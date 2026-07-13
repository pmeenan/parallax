import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { QualityTier } from "./budgets.js";
import { QUALITY_TIER_PROFILES } from "./runs/smoke.js";

const execFileAsync = promisify(execFile);

export interface MachineDescriptor {
  readonly arch: string;
  readonly cpu: {
    readonly cores: number;
    readonly logicalProcessors: number;
    readonly name: string;
  };
  readonly display: {
    readonly dimensionTolerancePixels: number;
    readonly height: number;
    readonly refreshRateHz: number;
    readonly refreshRateToleranceHz: number;
    readonly width: number;
  };
  readonly gateTiers: readonly QualityTier[];
  readonly gpu: {
    readonly architecture: string;
    readonly backend: string;
    readonly deviceId: number;
    readonly driverVersion: string;
    readonly name: string;
    readonly subSysId: number;
    readonly vendor: string;
    readonly vendorId: number;
  };
  readonly id: string;
  readonly minimumPhysicalMemoryBytes: number;
  readonly osBuild: string;
  readonly platform: NodeJS.Platform;
  readonly powerSchemeGuid: string;
  readonly schemaVersion: 1;
}

export interface WindowsHostIdentity {
  readonly cpu: MachineDescriptor["cpu"];
  readonly os: {
    readonly build: string;
    readonly caption: string;
  };
  readonly physicalMemoryBytes: number;
  readonly power: {
    readonly guid: string;
    readonly name: string | null;
  };
  readonly remoteSession: boolean;
  readonly videoControllers: readonly {
    readonly driverVersion: string;
    readonly height: number | null;
    readonly name: string;
    readonly pnpDeviceId: string;
    readonly refreshRateHz: number | null;
    readonly width: number | null;
  }[];
}

export interface CdpGpuDevice {
  readonly deviceId: number;
  readonly deviceString: string;
  readonly driverVendor: string;
  readonly driverVersion: string;
  readonly revision: number;
  readonly subSysId: number;
  readonly vendorId: number;
  readonly vendorString: string;
}

export interface WebGpuAdapterIdentity {
  readonly architecture: string;
  readonly backend: string | null;
  readonly description: string;
  readonly device: string;
  readonly driver: string | null;
  readonly isFallbackAdapter: boolean;
  readonly type: string | null;
  readonly vendor: string;
}

export interface BrowserDisplayIdentity {
  readonly probeFailures: readonly string[];
  readonly refreshRatesHz: readonly number[];
  readonly screen: {
    readonly availHeight: number;
    readonly availWidth: number;
    readonly colorDepth: number;
    readonly devicePixelRatio: number;
    readonly height: number;
    readonly width: number;
  } | null;
}

export interface GateEnvironmentObservation {
  readonly adapter: WebGpuAdapterIdentity;
  readonly arch: string;
  readonly browserDisplay: BrowserDisplayIdentity;
  readonly host: WindowsHostIdentity;
  readonly primaryGpu: CdpGpuDevice;
  readonly requestedTier: QualityTier;
  readonly platform: NodeJS.Platform;
}

export type EnvironmentGateState =
  | Readonly<{ readonly state: "measured"; readonly value: true }>
  | Readonly<{
      readonly reasons: readonly string[];
      readonly state: "invalid";
      readonly value: false;
    }>;

export type WindowsHostIdentityResult =
  | Readonly<{ readonly host: WindowsHostIdentity; readonly state: "measured" }>
  | Readonly<{ readonly reason: string; readonly state: "invalid" }>;

export function invalidEnvironmentGate(reasons: string | readonly string[]): EnvironmentGateState {
  const normalized = typeof reasons === "string" ? [reasons] : [...reasons];
  return Object.freeze({
    reasons: Object.freeze(normalized),
    state: "invalid",
    value: false,
  });
}

interface RawWindowsHostIdentity {
  readonly cpu: MachineDescriptor["cpu"];
  readonly osBuild: string;
  readonly osCaption: string;
  readonly physicalMemoryBytes: number;
  readonly powerScheme: string;
  readonly remoteSession: boolean;
  readonly videoControllers: WindowsHostIdentity["videoControllers"];
}

async function readMachineDescriptor(path: string): Promise<MachineDescriptor> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  const validationErrors = machineDescriptorValidationErrors(value);
  if (validationErrors.length > 0) {
    throw new Error(`Invalid machine descriptor at ${path}: ${validationErrors.join("; ")}`);
  }
  return value as MachineDescriptor;
}

export async function loadMachineDescriptor(
  machineRoot: string,
  machineId: string,
): Promise<MachineDescriptor> {
  if (!isMachineId(machineId)) {
    throw new Error(`Invalid machine ID ${JSON.stringify(machineId)}`);
  }
  const normalizedMachineId = machineId.toLowerCase();
  const descriptor = await readMachineDescriptor(join(machineRoot, `${normalizedMachineId}.json`));
  if (descriptor.id !== normalizedMachineId) {
    throw new Error(
      `Machine descriptor ID mismatch: expected ${normalizedMachineId}, received ${descriptor.id}`,
    );
  }
  for (const tier of descriptor.gateTiers) {
    const profile = QUALITY_TIER_PROFILES[tier];
    if (
      descriptor.display.width !== profile.renderSurface.width ||
      descriptor.display.height !== profile.renderSurface.height ||
      descriptor.display.refreshRateHz !== profile.refreshRateHz
    ) {
      throw new Error(
        `${descriptor.id} display ${descriptor.display.width}x${descriptor.display.height}@${descriptor.display.refreshRateHz} does not match ${tier} profile ${profile.renderSurface.width}x${profile.renderSurface.height}@${profile.refreshRateHz}`,
      );
    }
  }
  return descriptor;
}

export async function readWindowsHostIdentity(): Promise<WindowsHostIdentity> {
  if (process.platform !== "win32") {
    throw new Error(`Windows host probe cannot run on ${process.platform}`);
  }
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsIdentityScript],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  const raw = JSON.parse(stdout) as unknown;
  if (!isRawWindowsHostIdentity(raw)) {
    throw new Error("Windows environment probe returned an invalid payload");
  }
  const power = parsePowerScheme(raw.powerScheme);
  return Object.freeze({
    cpu: Object.freeze(raw.cpu),
    os: Object.freeze({ build: raw.osBuild, caption: raw.osCaption }),
    physicalMemoryBytes: raw.physicalMemoryBytes,
    power,
    remoteSession: raw.remoteSession,
    videoControllers: Object.freeze(
      raw.videoControllers.map((controller) => Object.freeze(controller)),
    ),
  });
}

export async function tryReadWindowsHostIdentity(): Promise<WindowsHostIdentityResult> {
  try {
    return Object.freeze({ host: await readWindowsHostIdentity(), state: "measured" });
  } catch (error) {
    return Object.freeze({
      reason: `Windows host identity probe failed: ${errorMessage(error)}`,
      state: "invalid",
    });
  }
}

export function parseDisplayRefreshRates(names: readonly string[]): readonly number[] {
  const rates: number[] = [];
  for (let index = 0; index < names.length; index += 1) {
    if (names[index]?.trim() !== "Refresh Rate in Hz") continue;
    const candidates = names.slice(index + 1, index + 5);
    const value = candidates
      .map((candidate) => candidate.match(/^\s*(\d+(?:\.\d+)?)\s*(?:Hz)?\s*$/i)?.[1])
      .find((candidate) => candidate !== undefined);
    if (value === undefined) continue;
    const rate = Number(value);
    if (Number.isFinite(rate) && rate > 0) rates.push(rate);
  }
  return Object.freeze([...new Set(rates)]);
}

export function safeMachineIdForFilename(machineId: string): string {
  return isMachineId(machineId) ? machineId.toLowerCase() : "invalid-machine-id";
}

export function evaluateGateEnvironment(
  descriptor: MachineDescriptor,
  observation: GateEnvironmentObservation,
): EnvironmentGateState {
  const reasons: string[] = [];
  mismatch(reasons, "machine platform", descriptor.platform, observation.platform);
  mismatch(reasons, "machine architecture", descriptor.arch, observation.arch);
  mismatch(reasons, "OS build", descriptor.osBuild, observation.host.os.build);
  mismatchNormalized(reasons, "CPU name", descriptor.cpu.name, observation.host.cpu.name);
  mismatch(reasons, "CPU cores", descriptor.cpu.cores, observation.host.cpu.cores);
  mismatch(
    reasons,
    "CPU logical processors",
    descriptor.cpu.logicalProcessors,
    observation.host.cpu.logicalProcessors,
  );
  if (observation.host.physicalMemoryBytes < descriptor.minimumPhysicalMemoryBytes) {
    reasons.push(
      `physical memory expected at least ${descriptor.minimumPhysicalMemoryBytes}, received ${observation.host.physicalMemoryBytes}`,
    );
  }
  if (!descriptor.gateTiers.includes(observation.requestedTier)) {
    reasons.push(`${descriptor.id} is not a registered ${observation.requestedTier} gate machine`);
  }
  if (observation.host.remoteSession) reasons.push("Windows reports a remote session");
  const unexpectedActiveDisplayControllers = observation.host.videoControllers.filter(
    (controller) =>
      !matchesRegisteredGpu(controller, descriptor.gpu) && isActiveDisplayController(controller),
  );
  if (unexpectedActiveDisplayControllers.length > 0) {
    reasons.push(
      `Windows reports unregistered active display adapters: ${unexpectedActiveDisplayControllers.map((controller) => controller.name).join(", ")}`,
    );
  }

  mismatch(
    reasons,
    "power scheme",
    descriptor.powerSchemeGuid.toLowerCase(),
    observation.host.power.guid.toLowerCase(),
  );

  const displayController = observation.host.videoControllers.find((controller) =>
    matchesRegisteredGpu(controller, descriptor.gpu),
  );
  if (displayController === undefined) {
    reasons.push(`Windows did not report the registered display adapter ${descriptor.gpu.name}`);
  } else {
    mismatch(
      reasons,
      "display-adapter driver",
      descriptor.gpu.driverVersion,
      displayController.driverVersion,
    );
    mismatch(reasons, "display width", descriptor.display.width, displayController.width);
    mismatch(reasons, "display height", descriptor.display.height, displayController.height);
    if (
      displayController.refreshRateHz === null ||
      !withinTolerance(
        displayController.refreshRateHz,
        descriptor.display.refreshRateHz,
        descriptor.display.refreshRateToleranceHz,
      )
    ) {
      reasons.push(
        `display refresh expected ${descriptor.display.refreshRateHz}±${descriptor.display.refreshRateToleranceHz} Hz, received ${String(displayController.refreshRateHz)}`,
      );
    }
  }

  reasons.push(...evaluateBrowserDisplay(descriptor.display, observation.browserDisplay));

  mismatch(reasons, "CDP GPU vendor ID", descriptor.gpu.vendorId, observation.primaryGpu.vendorId);
  mismatch(reasons, "CDP GPU device ID", descriptor.gpu.deviceId, observation.primaryGpu.deviceId);
  mismatch(
    reasons,
    "CDP GPU subsystem ID",
    descriptor.gpu.subSysId,
    observation.primaryGpu.subSysId,
  );
  mismatch(
    reasons,
    "CDP GPU driver",
    descriptor.gpu.driverVersion,
    observation.primaryGpu.driverVersion,
  );
  mismatchNormalized(reasons, "WebGPU vendor", descriptor.gpu.vendor, observation.adapter.vendor);
  mismatchNormalized(
    reasons,
    "WebGPU architecture",
    descriptor.gpu.architecture,
    observation.adapter.architecture,
  );
  mismatch(
    reasons,
    "WebGPU device",
    webGpuDeviceId(descriptor.gpu.deviceId),
    observation.adapter.device,
  );
  mismatchNormalized(
    reasons,
    "WebGPU description",
    descriptor.gpu.name,
    observation.adapter.description,
  );
  mismatchNormalized(
    reasons,
    "WebGPU backend",
    descriptor.gpu.backend,
    observation.adapter.backend,
  );
  if (observation.adapter.driver?.includes(descriptor.gpu.driverVersion) !== true) {
    reasons.push(
      `WebGPU driver expected to contain ${descriptor.gpu.driverVersion}, received ${String(observation.adapter.driver)}`,
    );
  }
  if (observation.adapter.isFallbackAdapter) reasons.push("WebGPU selected a fallback adapter");

  return reasons.length === 0
    ? Object.freeze({ state: "measured", value: true })
    : invalidEnvironmentGate(reasons);
}

export function evaluateBrowserDisplay(
  display: MachineDescriptor["display"],
  browserDisplay: BrowserDisplayIdentity,
): readonly string[] {
  const reasons: string[] = [...browserDisplay.probeFailures];
  if (browserDisplay.screen === null) {
    if (browserDisplay.probeFailures.length === 0) {
      reasons.push("Browser screen identity is unavailable");
    }
  } else {
    const browserPhysicalWidth = Math.round(
      browserDisplay.screen.width * browserDisplay.screen.devicePixelRatio,
    );
    const browserPhysicalHeight = Math.round(
      browserDisplay.screen.height * browserDisplay.screen.devicePixelRatio,
    );
    if (Math.abs(browserPhysicalWidth - display.width) > display.dimensionTolerancePixels) {
      reasons.push(
        `browser display width expected ${display.width}±${display.dimensionTolerancePixels} physical pixels, received ${browserPhysicalWidth}`,
      );
    }
    if (Math.abs(browserPhysicalHeight - display.height) > display.dimensionTolerancePixels) {
      reasons.push(
        `browser display height expected ${display.height}±${display.dimensionTolerancePixels} physical pixels, received ${browserPhysicalHeight}`,
      );
    }
  }
  if (browserDisplay.refreshRatesHz.length === 0) {
    reasons.push("Browser diagnostics did not report a display refresh rate");
  } else {
    const mismatchedRefreshRates = browserDisplay.refreshRatesHz.filter(
      (rate) => !withinTolerance(rate, display.refreshRateHz, display.refreshRateToleranceHz),
    );
    if (mismatchedRefreshRates.length > 0) {
      reasons.push(
        `Browser diagnostics report ambiguous/non-target display refresh rates: ${mismatchedRefreshRates.join(", ")} Hz`,
      );
    }
  }
  return Object.freeze(reasons);
}

function mismatch(
  reasons: string[],
  label: string,
  expected: number | string,
  actual: number | string | null,
): void {
  if (actual !== expected)
    reasons.push(`${label} expected ${expected}, received ${String(actual)}`);
}

function mismatchNormalized(
  reasons: string[],
  label: string,
  expected: string,
  actual: string | null,
): void {
  if (actual === null || normalizeDescription(actual) !== normalizeDescription(expected)) {
    reasons.push(`${label} expected ${expected}, received ${String(actual)}`);
  }
}

function normalizeDescription(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function isActiveDisplayController(controller: WindowsHostIdentity["videoControllers"][number]) {
  return (
    controller.width !== null || controller.height !== null || controller.refreshRateHz !== null
  );
}

function matchesRegisteredGpu(
  controller: WindowsHostIdentity["videoControllers"][number],
  gpu: MachineDescriptor["gpu"],
): boolean {
  const match = controller.pnpDeviceId.match(/PCI\\VEN_([0-9A-F]{4})&DEV_([0-9A-F]{4})/i);
  return (
    match !== null &&
    Number.parseInt(match[1] ?? "", 16) === gpu.vendorId &&
    Number.parseInt(match[2] ?? "", 16) === gpu.deviceId
  );
}

function webGpuDeviceId(deviceId: number): string {
  return `0x${deviceId.toString(16).padStart(4, "0")}`;
}

function withinTolerance(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMachineId(value: string): boolean {
  return /^[a-z0-9-]+$/i.test(value);
}

function parsePowerScheme(value: string): WindowsHostIdentity["power"] {
  const guid = value.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0];
  if (guid === undefined) throw new Error(`Could not parse active power scheme: ${value}`);
  const name = value.match(/\(([^()]*)\)\s*$/)?.[1] ?? null;
  return Object.freeze({ guid, name });
}

function isRawWindowsHostIdentity(value: unknown): value is RawWindowsHostIdentity {
  if (!isRecord(value) || !isRecord(value.cpu) || !Array.isArray(value.videoControllers)) {
    return false;
  }
  return (
    typeof value.osBuild === "string" &&
    typeof value.osCaption === "string" &&
    typeof value.physicalMemoryBytes === "number" &&
    typeof value.powerScheme === "string" &&
    typeof value.remoteSession === "boolean" &&
    typeof value.cpu.name === "string" &&
    typeof value.cpu.cores === "number" &&
    typeof value.cpu.logicalProcessors === "number" &&
    value.videoControllers.every(isVideoController)
  );
}

function machineDescriptorValidationErrors(value: unknown): readonly string[] {
  if (!isRecord(value)) return Object.freeze(["root must be an object"]);
  const reasons: string[] = [];
  expectedLiteral(value, "schemaVersion", 1, "schemaVersion", reasons);
  expectedType(value, "id", "string", "id", reasons);
  expectedType(value, "arch", "string", "arch", reasons);
  expectedType(value, "platform", "string", "platform", reasons);
  expectedType(value, "osBuild", "string", "osBuild", reasons);
  expectedType(
    value,
    "minimumPhysicalMemoryBytes",
    "number",
    "minimumPhysicalMemoryBytes",
    reasons,
  );
  expectedType(value, "powerSchemeGuid", "string", "powerSchemeGuid", reasons);
  if (!Array.isArray(value.gateTiers)) {
    reasons.push("gateTiers must be an array");
  } else if (!value.gateTiers.every((tier) => tier === "showcase" || tier === "standard")) {
    reasons.push("gateTiers entries must be showcase or standard");
  }
  validateObjectFields(
    value.cpu,
    "cpu",
    { cores: "number", logicalProcessors: "number", name: "string" },
    reasons,
  );
  validateObjectFields(
    value.display,
    "display",
    {
      dimensionTolerancePixels: "number",
      height: "number",
      refreshRateHz: "number",
      refreshRateToleranceHz: "number",
      width: "number",
    },
    reasons,
  );
  validateObjectFields(
    value.gpu,
    "gpu",
    {
      architecture: "string",
      backend: "string",
      deviceId: "number",
      driverVersion: "string",
      name: "string",
      subSysId: "number",
      vendor: "string",
      vendorId: "number",
    },
    reasons,
  );
  return Object.freeze(reasons);
}

function validateObjectFields(
  value: unknown,
  path: string,
  fields: Readonly<Record<string, "number" | "string">>,
  reasons: string[],
): void {
  if (!isRecord(value)) {
    reasons.push(`${path} must be an object`);
    return;
  }
  for (const [key, type] of Object.entries(fields)) {
    expectedType(value, key, type, `${path}.${key}`, reasons);
  }
}

function expectedType(
  value: Record<string, unknown>,
  key: string,
  type: "number" | "string",
  path: string,
  reasons: string[],
): void {
  if (typeof value[key] !== type) reasons.push(`${path} must be a ${type}`);
}

function expectedLiteral(
  value: Record<string, unknown>,
  key: string,
  expected: number,
  path: string,
  reasons: string[],
): void {
  if (value[key] !== expected) reasons.push(`${path} must equal ${expected}`);
}

function isVideoController(
  value: unknown,
): value is WindowsHostIdentity["videoControllers"][number] {
  return (
    isRecord(value) &&
    typeof value.driverVersion === "string" &&
    typeof value.name === "string" &&
    typeof value.pnpDeviceId === "string" &&
    isNullableNumber(value.height) &&
    isNullableNumber(value.refreshRateHz) &&
    isNullableNumber(value.width)
  );
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const windowsIdentityScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$computer = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$version = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$powerScheme = (& powercfg.exe /getactivescheme | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'powercfg.exe failed' }
$videoControllers = @(
  Get-CimInstance Win32_VideoController | ForEach-Object {
    [PSCustomObject]@{
      driverVersion = [string]$_.DriverVersion
      height = if ($null -eq $_.CurrentVerticalResolution) { $null } else { [int]$_.CurrentVerticalResolution }
      name = [string]$_.Name
      pnpDeviceId = [string]$_.PNPDeviceID
      refreshRateHz = if ($null -eq $_.CurrentRefreshRate) { $null } else { [int]$_.CurrentRefreshRate }
      width = if ($null -eq $_.CurrentHorizontalResolution) { $null } else { [int]$_.CurrentHorizontalResolution }
    }
  }
)
[PSCustomObject]@{
  cpu = [PSCustomObject]@{
    cores = [int]$cpu.NumberOfCores
    logicalProcessors = [int]$cpu.NumberOfLogicalProcessors
    name = ([string]$cpu.Name).Trim()
  }
  osBuild = "$($version.CurrentBuild).$($version.UBR)"
  osCaption = [string]$os.Caption
  physicalMemoryBytes = [double]$computer.TotalPhysicalMemory
  powerScheme = $powerScheme
  remoteSession = [System.Windows.Forms.SystemInformation]::TerminalServerSession
  videoControllers = $videoControllers
} | ConvertTo-Json -Compress -Depth 4
`;
