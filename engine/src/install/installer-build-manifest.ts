import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { BUILD_MANIFEST_SCHEMA_VERSION } from "../build/build-manifest-contract";
import { assertUnicodeScalarString, compareUnicodeScalars } from "../core/unicode-scalar-order";
import {
  OFFLINE_SHELL_GENERATION_SCHEMA_VERSION,
  OFFLINE_SHELL_SAVE_SCHEMA_VERSION,
} from "../offline-shell/shell-generation-contract";
import {
  INSTALL_MANIFEST_PATH,
  INSTALL_MANIFEST_SCHEMA_VERSION,
  type ParsedInstallManifest,
  parseInstallManifestDocument,
} from "../storage/install-manifest";

export const INSTALLER_BUILD_MANIFEST_SCHEMA_VERSION = BUILD_MANIFEST_SCHEMA_VERSION;
export const INSTALLER_BUILD_MANIFEST_PATH = "build-manifest.json";
export const INSTALLER_TARGET_REQUEST_HEADER = "x-parallax-installer-target";
export const INSTALLER_TARGET_REQUEST_VALUE = "network-first-with-offline-shell-fallback";

export interface InstallerBuildArtifact {
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}

export interface InstallerBuildManifest {
  readonly artifacts: readonly InstallerBuildArtifact[];
  readonly gameContentEntrypoints: readonly unknown[];
  readonly installManifestEntrypoint: Readonly<{
    readonly path: typeof INSTALL_MANIFEST_PATH;
    readonly schemaVersion: typeof INSTALL_MANIFEST_SCHEMA_VERSION;
  }>;
  readonly offlineShell: Readonly<{
    readonly generationSchemaVersion: typeof OFFLINE_SHELL_GENERATION_SCHEMA_VERSION;
    readonly saveSchemaVersion: typeof OFFLINE_SHELL_SAVE_SCHEMA_VERSION;
    readonly serviceWorkerPath: "service-worker.js";
  }>;
  readonly schemaVersion: typeof INSTALLER_BUILD_MANIFEST_SCHEMA_VERSION;
  readonly workerEntrypoints: readonly Readonly<{
    readonly path: string;
    readonly role: "decode" | "installer" | "render" | "sim" | "streaming" | "wasm-thread";
    readonly targetType: "worker";
  }>[];
}

export interface InstallerManifestIdentity {
  readonly buildManifest: InstallerBuildManifest;
  readonly installManifest: ParsedInstallManifest;
  readonly installManifestBytes: Uint8Array;
  readonly releaseDigest: string;
}

export class InstallerManifestIdentityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InstallerManifestIdentityError";
  }
}

export class InstallerManifestDocumentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InstallerManifestDocumentError";
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const CONTENT_ADDRESSED_APP = /^immutable\/app-([a-f0-9]{64})\.js$/;
const WORKER_ROLES = Object.freeze([
  "decode",
  "installer",
  "render",
  "sim",
  "streaming",
  "wasm-thread",
] as const);

export function parseInstallerBuildManifest(input: unknown): InstallerBuildManifest {
  const value = exact(input, [
    "artifacts",
    "gameContentEntrypoints",
    "installManifestEntrypoint",
    "offlineShell",
    "schemaVersion",
    "workerEntrypoints",
  ]);
  if (
    value.schemaVersion !== INSTALLER_BUILD_MANIFEST_SCHEMA_VERSION ||
    !Array.isArray(value.artifacts) ||
    !Array.isArray(value.gameContentEntrypoints) ||
    !Array.isArray(value.workerEntrypoints)
  ) {
    throw new Error("Installer requires build-manifest v16 arrays");
  }
  const install = exact(value.installManifestEntrypoint, ["path", "schemaVersion"]);
  if (
    install.path !== INSTALL_MANIFEST_PATH ||
    install.schemaVersion !== INSTALL_MANIFEST_SCHEMA_VERSION
  ) {
    throw new Error("Installer requires the exact install-manifest v1 entrypoint");
  }
  const offlineShell = exact(value.offlineShell, [
    "generationSchemaVersion",
    "saveSchemaVersion",
    "serviceWorkerPath",
  ]);
  if (
    offlineShell.generationSchemaVersion !== OFFLINE_SHELL_GENERATION_SCHEMA_VERSION ||
    offlineShell.saveSchemaVersion !== OFFLINE_SHELL_SAVE_SCHEMA_VERSION ||
    offlineShell.serviceWorkerPath !== "service-worker.js"
  ) {
    throw new Error("Installer requires the exact offline-shell v1 compatibility contract");
  }
  const artifactPaths = new Set<string>();
  const artifactHashes = new Set<string>();
  for (const candidate of value.artifacts) {
    const artifact = exact(candidate, ["bytes", "path", "sha256"]);
    if (
      !Number.isSafeInteger(artifact.bytes) ||
      (artifact.bytes as number) <= 0 ||
      typeof artifact.path !== "string" ||
      !safePath(artifact.path) ||
      typeof artifact.sha256 !== "string" ||
      !SHA256.test(artifact.sha256) ||
      artifactPaths.has(artifact.path) ||
      artifactHashes.has(artifact.sha256)
    ) {
      throw new Error("Installer build manifest has an invalid or duplicate artifact");
    }
    artifactPaths.add(artifact.path);
    artifactHashes.add(artifact.sha256);
  }
  const workers = new Map<string, string>();
  for (const candidate of value.workerEntrypoints) {
    const worker = exact(candidate, ["path", "role", "targetType"]);
    if (
      typeof worker.path !== "string" ||
      !safePath(worker.path) ||
      !artifactPaths.has(worker.path) ||
      typeof worker.role !== "string" ||
      !(WORKER_ROLES as readonly string[]).includes(worker.role) ||
      worker.targetType !== "worker" ||
      workers.has(worker.role)
    ) {
      throw new Error("Installer build manifest has an invalid worker entrypoint");
    }
    workers.set(worker.role, worker.path);
  }
  if (
    workers.size !== WORKER_ROLES.length ||
    WORKER_ROLES.some((role) => !workers.has(role)) ||
    new Set(workers.values()).size !== WORKER_ROLES.length
  ) {
    throw new Error("Installer requires exactly one distinct worker for every v16 role");
  }
  if (!artifactPaths.has(INSTALL_MANIFEST_PATH)) {
    throw new Error("Installer build manifest omits its install-manifest artifact");
  }
  if (!artifactPaths.has("service-worker.js")) {
    throw new Error("Installer build manifest omits its stable service-worker artifact");
  }
  return value as unknown as InstallerBuildManifest;
}

export function validateInstallerManifestBytes(
  buildManifest: InstallerBuildManifest,
  bytes: Uint8Array,
): InstallerManifestIdentity {
  const artifact = buildManifest.artifacts.find(({ path }) => path === INSTALL_MANIFEST_PATH);
  if (artifact === undefined) throw new Error("Install-manifest artifact is missing");
  if (bytes.byteLength !== artifact.bytes || bytesToHex(sha256(bytes)) !== artifact.sha256) {
    throw new InstallerManifestIdentityError(
      "Install-manifest bytes do not match build-manifest identity",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InstallerManifestDocumentError("Install-manifest body is not strict UTF-8 JSON");
  }
  try {
    return Object.freeze({
      buildManifest,
      installManifest: parseInstallManifestDocument(parsed),
      installManifestBytes: bytes.slice(),
      releaseDigest: artifact.sha256,
    });
  } catch (error: unknown) {
    throw new InstallerManifestDocumentError(
      error instanceof Error && error.message !== ""
        ? error.message
        : "Install-manifest document is invalid",
    );
  }
}

export function assertCompatibleInstallerShellEntrypoint(
  buildManifest: InstallerBuildManifest,
  shellEntrypointPath: string,
): InstallerBuildArtifact {
  const match = CONTENT_ADDRESSED_APP.exec(shellEntrypointPath);
  const artifact = buildManifest.artifacts.find(({ path }) => path === shellEntrypointPath);
  if (match === null || artifact === undefined || artifact.sha256 !== match[1]) {
    throw new Error(
      "Loaded app-shell entrypoint is not the exact content-addressed target artifact",
    );
  }
  return artifact;
}

export function resolveInstallerManifestUrl(buildManifestUrl: string, entrypoint: string): string {
  if (entrypoint !== INSTALL_MANIFEST_PATH) {
    throw new Error("Installer requires the exact install-manifest v1 entrypoint");
  }
  return new URL(entrypoint, resolveInstallerBuildRootUrl(buildManifestUrl)).href;
}

export function resolveInstallerBuildRootUrl(buildManifestUrl: string): string {
  const buildUrl = new URL(buildManifestUrl);
  if (
    buildUrl.username !== "" ||
    buildUrl.password !== "" ||
    buildUrl.pathname !== `/${INSTALLER_BUILD_MANIFEST_PATH}` ||
    buildUrl.search !== "" ||
    buildUrl.hash !== ""
  ) {
    throw new Error("Installer requires the exact root build-manifest URL");
  }
  return new URL("./", buildUrl).href;
}

function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Installer manifest value must be an object");
  }
  const value = input as Record<string, unknown>;
  const actual = Object.keys(value);
  for (const key of actual) assertUnicodeScalarString(key);
  actual.sort(compareUnicodeScalars);
  const expected = [...keys].sort(compareUnicodeScalars);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("Installer manifest value has unsupported or missing keys");
  }
  return value;
}

function safePath(value: string): boolean {
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
