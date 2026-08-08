import type { BuildManifest, ManifestWorkerEntrypoint } from "./build-manifest.js";

const REQUIRED_WORKER_ROLES = Object.freeze([
  "decode",
  "installer",
  "render",
  "sim",
  "streaming",
  "wasm-thread",
] as const);

type RequiredWorkerRole = (typeof REQUIRED_WORKER_ROLES)[number];

export interface HeapWorkerTopologyInput {
  readonly baseUrl: string;
  readonly decodeWorkerCount: number;
  readonly manifest: Pick<BuildManifest, "workerEntrypoints">;
}

/**
 * Resolves the exact dedicated-worker target multiset that an all-realm JS-heap
 * sample must observe. The wasm-thread entrypoint is validated as part of the build
 * topology but excluded because those short-lived workers do not remain in the
 * steady-state application target set. The M3 sim worker is long-lived and mandatory.
 */
export function resolveHeapWorkerTargetUrls(input: HeapWorkerTopologyInput): readonly string[] {
  if (!Number.isSafeInteger(input.decodeWorkerCount) || input.decodeWorkerCount < 1) {
    throw new Error(
      `Decode worker count must be a positive safe integer; received ${String(input.decodeWorkerCount)}`,
    );
  }

  const entrypoints = input.manifest.workerEntrypoints;
  if (entrypoints.length !== REQUIRED_WORKER_ROLES.length) {
    throw new Error(
      `Expected exactly ${REQUIRED_WORKER_ROLES.length} worker entrypoints; received ${entrypoints.length}`,
    );
  }

  const byRole = new Map<RequiredWorkerRole, ManifestWorkerEntrypoint>();
  const paths = new Set<string>();
  for (const entrypoint of entrypoints) {
    if (entrypoint.targetType !== "worker" || !isRequiredWorkerRole(entrypoint.role)) {
      throw new Error(
        `Unexpected worker topology entry ${JSON.stringify(entrypoint.role)}/${JSON.stringify(entrypoint.targetType)}`,
      );
    }
    if (byRole.has(entrypoint.role)) {
      throw new Error(`Duplicate ${entrypoint.role} worker entrypoint`);
    }
    if (paths.has(entrypoint.path)) {
      throw new Error(`Worker entrypoint path ${JSON.stringify(entrypoint.path)} is duplicated`);
    }
    byRole.set(entrypoint.role, entrypoint);
    paths.add(entrypoint.path);
  }

  for (const role of REQUIRED_WORKER_ROLES) {
    if (!byRole.has(role)) throw new Error(`Missing ${role} worker entrypoint`);
  }

  const root = new URL("/", input.baseUrl);
  const resolveRole = (role: RequiredWorkerRole): string => {
    const entrypoint = byRole.get(role);
    if (entrypoint === undefined) throw new Error(`${role} worker entrypoint disappeared`);
    return new URL(entrypoint.path, root).href;
  };
  const decodeUrl = resolveRole("decode");

  return Object.freeze([
    resolveRole("installer"),
    resolveRole("render"),
    resolveRole("sim"),
    resolveRole("streaming"),
    ...Array.from({ length: input.decodeWorkerCount }, () => decodeUrl),
  ]);
}

function isRequiredWorkerRole(value: string): value is RequiredWorkerRole {
  return (REQUIRED_WORKER_ROLES as readonly string[]).includes(value);
}
