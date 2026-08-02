import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { InstalledReleaseBinding } from "../storage/installed-release";
import {
  createPsoWarmupTrace,
  failedPsoWarmupTraceBundle,
  incompatibilityFailure,
  isPsoWarmupFailureError,
  PSO_WARMUP_RESOURCE_ID,
  type PsoWarmupTrace,
  type PsoWarmupTraceBundle,
  type PsoWarmupTraceBundleReady,
  parsePsoWarmupTraceBytes,
  serializePsoWarmupTrace,
} from "./pso-warmup-contract";

export type InstalledPsoWarmupRead = (path: string) => Promise<Uint8Array | null>;

export async function loadInstalledPsoWarmupTrace(
  binding: InstalledReleaseBinding,
  read: InstalledPsoWarmupRead,
): Promise<PsoWarmupTraceBundle> {
  let resource: Awaited<ReturnType<InstalledReleaseBinding["getResource"]>>;
  try {
    resource = await binding.getResource(PSO_WARMUP_RESOURCE_ID);
  } catch (error: unknown) {
    return failedPsoWarmupTraceBundle(
      "installed-release",
      binding.releaseDigest,
      incompatibilityFailure(
        "trace-load",
        error instanceof Error
          ? `Installed PSO warmup resource could not be resolved: ${error.message}`
          : "Installed PSO warmup resource could not be resolved",
      ),
    );
  }
  if (
    resource.manifest.kind !== "asset-pack" ||
    resource.manifest.scope !== "game-specific" ||
    resource.manifest.target !== "opfs"
  ) {
    return failedPsoWarmupTraceBundle(
      "installed-release",
      binding.releaseDigest,
      incompatibilityFailure(
        "trace-load",
        "Installed PSO warmup resource placement is incompatible",
      ),
    );
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await read(resource.reference.path);
  } catch (error: unknown) {
    return failedPsoWarmupTraceBundle(
      "installed-release",
      binding.releaseDigest,
      incompatibilityFailure(
        "trace-load",
        error instanceof Error
          ? `Installed PSO warmup trace object could not be read: ${error.message}`
          : "Installed PSO warmup trace object could not be read",
      ),
    );
  }
  if (bytes === null) {
    return failedPsoWarmupTraceBundle(
      "installed-release",
      binding.releaseDigest,
      incompatibilityFailure("trace-load", "Installed PSO warmup trace object is missing"),
    );
  }
  const digest = bytesToHex(sha256(bytes));
  if (
    bytes.byteLength !== resource.manifest.bytes ||
    bytes.byteLength !== resource.reference.bytes ||
    digest !== resource.manifest.sha256 ||
    digest !== resource.reference.sha256
  ) {
    return failedPsoWarmupTraceBundle(
      "installed-release",
      binding.releaseDigest,
      incompatibilityFailure(
        "trace-load",
        "Installed PSO warmup trace object identity is incompatible",
      ),
      Object.freeze({ bytes: bytes.byteLength, sha256: digest }),
    );
  }
  let trace: PsoWarmupTrace;
  try {
    trace = parsePsoWarmupTraceBytes(bytes);
  } catch (error: unknown) {
    return failedPsoWarmupTraceBundle(
      "installed-release",
      binding.releaseDigest,
      isPsoWarmupFailureError(error)
        ? error.failure
        : incompatibilityFailure("trace-validation", "Installed PSO warmup trace is incompatible"),
      Object.freeze({ bytes: bytes.byteLength, sha256: digest }),
    );
  }
  return Object.freeze({
    bytes: bytes.byteLength,
    failure: null,
    releaseDigest: binding.releaseDigest,
    sha256: digest,
    source: "installed-release",
    trace,
  });
}

export function createEmbeddedPsoWarmupTrace(): PsoWarmupTraceBundleReady {
  const trace = createPsoWarmupTrace();
  const bytes = serializePsoWarmupTrace(trace);
  return Object.freeze({
    bytes: bytes.byteLength,
    failure: null,
    releaseDigest: null,
    sha256: bytesToHex(sha256(bytes)),
    source: "privileged-embedded",
    trace,
  });
}
