import type { CDPSession } from "playwright-core";
import {
  readBrowserDisplayIdentity,
  readChromeCommandLine,
  readWebGpuAdapterIdentity,
} from "./browser-probes.js";
import type { QualityTier } from "./budgets.js";
import { sha256File } from "./build-manifest.js";
import {
  type ChromePin,
  launchPersistentChrome,
  validateChromeBrowserIdentity,
  validateChromeExecutable,
  validateChromeSandboxCommandLine,
} from "./chrome-pin.js";
import {
  type BrowserDisplayIdentity,
  type CdpGpuDevice,
  type EnvironmentGateState,
  evaluateGateEnvironment,
  invalidEnvironmentGate,
  loadMachineDescriptor,
  type MachineDescriptor,
  tryReadWindowsHostIdentity,
  type WebGpuAdapterIdentity,
  type WindowsHostIdentity,
} from "./environment.js";
import { launchAfterPhysicalConsoleDisplayWake } from "./physical-console-preflight.js";
import { QUALITY_TIER_PROFILES } from "./runs/smoke.js";
import {
  assertHarnessNavigationUrl,
  failedTargetEvidence,
  type HarnessTargetIdentity,
  type HarnessTargetVerificationEvidence,
  verifiedTargetEvidence,
} from "./target.js";
import { errorMessage } from "./value-utils.js";

export interface RegisteredEnvironmentIdentity {
  readonly adapter: WebGpuAdapterIdentity | null;
  readonly browserDisplay: BrowserDisplayIdentity | null;
  readonly browserCommandLine: string;
  readonly browserProduct: string;
  readonly browserChannel?: "chrome";
  readonly browserProtocolVersion?: string;
  readonly browserRevision: string;
  readonly browserUserAgent: string;
  readonly executableSha256: string;
  readonly executablePath?: string;
  readonly gateIdentity: EnvironmentGateState;
  readonly gpuDevices: readonly CdpGpuDevice[];
  readonly host: WindowsHostIdentity | null;
  readonly hostAfterRuns: WindowsHostIdentity | null;
  readonly jsVersion: string;
  readonly machine: MachineDescriptor | null;
  readonly machineId: string;
  readonly requestedTier: QualityTier;
  readonly sandboxVerified: true;
  readonly target: HarnessTargetIdentity;
  readonly targetPostflight: HarnessTargetVerificationEvidence;
  readonly targetPreflight: HarnessTargetVerificationEvidence;
  readonly targetDisplayMode: string;
}

export interface RegisteredBrowserValidation {
  readonly beforeVersionValidation?: (version: BrowserVersionIdentity) => Promise<void>;
  readonly executableSha256: string;
  readonly playwrightChannel: "chrome";
  readonly recordExtendedIdentity: true;
  readonly validateVersion: (version: BrowserVersionIdentity) => true;
}

export interface BrowserVersionIdentity {
  readonly jsVersion: string;
  readonly product: string;
  readonly protocolVersion: string;
  readonly revision: string;
  readonly userAgent: string;
}

export async function inspectRegisteredEnvironment(input: {
  readonly chromePin: ChromePin;
  readonly executablePath: string;
  readonly machineId: string;
  readonly machineRoot: string;
  readonly probeUrl: string;
  readonly profilePath: string;
  readonly target: HarnessTargetIdentity;
  readonly tier: QualityTier;
  readonly validation?: RegisteredBrowserValidation;
}): Promise<RegisteredEnvironmentIdentity> {
  const executableSha256 =
    input.validation === undefined
      ? await validateChromeExecutable(input.chromePin, input.executablePath)
      : (await sha256File(input.executablePath)).sha256;
  if (input.validation !== undefined && executableSha256 !== input.validation.executableSha256) {
    throw new Error(
      `Branded Chrome executable changed before identity launch: expected ${input.validation.executableSha256}, received ${executableSha256}`,
    );
  }
  let machine: MachineDescriptor | null = null;
  let machineDescriptorFailure: string | null = null;
  try {
    machine = await loadMachineDescriptor(input.machineRoot, input.machineId);
  } catch (error) {
    machineDescriptorFailure = `Machine descriptor unavailable: ${errorMessage(error)}`;
  }
  const hostResultPromise = tryReadWindowsHostIdentity();
  const context = await launchAfterPhysicalConsoleDisplayWake(() =>
    launchPersistentChrome(
      input.executablePath,
      input.profilePath,
      ["--enable-webgpu-developer-features"],
      input.validation === undefined ? "pinned-executable" : "branded-stable-channel",
    ),
  );
  let session: CDPSession | null = null;
  try {
    const browser = context.browser();
    if (browser === null) throw new Error("Playwright did not expose the launched browser");
    session = await browser.newBrowserCDPSession();
    const version = (await session.send("Browser.getVersion")) as BrowserVersionIdentity;
    if (input.validation === undefined) validateChromeBrowserIdentity(input.chromePin, version);
    else {
      await input.validation.beforeVersionValidation?.(version);
      input.validation.validateVersion(version);
    }
    const systemInfo = (await session.send("SystemInfo.getInfo")) as {
      gpu: { devices: readonly CdpGpuDevice[] };
    };
    const browserCommandLine = await readChromeCommandLine(context);
    const sandboxVerified = validateChromeSandboxCommandLine(browserCommandLine);
    const primaryGpu = systemInfo.gpu.devices[0];
    if (primaryGpu === undefined) throw new Error("CDP did not report a primary GPU");
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(input.probeUrl, { waitUntil: "load" });
    assertHarnessNavigationUrl(page.url(), input.probeUrl, "smoke identity probe");
    const adapterResult = await tryProbe("WebGPU adapter identity", () =>
      readWebGpuAdapterIdentity(page),
    );
    const browserDisplayResult = await tryProbe("Browser display identity", () =>
      readBrowserDisplayIdentity(context, page),
    );
    const adapter = adapterResult.state === "measured" ? adapterResult.value : null;
    const browserDisplay =
      browserDisplayResult.state === "measured" ? browserDisplayResult.value : null;
    const hostResult = await hostResultPromise;
    const host = hostResult.state === "measured" ? hostResult.host : null;
    const identityFailures = [
      ...(machineDescriptorFailure === null ? [] : [machineDescriptorFailure]),
      ...(hostResult.state === "invalid" ? [hostResult.reason] : []),
      ...(adapterResult.state === "invalid" ? [adapterResult.reason] : []),
      ...(browserDisplayResult.state === "invalid" ? [browserDisplayResult.reason] : []),
    ];
    const gateIdentity =
      machine === null || host === null || adapter === null || browserDisplay === null
        ? invalidEnvironmentGate(identityFailures)
        : evaluateGateEnvironment(machine, {
            adapter,
            arch: process.arch,
            browserDisplay,
            host,
            platform: process.platform,
            primaryGpu,
            requestedTier: input.tier,
          });
    return Object.freeze({
      adapter,
      browserDisplay,
      browserCommandLine,
      browserProduct: version.product,
      ...(input.validation === undefined
        ? {}
        : {
            browserProtocolVersion: version.protocolVersion,
            browserChannel: input.validation.playwrightChannel,
            executablePath: input.executablePath,
          }),
      browserRevision: version.revision,
      browserUserAgent: version.userAgent,
      executableSha256,
      gateIdentity,
      gpuDevices: systemInfo.gpu.devices,
      host,
      hostAfterRuns: null,
      jsVersion: version.jsVersion,
      machine,
      machineId: machine?.id ?? input.machineId,
      requestedTier: input.tier,
      sandboxVerified,
      target: input.target,
      targetPostflight: failedTargetEvidence("Serving target postflight has not run"),
      targetPreflight: verifiedTargetEvidence(input.target),
      targetDisplayMode: QUALITY_TIER_PROFILES[input.tier].targetDisplayMode,
    });
  } finally {
    await session?.detach().catch(() => undefined);
    await context.close();
  }
}

type ProbeResult<T> =
  | Readonly<{ readonly state: "measured"; readonly value: T }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" }>;

async function tryProbe<T>(label: string, probe: () => Promise<T>): Promise<ProbeResult<T>> {
  try {
    return Object.freeze({ state: "measured", value: await probe() });
  } catch (error) {
    return Object.freeze({
      reason: `${label} probe failed: ${errorMessage(error)}`,
      state: "invalid",
    });
  }
}
