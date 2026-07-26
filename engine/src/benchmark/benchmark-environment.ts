import {
  type BenchmarkBrowserIdentity,
  type BenchmarkCapability,
  type BenchmarkEnvironmentIdentity,
  type BenchmarkGpuAdapterIdentity,
  type BenchmarkMetric,
  type BenchmarkQualityPreset,
  type BenchmarkScreenIdentity,
  invalidMetric,
  measuredMetric,
  notApplicableMetric,
  unsupportedMetric,
} from "./benchmark-contract";

interface NavigatorUserAgentData {
  readonly brands: readonly Readonly<{ readonly brand: string; readonly version: string }>[];
  getHighEntropyValues(hints: readonly string[]): Promise<
    Readonly<{
      readonly architecture?: string;
      readonly bitness?: string;
      readonly fullVersionList?: readonly Readonly<{
        readonly brand: string;
        readonly version: string;
      }>[];
      readonly mobile?: boolean;
      readonly model?: string;
      readonly platform?: string;
      readonly platformVersion?: string;
      readonly wow64?: boolean;
    }>
  >;
  readonly mobile: boolean;
  readonly platform: string;
}

type NavigatorWithBenchmarkSurfaces = Navigator & {
  readonly deviceMemory?: number;
  readonly userAgentData?: NavigatorUserAgentData;
};

// Independent page-consumer pin. Harness regression coverage binds this to the
// producer-side build-manifest contract so either side drifting fails review.
export const BENCHMARK_BUILD_MANIFEST_SCHEMA_VERSION = 11;

export interface BenchmarkLongTaskMonitor {
  finish(): BenchmarkMetric<number>;
}

export interface BenchmarkPlatform {
  captureEnvironment(preset: BenchmarkQualityPreset): Promise<BenchmarkEnvironmentIdentity>;
  createLongTaskMonitor(): BenchmarkLongTaskMonitor;
  generatedAt(): string;
}

export function createBrowserBenchmarkPlatform(): BenchmarkPlatform {
  return Object.freeze({
    captureEnvironment: captureBrowserBenchmarkEnvironment,
    createLongTaskMonitor: createBrowserLongTaskMonitor,
    generatedAt: () => new Date().toISOString(),
  });
}

export async function captureBrowserBenchmarkEnvironment(
  _preset: BenchmarkQualityPreset,
): Promise<BenchmarkEnvironmentIdentity> {
  const benchmarkNavigator = navigator as NavigatorWithBenchmarkSurfaces;
  const [browser, artifactDigest, gpuAdapter] = await Promise.all([
    readBrowserIdentity(benchmarkNavigator),
    readArtifactDigest(),
    readGpuAdapter(benchmarkNavigator),
  ]);
  return Object.freeze({
    artifactDigest,
    browser,
    capabilities: readCapabilities(benchmarkNavigator),
    gpuAdapter,
    hardwareConcurrency: navigator.hardwareConcurrency,
    hostIdentity: unsupportedMetric<never>(
      "Page APIs do not expose registered-machine identity, host OS build, complete GPU driver identity, or physical-console attestation",
    ),
    powerAndSessionState: unsupportedMetric<never>(
      "Page APIs do not attest OS power scheme, remote-session state, display wake state, or display-adapter routing",
    ),
    referenceEligibility:
      browser.name === "Google Chrome"
        ? unsupportedMetric<true>(
            "Chrome reference eligibility requires registered host, power, driver, and physical-console evidence unavailable to the in-game page",
          )
        : notApplicableMetric<true>(
            "Only Chrome on a registered reference machine can carry budgets",
          ),
    screen: readScreenIdentity(),
  });
}

export function createBrowserLongTaskMonitor(): BenchmarkLongTaskMonitor {
  if (!PerformanceObserver.supportedEntryTypes.includes("longtask")) {
    return Object.freeze({
      finish: () =>
        unsupportedMetric<number>(
          "This browser does not expose the Window-scoped Long Tasks performance entry",
        ),
    });
  }
  let count = 0;
  let finished = false;
  const observer = new PerformanceObserver((list) => {
    count += list.getEntries().filter((entry) => entry.duration > 50).length;
  });
  observer.observe({ type: "longtask" } as PerformanceObserverInit);
  return Object.freeze({
    finish(): BenchmarkMetric<number> {
      if (finished) return invalidMetric("Long-task measurement was finished more than once");
      finished = true;
      count += observer.takeRecords().filter((entry) => entry.duration > 50).length;
      observer.disconnect();
      return measuredMetric(count);
    },
  });
}

async function readBrowserIdentity(
  benchmarkNavigator: NavigatorWithBenchmarkSurfaces,
): Promise<BenchmarkBrowserIdentity> {
  const uaData = benchmarkNavigator.userAgentData;
  if (uaData !== undefined) {
    try {
      const highEntropy = await uaData.getHighEntropyValues([
        "architecture",
        "bitness",
        "fullVersionList",
        "model",
        "platformVersion",
        "wow64",
      ]);
      const fullVersionList = Object.freeze(
        (highEntropy.fullVersionList ?? uaData.brands).map((item) =>
          Object.freeze({ brand: item.brand, version: item.version }),
        ),
      );
      const selected = selectBrowserBrand(fullVersionList);
      return Object.freeze({
        engine: chromiumBrand(fullVersionList) ? "Chromium" : "unknown",
        fullVersionList,
        mobile: highEntropy.mobile ?? uaData.mobile,
        name: selected?.brand ?? "unknown",
        platform: highEntropy.platform ?? uaData.platform,
        platformVersion: highEntropy.platformVersion ?? null,
        userAgent: benchmarkNavigator.userAgent,
        version: selected?.version ?? null,
      });
    } catch {
      // UA-CH is an identity enhancement. Preserve the ordinary user agent below
      // when policy or browser implementation rejects high-entropy values.
    }
  }
  const parsed = parseReducedUserAgent(benchmarkNavigator.userAgent);
  return Object.freeze({
    engine: parsed.engine,
    fullVersionList: Object.freeze([]),
    mobile: null,
    name: parsed.name,
    platform: benchmarkNavigator.platform || null,
    platformVersion: null,
    userAgent: benchmarkNavigator.userAgent,
    version: parsed.version,
  });
}

function selectBrowserBrand(
  brands: readonly Readonly<{ readonly brand: string; readonly version: string }>[],
): Readonly<{ readonly brand: string; readonly version: string }> | undefined {
  return (
    brands.find((brand) => brand.brand === "Google Chrome") ??
    brands.find((brand) => brand.brand === "Microsoft Edge") ??
    brands.find((brand) => brand.brand === "Chromium") ??
    brands.find((brand) => !/not.?a.?brand/i.test(brand.brand))
  );
}

function chromiumBrand(
  brands: readonly Readonly<{ readonly brand: string; readonly version: string }>[],
): boolean {
  return brands.some((brand) => brand.brand === "Chromium");
}

function parseReducedUserAgent(userAgent: string): Readonly<{
  readonly engine: string;
  readonly name: string;
  readonly version: string | null;
}> {
  const firefox = userAgent.match(/Firefox\/([0-9.]+)/);
  if (firefox !== null) {
    return Object.freeze({ engine: "Gecko", name: "Firefox", version: firefox[1] ?? null });
  }
  const edge = userAgent.match(/Edg\/([0-9.]+)/);
  if (edge !== null) {
    return Object.freeze({ engine: "Chromium", name: "Microsoft Edge", version: edge[1] ?? null });
  }
  const chrome = userAgent.match(/Chrome\/([0-9.]+)/);
  if (chrome !== null) {
    return Object.freeze({ engine: "Chromium", name: "Google Chrome", version: chrome[1] ?? null });
  }
  const safari = userAgent.match(/Version\/([0-9.]+).*Safari\//);
  if (safari !== null) {
    return Object.freeze({ engine: "WebKit", name: "Safari", version: safari[1] ?? null });
  }
  return Object.freeze({ engine: "unknown", name: "unknown", version: null });
}

async function readArtifactDigest(): Promise<BenchmarkMetric<string>> {
  try {
    const response = await fetch(new URL("/build-manifest.json", location.href), {
      cache: "no-store",
    });
    if (!response.ok) {
      return invalidMetric(`Build manifest request returned HTTP ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (
      !record(parsed) ||
      parsed.schemaVersion !== BENCHMARK_BUILD_MANIFEST_SCHEMA_VERSION ||
      !Array.isArray(parsed.artifacts) ||
      !Array.isArray(parsed.workerEntrypoints) ||
      !Array.isArray(parsed.gameContentEntrypoints)
    ) {
      return invalidMetric(
        `Build manifest does not satisfy schema v${BENCHMARK_BUILD_MANIFEST_SCHEMA_VERSION} identity fields`,
      );
    }
    return measuredMetric(hex(await crypto.subtle.digest("SHA-256", bytes)));
  } catch (error: unknown) {
    return invalidMetric(`Build artifact identity is unavailable: ${errorMessage(error)}`);
  }
}

async function readGpuAdapter(
  benchmarkNavigator: NavigatorWithBenchmarkSurfaces,
): Promise<BenchmarkMetric<BenchmarkGpuAdapterIdentity>> {
  if (benchmarkNavigator.gpu === undefined) {
    return unsupportedMetric("WebGPU is unavailable");
  }
  try {
    const adapter = await benchmarkNavigator.gpu.requestAdapter();
    if (adapter === null) return invalidMetric("WebGPU did not return an adapter");
    return measuredMetric(
      Object.freeze({
        architecture: adapter.info.architecture,
        description: adapter.info.description,
        device: adapter.info.device,
        isFallbackAdapter: adapter.info.isFallbackAdapter,
        source: "window-request-adapter" as const,
        vendor: adapter.info.vendor,
      }),
    );
  } catch (error: unknown) {
    return invalidMetric(`WebGPU adapter identity failed: ${errorMessage(error)}`);
  }
}

function readScreenIdentity(): BenchmarkScreenIdentity {
  const devicePixelRatio = window.devicePixelRatio;
  return Object.freeze({
    availableCssPixels: Object.freeze({ height: screen.availHeight, width: screen.availWidth }),
    colorDepth: screen.colorDepth,
    cssPixels: Object.freeze({ height: screen.height, width: screen.width }),
    devicePixelRatio,
    orientation: Object.freeze({
      angle: screen.orientation?.angle ?? 0,
      type: screen.orientation?.type ?? "unknown",
    }),
    physicalPixelEstimate: Object.freeze({
      height: Math.round(screen.height * devicePixelRatio),
      width: Math.round(screen.width * devicePixelRatio),
    }),
    viewportCssPixels: Object.freeze({ height: innerHeight, width: innerWidth }),
  });
}

function readCapabilities(
  benchmarkNavigator: NavigatorWithBenchmarkSurfaces,
): readonly BenchmarkCapability[] {
  const sharedMemory = supportsSharedWasmMemory();
  return Object.freeze([
    capability("cross-origin-isolated", crossOriginIsolated),
    capability("offscreen-canvas", typeof OffscreenCanvas === "function"),
    capability("opfs", typeof benchmarkNavigator.storage?.getDirectory === "function"),
    capability("shared-array-buffer", typeof SharedArrayBuffer === "function"),
    capability("wasm-simd", supportsWasmSimd()),
    capability("wasm-threads", sharedMemory),
    capability("webgpu", benchmarkNavigator.gpu !== undefined),
    capability("window-long-tasks", PerformanceObserver.supportedEntryTypes.includes("longtask")),
  ]);
}

function capability(id: BenchmarkCapability["id"], available: boolean): BenchmarkCapability {
  return Object.freeze({ id, state: available ? "available" : "unavailable" });
}

function supportsSharedWasmMemory(): boolean {
  try {
    return (
      typeof SharedArrayBuffer === "function" &&
      new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof
        SharedArrayBuffer
    );
  } catch {
    return false;
  }
}

export function supportsWasmSimd(): boolean {
  return WebAssembly.validate(
    new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 9, 1, 7, 0, 65, 0, 253, 15,
      26, 11,
    ]),
  );
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}
