import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium } from "playwright-core";
import { sha256File } from "./build-manifest.js";

export interface ChromePin {
  readonly browserRevision: string;
  readonly channel: "stable";
  readonly downloads: Readonly<Record<string, string>>;
  readonly executableSha256: Readonly<Record<string, string>>;
  readonly revision: string;
  readonly version: string;
}

export type ChromeLaunchMode = "branded-stable-channel" | "pinned-executable";

const CHROME_PIN_ANCHOR_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const CHROME_PIN_KEYS = Object.freeze([
  "browserRevision",
  "channel",
  "downloads",
  "executableSha256",
  "revision",
  "version",
]);
const CHROME_DOWNLOAD_PLATFORMS = Object.freeze(["linux64", "mac-arm64", "mac-x64", "win64"]);
const CHROME_EXECUTABLE_DIGEST_PLATFORMS = Object.freeze(["win64"]);
const CHROME_BROWSER_REVISION = /^@[0-9a-f]{40}$/;
const CHROME_FOR_TESTING_REVISION = /^[1-9]\d*$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function validateChromeSandboxCommandLine(commandLine: string): true {
  if (hasCommandLineSwitch(commandLine, "--no-sandbox")) {
    throw new Error("Chrome launch disabled process sandboxing with --no-sandbox");
  }
  return true;
}

function hasCommandLineSwitch(commandLine: string, expected: string): boolean {
  return commandLine
    .split(/\s+/)
    .some((token) => token === expected || token.startsWith(`${expected}=`));
}

export async function loadChromePin(path: string): Promise<ChromePin> {
  return validateChromePinDescriptor(JSON.parse(await readFile(path, "utf8")), path);
}

export function validateChromePinDescriptor(value: unknown, label = "Chrome pin"): ChromePin {
  const pin = requireRecord(value, label);
  requireExactKeys(pin, CHROME_PIN_KEYS, label);
  const version = requireMatchingString(pin.version, CHROME_PIN_ANCHOR_VERSION, `${label}.version`);
  if (pin.channel !== "stable") {
    throw new Error(`${label}.channel must be exactly stable`);
  }
  const revision = requireMatchingString(
    pin.revision,
    CHROME_FOR_TESTING_REVISION,
    `${label}.revision`,
  );
  const browserRevision = requireMatchingString(
    pin.browserRevision,
    CHROME_BROWSER_REVISION,
    `${label}.browserRevision`,
  );
  const downloads = requireExactStringRecord(
    pin.downloads,
    CHROME_DOWNLOAD_PLATFORMS,
    `${label}.downloads`,
  );
  for (const platform of CHROME_DOWNLOAD_PLATFORMS) {
    const expected = chromeForTestingDownloadUrl(version, platform);
    if (downloads[platform] !== expected) {
      throw new Error(
        `${label}.downloads.${platform} must be the exact Chrome for Testing URL ${expected}`,
      );
    }
  }
  const executableSha256 = requireExactStringRecord(
    pin.executableSha256,
    CHROME_EXECUTABLE_DIGEST_PLATFORMS,
    `${label}.executableSha256`,
  );
  for (const platform of CHROME_EXECUTABLE_DIGEST_PLATFORMS) {
    requireMatchingString(
      executableSha256[platform],
      SHA256,
      `${label}.executableSha256.${platform}`,
    );
  }
  return Object.freeze({
    browserRevision,
    channel: "stable",
    downloads: Object.freeze(downloads),
    executableSha256: Object.freeze(executableSha256),
    revision,
    version,
  });
}

export function validateChromeBrowserIdentity(
  chromePin: ChromePin,
  observed: Readonly<{ readonly product: string; readonly revision: string }>,
): true {
  const actualVersion = observed.product.replace(/^Chrome\//, "");
  if (actualVersion !== chromePin.version) {
    throw new Error(
      `Chrome for Testing version mismatch: expected ${chromePin.version}, received ${actualVersion}`,
    );
  }
  if (observed.revision !== chromePin.browserRevision) {
    throw new Error(
      `Chrome for Testing browser revision mismatch: expected ${chromePin.browserRevision}, received ${observed.revision}`,
    );
  }
  return true;
}

export async function resolveSmokeChromePinPath(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const anchor = environment.PARALLAX_CHROME_PIN_ANCHOR;
  if (anchor === undefined || anchor === "") {
    return join(repositoryRoot, "harness/chrome/stable.json");
  }
  if (!CHROME_PIN_ANCHOR_VERSION.test(anchor)) {
    throw new Error(
      `PARALLAX_CHROME_PIN_ANCHOR must be an exact four-component Chrome version, received ${JSON.stringify(anchor)}`,
    );
  }
  const path = join(repositoryRoot, "harness/chrome/anchors", `${anchor}.json`);
  try {
    await access(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Unknown Chrome pin anchor ${anchor}`);
    }
    throw error;
  }
  return path;
}

export async function loadSmokeChromePin(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ChromePin> {
  const path = await resolveSmokeChromePinPath(repositoryRoot, environment);
  const pin = await loadChromePin(path);
  const anchor = environment.PARALLAX_CHROME_PIN_ANCHOR;
  if (anchor !== undefined && anchor !== "" && pin.version !== anchor) {
    throw new Error(
      `Chrome pin anchor descriptor version mismatch: selected ${anchor}, descriptor declares ${pin.version}`,
    );
  }
  return pin;
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
  args: readonly string[] = [],
  launchMode: ChromeLaunchMode = "pinned-executable",
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(
    profilePath,
    createPersistentChromeLaunchOptions(executablePath, args, launchMode),
  );
}

export function createPersistentChromeLaunchOptions(
  executablePath: string,
  args: readonly string[] = [],
  launchMode: ChromeLaunchMode = "pinned-executable",
) {
  if (
    args.some((argument) => argument === "--no-sandbox" || argument.startsWith("--no-sandbox="))
  ) {
    throw new Error("Parallax Chrome launches may not disable process sandboxing");
  }
  return {
    args: ["--start-fullscreen", ...args],
    // Playwright 1.61.1 accepts channel and executablePath together: executablePath
    // selects the spawned binary while channel retains the branded Chrome launch mode.
    ...(launchMode === "branded-stable-channel" ? { channel: "chrome" as const } : {}),
    chromiumSandbox: true,
    executablePath,
    headless: false,
    viewport: null,
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`${label} keys must be exactly ${sortedExpected.join(", ")}`);
  }
}

function requireMatchingString(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} has an invalid value`);
  }
  return value;
}

function requireExactStringRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, string> {
  const record = requireRecord(value, label);
  requireExactKeys(record, expectedKeys, label);
  const strings: Record<string, string> = {};
  for (const key of expectedKeys) {
    if (typeof record[key] !== "string") {
      throw new Error(`${label}.${key} must be a string`);
    }
    strings[key] = record[key];
  }
  return strings;
}

function chromeForTestingDownloadUrl(version: string, platform: string): string {
  return `https://storage.googleapis.com/chrome-for-testing-public/${version}/${platform}/chrome-${platform}.zip`;
}
