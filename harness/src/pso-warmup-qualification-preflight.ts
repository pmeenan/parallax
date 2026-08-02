import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { readAndValidateBuildManifest } from "./build-manifest.js";
import {
  loadChromePin,
  resolveChromeExecutablePath,
  validateChromeExecutable,
} from "./chrome-pin.js";
import { loadMachineDescriptor } from "./environment.js";
import type { PsoWarmupQualificationAuthority } from "./pso-warmup-qualification.js";
import { readSourceIdentity } from "./source-identity.js";

export interface PsoWarmupQualificationPreflight {
  readonly authority: PsoWarmupQualificationAuthority;
  readonly buildRoot: string;
  readonly chromeExecutablePath: string;
  readonly chromePinPath: string;
  readonly inputBytes: Uint8Array;
  readonly repositoryRoot: string;
  readonly smokeReportFilePath: string;
}

export async function readPsoWarmupQualificationPreflight(input: {
  readonly buildRoot: string;
  readonly repositoryRoot: string;
  readonly smokeReportPath: string;
}): Promise<PsoWarmupQualificationPreflight> {
  const chromePinPath = join(input.repositoryRoot, "harness/chrome/stable.json");
  const chromePin = await loadChromePin(chromePinPath);
  const chromeExecutablePath = await resolveChromeExecutablePath(input.repositoryRoot, chromePin);
  const [build, chromeExecutableSha256, inputBytes, repositorySource] = await Promise.all([
    readAndValidateBuildManifest(input.buildRoot),
    validateChromeExecutable(chromePin, chromeExecutablePath),
    readFile(input.smokeReportPath),
    readSourceIdentity(input.repositoryRoot),
  ]);
  const machineId = smokeReportMachineId(inputBytes);
  const machineDescriptor = await loadMachineDescriptor(
    join(input.repositoryRoot, "harness/machines"),
    machineId,
  );
  return Object.freeze({
    authority: Object.freeze({
      build,
      chromeExecutableSha256,
      chromePin,
      machineDescriptor,
      repositorySource,
      smokeReportPath: logicalSmokeReportPath(input.repositoryRoot, input.smokeReportPath),
    }),
    buildRoot: input.buildRoot,
    chromeExecutablePath,
    chromePinPath,
    inputBytes,
    repositoryRoot: input.repositoryRoot,
    smokeReportFilePath: input.smokeReportPath,
  });
}

export async function assertPsoWarmupQualificationPreflightUnchanged(
  preflight: PsoWarmupQualificationPreflight,
): Promise<void> {
  const [
    finalBuild,
    finalChromePin,
    finalChromeExecutableSha256,
    finalInputBytes,
    finalSource,
    finalMachineDescriptor,
  ] = await Promise.all([
    readAndValidateBuildManifest(preflight.buildRoot),
    loadChromePin(preflight.chromePinPath),
    validateChromeExecutable(preflight.authority.chromePin, preflight.chromeExecutablePath),
    readFile(preflight.smokeReportFilePath),
    readSourceIdentity(preflight.repositoryRoot),
    loadMachineDescriptor(
      join(preflight.repositoryRoot, "harness/machines"),
      preflight.authority.machineDescriptor.id,
    ),
  ]);
  if (
    JSON.stringify(finalBuild) !== JSON.stringify(preflight.authority.build) ||
    JSON.stringify(finalChromePin) !== JSON.stringify(preflight.authority.chromePin) ||
    finalChromeExecutableSha256 !== preflight.authority.chromeExecutableSha256 ||
    !Buffer.from(finalInputBytes).equals(Buffer.from(preflight.inputBytes)) ||
    JSON.stringify(finalSource) !== JSON.stringify(preflight.authority.repositorySource) ||
    JSON.stringify(finalMachineDescriptor) !== JSON.stringify(preflight.authority.machineDescriptor)
  ) {
    throw new Error("PSO warmup qualification authority changed during validation");
  }
}

function smokeReportMachineId(inputBytes: Uint8Array): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(inputBytes)) as unknown;
  } catch (error: unknown) {
    throw new Error("PSO warmup qualification cannot resolve machine registration from input", {
      cause: error,
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("PSO warmup qualification input must contain an environment");
  }
  const environment = (parsed as Record<string, unknown>).environment;
  if (typeof environment !== "object" || environment === null || Array.isArray(environment)) {
    throw new Error("PSO warmup qualification input environment is invalid");
  }
  const machineId = (environment as Record<string, unknown>).machineId;
  if (typeof machineId !== "string" || machineId === "") {
    throw new Error("PSO warmup qualification input machineId is invalid");
  }
  return machineId;
}

function logicalSmokeReportPath(repositoryRoot: string, smokeReportPath: string): string {
  const candidate = relative(repositoryRoot, smokeReportPath);
  if (
    candidate !== "" &&
    !candidate.startsWith(`..${sep}`) &&
    candidate !== ".." &&
    !isAbsolute(candidate)
  ) {
    return candidate.replaceAll("\\", "/");
  }
  return `external/${basename(smokeReportPath)}`;
}
