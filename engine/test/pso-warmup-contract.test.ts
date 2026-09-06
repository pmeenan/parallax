import { createStandardMaterial, type EngineContext, type Mesh } from "@babylonjs/lite";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // The pinned low-level shader composer reads WebGPU's immutable stage flags at import.
  Object.defineProperty(globalThis, "GPUShaderStage", {
    configurable: true,
    value: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
  });
});

import {
  createEmbeddedPsoWarmupTrace,
  createPsoWarmupTrace,
  isPsoWarmupFailureError,
  PSO_WARMUP_BUILD_COMPATIBILITY_DIGEST,
  PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST,
  parseFailure,
  parsePsoWarmupTrace,
  parsePsoWarmupTraceBundle,
  parsePsoWarmupTraceBytes,
  sanitizePsoWarmupFailureDetail,
  serializePsoWarmupTrace,
} from "../src/index";
import {
  normalizePsoBindGroupLayoutDescriptor,
  observeStandardOpaquePsoRegistration,
} from "../src/render/pso-warmup-babylon-observer";
import { createStreamedPbrMaterial } from "../src/render/streamed-pbr-asset";

describe("PSO warmup trace contract", () => {
  it("rejects invalid GPU handles even when the pipeline descriptor matches exactly", async () => {
    for (const mutation of ["gpu-validation", "shader-diagnostics"] as const) {
      const boundary = await createBoundary(mutation);
      await expect(boundary.register()).rejects.toThrow(/GPU validation failed.*injected/);
      expect(boundary.device.createRenderPipeline).toBe(boundary.originalCreateRenderPipeline);
    }
  });
  it("observes all three pinned shipping pipelines and rejects an omitted depth pass", async () => {
    const complete = await createCsmBoundary();
    const observed = await complete.observation.registerAll([complete.mesh], complete.compile);
    expect([...observed]).toEqual(
      createPsoWarmupTrace()
        .entries.slice(0, 3)
        .map((entry) => [entry.id, entry.stateDigest]),
    );
    const missing = await createCsmBoundary(true);
    await expect(missing.observation.registerAll([missing.mesh], missing.compile)).rejects.toThrow(
      /standard-csm-depth.*observed 0/,
    );
  });
  it("observes exact PBR surface and shadow pipelines", async () => {
    const boundary = await createCsmBoundary();
    const stone = await pbrBoundary(boundary.device);
    const observed = await boundary.observation.registerAll([boundary.mesh], async () => {
      boundary.compile();
      stone.compile();
    }, [stone.mesh]);
    expect([...observed]).toEqual(
      createPsoWarmupTrace().entries.map((entry) => [entry.id, entry.stateDigest]),
    );
  });
  it("rejects missing PBR shadow pipelines and changed composed sources", async () => {
    for (const mutation of ["missing-depth", "source"] as const) {
      const boundary = await createCsmBoundary();
      const stone = await pbrBoundary(boundary.device, mutation);
      await expect(
        boundary.observation.registerAll([boundary.mesh], async () => {
          boundary.compile();
          stone.compile();
        }, [stone.mesh]),
      ).rejects.toThrow(mutation === "source" ? /WGSL drift/ : /pbr-csm-depth.*observed 0/);
    }
  });
  it("keeps bounded failure details idempotent at whitespace truncation boundaries", () => {
    for (let prefixLength = 0; prefixLength < 240; prefixLength += 1) {
      const sanitized = sanitizePsoWarmupFailureDetail(
        `${"x".repeat(prefixLength)} ${"y".repeat(300)}`,
      );
      expect(sanitizePsoWarmupFailureDetail(sanitized)).toBe(sanitized);
      expect(parseFailure(sanitized).detail).toBe(sanitized);
    }
  });

  it("round-trips the exact deterministic current registry", () => {
    const trace = createPsoWarmupTrace();
    expect(parsePsoWarmupTraceBytes(serializePsoWarmupTrace(trace))).toEqual(trace);
    expect(trace.buildCompatibilityDigest).toBe(PSO_WARMUP_BUILD_COMPATIBILITY_DIGEST);
    expect(trace.entries[0]?.stateDigest).toBe(PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST);
    expect(new TextDecoder().decode(serializePsoWarmupTrace(trace))).toMatch(/\n$/);
  });

  it("classifies malformed bytes separately from incompatible trace state", () => {
    for (const [input, expectedClass] of [
      [new TextEncoder().encode("{invalid}\n"), "parse"],
      [
        {
          ...createPsoWarmupTrace(),
          renderer: "@babylonjs/lite@0.0.0",
        },
        "incompatibility",
      ],
    ] as const) {
      try {
        if (input instanceof Uint8Array) parsePsoWarmupTraceBytes(input);
        else parsePsoWarmupTrace(input);
        throw new Error("Expected PSO warmup failure");
      } catch (error: unknown) {
        expect(isPsoWarmupFailureError(error)).toBe(true);
        if (!isPsoWarmupFailureError(error)) throw error;
        expect(error.failure.class).toBe(expectedClass);
      }
    }
  });

  it("validates exact bundle identity and provenance at the render-worker boundary", () => {
    const bundle = createEmbeddedPsoWarmupTrace();
    expect(parsePsoWarmupTraceBundle(bundle)).toEqual(bundle);
    expect(() => parsePsoWarmupTraceBundle({ ...bundle, bytes: bundle.bytes + 1 })).toThrow(
      /identity or provenance/,
    );
    expect(() =>
      parsePsoWarmupTraceBundle({
        ...bundle,
        releaseDigest: "a".repeat(64),
        source: "privileged-embedded",
      }),
    ).toThrow(/identity or provenance/);
  });

  it("rejects unknown keys, semantic drift, and noncanonical bytes", () => {
    const trace = createPsoWarmupTrace();
    expect(() => parsePsoWarmupTrace({ ...trace, extra: true })).toThrow(/shape is incompatible/);
    expect(() =>
      parsePsoWarmupTrace({
        ...trace,
        entries: [{ ...trace.entries[0], stateDigest: "a".repeat(64) }],
      }),
    ).toThrow(/current render-state registry/);
    expect(() => parsePsoWarmupTraceBytes(new TextEncoder().encode(JSON.stringify(trace)))).toThrow(
      /end with a newline/,
    );
  });

  it("rejects mutation of every effective pipeline descriptor leaf", () => {
    const trace = createPsoWarmupTrace();
    for (const [index, entry] of trace.entries.entries()) {
      const state = entry.state;
      const paths = leafPaths(state);
      expect(paths.length).toBeGreaterThan(40);
      for (const path of paths) {
        const mutatedState = structuredClone(state);
        mutateLeaf(mutatedState, path);
        expect(
          () =>
            parsePsoWarmupTrace({
              ...trace,
              entries: trace.entries.map((candidate, candidateIndex) =>
                candidateIndex === index ? { ...candidate, state: mutatedState } : candidate,
              ),
            }),
          path.join("."),
        ).toThrow(/entry is incompatible/);
      }
    }
  });

  it("derives the digest from the effective descriptor observed at createRenderPipeline", async () => {
    const boundary = await createBoundary();
    expect(await boundary.register()).toBe(PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST);
  });

  it("requires one pipeline creation inside the registered compile callback", async () => {
    const boundary = await createBoundary();
    await boundary.compile();

    await expect(boundary.observation.register([boundary.mesh], () => undefined)).rejects.toThrow(
      /expected one Standard pipeline creation, observed 0/,
    );
  });

  it("restores the GPUDevice after a compile-window failure", async () => {
    const boundary = await createBoundary();
    await expect(
      boundary.observation.register([boundary.mesh], () => {
        throw new Error("scene registration failed");
      }),
    ).rejects.toThrow("scene registration failed");

    expect(boundary.device.createRenderPipeline).toBe(boundary.originalCreateRenderPipeline);
  });

  it("preserves a primary compile failure while aggregating every restore failure for retry", async () => {
    const target = createFakeDevice();
    const originals = { ...target };
    const restoreFailuresRemaining = new Map<string, number>([
      ["createRenderPipeline", 1],
      ["createShaderModule", 1],
    ]);
    const device = new Proxy(target, {
      defineProperty(current, property, descriptor) {
        const name = String(property) as keyof FakeDevice;
        if (descriptor.value === originals[name]) {
          const remaining = restoreFailuresRemaining.get(name) ?? 0;
          if (remaining > 0) {
            restoreFailuresRemaining.set(name, remaining - 1);
            throw new Error(`restore failed:${name}`);
          }
        }
        return Reflect.defineProperty(current, property, descriptor);
      },
    });
    const observation = observeStandardOpaquePsoRegistration(engineForDevice(device));
    const mesh = createStandardMesh();
    const primary = new Error("compile primary");
    let failure: unknown;
    try {
      await observation.register([mesh], () => {
        throw primary;
      });
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw failure;
    expect(failure.cause).toBe(primary);
    expect(failure.errors).toEqual([
      primary,
      expect.objectContaining({ message: "restore failed:createRenderPipeline" }),
      expect.objectContaining({ message: "restore failed:createShaderModule" }),
    ]);
    expect(device.createBindGroupLayout).toBe(originals.createBindGroupLayout);
    expect(device.createPipelineLayout).toBe(originals.createPipelineLayout);
    await expect(observation.register([mesh], () => undefined)).rejects.toThrow(/disposed/);
    expect(() => observation.dispose()).not.toThrow();
    expect(device).toMatchObject(originals);
  });

  it("preserves validation failure when observer restoration also fails", async () => {
    const target = createFakeDevice();
    const originalCreateRenderPipeline = target.createRenderPipeline;
    let failRestore = true;
    const device = new Proxy(target, {
      defineProperty(current, property, descriptor) {
        if (
          property === "createRenderPipeline" &&
          descriptor.value === originalCreateRenderPipeline &&
          failRestore
        ) {
          failRestore = false;
          throw new Error("validation restore failed");
        }
        return Reflect.defineProperty(current, property, descriptor);
      },
    });
    const observation = observeStandardOpaquePsoRegistration(engineForDevice(device));
    let failure: unknown;
    try {
      await observation.register([], () => undefined);
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw failure;
    expect(failure.cause).toMatchObject({ message: expect.stringMatching(/at least one/) });
    expect(failure.errors[1]).toMatchObject({ message: "validation restore failed" });
    expect(() => observation.dispose()).not.toThrow();
  });

  it("attempts every installed-method restore when installation and cleanup both fail", () => {
    const target = createFakeDevice();
    const originals = { ...target };
    const restoreAttempts: string[] = [];
    const device = new Proxy(target, {
      defineProperty(current, property, descriptor) {
        const name = String(property) as keyof FakeDevice;
        if (descriptor.value === originals[name]) {
          restoreAttempts.push(name);
          if (name !== "createPipelineLayout") throw new Error(`restore failed:${name}`);
        } else if (name === "createRenderPipeline") {
          throw new Error("install primary");
        }
        return Reflect.defineProperty(current, property, descriptor);
      },
    });

    let failure: unknown;
    try {
      observeStandardOpaquePsoRegistration(engineForDevice(device));
    } catch (error: unknown) {
      failure = error;
    }

    expect(restoreAttempts).toEqual([
      "createPipelineLayout",
      "createShaderModule",
      "createBindGroupLayout",
    ]);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw failure;
    expect(failure.cause).toMatchObject({ message: "install primary" });
    expect(failure.errors).toHaveLength(3);
    expect(failure.errors[0]).toBe(failure.cause);
  });

  it("rejects the former arbitrary build-group family bypass", async () => {
    const boundary = await createBoundary();
    Reflect.set(boundary.mesh.material, "_buildGroup", { _materialFamily: "standard" });
    await expect(boundary.register()).rejects.toThrow(/material feature key 0/);
    boundary.observation.dispose();
  });

  it.each([
    "scene-bind-binding",
    "scene-bind-visibility",
    "scene-bind-buffer-type",
    "scene-bind-buffer-dynamic",
    "scene-bind-buffer-min-size",
    "scene-bind-resource-kind",
    "scene-bind-extra-resource-key",
    "scene-bind-multiple-resources",
    "mesh-bind-layout",
    "vertex-shader",
    "fragment-shader",
    "vertex-layout",
    "color-target",
    "depth-target",
    "sample-count",
    "primitive",
  ] as const)("fails closed when the live %s input mutates", async (mutation) => {
    await expect(async () => {
      const boundary = await createBoundary(mutation);
      await boundary.register();
    }).rejects.toThrow(/PSO warmup/);
  });

  it("normalizes every WebGPU bind resource kind with all effective defaults", () => {
    const cases: readonly {
      readonly descriptor: GPUBindGroupLayoutEntry;
      readonly resource: unknown;
    }[] = [
      {
        descriptor: { binding: 0, buffer: {}, visibility: 1 },
        resource: {
          hasDynamicOffset: false,
          kind: "buffer",
          minBindingSize: 0,
          type: "uniform",
        },
      },
      {
        descriptor: { binding: 0, sampler: {}, visibility: 1 },
        resource: { kind: "sampler", type: "filtering" },
      },
      {
        descriptor: { binding: 0, texture: {}, visibility: 1 },
        resource: {
          kind: "texture",
          multisampled: false,
          sampleType: "float",
          viewDimension: "2d",
        },
      },
      {
        descriptor: {
          binding: 0,
          storageTexture: { format: "rgba8unorm" },
          visibility: 1,
        },
        resource: {
          access: "write-only",
          format: "rgba8unorm",
          kind: "storageTexture",
          viewDimension: "2d",
        },
      },
      {
        descriptor: { binding: 0, externalTexture: {}, visibility: 1 },
        resource: { kind: "externalTexture" },
      },
    ];
    for (const fixture of cases) {
      expect(
        normalizePsoBindGroupLayoutDescriptor({ entries: [fixture.descriptor] }).entries[0]
          ?.resource,
      ).toEqual(fixture.resource);
    }
  });

  it("retains every nondefault bind-resource leaf and rejects ambiguous or extra alternatives", () => {
    expect(
      normalizePsoBindGroupLayoutDescriptor({
        entries: [
          {
            binding: 3,
            buffer: { hasDynamicOffset: true, minBindingSize: 64, type: "read-only-storage" },
            visibility: 7,
          },
          { binding: 4, sampler: { type: "comparison" }, visibility: 2 },
          {
            binding: 5,
            texture: { multisampled: true, sampleType: "sint", viewDimension: "cube-array" },
            visibility: 2,
          },
          {
            binding: 6,
            storageTexture: {
              access: "read-write",
              format: "rgba16float",
              viewDimension: "3d",
            },
            visibility: 2,
          },
        ],
      }).entries,
    ).toMatchObject([
      {
        binding: 3,
        resource: {
          hasDynamicOffset: true,
          kind: "buffer",
          minBindingSize: 64,
          type: "read-only-storage",
        },
        visibility: 7,
      },
      { resource: { kind: "sampler", type: "comparison" } },
      {
        resource: {
          kind: "texture",
          multisampled: true,
          sampleType: "sint",
          viewDimension: "cube-array",
        },
      },
      {
        resource: {
          access: "read-write",
          format: "rgba16float",
          kind: "storageTexture",
          viewDimension: "3d",
        },
      },
    ]);
    expect(() =>
      normalizePsoBindGroupLayoutDescriptor({
        entries: [{ binding: 0, buffer: {}, sampler: {}, visibility: 1 }],
      }),
    ).toThrow(/exactly one resource/);
    expect(() =>
      normalizePsoBindGroupLayoutDescriptor({
        entries: [
          {
            binding: 0,
            buffer: { unexpected: true } as GPUBufferBindingLayout,
            visibility: 1,
          },
        ],
      }),
    ).toThrow(/unsupported keys/);
  });
});

type BoundaryMutation =
  | "gpu-validation"
  | "shader-diagnostics"
  | "color-target"
  | "depth-target"
  | "fragment-shader"
  | "mesh-bind-layout"
  | "primitive"
  | "sample-count"
  | "scene-bind-binding"
  | "scene-bind-buffer-dynamic"
  | "scene-bind-buffer-min-size"
  | "scene-bind-buffer-type"
  | "scene-bind-extra-resource-key"
  | "scene-bind-multiple-resources"
  | "scene-bind-resource-kind"
  | "scene-bind-visibility"
  | "vertex-layout"
  | "vertex-shader";

interface FakeDevice {
  pushErrorScope(filter: GPUErrorFilter): void;
  popErrorScope(): Promise<GPUError | null>;
  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
  createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
}

function createFakeDevice(): FakeDevice {
  let handle = 0;
  const objectHandle = <T extends object>(): T => ({ handle: handle++ }) as T;
  return {
    pushErrorScope: () => undefined,
    popErrorScope: async () => null,
    createBindGroupLayout: () => objectHandle<GPUBindGroupLayout>(),
    createPipelineLayout: () => objectHandle<GPUPipelineLayout>(),
    createRenderPipeline: () => objectHandle<GPURenderPipeline>(),
    createShaderModule: () => ({
      ...objectHandle<GPUShaderModule>(),
      getCompilationInfo: async () => ({ messages: [] }),
    }),
  };
}

function engineForDevice(device: FakeDevice): EngineContext {
  return {
    _device: device,
    format: "bgra8unorm",
    msaaSamples: 4,
  } as unknown as EngineContext;
}

function createStandardMesh(): Mesh {
  return {
    _gpu: {},
    material: createStandardMaterial(),
    name: "greybox-test",
    receiveShadows: false,
  } as unknown as Mesh;
}

async function createBoundary(mutation?: BoundaryMutation): Promise<{
  compile(): Promise<void>;
  readonly device: FakeDevice;
  readonly mesh: Mesh;
  readonly observation: ReturnType<typeof observeStandardOpaquePsoRegistration>;
  readonly originalCreateRenderPipeline: FakeDevice["createRenderPipeline"];
  register(): Promise<string>;
}> {
  const device = createFakeDevice();
  if (mutation === "gpu-validation")
    device.popErrorScope = async () => ({ message: "injected invalid pipeline" });
  if (mutation === "shader-diagnostics")
    device.createShaderModule = () =>
      ({
        getCompilationInfo: async () => ({
          messages: [{ type: "error", lineNum: 1, linePos: 1, message: "injected shader error" }],
        }),
      }) as unknown as GPUShaderModule;
  const originalCreateRenderPipeline = device.createRenderPipeline;
  const engine = engineForDevice(device);
  const observation = observeStandardOpaquePsoRegistration(engine);
  const sceneFirstEntry = {
    binding: mutation === "scene-bind-binding" ? 2 : 0,
    buffer: {
      ...(mutation === "scene-bind-buffer-dynamic" ? { hasDynamicOffset: true } : {}),
      ...(mutation === "scene-bind-buffer-min-size" ? { minBindingSize: 64 } : {}),
      type: mutation === "scene-bind-buffer-type" ? ("storage" as const) : ("uniform" as const),
    },
    visibility: mutation === "scene-bind-visibility" ? 2 : 3,
  } as GPUBindGroupLayoutEntry;
  if (mutation === "scene-bind-resource-kind") {
    Reflect.deleteProperty(sceneFirstEntry, "buffer");
    Reflect.set(sceneFirstEntry, "sampler", {});
  }
  if (mutation === "scene-bind-extra-resource-key") {
    Reflect.set(sceneFirstEntry.buffer ?? {}, "unexpected", true);
  }
  if (mutation === "scene-bind-multiple-resources") {
    Reflect.set(sceneFirstEntry, "sampler", {});
  }
  const sceneBindGroupLayout = device.createBindGroupLayout({
    entries: [sceneFirstEntry, { binding: 1, buffer: { type: "uniform" }, visibility: 2 }],
    label: "scene",
  });
  const mesh = createStandardMesh();
  const compile = async (): Promise<void> => {
    const composer = (await import(
      // @ts-expect-error The pinned package intentionally does not export this composer;
      // the test exercises the exact private boundary that the production observer pins.
      "../node_modules/@babylonjs/lite/lib/material/standard/standard-pipeline.js"
    )) as unknown as {
      composeStandardShader(
        materialFeatures: number,
        meshFeatures: number,
      ): {
        readonly _fragmentWGSL: string;
        readonly _meshBGLDescriptor: GPUBindGroupLayoutDescriptor;
        readonly _vertexBufferLayouts: readonly GPUVertexBufferLayout[];
        readonly _vertexWGSL: string;
      };
    };
    const composed = composer.composeStandardShader(0, 0);
    const meshDescriptor =
      mutation === "mesh-bind-layout"
        ? {
            entries: [
              { binding: 0, buffer: { type: "storage" as const }, visibility: 3 },
              { binding: 1, buffer: { type: "uniform" as const }, visibility: 2 },
            ],
          }
        : composed._meshBGLDescriptor;
    const meshBindGroupLayout = device.createBindGroupLayout(meshDescriptor);
    const vertexModule = device.createShaderModule({
      code:
        mutation === "vertex-shader"
          ? `${composed._vertexWGSL}\n// mutation`
          : composed._vertexWGSL,
    });
    const fragmentModule = device.createShaderModule({
      code:
        mutation === "fragment-shader"
          ? `${composed._fragmentWGSL}\n// mutation`
          : composed._fragmentWGSL,
    });
    const vertexBuffers =
      mutation === "vertex-layout"
        ? [
            {
              ...composed._vertexBufferLayouts[0],
              arrayStride: 16,
            } as GPUVertexBufferLayout,
            composed._vertexBufferLayouts[1] as GPUVertexBufferLayout,
          ]
        : composed._vertexBufferLayouts;
    device.createRenderPipeline({
      depthStencil: {
        depthCompare: "greater-equal",
        depthWriteEnabled: true,
        format: mutation === "depth-target" ? "depth32float" : "depth24plus-stencil8",
      },
      fragment: {
        entryPoint: "main",
        module: fragmentModule,
        targets: [{ format: mutation === "color-target" ? "rgba8unorm" : "bgra8unorm" }],
      },
      layout: device.createPipelineLayout({
        bindGroupLayouts: [sceneBindGroupLayout, meshBindGroupLayout],
      }),
      multisample: { count: mutation === "sample-count" ? 1 : 4 },
      primitive: {
        cullMode: mutation === "primitive" ? "front" : "back",
        frontFace: "ccw",
        topology: "triangle-list",
      },
      vertex: {
        buffers: [...vertexBuffers],
        entryPoint: "main",
        module: vertexModule,
      },
    });
  };
  return {
    compile,
    device,
    mesh,
    observation,
    originalCreateRenderPipeline,
    register: () => observation.register([mesh], compile),
  };
}

function leafPaths(
  input: unknown,
  prefix: readonly (string | number)[] = [],
): (string | number)[][] {
  if (typeof input !== "object" || input === null) return [[...prefix]];
  const paths: (string | number)[][] = [];
  for (const [key, value] of Object.entries(input)) {
    paths.push(...leafPaths(value, [...prefix, Array.isArray(input) ? Number(key) : key]));
  }
  return paths;
}

function mutateLeaf(input: unknown, path: readonly (string | number)[]): void {
  let owner = input as Record<string | number, unknown>;
  for (const segment of path.slice(0, -1)) {
    owner = owner[segment] as Record<string | number, unknown>;
  }
  const leaf = path.at(-1);
  if (leaf === undefined) throw new Error("Mutation path is empty");
  const value = owner[leaf];
  owner[leaf] =
    value === null
      ? "mutated"
      : typeof value === "boolean"
        ? !value
        : typeof value === "number"
          ? value + 1
          : `${String(value)}-mutated`;
}

async function createCsmBoundary(omitDepth = false) {
  const device = createFakeDevice();
  const observation = observeStandardOpaquePsoRegistration(engineForDevice(device));
  const mesh = createStandardMesh();
  mesh.receiveShadows = true;
  // Exact-pin private shader composition is deliberately exercised at this boundary.
  const composer = (await import(
    // @ts-expect-error The package does not expose the private composer in its exports.
    "../node_modules/@babylonjs/lite/lib/material/standard/standard-pipeline.js"
  )) as unknown as {
    composeStandardShader(
      features: number,
      meshFeatures: number,
      fragments: readonly unknown[],
    ): {
      _meshBGLDescriptor: GPUBindGroupLayoutDescriptor;
      _shadowBGLDescriptor?: GPUBindGroupLayoutDescriptor;
      _vertexWGSL: string;
      _fragmentWGSL: string;
      _vertexBufferLayouts: GPUVertexBufferLayout[];
    };
  };
  const fragments = (await import(
    // @ts-expect-error Same pinned private receiver fragment used by the shipping public CSM API.
    "../node_modules/@babylonjs/lite/lib/material/standard/fragments/std-csm-shadow-fragment.js"
  )) as unknown as {
    createStdCsmShadowFragment(lights: readonly { lightIndex: number }[]): unknown;
  };
  const sceneLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: 3, buffer: { type: "uniform" } },
      { binding: 1, visibility: 2, buffer: { type: "uniform" } },
    ],
  });
  return {
    observation,
    device,
    mesh,
    compile: () => {
      for (const entry of createPsoWarmupTrace().entries.slice(0, omitDepth ? 2 : 3)) {
        const state = entry.state;
        if (state.shader.family !== "standard") throw new Error("Expected Standard fixture");
        const composed = composer.composeStandardShader(
          state.shader.materialFeatureKey,
          state.shader.meshFeatureKey,
          state.shader.meshFeatureKey === 256
            ? [fragments.createStdCsmShadowFragment([{ lightIndex: 1 }])]
            : [],
        );
        const groups = [sceneLayout, device.createBindGroupLayout(composed._meshBGLDescriptor)];
        if (composed._shadowBGLDescriptor)
          groups.push(device.createBindGroupLayout(composed._shadowBGLDescriptor));
        device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: groups }),
          vertex: {
            module: device.createShaderModule({ code: composed._vertexWGSL }),
            entryPoint: "main",
            buffers: composed._vertexBufferLayouts,
          },
          fragment: {
            module: device.createShaderModule({ code: composed._fragmentWGSL }),
            entryPoint: "main",
            targets: state.colorTarget === null ? [] : [{ format: state.colorTarget.format }],
          },
          depthStencil: state.depthStencil,
          multisample: state.multisample,
          primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        });
      }
    },
  };
}

async function pbrBoundary(device: FakeDevice, mutation?: "missing-depth" | "source") {
  const texture = {} as import("@babylonjs/lite").Texture2D;
  const material = createStreamedPbrMaterial(
    { baseColor: texture, normal: texture, orm: texture },
    {
      baseColorFactor: [1, 1, 1],
      roughnessFactor: 1,
      metallicFactor: 0,
      normalScale: 0.35,
    },
  );
  const mesh = {
    material,
    name: "pbr",
    _gpu: {},
    receiveShadows: true,
    thinInstances: {},
  } as unknown as Mesh;
  // These exact-pin source composers are the producer of the observed live WGSL.
  // @ts-expect-error Pinned dependency implementation does not ship declarations.
  const composer = await import("../node_modules/@babylonjs/lite/lib/material/pbr/pbr-compose.js");
  const lights = await import(
    // @ts-expect-error Pinned dependency implementation does not ship declarations.
    "../node_modules/@babylonjs/lite/lib/material/pbr/fragments/multilight-wgsl.js"
  );
  const csm = await import(
    // @ts-expect-error Pinned dependency implementation does not ship declarations.
    "../node_modules/@babylonjs/lite/lib/material/pbr/fragments/pbr-csm-shadow-fragment.js"
  );
  const thin = await import(
    // @ts-expect-error Exact-pin private shader fragment has no declarations.
    "../node_modules/@babylonjs/lite/lib/shader/fragments/thin-instance-fragment.js"
  );
  const compose = composer.createPbrComposer({
    _createThinInstanceFragment: thin.createThinInstanceFragment,
    _multiLightWGSL: lights.MULTI_LIGHT_STRUCTS() + lights.COMPUTE_PBR_LIGHT,
    _multiLightLoop: lights.getMultiLightLoop(),
    _createPbrShadowFragment: csm.createPbrCsmShadowFragment,
    _shadowLights: [{ lightIndex: 1 }],
  }) as (
    features: number,
    features2: number,
    meshFeatures: number,
    sceneFeatures: number,
    lightMode: number,
  ) => {
    _vertexWGSL: string;
    _fragmentWGSL: string;
    _meshBGLDescriptor: GPUBindGroupLayoutDescriptor;
    _shadowBGLDescriptor?: GPUBindGroupLayoutDescriptor;
    _vertexBufferLayouts: GPUVertexBufferLayout[];
  };
  const sceneLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: 3, buffer: { type: "uniform" } },
      { binding: 1, visibility: 2, buffer: { type: "uniform" } },
    ],
  });
  return {
    mesh,
    compile() {
      for (const entry of createPsoWarmupTrace().entries.slice(3)) {
        const state = entry.state;
        const depth = state.colorTarget === null;
        if (depth && mutation === "missing-depth") continue;
        const composed = compose(
          1 | (1 << 15) | (1 << 17),
          (1 << 12) | (depth ? 1 << 15 : 0),
          (depth ? 0 : 256) | 16,
          0,
          2,
        );
        const groups = [sceneLayout, device.createBindGroupLayout(composed._meshBGLDescriptor)];
        if (composed._shadowBGLDescriptor)
          groups.push(device.createBindGroupLayout(composed._shadowBGLDescriptor));
        device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: groups }),
          vertex: {
            module: device.createShaderModule({
              code: composed._vertexWGSL + (mutation === "source" ? "\n// drift" : ""),
            }),
            entryPoint: "main",
            buffers: composed._vertexBufferLayouts,
          },
          fragment: {
            module: device.createShaderModule({ code: composed._fragmentWGSL }),
            entryPoint: "main",
            targets: state.colorTarget === null ? [] : [{ format: state.colorTarget.format }],
          },
          depthStencil: state.depthStencil,
          multisample: state.multisample,
          primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        });
      }
    },
  };
}
