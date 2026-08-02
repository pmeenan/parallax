import {
  canonicalAppOwnedLlmModelResourceId,
  INSTALL_MANIFEST_GAME_ID,
  INSTALL_MANIFEST_PATH,
  INSTALL_MANIFEST_SCHEMA_VERSION,
  INSTALL_RESOURCE_PLACEMENTS,
} from "@parallax/engine";

export { INSTALL_MANIFEST_GAME_ID, INSTALL_MANIFEST_PATH, INSTALL_MANIFEST_SCHEMA_VERSION };

export type InstallResourceScope = "app-shell" | "common" | "game-specific";
export type InstallResourceTarget = "opfs" | "shell";
export type InstallResourceKind =
  | "asset-pack"
  | "district-index"
  | "document"
  | "model"
  | "module"
  | "wasm"
  | "worker"
  | "world-cell";

export interface InstallResource {
  readonly bytes: number;
  readonly id: string;
  readonly kind: InstallResourceKind;
  readonly scope: InstallResourceScope;
  readonly sha256: string;
  readonly source: string;
  readonly target: InstallResourceTarget;
}

export interface InstallManifest {
  readonly gameId: typeof INSTALL_MANIFEST_GAME_ID;
  readonly resources: readonly InstallResource[];
  readonly schemaVersion: typeof INSTALL_MANIFEST_SCHEMA_VERSION;
}

export interface InstallManifestSummary {
  readonly bytesByScope: Readonly<Record<InstallResourceScope, number>>;
  readonly bytesByTarget: Readonly<Record<InstallResourceTarget, number>>;
  readonly countByScope: Readonly<Record<InstallResourceScope, number>>;
  readonly countByTarget: Readonly<Record<InstallResourceTarget, number>>;
  readonly resourceBytes: number;
  readonly resourceCount: number;
}

export type InstallManifestLocalArtifact = InstallResource;

export interface ParsedInstallManifest {
  readonly manifest: InstallManifest;
  readonly summary: InstallManifestSummary;
}

const PINNED_MODEL = Object.freeze([
  Object.freeze({
    bytes: 23_532_320,
    path: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00001-of-00005.gguf",
    sha256: "ff074d7cae3cbda06f7a32b6d42c206bf88c2bee84c9d6165a0937ec2b61958d",
  }),
  Object.freeze({
    bytes: 1_321_205_952,
    path: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00002-of-00005.gguf",
    sha256: "1c5368744032e95ba212561c1985cd8017de6fd165fef1f648528e0be265d4a8",
  }),
  Object.freeze({
    bytes: 508_734_272,
    path: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00003-of-00005.gguf",
    sha256: "f8c3b5b6f05090ef292ed643357fed6b1df5381d0a21e11d3515580af3ef48f3",
  }),
  Object.freeze({
    bytes: 510_543_744,
    path: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00004-of-00005.gguf",
    sha256: "ca3403a90060fc56b92e6b35acb0090eebb8b7eb11c4919536ba645f4d45c461",
  }),
  Object.freeze({
    bytes: 256_355_264,
    path: "gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00005-of-00005.gguf",
    sha256: "30c5c95b427827e9f1993f7df2e4d6cbdea2354811ab5dcafd6db41190cfb9f9",
  }),
]);
const TOP_LEVEL_KEYS = Object.freeze(["gameId", "resources", "schemaVersion"]);
const RESOURCE_KEYS = Object.freeze(["bytes", "id", "kind", "scope", "sha256", "source", "target"]);
const SAFE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SCOPES: ReadonlySet<string> = new Set(["app-shell", "common", "game-specific"]);
const TARGETS: ReadonlySet<string> = new Set(["opfs", "shell"]);
const KINDS: ReadonlySet<string> = new Set([
  "asset-pack",
  "district-index",
  "document",
  "model",
  "module",
  "wasm",
  "worker",
  "world-cell",
]);
const PLACEMENTS: ReadonlySet<string> = new Set(INSTALL_RESOURCE_PLACEMENTS);

export function parseInstallManifest(
  input: unknown,
  expectedLocalArtifacts: readonly InstallManifestLocalArtifact[],
): ParsedInstallManifest {
  if (!isRecord(input) || !hasExactKeys(input, TOP_LEVEL_KEYS)) {
    throw new Error("Install manifest v1 requires exact gameId, resources, and schemaVersion keys");
  }
  if (input.gameId !== INSTALL_MANIFEST_GAME_ID) {
    throw new Error(`Unsupported install manifest gameId ${String(input.gameId)}`);
  }
  if (input.schemaVersion !== INSTALL_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported install manifest schema ${String(input.schemaVersion)}`);
  }
  if (!Array.isArray(input.resources) || input.resources.length === 0) {
    throw new Error("Install manifest v1 requires a non-empty resources array");
  }
  const ids = new Set<string>();
  const sources = new Set<string>();
  const hashes = new Set<string>();
  const resources: InstallResource[] = [];
  let previousId: string | null = null;
  for (const candidate of input.resources) {
    const resource = parseResource(candidate);
    if (ids.has(resource.id)) throw new Error(`Duplicate install resource id ${resource.id}`);
    if (sources.has(resource.source))
      throw new Error(`Duplicate install resource source ${resource.source}`);
    if (hashes.has(resource.sha256))
      throw new Error(`Duplicate install resource sha256 ${resource.sha256}`);
    if (previousId !== null && compareCodepoints(previousId, resource.id) >= 0) {
      throw new Error("Install manifest resources must be ordered by strictly increasing id");
    }
    ids.add(resource.id);
    sources.add(resource.source);
    hashes.add(resource.sha256);
    resources.push(resource);
    previousId = resource.id;
  }
  validatePinnedModels(resources);
  validateLocalArtifacts(resources, expectedLocalArtifacts);
  const manifest = Object.freeze({
    gameId: INSTALL_MANIFEST_GAME_ID,
    resources: Object.freeze(resources),
    schemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
  });
  return Object.freeze({ manifest, summary: summarize(resources) });
}

function parseResource(input: unknown): InstallResource {
  if (!isRecord(input) || !hasExactKeys(input, RESOURCE_KEYS)) {
    throw new Error("Install manifest resource has unsupported or missing keys");
  }
  if (
    !Number.isSafeInteger(input.bytes) ||
    (input.bytes as number) <= 0 ||
    typeof input.id !== "string" ||
    !SAFE_ID.test(input.id) ||
    typeof input.kind !== "string" ||
    !KINDS.has(input.kind) ||
    typeof input.scope !== "string" ||
    !SCOPES.has(input.scope) ||
    typeof input.sha256 !== "string" ||
    !SHA256.test(input.sha256) ||
    typeof input.source !== "string" ||
    typeof input.target !== "string" ||
    !TARGETS.has(input.target)
  ) {
    throw new Error(`Invalid install manifest resource: ${JSON.stringify(input)}`);
  }
  const resource = input as unknown as InstallResource;
  validateSource(resource.source);
  validatePlacement(resource);
  return Object.freeze({ ...resource });
}

function validateSource(source: string): void {
  if (source.startsWith("https://")) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new Error(`Invalid install resource HTTPS source ${source}`);
    }
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.origin === "null"
    ) {
      throw new Error(`Unsafe install resource HTTPS source ${source}`);
    }
    return;
  }
  if (
    source === "" ||
    !/^[A-Za-z0-9._/-]+$/.test(source) ||
    source.startsWith("/") ||
    source.includes("\\") ||
    source.includes("?") ||
    source.includes("#") ||
    source.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe install resource local source ${source}`);
  }
}

function validatePlacement(resource: InstallResource): void {
  const placement = `${resource.scope}/${resource.target}/${resource.kind}`;
  if (!PLACEMENTS.has(placement)) {
    throw new Error(`Unsupported install resource placement ${placement}`);
  }
  if (resource.target === "shell" && resource.source.startsWith("https://")) {
    throw new Error("Shell install resources must use a local same-origin source");
  }
}

function validatePinnedModels(resources: readonly InstallResource[]): void {
  const models = resources.filter((resource) => resource.kind === "model");
  if (models.length !== PINNED_MODEL.length) {
    throw new Error("Install manifest does not contain the five exact pinned model shards");
  }
  for (const artifact of PINNED_MODEL) {
    const source = `immutable/model-${artifact.sha256}.gguf`;
    const id = canonicalAppOwnedLlmModelResourceId(artifact.path);
    if (
      models.filter(
        (resource) =>
          resource.bytes === artifact.bytes &&
          resource.id === id &&
          resource.scope === "common" &&
          resource.sha256 === artifact.sha256 &&
          resource.source === source &&
          resource.target === "opfs",
      ).length !== 1
    ) {
      throw new Error(`Install manifest model identity mismatch for ${artifact.path}`);
    }
  }
}

function validateLocalArtifacts(
  resources: readonly InstallResource[],
  artifacts: readonly InstallManifestLocalArtifact[],
): void {
  const paths = new Set<string>();
  const installOnlyPaths = new Set(
    PINNED_MODEL.map((artifact) => `immutable/model-${artifact.sha256}.gguf`),
  );
  for (const artifact of artifacts) {
    if (
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0 ||
      !SHA256.test(artifact.sha256)
    ) {
      throw new Error(`Invalid expected local install artifact ${artifact.source}`);
    }
    validateSource(artifact.source);
    validatePlacement(artifact);
    if (
      artifact.source.startsWith("https://") ||
      installOnlyPaths.has(artifact.source) ||
      paths.has(artifact.source)
    ) {
      throw new Error(`Unsafe or duplicate expected local install artifact ${artifact.source}`);
    }
    paths.add(artifact.source);
    const matches = resources.filter((resource) => resource.source === artifact.source);
    if (matches.length !== 1) {
      throw new Error(`Local artifact ${artifact.source} must be classified exactly once`);
    }
    const match = matches[0];
    if (
      match?.bytes !== artifact.bytes ||
      match.id !== artifact.id ||
      match.kind !== artifact.kind ||
      match.scope !== artifact.scope ||
      match.sha256 !== artifact.sha256 ||
      match.target !== artifact.target
    ) {
      throw new Error(`Local install resource classification mismatch for ${artifact.source}`);
    }
  }
  const unexpected = resources.find(
    (resource) => !paths.has(resource.source) && !installOnlyPaths.has(resource.source),
  );
  if (unexpected !== undefined) {
    throw new Error(
      `Install manifest classifies unknown current-build resource ${unexpected.source}`,
    );
  }
}

function summarize(resources: readonly InstallResource[]): InstallManifestSummary {
  const bytesByScope: Record<InstallResourceScope, number> = {
    "app-shell": 0,
    common: 0,
    "game-specific": 0,
  };
  const countByScope: Record<InstallResourceScope, number> = {
    "app-shell": 0,
    common: 0,
    "game-specific": 0,
  };
  const bytesByTarget: Record<InstallResourceTarget, number> = { opfs: 0, shell: 0 };
  const countByTarget: Record<InstallResourceTarget, number> = { opfs: 0, shell: 0 };
  let resourceBytes = 0;
  for (const resource of resources) {
    bytesByScope[resource.scope] = safeAdd(bytesByScope[resource.scope], resource.bytes);
    countByScope[resource.scope] += 1;
    bytesByTarget[resource.target] = safeAdd(bytesByTarget[resource.target], resource.bytes);
    countByTarget[resource.target] += 1;
    resourceBytes = safeAdd(resourceBytes, resource.bytes);
  }
  return Object.freeze({
    bytesByScope: Object.freeze(bytesByScope),
    bytesByTarget: Object.freeze(bytesByTarget),
    countByScope: Object.freeze(countByScope),
    countByTarget: Object.freeze(countByTarget),
    resourceBytes,
    resourceCount: resources.length,
  });
}

function safeAdd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new Error("Install manifest byte aggregate is unsafe");
  return total;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort(compareCodepoints);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
