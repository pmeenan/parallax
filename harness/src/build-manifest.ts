import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  BUILD_MANIFEST_SCHEMA_VERSION,
  canonicalStreamingDistrictIndexResourceId,
  OFFLINE_SHELL_GENERATION_SCHEMA_VERSION,
  OFFLINE_SHELL_SAVE_SCHEMA_VERSION,
  parseStreamingCellArtifactSource,
  parseStreamingDistrictIndex,
  STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
  scaleStreamingDependencyResourceId,
} from "@parallax/engine";
import {
  INSTALL_MANIFEST_PATH,
  INSTALL_MANIFEST_SCHEMA_VERSION,
  type InstallManifest,
  type InstallManifestSummary,
  parseInstallManifest,
} from "./install-manifest.js";
import {
  type PsoWarmupTraceIdentity,
  readAndValidatePsoWarmupTraceIdentity,
} from "./pso-warmup-trace.js";

// The build manifest cannot list its own hash. The install-manifest artifact classifies
// every other build artifact; its SHA-256 is releaseDigest, while the build-manifest
// SHA-256 remains the compatibility-preserving artifactDigest.
const UNLISTED_ALLOWLIST: ReadonlySet<string> = new Set(["build-manifest.json"]);

export { BUILD_MANIFEST_SCHEMA_VERSION };

export interface ManifestArtifact {
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}

export interface BuildManifest {
  readonly artifacts: readonly ManifestArtifact[];
  readonly gameContentEntrypoints: readonly ManifestGameContentEntrypoint[];
  readonly installManifestEntrypoint: ManifestInstallManifestEntrypoint;
  readonly offlineShell: Readonly<{
    readonly generationSchemaVersion: typeof OFFLINE_SHELL_GENERATION_SCHEMA_VERSION;
    readonly saveSchemaVersion: typeof OFFLINE_SHELL_SAVE_SCHEMA_VERSION;
    readonly serviceWorkerPath: "service-worker.js";
  }>;
  readonly schemaVersion: typeof BUILD_MANIFEST_SCHEMA_VERSION;
  readonly workerEntrypoints: readonly ManifestWorkerEntrypoint[];
}

export interface ManifestInstallManifestEntrypoint {
  readonly path: typeof INSTALL_MANIFEST_PATH;
  readonly schemaVersion: typeof INSTALL_MANIFEST_SCHEMA_VERSION;
}

export interface ManifestGameContentEntrypoint {
  readonly districtId: string;
  readonly path: string;
  readonly schemaVersion: typeof STREAMING_DISTRICT_INDEX_SCHEMA_VERSION;
  readonly scope: "game-specific";
  readonly targetType: "district";
}

export interface ManifestWorkerEntrypoint {
  readonly path: string;
  readonly role: "decode" | "installer" | "render" | "streaming" | "wasm-thread";
  readonly targetType: "worker";
}

export interface FileDigest {
  readonly bytes: number;
  readonly sha256: string;
}

export interface ValidatedBuildManifest {
  readonly artifactDigest: string;
  readonly buildManifestDigest: string;
  readonly installManifest: InstallManifest;
  readonly installSummary: InstallManifestSummary;
  readonly manifest: BuildManifest;
  readonly psoWarmupTrace: PsoWarmupTraceIdentity;
  readonly releaseDigest: string;
}

export interface InstallOnlyFile {
  readonly bytes: number;
  readonly sha256: string;
  readonly source: string;
}

export function validateBuildManifestContentAddressedPaths(
  manifest: Pick<BuildManifest, "artifacts" | "workerEntrypoints">,
  installManifest?: Pick<InstallManifest, "resources">,
): void {
  const artifacts = new Map(manifest.artifacts.map((artifact) => [artifact.path, artifact]));
  const requireBoundPath = (artifact: ManifestArtifact, kind: "JavaScript" | "Wasm"): void => {
    const extension = kind === "JavaScript" ? "js" : "wasm";
    const match = artifact.path.match(
      new RegExp(`^immutable/[A-Za-z0-9._/-]+-([a-f0-9]{64})\\.${extension}$`, "u"),
    );
    if (match?.[1] !== artifact.sha256) {
      throw new Error(
        `Content-addressed ${kind} path does not bind its artifact SHA-256: ${artifact.path}`,
      );
    }
  };
  for (const artifact of manifest.artifacts) {
    if (artifact.path.startsWith("immutable/") && artifact.path.endsWith(".js")) {
      requireBoundPath(artifact, "JavaScript");
    } else if (artifact.path.startsWith("immutable/") && artifact.path.endsWith(".wasm")) {
      requireBoundPath(artifact, "Wasm");
    }
  }
  for (const worker of manifest.workerEntrypoints) {
    const artifact = artifacts.get(worker.path);
    if (artifact === undefined || !worker.path.endsWith(".js")) {
      throw new Error(
        `Content-addressed ${worker.role} worker artifact is missing: ${worker.path}`,
      );
    }
    requireBoundPath(artifact, "JavaScript");
  }
  if (installManifest === undefined) return;
  const modulePrefixes = new Map([
    ["app-shell-module-app", "app"],
    ["common-module-engine", "engine"],
    ["game-specific-module-game", "game"],
  ]);
  for (const resource of installManifest.resources.filter(
    ({ kind, target }) =>
      target === "shell" && (kind === "module" || kind === "wasm" || kind === "worker"),
  )) {
    const artifact = artifacts.get(resource.source);
    if (
      artifact === undefined ||
      artifact.bytes !== resource.bytes ||
      artifact.sha256 !== resource.sha256
    ) {
      throw new Error(
        `Shell executable does not bind its exact build artifact: ${resource.source}`,
      );
    }
    if (resource.source === "service-worker.js") continue;
    if (resource.kind === "wasm") requireBoundPath(artifact, "Wasm");
    else requireBoundPath(artifact, "JavaScript");
    const expectedModulePrefix = modulePrefixes.get(resource.id);
    if (
      expectedModulePrefix !== undefined &&
      !resource.source.startsWith(`immutable/${expectedModulePrefix}-`)
    ) {
      throw new Error(
        `Shell ${expectedModulePrefix} module path has the wrong content-addressed role: ${resource.source}`,
      );
    }
  }
}

export async function readAndValidateBuildManifest(
  buildRoot: string,
  options: Readonly<{ readonly installOnlyFiles?: readonly InstallOnlyFile[] }> = {},
): Promise<ValidatedBuildManifest> {
  const resolvedRoot = resolve(buildRoot);
  const manifestBytes = await readFile(resolve(resolvedRoot, "build-manifest.json"));
  const parsedManifest = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  if (
    !isRecord(parsedManifest) ||
    !hasExactKeys(parsedManifest, [
      "artifacts",
      "gameContentEntrypoints",
      "installManifestEntrypoint",
      "offlineShell",
      "schemaVersion",
      "workerEntrypoints",
    ])
  ) {
    throw new Error("Build manifest v15 has unsupported or missing top-level keys");
  }
  const manifest = parsedManifest as unknown as BuildManifest;
  if (manifest.schemaVersion !== BUILD_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported build manifest schema ${String(manifest.schemaVersion)}`);
  }
  if (
    !Array.isArray(manifest.artifacts) ||
    !Array.isArray(manifest.gameContentEntrypoints) ||
    !Array.isArray(manifest.workerEntrypoints)
  ) {
    throw new Error(
      "Build manifest v15 requires artifact, game-content-entrypoint, and worker-entrypoint arrays",
    );
  }
  if (
    !isRecord(manifest.installManifestEntrypoint) ||
    !hasExactKeys(manifest.installManifestEntrypoint, ["path", "schemaVersion"]) ||
    manifest.installManifestEntrypoint.path !== INSTALL_MANIFEST_PATH ||
    manifest.installManifestEntrypoint.schemaVersion !== INSTALL_MANIFEST_SCHEMA_VERSION
  ) {
    throw new Error("Build manifest v15 requires the exact install-manifest v1 entrypoint");
  }
  if (
    !isRecord(manifest.offlineShell) ||
    !hasExactKeys(manifest.offlineShell, [
      "generationSchemaVersion",
      "saveSchemaVersion",
      "serviceWorkerPath",
    ]) ||
    manifest.offlineShell.generationSchemaVersion !== OFFLINE_SHELL_GENERATION_SCHEMA_VERSION ||
    manifest.offlineShell.saveSchemaVersion !== OFFLINE_SHELL_SAVE_SCHEMA_VERSION ||
    manifest.offlineShell.serviceWorkerPath !== "service-worker.js"
  ) {
    throw new Error("Build manifest v15 requires the exact offline-shell v1 contract");
  }
  const workerRoles = manifest.workerEntrypoints.map((entrypoint) => entrypoint.role);
  const workerPaths = new Set(
    manifest.workerEntrypoints.map((entrypoint) => resolve(resolvedRoot, entrypoint.path)),
  );
  if (
    manifest.workerEntrypoints.length !== 5 ||
    workerRoles.filter((role) => role === "decode").length !== 1 ||
    workerRoles.filter((role) => role === "installer").length !== 1 ||
    workerRoles.filter((role) => role === "render").length !== 1 ||
    workerRoles.filter((role) => role === "streaming").length !== 1 ||
    workerRoles.filter((role) => role === "wasm-thread").length !== 1 ||
    workerPaths.size !== 5
  ) {
    throw new Error(
      "Build manifest v15 requires exactly one distinct decode, installer, render, streaming, and WASM-thread worker",
    );
  }
  const artifactPaths = new Set<string>();
  const artifactHashes = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (
      !isRecord(artifact) ||
      !hasExactKeys(artifact, ["bytes", "path", "sha256"]) ||
      typeof artifact.bytes !== "number" ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0 ||
      typeof artifact.path !== "string" ||
      artifact.path === "" ||
      !/^[A-Za-z0-9._/-]+$/.test(artifact.path) ||
      artifact.path.startsWith("/") ||
      artifact.path.includes("\\") ||
      artifact.path
        .split("/")
        .some((segment) => segment === "" || segment === "." || segment === "..") ||
      typeof artifact.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      artifactPaths.has(artifact.path) ||
      artifactHashes.has(artifact.sha256)
    ) {
      throw new Error(`Invalid or duplicate build-manifest artifact: ${JSON.stringify(artifact)}`);
    }
    artifactPaths.add(artifact.path);
    artifactHashes.add(artifact.sha256);
    const artifactPath = resolve(resolvedRoot, artifact.path);
    if (!artifactPath.startsWith(`${resolvedRoot}${sep}`)) {
      throw new Error(`Build manifest artifact escapes the build root: ${artifact.path}`);
    }
    const actual = await sha256File(artifactPath);
    if (actual.bytes !== artifact.bytes || actual.sha256 !== artifact.sha256) {
      throw new Error(`Built artifact does not match its manifest: ${artifact.path}`);
    }
  }
  for (const entrypoint of manifest.workerEntrypoints) {
    if (
      !isRecord(entrypoint) ||
      !hasExactKeys(entrypoint, ["path", "role", "targetType"]) ||
      (entrypoint.role !== "decode" &&
        entrypoint.role !== "installer" &&
        entrypoint.role !== "render" &&
        entrypoint.role !== "streaming" &&
        entrypoint.role !== "wasm-thread") ||
      entrypoint.targetType !== "worker" ||
      !manifest.artifacts.some((artifact) => artifact.path === entrypoint.path)
    ) {
      throw new Error(`Invalid build-manifest worker entrypoint: ${JSON.stringify(entrypoint)}`);
    }
  }
  validateBuildManifestContentAddressedPaths(manifest);
  if (manifest.gameContentEntrypoints.length === 0) {
    throw new Error("Build manifest v15 requires at least one game-content district entrypoint");
  }
  const districtIds = new Set<string>();
  const districtPaths = new Set<string>();
  for (const entrypoint of manifest.gameContentEntrypoints) {
    if (
      !isRecord(entrypoint) ||
      !hasExactKeys(entrypoint, ["districtId", "path", "schemaVersion", "scope", "targetType"]) ||
      typeof entrypoint.districtId !== "string" ||
      entrypoint.districtId.trim() === "" ||
      typeof entrypoint.path !== "string" ||
      entrypoint.path.trim() === "" ||
      entrypoint.schemaVersion !== STREAMING_DISTRICT_INDEX_SCHEMA_VERSION ||
      entrypoint.scope !== "game-specific" ||
      entrypoint.targetType !== "district" ||
      !manifest.artifacts.some((artifact) => artifact.path === entrypoint.path)
    ) {
      throw new Error(
        `Invalid build-manifest game content entrypoint: ${JSON.stringify(entrypoint)}`,
      );
    }
    if (districtIds.has(entrypoint.districtId) || districtPaths.has(entrypoint.path)) {
      throw new Error("Build manifest v15 requires unique game-content district IDs and paths");
    }
    districtIds.add(entrypoint.districtId);
    districtPaths.add(entrypoint.path);
    const districtIndex = await readDistrictIndex(resolvedRoot, entrypoint.path);
    if (districtIndex.districtId !== entrypoint.districtId) {
      throw new Error(
        `Build-manifest game content entrypoint does not match its district index: ${entrypoint.path}`,
      );
    }
    if (districtIndex.schemaVersion !== entrypoint.schemaVersion) {
      throw new Error(
        `Build-manifest game content entrypoint does not match its district index schema: ${entrypoint.path}`,
      );
    }
    for (const cell of districtIndex.cells) {
      const artifact = manifest.artifacts.find((candidate) => candidate.path === cell.path);
      if (
        artifact === undefined ||
        artifact.bytes !== cell.bytes ||
        artifact.sha256 !== cell.sha256
      ) {
        throw new Error(
          `Build-manifest district index cell does not match an exact artifact: ${cell.path}`,
        );
      }
    }
  }
  const installArtifact = manifest.artifacts.find(
    (artifact) => artifact.path === manifest.installManifestEntrypoint.path,
  );
  if (installArtifact === undefined) {
    throw new Error(
      "Build manifest v15 does not list its install-manifest entrypoint as an artifact",
    );
  }
  if (!manifest.artifacts.some((artifact) => artifact.path === "service-worker.js")) {
    throw new Error("Build manifest v15 does not list its service-worker artifact");
  }
  const installBytes = await readFile(resolve(resolvedRoot, installArtifact.path));
  const expectedLocalResources = manifest.artifacts
    .filter((artifact) => artifact.path !== INSTALL_MANIFEST_PATH)
    .map((artifact) => expectedLocalResource(manifest, artifact));
  const install = parseInstallManifest(
    JSON.parse(installBytes.toString("utf8")) as unknown,
    expectedLocalResources,
  );
  validateBuildManifestContentAddressedPaths(manifest, install.manifest);
  const installOnlyFiles = await validateInstallOnlyFiles(
    resolvedRoot,
    install.manifest,
    options.installOnlyFiles ?? [],
  );
  const listed = new Set(manifest.artifacts.map((artifact) => artifact.path));
  const unexpected = (await listFilesRecursively(resolvedRoot)).filter(
    (path) => !listed.has(path) && !installOnlyFiles.has(path) && !UNLISTED_ALLOWLIST.has(path),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Served build root contains files that are not in the build manifest: ${unexpected.join(", ")}`,
    );
  }
  const psoWarmupTrace = await readAndValidatePsoWarmupTraceIdentity(
    resolvedRoot,
    manifest,
    install.manifest,
  );
  return Object.freeze({
    artifactDigest: sha256Hex(manifestBytes),
    buildManifestDigest: sha256Hex(manifestBytes),
    installManifest: install.manifest,
    installSummary: install.summary,
    manifest,
    psoWarmupTrace,
    releaseDigest: installArtifact.sha256,
  });
}

async function validateInstallOnlyFiles(
  root: string,
  installManifest: InstallManifest,
  files: readonly InstallOnlyFile[],
): Promise<ReadonlySet<string>> {
  const installModels = installManifest.resources.filter(({ kind }) => kind === "model");
  if (files.length === 0) return new Set();
  if (files.length !== installModels.length) {
    throw new Error("Install-only file inventory does not cover every exact model resource");
  }
  const paths = new Set<string>();
  for (const file of files) {
    if (
      !isRecord(file) ||
      !hasExactKeys(file, ["bytes", "sha256", "source"]) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes <= 0 ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      typeof file.source !== "string" ||
      file.source !== `immutable/model-${file.sha256}.gguf` ||
      paths.has(file.source)
    ) {
      throw new Error("Install-only model file identity is invalid");
    }
    const manifestResource = installModels.find(({ source }) => source === file.source);
    if (
      manifestResource === undefined ||
      manifestResource.bytes !== file.bytes ||
      manifestResource.sha256 !== file.sha256 ||
      manifestResource.target !== "opfs"
    ) {
      throw new Error(`Install-only model differs from the validated manifest: ${file.source}`);
    }
    const path = resolve(root, file.source);
    if (!path.startsWith(`${root}${sep}`)) {
      throw new Error(`Install-only model escapes the build root: ${file.source}`);
    }
    const fileStat = await lstat(path);
    if (fileStat.isSymbolicLink() || !fileStat.isFile() || (await realpath(path)) !== path) {
      throw new Error(`Install-only model is not a direct regular file: ${file.source}`);
    }
    const actual = await sha256File(path);
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) {
      throw new Error(`Install-only model bytes or digest differ: ${file.source}`);
    }
    paths.add(file.source);
  }
  return paths;
}

function expectedLocalResource(
  manifest: BuildManifest,
  artifact: ManifestArtifact,
): import("./install-manifest.js").InstallResource {
  const base = { bytes: artifact.bytes, sha256: artifact.sha256, source: artifact.path };
  if (artifact.path === "index.html")
    return {
      ...base,
      id: "app-shell-document-index",
      kind: "document",
      scope: "app-shell",
      target: "shell",
    };
  if (artifact.path === "service-worker.js")
    return {
      ...base,
      id: "common-worker-service",
      kind: "worker",
      scope: "common",
      target: "shell",
    };
  if (/^immutable\/app-[a-f0-9]{64}\.js$/.test(artifact.path))
    return {
      ...base,
      id: "app-shell-module-app",
      kind: "module",
      scope: "app-shell",
      target: "shell",
    };
  if (/^immutable\/engine-[a-f0-9]{64}\.js$/.test(artifact.path))
    return {
      ...base,
      id: "common-module-engine",
      kind: "module",
      scope: "common",
      target: "shell",
    };
  if (/^immutable\/game-[a-f0-9]{64}\.js$/.test(artifact.path))
    return {
      ...base,
      id: "game-specific-module-game",
      kind: "module",
      scope: "game-specific",
      target: "shell",
    };
  const worker = manifest.workerEntrypoints.find((entrypoint) => entrypoint.path === artifact.path);
  if (worker !== undefined)
    return {
      ...base,
      id: `common-worker-${worker.role}`,
      kind: "worker",
      scope: "common",
      target: "shell",
    };
  const wasm = artifact.path.match(/^immutable\/([a-z0-9-]+)-[a-f0-9]{64}\.wasm$/);
  if (wasm?.[1] !== undefined)
    return {
      ...base,
      id: `common-wasm-${wasm[1]}`,
      kind: "wasm",
      scope: "common",
      target: "shell",
    };
  if (/^immutable\/pso-warmup-trace-[a-f0-9]{64}\.json$/.test(artifact.path))
    return {
      ...base,
      id: "game-specific-pso-warmup-trace",
      kind: "asset-pack",
      scope: "game-specific",
      target: "opfs",
    };
  if (/^immutable\/representative-streaming-ktx2-[a-f0-9]{64}\.ktx2$/.test(artifact.path))
    return {
      ...base,
      id: "game-specific-streaming-00-texture",
      kind: "asset-pack",
      scope: "game-specific",
      target: "opfs",
    };
  if (/^immutable\/representative-streaming-meshopt-[a-f0-9]{64}\.meshopt$/.test(artifact.path))
    return {
      ...base,
      id: "game-specific-streaming-01-mesh",
      kind: "asset-pack",
      scope: "game-specific",
      target: "opfs",
    };
  const scaleStreaming = artifact.path.match(
    /^immutable\/streaming-(texture|vertices|indices)-([a-f0-9]{64})\.(ktx2|meshopt)$/,
  );
  if (scaleStreaming !== null) {
    const [, role, pathSha256, extension] = scaleStreaming;
    const texture = role === "texture";
    if (
      (role !== "texture" && role !== "vertices" && role !== "indices") ||
      pathSha256 !== artifact.sha256 ||
      (texture ? extension !== "ktx2" : extension !== "meshopt")
    ) {
      throw new Error(`Scale-streaming artifact identity is invalid: ${artifact.path}`);
    }
    return {
      ...base,
      id: scaleStreamingDependencyResourceId(role, pathSha256),
      kind: "asset-pack",
      scope: "game-specific",
      target: "opfs",
    };
  }
  const district = manifest.gameContentEntrypoints.find(
    (entrypoint) => entrypoint.path === artifact.path,
  );
  if (district !== undefined)
    return {
      ...base,
      id: canonicalStreamingDistrictIndexResourceId(district.districtId),
      kind: "district-index",
      scope: "game-specific",
      target: "opfs",
    };
  if (/^immutable\/[a-z0-9-]+-cell-/.test(artifact.path)) {
    const identity = parseStreamingCellArtifactSource(artifact.path);
    if (identity.sha256 !== artifact.sha256) {
      throw new Error(`Streaming cell filename hash does not match artifact: ${artifact.path}`);
    }
    return {
      ...base,
      id: identity.resourceId,
      kind: "world-cell",
      scope: "game-specific",
      target: "opfs",
    };
  }
  throw new Error(`Build artifact has no exact install classification: ${artifact.path}`);
}

async function readDistrictIndex(
  buildRoot: string,
  path: string,
): Promise<
  Readonly<{
    cells: readonly Readonly<{ bytes: number; path: string; sha256: string }>[];
    districtId: string;
    schemaVersion: number;
  }>
> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolve(buildRoot, path), "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Build-manifest district index is not valid JSON: ${path}`, { cause: error });
  }
  if (!isRecord(parsed) || typeof parsed.districtId !== "string") {
    throw new Error(`Build-manifest district index has invalid identity fields: ${path}`);
  }
  try {
    const district = parseStreamingDistrictIndex(parsed, parsed.districtId);
    return Object.freeze({
      cells: district.cells,
      districtId: district.districtId,
      schemaVersion: district.schemaVersion,
    });
  } catch (error) {
    throw new Error(`Build-manifest district index violates the runtime contract: ${path}`, {
      cause: error,
    });
  }
}

export async function listFilesRecursively(
  directory: string,
  prefix = "",
): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(resolve(directory, entry.name), relativePath)));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

export async function sha256File(path: string): Promise<FileDigest> {
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    digest.update(buffer);
  }
  return Object.freeze({ bytes, sha256: digest.digest("hex") });
}

export function sha256Hex(bytes: NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}
