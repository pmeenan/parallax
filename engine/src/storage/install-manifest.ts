import { APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS } from "../ai/app-owned-llm-spike-protocol";
import { assertUnicodeScalarString, compareUnicodeScalars } from "../core/unicode-scalar-order";

export const INSTALL_MANIFEST_SCHEMA_VERSION = 1;
export const INSTALL_MANIFEST_GAME_ID = "parallax";
export const INSTALL_MANIFEST_PATH = "install-manifest.json";

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

export const INSTALL_RESOURCE_PLACEMENTS = Object.freeze([
  "app-shell/shell/document",
  "app-shell/shell/module",
  "common/opfs/asset-pack",
  "common/opfs/model",
  "common/shell/module",
  "common/shell/wasm",
  "common/shell/worker",
  "game-specific/opfs/asset-pack",
  "game-specific/opfs/district-index",
  "game-specific/opfs/world-cell",
  "game-specific/shell/module",
] as const);
export type InstallResourcePlacement = (typeof INSTALL_RESOURCE_PLACEMENTS)[number];

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

const TOP_LEVEL_KEYS = Object.freeze(["gameId", "resources", "schemaVersion"]);
const RESOURCE_KEYS = Object.freeze(["bytes", "id", "kind", "scope", "sha256", "source", "target"]);
const RESOURCE_SCOPES: ReadonlySet<string> = new Set(["app-shell", "common", "game-specific"]);
const RESOURCE_TARGETS: ReadonlySet<string> = new Set(["opfs", "shell"]);
const RESOURCE_KINDS: ReadonlySet<string> = new Set([
  "asset-pack",
  "district-index",
  "document",
  "model",
  "module",
  "wasm",
  "worker",
  "world-cell",
]);
const RESOURCE_PLACEMENTS: ReadonlySet<string> = new Set(INSTALL_RESOURCE_PLACEMENTS);
const SAFE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function canonicalAppOwnedLlmModelResourceId(path: string): string {
  if (path === "") throw new Error("App-owned model artifact path must not be empty");
  const resourceId = `common-model-${path.replaceAll(/[^a-zA-Z0-9._-]/g, "-").toLowerCase()}`;
  if (!SAFE_ID.test(resourceId)) {
    throw new Error("App-owned model artifact path cannot produce a canonical resource ID");
  }
  return resourceId;
}

export function parseInstallManifest(
  input: unknown,
  expectedLocalArtifacts: readonly InstallManifestLocalArtifact[],
): ParsedInstallManifest {
  const parsed = parseInstallManifestDocument(input);
  validatePinnedModelResources(parsed.manifest.resources);
  validateLocalArtifacts(parsed.manifest.resources, expectedLocalArtifacts);
  return parsed;
}

/**
 * Parses the self-authenticating runtime document without applying the build-specific
 * inventory policy. Build and harness validation must use parseInstallManifest().
 */
export function parseInstallManifestDocument(input: unknown): ParsedInstallManifest {
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
    if (sources.has(resource.source)) {
      throw new Error(`Duplicate install resource source ${resource.source}`);
    }
    if (hashes.has(resource.sha256)) {
      throw new Error(`Duplicate install resource sha256 ${resource.sha256}`);
    }
    if (previousId !== null && compareUnicodeScalars(previousId, resource.id) >= 0) {
      throw new Error("Install manifest resources must be ordered by strictly increasing id");
    }
    ids.add(resource.id);
    sources.add(resource.source);
    hashes.add(resource.sha256);
    resources.push(resource);
    previousId = resource.id;
  }

  const manifest = Object.freeze({
    gameId: INSTALL_MANIFEST_GAME_ID,
    resources: Object.freeze(resources),
    schemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
  });
  return Object.freeze({ manifest, summary: summarizeInstallManifest(resources) });
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
    !RESOURCE_KINDS.has(input.kind) ||
    typeof input.scope !== "string" ||
    !RESOURCE_SCOPES.has(input.scope) ||
    typeof input.sha256 !== "string" ||
    !SHA256.test(input.sha256) ||
    typeof input.source !== "string" ||
    typeof input.target !== "string" ||
    !RESOURCE_TARGETS.has(input.target)
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
  if (!RESOURCE_PLACEMENTS.has(placement)) {
    throw new Error(`Unsupported install resource placement ${placement}`);
  }
  if (resource.target === "shell" && resource.source.startsWith("https://")) {
    throw new Error("Shell install resources must use a local same-origin source");
  }
}

function validatePinnedModelResources(resources: readonly InstallResource[]): void {
  const models = resources.filter((resource) => resource.kind === "model");
  if (models.length !== APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length) {
    throw new Error("Install manifest does not contain the five exact pinned model shards");
  }
  for (const artifact of APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS) {
    const source = `immutable/model-${artifact.sha256}.gguf`;
    const expectedId = canonicalAppOwnedLlmModelResourceId(artifact.path);
    const matches = models.filter(
      (resource) =>
        resource.bytes === artifact.bytes &&
        resource.id === expectedId &&
        resource.scope === "common" &&
        resource.sha256 === artifact.sha256 &&
        resource.source === source &&
        resource.target === "opfs",
    );
    if (matches.length !== 1) {
      throw new Error(`Install manifest model identity mismatch for ${artifact.path}`);
    }
  }
}

function validateLocalArtifacts(
  resources: readonly InstallResource[],
  artifacts: readonly InstallManifestLocalArtifact[],
): void {
  const expectedPaths = new Set<string>();
  const installOnlyPaths = new Set(
    APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.map(
      (artifact) => `immutable/model-${artifact.sha256}.gguf`,
    ),
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
      expectedPaths.has(artifact.source)
    ) {
      throw new Error(`Unsafe or duplicate expected local install artifact ${artifact.source}`);
    }
    expectedPaths.add(artifact.source);
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
  const unexpected = resources.filter(
    (resource) => !expectedPaths.has(resource.source) && !installOnlyPaths.has(resource.source),
  );
  if (unexpected.length !== 0) {
    throw new Error(
      `Install manifest classifies unknown current-build resource ${unexpected[0]?.source}`,
    );
  }
}

function summarizeInstallManifest(resources: readonly InstallResource[]): InstallManifestSummary {
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
  const keys = Object.keys(value);
  for (const key of keys) assertUnicodeScalarString(key);
  keys.sort(compareUnicodeScalars);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}
