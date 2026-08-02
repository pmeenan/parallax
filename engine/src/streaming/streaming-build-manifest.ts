import { BUILD_MANIFEST_SCHEMA_VERSION } from "../build/build-manifest-contract";
import {
  OFFLINE_SHELL_GENERATION_SCHEMA_VERSION,
  OFFLINE_SHELL_SAVE_SCHEMA_VERSION,
} from "../offline-shell/shell-generation-contract";
import {
  INSTALL_MANIFEST_PATH,
  INSTALL_MANIFEST_SCHEMA_VERSION,
} from "../storage/install-manifest";
import { STREAMING_DISTRICT_INDEX_SCHEMA_VERSION } from "./streaming-protocol";

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/;

export interface StreamingBuildArtifact {
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}

export interface StreamingBuildManifest {
  readonly artifacts: readonly StreamingBuildArtifact[];
  readonly gameContentEntrypoints: readonly Readonly<{
    districtId: string;
    path: string;
    schemaVersion: typeof STREAMING_DISTRICT_INDEX_SCHEMA_VERSION;
    scope: "game-specific";
    targetType: "district";
  }>[];
  readonly installManifestEntrypoint: Readonly<{
    path: typeof INSTALL_MANIFEST_PATH;
    schemaVersion: typeof INSTALL_MANIFEST_SCHEMA_VERSION;
  }>;
  readonly offlineShell: Readonly<{
    generationSchemaVersion: typeof OFFLINE_SHELL_GENERATION_SCHEMA_VERSION;
    saveSchemaVersion: typeof OFFLINE_SHELL_SAVE_SCHEMA_VERSION;
    serviceWorkerPath: "service-worker.js";
  }>;
  readonly schemaVersion: typeof BUILD_MANIFEST_SCHEMA_VERSION;
  readonly workerEntrypoints: readonly unknown[];
}

export function validateStreamingBuildManifest(value: unknown): StreamingBuildManifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "artifacts",
      "gameContentEntrypoints",
      "installManifestEntrypoint",
      "offlineShell",
      "schemaVersion",
      "workerEntrypoints",
    ])
  ) {
    throw new Error("Streaming build manifest has invalid top-level fields");
  }
  const install = value.installManifestEntrypoint;
  const offlineShell = value.offlineShell;
  if (
    value.schemaVersion !== BUILD_MANIFEST_SCHEMA_VERSION ||
    !Array.isArray(value.artifacts) ||
    !Array.isArray(value.workerEntrypoints) ||
    !Array.isArray(value.gameContentEntrypoints) ||
    !isRecord(install) ||
    !hasExactKeys(install, ["path", "schemaVersion"]) ||
    install.path !== INSTALL_MANIFEST_PATH ||
    install.schemaVersion !== INSTALL_MANIFEST_SCHEMA_VERSION ||
    !isRecord(offlineShell) ||
    !hasExactKeys(offlineShell, [
      "generationSchemaVersion",
      "saveSchemaVersion",
      "serviceWorkerPath",
    ]) ||
    offlineShell.generationSchemaVersion !== OFFLINE_SHELL_GENERATION_SCHEMA_VERSION ||
    offlineShell.saveSchemaVersion !== OFFLINE_SHELL_SAVE_SCHEMA_VERSION ||
    offlineShell.serviceWorkerPath !== "service-worker.js"
  ) {
    throw new Error(
      "Streaming worker requires build-manifest v15/install-manifest v1/offline-shell v1",
    );
  }

  const artifactPaths = new Set<string>();
  const artifactHashes = new Set<string>();
  for (const artifact of value.artifacts) {
    if (
      !isRecord(artifact) ||
      !hasExactKeys(artifact, ["bytes", "path", "sha256"]) ||
      typeof artifact.bytes !== "number" ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0 ||
      typeof artifact.path !== "string" ||
      !isSafeLocalPath(artifact.path) ||
      typeof artifact.sha256 !== "string" ||
      !SHA256.test(artifact.sha256) ||
      artifactPaths.has(artifact.path) ||
      artifactHashes.has(artifact.sha256)
    ) {
      throw new Error("Streaming build manifest has an invalid or duplicate artifact");
    }
    artifactPaths.add(artifact.path);
    artifactHashes.add(artifact.sha256);
  }
  if (!artifactPaths.has(INSTALL_MANIFEST_PATH)) {
    throw new Error("Streaming build manifest omits its install-manifest entrypoint artifact");
  }
  if (!artifactPaths.has("service-worker.js")) {
    throw new Error("Streaming build manifest omits its service-worker artifact");
  }

  // This validator enforces the artifact and district subset that streaming provisioning
  // consumes. It deliberately leaves worker-entrypoint role validation and full served-tree
  // inventory/byte hashing to their owning runtime consumers and the independent harness
  // validator; fetching and validating the selected district body happens immediately after
  // this structural boundary.
  if (value.gameContentEntrypoints.length === 0) {
    throw new Error("Streaming build manifest requires at least one district entrypoint");
  }
  const districtIds = new Set<string>();
  const districtPaths = new Set<string>();
  for (const entrypoint of value.gameContentEntrypoints) {
    if (
      !isRecord(entrypoint) ||
      !hasExactKeys(entrypoint, ["districtId", "path", "schemaVersion", "scope", "targetType"]) ||
      typeof entrypoint.districtId !== "string" ||
      !SAFE_ID.test(entrypoint.districtId) ||
      typeof entrypoint.path !== "string" ||
      !isSafeLocalPath(entrypoint.path) ||
      entrypoint.schemaVersion !== STREAMING_DISTRICT_INDEX_SCHEMA_VERSION ||
      entrypoint.scope !== "game-specific" ||
      entrypoint.targetType !== "district" ||
      districtIds.has(entrypoint.districtId) ||
      districtPaths.has(entrypoint.path) ||
      !artifactPaths.has(entrypoint.path)
    ) {
      throw new Error("Streaming build manifest has an invalid district entrypoint");
    }
    districtIds.add(entrypoint.districtId);
    districtPaths.add(entrypoint.path);
  }
  return value as unknown as StreamingBuildManifest;
}

function isSafeLocalPath(value: string): boolean {
  return (
    value !== "" &&
    /^[A-Za-z0-9._/-]+$/.test(value) &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("?") &&
    !value.includes("#") &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort(compareCodepoints);
  const sortedExpected = [...expected].sort(compareCodepoints);
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
