import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { sha256File } from "./build-manifest.js";
import type { ChromePin } from "./chrome-pin.js";
import type {
  BrowserVersionIdentity,
  RegisteredBrowserValidation,
} from "./registered-environment.js";

const execFileAsync = promisify(execFile);
const FOUR_COMPONENT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const BROWSER_REVISION = /^@[a-f0-9]{40}$/u;
const PROTOCOL_VERSION = /^\d+\.\d+$/u;
const USER_AGENT_CHROME_VERSION = /(?:^|[ ()])Chrome\/(\d+\.\d+\.\d+\.\d+)(?=$|[ ()])/gu;
const MAX_BROWSER_IDENTITY_FIELD_LENGTH = 1_024;

export interface InstalledBrandedChromeIdentity {
  readonly executablePath: string;
  readonly executableSha256: string;
  readonly fileDescription: "Google Chrome";
  readonly fileVersion: string;
  readonly originalFilename: "chrome.exe";
  readonly productName: "Google Chrome";
  readonly registryPath: string;
  readonly signatureStatus: "Valid";
  readonly signerSubject: string;
}

interface RawInstalledBrandedChromeIdentity {
  readonly executablePath: unknown;
  readonly fileDescription: unknown;
  readonly fileVersion: unknown;
  readonly originalFilename: unknown;
  readonly productName: unknown;
  readonly registryPath: unknown;
  readonly signatureStatus: unknown;
  readonly signerSubject: unknown;
}

export const loadInboxPowerShellSecurityModuleScript = String.raw`
$securityModulePath = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
Import-Module -Name $securityModulePath -ErrorAction Stop
`;

const brandedChromeInspectionScript = String.raw`
$ErrorActionPreference = 'Stop'
${loadInboxPowerShellSecurityModuleScript}
$registryKeys = @(
  'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
  'Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
  'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'
)
$registrations = @()
foreach ($registryKey in $registryKeys) {
  if (Test-Path -LiteralPath $registryKey) {
    $key = Get-Item -LiteralPath $registryKey
    $value = $key.GetValue('')
    if ($value) { $registrations += [pscustomobject]@{ registryPath = $registryKey; executablePath = [string]$value } }
  }
}
$registrations = @($registrations | Sort-Object executablePath -Unique)
if ($registrations.Count -ne 1) { throw "Expected exactly one registered installed Chrome executable; received $($registrations.Count)" }
$registration = $registrations[0]
$item = Get-Item -LiteralPath $registration.executablePath
$signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $item.FullName
[pscustomobject]@{
  executablePath = $item.FullName
  registryPath = $registration.registryPath
  productName = $item.VersionInfo.ProductName
  fileDescription = $item.VersionInfo.FileDescription
  originalFilename = $item.VersionInfo.OriginalFilename
  fileVersion = $item.VersionInfo.FileVersion
  signatureStatus = [string]$signature.Status
  signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }
} | ConvertTo-Json -Compress
`;

export async function inspectInstalledBrandedChrome(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<InstalledBrandedChromeIdentity> {
  for (const name of ["PARALLAX_CHROME_PATH", "PARALLAX_BRANDED_CHROME_PATH"] as const) {
    if (environment[name] !== undefined && environment[name] !== "") {
      throw new Error(
        `${name} is forbidden for branded-Stable parity; use the registered installation`,
      );
    }
  }
  if (process.platform !== "win32") {
    throw new Error(
      `Branded-Stable parity requires the registered Windows dev-01 host, received ${process.platform}`,
    );
  }
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", brandedChromeInspectionScript],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  const raw = JSON.parse(stdout) as RawInstalledBrandedChromeIdentity;
  const canonicalPath = await realpath(requireString(raw.executablePath, "executablePath"));
  const executableSha256 = (await sha256File(canonicalPath)).sha256;
  return validateInstalledBrandedChromeIdentity({
    ...raw,
    executablePath: canonicalPath,
    executableSha256,
  });
}

export function validateInstalledBrandedChromeIdentity(
  value: Readonly<Record<keyof InstalledBrandedChromeIdentity, unknown>>,
): InstalledBrandedChromeIdentity {
  const executablePath = resolve(requireString(value.executablePath, "executablePath"));
  const registryPath = requireString(value.registryPath, "registryPath");
  const executableSha256 = requireMatch(value.executableSha256, SHA256, "executableSha256");
  const fileVersion = requireMatch(value.fileVersion, FOUR_COMPONENT_VERSION, "fileVersion");
  if (basename(executablePath).toLowerCase() !== "chrome.exe") {
    throw new Error("Installed branded Chrome executable must be chrome.exe");
  }
  requireExact(value.productName, "Google Chrome", "productName");
  requireExact(value.fileDescription, "Google Chrome", "fileDescription");
  requireExact(value.originalFilename, "chrome.exe", "originalFilename");
  requireExact(value.signatureStatus, "Valid", "signatureStatus");
  const signerSubject = requireString(value.signerSubject, "signerSubject");
  if (!/(?:^|,\s*)O=Google LLC(?:,|$)/u.test(signerSubject)) {
    throw new Error("Installed branded Chrome signer must be Google LLC");
  }
  if (!/^Registry::HKEY_(?:LOCAL_MACHINE|CURRENT_USER)\\/u.test(registryPath)) {
    throw new Error(
      "Installed branded Chrome must come from a machine or user App Paths registration",
    );
  }
  return Object.freeze({
    executablePath,
    executableSha256,
    fileDescription: "Google Chrome",
    fileVersion,
    originalFilename: "chrome.exe",
    productName: "Google Chrome",
    registryPath,
    signatureStatus: "Valid",
    signerSubject,
  });
}

export function requireBrandedChromeComparable(
  brandedVersion: string,
  comparisonReference: ChromePin,
): true {
  const branded = versionParts(brandedVersion, "installed branded Chrome");
  const reference = versionParts(comparisonReference.version, "selected Chrome for Testing");
  if (branded.major !== reference.major || branded.build !== reference.build) {
    throw new Error(
      `Installed branded Chrome ${brandedVersion} is not comparable to selected Chrome for Testing ${comparisonReference.version}: major/build must match (${reference.major}/${reference.build})`,
    );
  }
  return true;
}

export function brandedBrowserValidation(
  branded: InstalledBrandedChromeIdentity,
  comparisonReference: ChromePin,
  beforeVersionValidation?: (version: BrowserVersionIdentity) => Promise<void>,
): RegisteredBrowserValidation {
  requireBrandedChromeComparable(branded.fileVersion, comparisonReference);
  return Object.freeze({
    executableSha256: branded.executableSha256,
    playwrightChannel: "chrome",
    recordExtendedIdentity: true,
    ...(beforeVersionValidation === undefined ? {} : { beforeVersionValidation }),
    validateVersion: (version: BrowserVersionIdentity) =>
      validateBrandedBrowserVersion(version, branded, comparisonReference),
  });
}

export function validateBrandedBrowserVersion(
  version: BrowserVersionIdentity,
  branded: InstalledBrandedChromeIdentity,
  comparisonReference: ChromePin,
): true {
  requireBrandedChromeComparable(branded.fileVersion, comparisonReference);
  const productVersion = version.product.replace(/^Chrome\//u, "");
  if (version.product !== `Chrome/${branded.fileVersion}`) {
    throw new Error(
      `Branded Browser.getVersion product must match the registered executable: expected Chrome/${branded.fileVersion}, received ${version.product}`,
    );
  }
  requireBrandedChromeComparable(productVersion, comparisonReference);
  requireMatch(version.revision, BROWSER_REVISION, "Browser.getVersion revision");
  requireMatch(version.protocolVersion, PROTOCOL_VERSION, "Browser.getVersion protocolVersion");
  validateBrandedChromeUserAgent(version.userAgent, branded.fileVersion);
  if (version.jsVersion.trim() === "") throw new Error("Browser.getVersion jsVersion is empty");
  return true;
}

export function validateObservedBrowserVersionIdentity(value: unknown): BrowserVersionIdentity {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Browser.getVersion observation must be an object");
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = ["jsVersion", "product", "protocolVersion", "revision", "userAgent"];
  const actualKeys = Object.keys(record).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== [...expectedKeys].sort()[index])
  ) {
    throw new Error("Browser.getVersion observation has unexpected fields");
  }
  return Object.freeze({
    jsVersion: requireBoundedString(record.jsVersion, "Browser.getVersion jsVersion"),
    product: requireBoundedString(record.product, "Browser.getVersion product"),
    protocolVersion: requireBoundedString(
      record.protocolVersion,
      "Browser.getVersion protocolVersion",
    ),
    revision: requireBoundedString(record.revision, "Browser.getVersion revision"),
    userAgent: requireBoundedString(record.userAgent, "Browser.getVersion userAgent"),
  });
}

function validateBrandedChromeUserAgent(userAgent: string, brandedVersion: string): true {
  const matches = [...userAgent.matchAll(USER_AGENT_CHROME_VERSION)];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new Error("Browser.getVersion userAgent must identify exactly one Chrome family token");
  }
  const branded = versionParts(brandedVersion, "installed branded Chrome");
  const expectedReducedVersion = `${branded.major}.0.0.0`;
  const observedVersion = matches[0][1];
  if (observedVersion !== brandedVersion && observedVersion !== expectedReducedVersion) {
    throw new Error(
      `Browser.getVersion userAgent Chrome version must be the exact registered version or expected reduced form ${expectedReducedVersion}`,
    );
  }
  return true;
}

function versionParts(
  value: string,
  label: string,
): { readonly build: number; readonly major: number } {
  const match = value.match(FOUR_COMPONENT_VERSION);
  if (match === null) throw new Error(`${label} version must have four numeric components`);
  return Object.freeze({ major: Number(match[1]), build: Number(match[3]) });
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireBoundedString(value: unknown, label: string): string {
  const result = requireString(value, label);
  if (result.length > MAX_BROWSER_IDENTITY_FIELD_LENGTH) {
    throw new Error(`${label} exceeds ${MAX_BROWSER_IDENTITY_FIELD_LENGTH} characters`);
  }
  return result;
}

function requireMatch(value: unknown, pattern: RegExp, label: string): string {
  const result = requireString(value, label);
  if (!pattern.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function requireExact<T extends string>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw new Error(`${label} must be exactly ${expected}`);
  return expected;
}
