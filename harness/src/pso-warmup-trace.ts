import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

const TRACE_SCHEMA_VERSION = 1;
const RENDERER = "@babylonjs/lite@1.12.0";
const RESOURCE_ID = "game-specific-pso-warmup-trace";
const ENTRY_ID = "babylon-lite.standard-opaque-msaa4";
const WEBGPU_ALL_BITS = 0xffff_ffff;
const WEBGPU_COLOR_WRITE_ALL = 0xf;
const STENCIL_FACE_DEFAULT = Object.freeze({
  compare: "always" as const,
  depthFailOp: "keep" as const,
  failOp: "keep" as const,
  passOp: "keep" as const,
});
const EFFECTIVE_PIPELINE_STATE = deepFreeze({
  colorTarget: {
    blend: null,
    format: "bgra8unorm",
    writeMask: WEBGPU_COLOR_WRITE_ALL,
  },
  depthStencil: {
    depthBias: 0,
    depthBiasClamp: 0,
    depthBiasSlopeScale: 0,
    depthCompare: "greater-equal",
    depthWriteEnabled: true,
    format: "depth24plus-stencil8",
    stencilBack: STENCIL_FACE_DEFAULT,
    stencilFront: STENCIL_FACE_DEFAULT,
    stencilReadMask: WEBGPU_ALL_BITS,
    stencilWriteMask: WEBGPU_ALL_BITS,
  },
  layout: {
    bindGroups: [
      {
        entries: [
          {
            binding: 0,
            resource: {
              hasDynamicOffset: false,
              kind: "buffer",
              minBindingSize: 0,
              type: "uniform",
            },
            visibility: 3,
          },
          {
            binding: 1,
            resource: {
              hasDynamicOffset: false,
              kind: "buffer",
              minBindingSize: 0,
              type: "uniform",
            },
            visibility: 2,
          },
        ],
        index: 0,
      },
      {
        entries: [
          {
            binding: 0,
            resource: {
              hasDynamicOffset: false,
              kind: "buffer",
              minBindingSize: 0,
              type: "uniform",
            },
            visibility: 3,
          },
          {
            binding: 1,
            resource: {
              hasDynamicOffset: false,
              kind: "buffer",
              minBindingSize: 0,
              type: "uniform",
            },
            visibility: 2,
          },
        ],
        index: 1,
      },
    ],
    mode: "explicit",
  },
  multisample: {
    alphaToCoverageEnabled: false,
    count: 4,
    mask: WEBGPU_ALL_BITS,
  },
  primitive: {
    cullMode: "back",
    frontFace: "ccw",
    stripIndexFormat: null,
    topology: "triangle-list",
    unclippedDepth: false,
  },
  shader: {
    family: "standard",
    fragmentEntryPoint: "main",
    materialFeatureKey: 0,
    meshFeatureKey: 0,
    variantKey: "",
    vertexEntryPoint: "main",
  },
  vertexBuffers: [
    {
      arrayStride: 12,
      attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }],
      stepMode: "vertex",
    },
    {
      arrayStride: 12,
      attributes: [{ format: "float32x3", offset: 0, shaderLocation: 1 }],
      stepMode: "vertex",
    },
  ],
} as const);

export type PsoWarmupEffectivePipelineState = typeof EFFECTIVE_PIPELINE_STATE;

export interface PsoWarmupTraceIdentity {
  readonly buildCompatibilityDigest: string;
  readonly bytes: number;
  readonly entry: Readonly<{
    readonly id: typeof ENTRY_ID;
    readonly kind: "render";
    readonly priority: 0;
    readonly state: PsoWarmupEffectivePipelineState;
    readonly stateDigest: string;
  }>;
  readonly renderer: typeof RENDERER;
  readonly resource: Readonly<{
    readonly id: typeof RESOURCE_ID;
    readonly kind: "asset-pack";
    readonly scope: "game-specific";
    readonly source: string;
    readonly target: "opfs";
  }>;
  readonly schemaVersion: typeof TRACE_SCHEMA_VERSION;
  readonly sha256: string;
}

export interface PsoWarmupBuildManifestInput {
  readonly artifacts: readonly Readonly<{
    readonly bytes: number;
    readonly path: string;
    readonly sha256: string;
  }>[];
}

export interface PsoWarmupInstallManifestInput {
  readonly resources: readonly Readonly<{
    readonly bytes: number;
    readonly id: string;
    readonly kind: string;
    readonly scope: string;
    readonly sha256: string;
    readonly source: string;
    readonly target: string;
  }>[];
}

const EXPECTED_IDENTITY = createExpectedIdentity();

export function resolveExpectedPsoWarmupTraceIdentity(): PsoWarmupTraceIdentity {
  return EXPECTED_IDENTITY;
}

export async function readAndValidatePsoWarmupTraceIdentity(
  buildRoot: string,
  buildManifest: PsoWarmupBuildManifestInput,
  installManifest: PsoWarmupInstallManifestInput,
): Promise<PsoWarmupTraceIdentity> {
  const artifacts = buildManifest.artifacts.filter(
    (artifact) =>
      /^immutable\/pso-warmup-trace-[a-f0-9]{64}\.json$/.test(artifact.path) ||
      artifact.path.includes("pso-warmup-trace"),
  );
  if (artifacts.length !== 1) {
    throw new Error("Build manifest must bind exactly one PSO warmup trace artifact");
  }
  const artifact = artifacts[0];
  if (artifact === undefined) throw new Error("PSO warmup trace artifact is missing");
  const resources = installManifest.resources.filter(
    (resource) => resource.id === RESOURCE_ID || resource.source.includes("pso-warmup-trace"),
  );
  if (resources.length !== 1) {
    throw new Error("Install manifest must bind exactly one PSO warmup trace resource");
  }
  const resource = resources[0];
  if (resource === undefined) throw new Error("PSO warmup trace resource is missing");
  const expectedPath = `immutable/pso-warmup-trace-${EXPECTED_IDENTITY.sha256}.json`;
  if (
    artifact.path !== expectedPath ||
    artifact.bytes !== EXPECTED_IDENTITY.bytes ||
    artifact.sha256 !== EXPECTED_IDENTITY.sha256 ||
    resource.bytes !== artifact.bytes ||
    resource.id !== RESOURCE_ID ||
    resource.kind !== "asset-pack" ||
    resource.scope !== "game-specific" ||
    resource.sha256 !== artifact.sha256 ||
    resource.source !== artifact.path ||
    resource.target !== "opfs"
  ) {
    throw new Error(
      "PSO warmup manifest resource does not match the exact expected trace identity",
    );
  }
  const root = resolve(buildRoot);
  const path = resolve(root, artifact.path);
  if (!path.startsWith(`${root}${sep}`)) {
    throw new Error("PSO warmup trace artifact escapes the build root");
  }
  const bytes = await readFile(path);
  validateExactPsoWarmupTraceBytes(bytes);
  return Object.freeze({
    ...EXPECTED_IDENTITY,
    resource: Object.freeze({ ...EXPECTED_IDENTITY.resource, source: artifact.path }),
  });
}

export function validateExactPsoWarmupTraceBytes(bytes: Uint8Array): PsoWarmupTraceIdentity {
  const expectedBytes = expectedTraceBytes(EXPECTED_IDENTITY);
  const actualHash = sha256Hex(bytes);
  if (
    bytes.byteLength !== EXPECTED_IDENTITY.bytes ||
    actualHash !== EXPECTED_IDENTITY.sha256 ||
    !Buffer.from(bytes).equals(expectedBytes)
  ) {
    throw new Error("PSO warmup trace bytes do not match the exact independent harness contract");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    throw new Error("PSO warmup trace bytes are not canonical UTF-8 JSON", { cause: error });
  }
  if (JSON.stringify(parsed) !== JSON.stringify(expectedTrace(EXPECTED_IDENTITY))) {
    throw new Error("PSO warmup trace fields do not match the exact independent harness contract");
  }
  return EXPECTED_IDENTITY;
}

function createExpectedIdentity(): PsoWarmupTraceIdentity {
  const stateDigest = digestCanonical(EFFECTIVE_PIPELINE_STATE);
  const entry = Object.freeze({
    id: ENTRY_ID,
    kind: "render" as const,
    priority: 0 as const,
    state: EFFECTIVE_PIPELINE_STATE,
    stateDigest,
  });
  const buildCompatibilityDigest = digestCanonical({
    entries: [{ id: ENTRY_ID, stateDigest }],
    renderer: RENDERER,
    schemaVersion: TRACE_SCHEMA_VERSION,
  });
  const partial: Readonly<{
    readonly buildCompatibilityDigest: string;
    readonly entry: PsoWarmupTraceIdentity["entry"];
    readonly renderer: typeof RENDERER;
    readonly schemaVersion: typeof TRACE_SCHEMA_VERSION;
  }> = {
    buildCompatibilityDigest,
    entry,
    renderer: RENDERER,
    schemaVersion: TRACE_SCHEMA_VERSION,
  };
  const bytes = Buffer.from(`${JSON.stringify(expectedTrace(partial), null, 2)}\n`);
  return Object.freeze({
    ...partial,
    bytes: bytes.byteLength,
    resource: Object.freeze({
      id: RESOURCE_ID,
      kind: "asset-pack" as const,
      scope: "game-specific" as const,
      source: "",
      target: "opfs" as const,
    }),
    sha256: sha256Hex(bytes),
  });
}

function expectedTrace(
  identity: Readonly<{
    readonly buildCompatibilityDigest: string;
    readonly entry: PsoWarmupTraceIdentity["entry"];
    readonly renderer: typeof RENDERER;
    readonly schemaVersion: typeof TRACE_SCHEMA_VERSION;
  }>,
): unknown {
  return {
    buildCompatibilityDigest: identity.buildCompatibilityDigest,
    entries: [identity.entry],
    renderer: identity.renderer,
    schemaVersion: identity.schemaVersion,
  };
}

function expectedTraceBytes(identity: PsoWarmupTraceIdentity): Buffer {
  return Buffer.from(`${JSON.stringify(expectedTrace(identity), null, 2)}\n`);
}

function digestCanonical(input: unknown): string {
  return sha256Hex(Buffer.from(JSON.stringify(input)));
}

function sha256Hex(input: NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(input).digest("hex");
}

function deepFreeze<T>(input: T): Readonly<T> {
  if (typeof input === "object" && input !== null) {
    Object.freeze(input);
    for (const value of Object.values(input)) deepFreeze(value);
  }
  return input;
}
