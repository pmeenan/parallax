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
  args: readonly string[] = [],
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(
    profilePath,
    createPersistentChromeLaunchOptions(executablePath, args),
  );
}

export function createPersistentChromeLaunchOptions(
  executablePath: string,
  args: readonly string[] = [],
) {
  if (
    args.some((argument) => argument === "--no-sandbox" || argument.startsWith("--no-sandbox="))
  ) {
    throw new Error("Parallax Chrome launches may not disable process sandboxing");
  }
  return {
    args: ["--start-fullscreen", ...args],
    chromiumSandbox: true,
    executablePath,
    headless: false,
    viewport: null,
  };
}
