import { createHash, randomUUID } from "node:crypto";
import { copyFile, cp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type BuildManifest,
  readAndValidateBuildManifest,
  sha256File,
  type ValidatedBuildManifest,
} from "./build-manifest.js";
import type { InstallManifest, InstallResource, InstallResourceKind } from "./install-manifest.js";

const SHA256 = /^[a-f0-9]{64}$/;
const EXECUTABLE_KINDS: ReadonlySet<InstallResourceKind> = new Set([
  "document",
  "module",
  "wasm",
  "worker",
]);
const ASSET_KINDS: ReadonlySet<InstallResourceKind> = new Set([
  "asset-pack",
  "district-index",
  "model",
  "world-cell",
]);

export interface AssetOnlyResourceIdentity {
  readonly bytes: number;
  readonly id: string;
  readonly kind: InstallResourceKind;
  readonly scope: InstallResource["scope"];
  readonly sha256: string;
  readonly source: string;
  readonly target: InstallResource["target"];
}

export interface AssetOnlyResourceChange {
  readonly after: AssetOnlyResourceIdentity;
  readonly before: AssetOnlyResourceIdentity;
  readonly id: string;
}

export interface AssetOnlyReleaseUpdateAnalysis {
  readonly changedResources: readonly AssetOnlyResourceChange[];
  readonly executableIdentityDigest: string;
  readonly executableResources: readonly AssetOnlyResourceIdentity[];
  readonly unchangedResourceCount: number;
}

export interface AssetOnlyUpdateFixture {
  readonly analysis: AssetOnlyReleaseUpdateAnalysis;
  readonly changedPaths: Readonly<{
    readonly after: readonly string[];
    readonly before: readonly string[];
  }>;
  readonly post: ValidatedBuildManifest;
  readonly pre: ValidatedBuildManifest;
}

export function analyzeAssetOnlyReleaseUpdate(
  pre: Pick<
    ValidatedBuildManifest,
    "artifactDigest" | "installManifest" | "manifest" | "releaseDigest"
  >,
  post: Pick<
    ValidatedBuildManifest,
    "artifactDigest" | "installManifest" | "manifest" | "releaseDigest"
  >,
): AssetOnlyReleaseUpdateAnalysis {
  requireDigest(pre.artifactDigest, "pre artifact");
  requireDigest(pre.releaseDigest, "pre release");
  requireDigest(post.artifactDigest, "post artifact");
  requireDigest(post.releaseDigest, "post release");
  if (pre.artifactDigest === post.artifactDigest || pre.releaseDigest === post.releaseDigest) {
    throw new Error("Asset-only update must change both artifact and release identity");
  }
  validateBuildLifecycleIdentity(pre.manifest, post.manifest);

  const preResources = indexResources(pre.installManifest, "pre");
  const postResources = indexResources(post.installManifest, "post");
  if (
    preResources.size !== postResources.size ||
    [...preResources.keys()].some((id) => !postResources.has(id))
  ) {
    throw new Error("Asset-only update may not add or remove install resource IDs");
  }

  const changedResources: AssetOnlyResourceChange[] = [];
  const executableResources: AssetOnlyResourceIdentity[] = [];
  let unchangedResourceCount = 0;
  for (const [id, before] of preResources) {
    const after = postResources.get(id);
    if (after === undefined) throw new Error(`Post-update resource ${id} disappeared`);
    const beforeIdentity = freezeIdentity(before);
    const afterIdentity = freezeIdentity(after);
    const changed = !sameResource(beforeIdentity, afterIdentity);
    if (EXECUTABLE_KINDS.has(before.kind) || EXECUTABLE_KINDS.has(after.kind)) {
      if (changed) throw new Error(`Executable install resource drifted across update: ${id}`);
      executableResources.push(beforeIdentity);
      unchangedResourceCount += 1;
      continue;
    }
    if (
      before.kind !== after.kind ||
      before.scope !== after.scope ||
      before.target !== after.target
    ) {
      throw new Error(`Install resource classification drifted across update: ${id}`);
    }
    if (changed) {
      if (!ASSET_KINDS.has(before.kind)) {
        throw new Error(`Non-asset install resource drifted across update: ${id}`);
      }
      if (before.sha256 === after.sha256 || before.source === after.source) {
        throw new Error(`Changed asset ${id} did not advance both content hash and immutable URL`);
      }
      changedResources.push(Object.freeze({ after: afterIdentity, before: beforeIdentity, id }));
    } else {
      unchangedResourceCount += 1;
    }
  }
  if (changedResources.length === 0) {
    throw new Error("Asset-only update changed no declared asset resource");
  }
  executableResources.sort((left, right) => compareCodepoints(left.id, right.id));
  changedResources.sort((left, right) => compareCodepoints(left.id, right.id));
  return Object.freeze({
    changedResources: Object.freeze(changedResources),
    executableIdentityDigest: digestExecutableResources(executableResources),
    executableResources: Object.freeze(executableResources),
    unchangedResourceCount,
  });
}

export async function createAssetOnlyUpdateFixture(
  preRoot: string,
  postRoot: string,
  options: Readonly<{ readonly minimumChangedResourceBytes?: number }> = {},
): Promise<AssetOnlyUpdateFixture> {
  const pre = await readAndValidateBuildManifest(preRoot);
  await cp(preRoot, postRoot, { errorOnExist: true, force: false, recursive: true });

  const mutableBuild = structuredClone(pre.manifest) as MutableBuildManifest;
  const mutableInstall = structuredClone(pre.installManifest) as MutableInstallManifest;
  const worldCell = mutableInstall.resources.find((resource) => resource.kind === "world-cell");
  const districtIndexes = mutableInstall.resources.filter(
    (resource) => resource.kind === "district-index",
  );
  if (worldCell === undefined || districtIndexes.length === 0) {
    throw new Error("Asset-only update fixture requires a world cell and district index");
  }

  const oldCellPath = worldCell.source;
  const oldCellBytes = await readFile(join(postRoot, oldCellPath));
  JSON.parse(oldCellBytes.toString("utf8"));
  const minimumChangedResourceBytes = options.minimumChangedResourceBytes ?? 0;
  if (!Number.isSafeInteger(minimumChangedResourceBytes) || minimumChangedResourceBytes < 0) {
    throw new Error("Asset-only update minimum changed-resource bytes is invalid");
  }
  const appendedBytes = Math.max(1, minimumChangedResourceBytes - oldCellBytes.byteLength);
  // JSON permits trailing whitespace. The ordinary D-144 fixture appends one byte;
  // fault-lifecycle qualification may request a bounded larger non-executable body so
  // browser termination can be observed after transfer starts, without changing the
  // fixture's executable identity or adding a server-side timing shim.
  const updatedCellBytes = Buffer.concat([oldCellBytes, Buffer.alloc(appendedBytes, 0x20)]);
  const updatedCellSha256 = sha256(updatedCellBytes);
  const updatedCellPath = replaceContentHash(oldCellPath, updatedCellSha256);
  await writeFile(join(postRoot, updatedCellPath), updatedCellBytes, { flag: "wx" });
  await rm(join(postRoot, oldCellPath));
  updateResource(worldCell, updatedCellPath, updatedCellSha256, updatedCellBytes.byteLength);
  updateBuildArtifact(
    mutableBuild,
    oldCellPath,
    updatedCellPath,
    updatedCellSha256,
    updatedCellBytes.byteLength,
  );

  const oldIndexPaths: string[] = [];
  const updatedIndexPaths: string[] = [];
  for (const districtIndex of districtIndexes) {
    const oldIndexPath = districtIndex.source;
    const parsedIndex = JSON.parse(await readFile(join(postRoot, oldIndexPath), "utf8")) as unknown;
    const mutableIndex = rewriteDistrictIndexCellReferences(parsedIndex, oldCellPath, {
      bytes: updatedCellBytes.byteLength,
      path: updatedCellPath,
      sha256: updatedCellSha256,
    });
    if (mutableIndex === null) continue;
    const updatedIndexBytes = Buffer.from(JSON.stringify(mutableIndex));
    const updatedIndexSha256 = sha256(updatedIndexBytes);
    const updatedIndexPath = replaceContentHash(oldIndexPath, updatedIndexSha256);
    await writeFile(join(postRoot, updatedIndexPath), updatedIndexBytes, { flag: "wx" });
    await rm(join(postRoot, oldIndexPath));
    updateResource(
      districtIndex,
      updatedIndexPath,
      updatedIndexSha256,
      updatedIndexBytes.byteLength,
    );
    updateBuildArtifact(
      mutableBuild,
      oldIndexPath,
      updatedIndexPath,
      updatedIndexSha256,
      updatedIndexBytes.byteLength,
    );
    const districtEntrypoints = mutableBuild.gameContentEntrypoints.filter(
      (entrypoint) => entrypoint.path === oldIndexPath,
    );
    if (districtEntrypoints.length !== 1) {
      throw new Error(`Build manifest does not reference exact district index ${oldIndexPath}`);
    }
    const districtEntrypoint = districtEntrypoints[0];
    if (districtEntrypoint === undefined) throw new Error("District entrypoint disappeared");
    districtEntrypoint.path = updatedIndexPath;
    oldIndexPaths.push(oldIndexPath);
    updatedIndexPaths.push(updatedIndexPath);
  }
  if (oldIndexPaths.length === 0) {
    throw new Error("No district index references the selected world cell");
  }

  const installBytes = Buffer.from(`${JSON.stringify(mutableInstall, null, 2)}\n`);
  await writeFile(join(postRoot, "install-manifest.json"), installBytes);
  updateBuildArtifact(
    mutableBuild,
    "install-manifest.json",
    "install-manifest.json",
    sha256(installBytes),
    installBytes.byteLength,
  );
  await writeFile(
    join(postRoot, "build-manifest.json"),
    `${JSON.stringify(mutableBuild, null, 2)}\n`,
  );

  // The shared build validator re-parses every district entrypoint and checks every
  // cell reference against the exact artifact identity. That is the final guard
  // against a missed shared-index reference.
  const post = await readAndValidateBuildManifest(postRoot);
  const analysis = analyzeAssetOnlyReleaseUpdate(pre, post);
  return Object.freeze({
    analysis,
    changedPaths: Object.freeze({
      after: Object.freeze([updatedCellPath, ...updatedIndexPaths]),
      before: Object.freeze([oldCellPath, ...oldIndexPaths]),
    }),
    post,
    pre,
  });
}

export async function publishAssetOnlyUpdateFixture(
  servingRoot: string,
  postRoot: string,
  fixture: AssetOnlyUpdateFixture,
): Promise<void> {
  for (const path of fixture.changedPaths.after) {
    await copyFile(join(postRoot, path), join(servingRoot, path));
    const expected = fixture.post.manifest.artifacts.find((artifact) => artifact.path === path);
    const actual = await sha256File(join(servingRoot, path));
    if (
      expected === undefined ||
      actual.bytes !== expected.bytes ||
      actual.sha256 !== expected.sha256
    ) {
      throw new Error(`Published asset-update resource identity is invalid: ${path}`);
    }
  }
  for (const path of ["install-manifest.json", "build-manifest.json"] as const) {
    const temporary = join(servingRoot, `.${path}.${randomUUID()}.next`);
    await copyFile(join(postRoot, path), temporary);
    await rename(temporary, join(servingRoot, path));
  }
  for (const path of fixture.changedPaths.before) {
    await rm(join(servingRoot, path));
  }
  await verifyPublishedAssetOnlyFixture(servingRoot, fixture);
}

export async function verifyPublishedAssetOnlyFixture(
  servingRoot: string,
  fixture: AssetOnlyUpdateFixture,
): Promise<void> {
  const [buildIdentity, installIdentity] = await Promise.all([
    sha256File(join(servingRoot, "build-manifest.json")),
    sha256File(join(servingRoot, "install-manifest.json")),
  ]);
  if (
    buildIdentity.sha256 !== fixture.post.artifactDigest ||
    installIdentity.sha256 !== fixture.post.releaseDigest
  ) {
    throw new Error("Published asset-only release does not match its exact fixture identity");
  }
  for (const artifact of fixture.post.manifest.artifacts) {
    const actual = await sha256File(join(servingRoot, artifact.path));
    if (actual.bytes !== artifact.bytes || actual.sha256 !== artifact.sha256) {
      throw new Error(`Published asset-update artifact identity is invalid: ${artifact.path}`);
    }
  }
  for (const path of fixture.changedPaths.before) {
    try {
      await stat(join(servingRoot, path));
    } catch (error: unknown) {
      if (isMissing(error)) continue;
      throw error;
    }
    throw new Error(`Published asset-update retained a stale pre-release path: ${path}`);
  }
}

function validateBuildLifecycleIdentity(pre: BuildManifest, post: BuildManifest): void {
  if (
    pre.schemaVersion !== post.schemaVersion ||
    JSON.stringify(pre.workerEntrypoints) !== JSON.stringify(post.workerEntrypoints) ||
    JSON.stringify(pre.offlineShell) !== JSON.stringify(post.offlineShell) ||
    pre.installManifestEntrypoint.path !== post.installManifestEntrypoint.path ||
    pre.installManifestEntrypoint.schemaVersion !== post.installManifestEntrypoint.schemaVersion
  ) {
    throw new Error("Executable build lifecycle contract drifted across asset-only update");
  }
}

function indexResources(
  manifest: InstallManifest,
  label: "post" | "pre",
): ReadonlyMap<string, InstallResource> {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.gameId !== "parallax" ||
    !Array.isArray(manifest.resources) ||
    manifest.resources.length === 0
  ) {
    throw new Error(`${label} install manifest identity is invalid`);
  }
  const resources = new Map<string, InstallResource>();
  for (const resource of manifest.resources) {
    requireResource(resource, label);
    if (resources.has(resource.id)) throw new Error(`${label} install resource ID is duplicated`);
    resources.set(resource.id, resource);
  }
  return resources;
}

function requireResource(resource: InstallResource, label: string): void {
  if (
    !Number.isSafeInteger(resource.bytes) ||
    resource.bytes <= 0 ||
    typeof resource.id !== "string" ||
    resource.id === "" ||
    typeof resource.kind !== "string" ||
    (!EXECUTABLE_KINDS.has(resource.kind) && !ASSET_KINDS.has(resource.kind)) ||
    typeof resource.source !== "string" ||
    resource.source === "" ||
    !SHA256.test(resource.sha256)
  ) {
    throw new Error(`${label} install resource identity is invalid`);
  }
}

function freezeIdentity(resource: InstallResource): AssetOnlyResourceIdentity {
  return Object.freeze({
    bytes: resource.bytes,
    id: resource.id,
    kind: resource.kind,
    scope: resource.scope,
    sha256: resource.sha256,
    source: resource.source,
    target: resource.target,
  });
}

function sameResource(left: AssetOnlyResourceIdentity, right: AssetOnlyResourceIdentity): boolean {
  return (
    left.bytes === right.bytes &&
    left.id === right.id &&
    left.kind === right.kind &&
    left.scope === right.scope &&
    left.sha256 === right.sha256 &&
    left.source === right.source &&
    left.target === right.target
  );
}

function digestExecutableResources(resources: readonly AssetOnlyResourceIdentity[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        resources.map(({ bytes, id, kind, scope, sha256: digest, source, target }) => ({
          bytes,
          id,
          kind,
          scope,
          sha256: digest,
          source,
          target,
        })),
      ),
    )
    .digest("hex");
}

function requireDigest(value: string, label: string): void {
  if (!SHA256.test(value)) throw new Error(`${label} identity is not a lower-case SHA-256`);
}

function sha256(value: NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(value).digest("hex");
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function replaceContentHash(path: string, digest: string): string {
  const updated = path.replace(/[a-f0-9]{64}(?=\.json$)/, digest);
  if (updated === path || !updated.endsWith(`-${digest}.json`)) {
    throw new Error(`Asset-only update source lacks an exact content hash: ${path}`);
  }
  return updated;
}

function updateResource(
  resource: MutableInstallResource,
  source: string,
  digest: string,
  bytes: number,
): void {
  resource.bytes = bytes;
  resource.sha256 = digest;
  resource.source = source;
}

function updateBuildArtifact(
  manifest: MutableBuildManifest,
  oldPath: string,
  path: string,
  digest: string,
  bytes: number,
): void {
  const artifact = manifest.artifacts.find((candidate) => candidate.path === oldPath);
  if (artifact === undefined) throw new Error(`Build artifact disappeared: ${oldPath}`);
  artifact.bytes = bytes;
  artifact.path = path;
  artifact.sha256 = digest;
}

export function rewriteDistrictIndexCellReferences(
  input: unknown,
  oldCellPath: string,
  updated: Readonly<{ readonly bytes: number; readonly path: string; readonly sha256: string }>,
): MutableDistrictIndex | null {
  const index = requireDistrictIndex(input);
  const sharedCells = index.cells.filter((candidate) => candidate.path === oldCellPath);
  if (sharedCells.length === 0) return null;
  for (const cell of sharedCells) {
    cell.bytes = updated.bytes;
    cell.path = updated.path;
    cell.sha256 = updated.sha256;
  }
  return index;
}

function requireDistrictIndex(input: unknown): MutableDistrictIndex {
  if (!isRecord(input) || !Array.isArray(input.cells)) {
    throw new Error("District index fixture is malformed");
  }
  for (const cell of input.cells) {
    if (
      !isRecord(cell) ||
      typeof cell.path !== "string" ||
      typeof cell.sha256 !== "string" ||
      !Number.isSafeInteger(cell.bytes)
    ) {
      throw new Error("District index fixture cell is malformed");
    }
  }
  return input as unknown as MutableDistrictIndex;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface MutableManifestArtifact {
  bytes: number;
  path: string;
  sha256: string;
}

interface MutableBuildManifest extends Omit<BuildManifest, "artifacts" | "gameContentEntrypoints"> {
  artifacts: MutableManifestArtifact[];
  gameContentEntrypoints: {
    districtId: string;
    path: string;
    schemaVersion: BuildManifest["gameContentEntrypoints"][number]["schemaVersion"];
    scope: "game-specific";
    targetType: "district";
  }[];
}

interface MutableInstallResource extends Omit<InstallResource, "bytes" | "sha256" | "source"> {
  bytes: number;
  sha256: string;
  source: string;
}

interface MutableInstallManifest extends Omit<InstallManifest, "resources"> {
  resources: MutableInstallResource[];
}

export interface MutableDistrictIndex {
  cells: {
    bytes: number;
    path: string;
    sha256: string;
  }[];
  [key: string]: unknown;
}
