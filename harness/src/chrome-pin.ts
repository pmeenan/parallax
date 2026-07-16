import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium } from "playwright-core";
import { sha256File } from "./build-manifest.js";

export interface ChromePin {
  readonly channel: "stable";
  readonly downloads: Readonly<Record<string, string>>;
  readonly executableSha256: Readonly<Record<string, string>>;
  readonly revision: string;
  readonly version: string;
}

export interface PersistentChromeLaunchOptions {
  readonly args?: readonly string[];
  readonly ignoreDefaultArgs?: readonly string[];
}

export interface PromptApiChromeLaunchEvidence {
  readonly commandLine: string;
  readonly disabledFeatures: readonly string[];
  readonly modelDeliverySwitchesVerified: true;
  readonly webGpuDeveloperFeaturesEnabled: true;
}

const PLAYWRIGHT_DISABLED_FEATURES = Object.freeze([
  "AvoidUnnecessaryBeforeUnloadCheckSync",
  "BoundaryEventDispatchTracksNodeRemoval",
  "DestroyProfileOnBrowserClose",
  "DialMediaRouteProvider",
  "GlobalMediaControls",
  "HttpsUpgrades",
  "LensOverlay",
  "MediaRouter",
  "PaintHolding",
  "ThirdPartyStoragePartitioning",
  "Translate",
  "AutoDeElevate",
  "RenderDocument",
  "OptimizationHints",
  "msForceBrowserSignIn",
  "msEdgeUpdateLaunchServicesPreferredVersion",
]);

export const PROMPT_API_PRESERVED_DISABLED_FEATURES = Object.freeze(
  PLAYWRIGHT_DISABLED_FEATURES.filter((feature) => feature !== "OptimizationHints"),
);

// Playwright's normal automation defaults suppress the Chrome services needed for
// Prompt API model delivery. Ignore its combined feature argument, then restore every
// disabled feature except OptimizationHints so render/navigation/profile behavior
// stays aligned with ordinary smoke launches. Runtime command-line validation below
// makes exact-string drift in Playwright's private default fail closed.
export const PROMPT_API_IGNORED_PLAYWRIGHT_DEFAULT_ARGS = Object.freeze([
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-component-extensions-with-background-pages",
  `--disable-features=${PLAYWRIGHT_DISABLED_FEATURES.join(",")}`,
]);

export const PROMPT_API_CHROME_LAUNCH_ARGS = Object.freeze([
  `--disable-features=${PROMPT_API_PRESERVED_DISABLED_FEATURES.join(",")}`,
  "--enable-webgpu-developer-features",
]);

export function validatePromptApiChromeCommandLine(
  commandLine: string,
): PromptApiChromeLaunchEvidence {
  for (const forbiddenSwitch of [
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-component-extensions-with-background-pages",
  ]) {
    if (hasCommandLineSwitch(commandLine, forbiddenSwitch)) {
      throw new Error(
        `Prompt API model delivery is disabled by effective Chrome switch ${forbiddenSwitch}`,
      );
    }
  }
  const disabledFeatures = readDisabledFeatures(commandLine);
  if (disabledFeatures.includes("OptimizationHints")) {
    throw new Error(
      "Prompt API model delivery is disabled because effective Chrome features include OptimizationHints",
    );
  }
  const missingPreservedFeatures = PROMPT_API_PRESERVED_DISABLED_FEATURES.filter(
    (feature) => !disabledFeatures.includes(feature),
  );
  if (missingPreservedFeatures.length > 0) {
    throw new Error(
      `Prompt API launch no longer preserves Playwright's rendering/navigation/profile feature suppressions: ${missingPreservedFeatures.join(", ")}`,
    );
  }
  if (!hasCommandLineSwitch(commandLine, "--enable-webgpu-developer-features")) {
    throw new Error(
      "Prompt API environment identity requires effective Chrome switch --enable-webgpu-developer-features",
    );
  }
  return Object.freeze({
    commandLine,
    disabledFeatures: Object.freeze(disabledFeatures),
    modelDeliverySwitchesVerified: true,
    webGpuDeveloperFeaturesEnabled: true,
  });
}

function readDisabledFeatures(commandLine: string): string[] {
  const features: string[] = [];
  for (const match of commandLine.matchAll(/(?:^|\s)--disable-features=(?:"([^"]*)"|(\S+))/g)) {
    const value = match[1] ?? match[2];
    if (value !== undefined && value !== "") features.push(...value.split(","));
  }
  return [...new Set(features)];
}

function hasCommandLineSwitch(commandLine: string, expected: string): boolean {
  return commandLine.split(/\s+/).includes(expected);
}

export async function loadChromePin(path: string): Promise<ChromePin> {
  return JSON.parse(await readFile(path, "utf8")) as ChromePin;
}

export async function resolveChromeExecutablePath(
  repositoryRoot: string,
  chromePin: ChromePin,
): Promise<string> {
  const override = process.env.PARALLAX_CHROME_PATH;
  if (override !== undefined && override !== "") return resolve(override);
  const versionRoot = join(repositoryRoot, "harness/chrome/cft", chromePin.version);
  const conventional =
    process.platform === "darwin"
      ? join(versionRoot, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
      : process.platform === "win32"
        ? join(versionRoot, "chrome.exe")
        : join(versionRoot, "chrome");
  try {
    await access(conventional);
  } catch {
    throw new Error(
      `Pinned Chrome for Testing ${chromePin.version} was not found at the conventional path ${conventional}. Extract the pinned archive's platform directory contents there, or set PARALLAX_CHROME_PATH to the executable.`,
    );
  }
  return conventional;
}

export async function validateChromeExecutable(
  chromePin: ChromePin,
  executablePath: string,
): Promise<string> {
  const platformKey = chromePlatformKey();
  const expected = chromePin.executableSha256[platformKey];
  if (expected === undefined) {
    throw new Error(`Chrome for Testing executable digest is not pinned for ${platformKey}`);
  }
  const actual = (await sha256File(executablePath)).sha256;
  if (actual !== expected) {
    throw new Error(`Chrome executable digest mismatch: expected ${expected}, received ${actual}`);
  }
  return actual;
}

export function chromePlatformKey(): string {
  if (process.platform === "win32" && process.arch === "x64") return "win64";
  if (process.platform === "linux" && process.arch === "x64") return "linux64";
  if (process.platform === "darwin" && process.arch === "arm64") return "mac-arm64";
  if (process.platform === "darwin" && process.arch === "x64") return "mac-x64";
  throw new Error(`No Chrome for Testing platform mapping for ${process.platform}/${process.arch}`);
}

export function launchPersistentChrome(
  executablePath: string,
  profilePath: string,
  options: readonly string[] | PersistentChromeLaunchOptions = [],
): Promise<BrowserContext> {
  const normalized: PersistentChromeLaunchOptions = Array.isArray(options)
    ? { args: options as readonly string[] }
    : (options as PersistentChromeLaunchOptions);
  return chromium.launchPersistentContext(profilePath, {
    args: ["--start-fullscreen", ...(normalized.args ?? [])],
    executablePath,
    headless: false,
    ...(normalized.ignoreDefaultArgs === undefined
      ? {}
      : { ignoreDefaultArgs: [...normalized.ignoreDefaultArgs] }),
    viewport: null,
  });
}
