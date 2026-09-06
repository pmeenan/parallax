import {
  createPbrMaterial,
  createStandardMaterial,
  type EngineContext,
  isPbrMaterial,
  isStandardMaterial,
  type Mesh,
  type StandardMaterialProps,
} from "@babylonjs/lite";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  createPsoWarmupTrace,
  PBR_COLOR_STATE,
  PBR_DEPTH_FRAGMENT_WGSL_SHA256,
  PBR_DEPTH_STATE,
  PBR_FRAGMENT_WGSL_SHA256,
  PBR_VERTEX_WGSL_SHA256,
  PSO_WARMUP_PIPELINES,
  PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST,
} from "./pso-warmup-contract";

const WEBGPU_ALL_BITS = 0xffff_ffff;
const WEBGPU_COLOR_WRITE_ALL = 0xf;
const STENCIL_FACE_DEFAULT = Object.freeze({
  compare: "always" as const,
  depthFailOp: "keep" as const,
  failOp: "keep" as const,
  passOp: "keep" as const,
});
const STANDARD_VERTEX_WGSL_SHA256 =
  "ca2060957e94cfa5c00cef782f436988de1db81b09e7b7593f3dd7ff2026af07";
const STANDARD_FRAGMENT_WGSL_SHA256 =
  "ae7d8c884d08d7a8c9efe5cef64bfb5ee727b57a208595d180f98e1c8bd00a88";
const CANONICAL_STANDARD_BUILD_GROUP = Reflect.get(createStandardMaterial(), "_buildGroup");
const STANDARD_OPAQUE_STATE = createPsoWarmupTrace().entries[0]?.state;

export interface StandardOpaquePsoObservation {
  dispose(): void;
  register(meshes: readonly Mesh[], compile: () => void | Promise<void>): Promise<string>;
  registerAll(
    meshes: readonly Mesh[],
    compile: () => void | Promise<void>,
    pbrMeshes?: readonly Mesh[],
  ): Promise<ReadonlyMap<string, string>>;
}

interface InstrumentedGpuDevice {
  pushErrorScope(filter: GPUErrorFilter): void;
  popErrorScope(): Promise<GPUError | null>;
  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
  createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
}

export interface CapturedBindGroupLayout {
  readonly entries: readonly {
    readonly binding: number;
    readonly resource: CapturedBindGroupResource;
    readonly visibility: GPUShaderStageFlags;
  }[];
}

export type CapturedBindGroupResource =
  | Readonly<{
      readonly hasDynamicOffset: boolean;
      readonly kind: "buffer";
      readonly minBindingSize: number;
      readonly type: GPUBufferBindingType;
    }>
  | Readonly<{ readonly kind: "externalTexture" }>
  | Readonly<{ readonly kind: "sampler"; readonly type: GPUSamplerBindingType }>
  | Readonly<{
      readonly access: GPUStorageTextureAccess;
      readonly format: GPUTextureFormat;
      readonly kind: "storageTexture";
      readonly viewDimension: GPUTextureViewDimension;
    }>
  | Readonly<{
      readonly kind: "texture";
      readonly multisampled: boolean;
      readonly sampleType: GPUTextureSampleType;
      readonly viewDimension: GPUTextureViewDimension;
    }>;

type InstrumentedMethodName = keyof InstrumentedGpuDevice;

/**
 * Installs a bounded observer at Babylon Lite's pinned GPUDevice boundary. It must be
 * created immediately after the engine and before the scene context so the scene bind
 * group layout and the later composed Standard pipeline share one observed object graph.
 */
export function observeStandardOpaquePsoRegistration(
  engine: EngineContext,
): StandardOpaquePsoObservation {
  if (engine.format !== "bgra8unorm" || engine.msaaSamples !== 4) {
    throw new Error(
      `PSO warmup requires bgra8unorm/MSAA4, received ${engine.format}/MSAA${engine.msaaSamples}`,
    );
  }
  if (STANDARD_OPAQUE_STATE === undefined) {
    throw new Error("PSO warmup trace is missing the Standard opaque state");
  }

  const device = Reflect.get(engine, "_device") as InstrumentedGpuDevice | undefined;
  if (device === undefined || typeof device !== "object") {
    throw new Error("PSO warmup cannot observe Babylon's GPUDevice");
  }
  const bindGroupLayouts = new WeakMap<object, CapturedBindGroupLayout>();
  const pipelineLayouts = new WeakMap<object, readonly GPUBindGroupLayout[]>();
  const shaderModules = new WeakMap<object, string>();
  const restores: (() => void)[] = [];
  const observedStates: unknown[] = [];
  const shaderValidation: Promise<readonly string[]>[] = [];
  let disposed = false;

  const restorePatchedMethods = (): readonly unknown[] => {
    const failures: unknown[] = [];
    const retry: (() => void)[] = [];
    for (const restore of restores.splice(0)) {
      try {
        restore();
      } catch (error: unknown) {
        failures.push(error);
        retry.push(restore);
      }
    }
    restores.push(...retry);
    return failures;
  };

  const throwRestoreFailures = (failures: readonly unknown[]): void => {
    if (failures.length === 0) return;
    throw new AggregateError(failures, "PSO warmup GPUDevice restoration failed");
  };

  const install = <K extends InstrumentedMethodName>(
    name: K,
    replacement: InstrumentedGpuDevice[K],
  ): void => {
    const own = Object.getOwnPropertyDescriptor(device, name);
    Object.defineProperty(device, name, {
      configurable: true,
      value: replacement,
      writable: true,
    });
    restores.unshift(() => {
      if (own === undefined) {
        if (!Reflect.deleteProperty(device, name)) {
          throw new Error(`PSO warmup could not remove patched GPUDevice method ${name}`);
        }
      } else {
        Object.defineProperty(device, name, own);
      }
    });
  };

  try {
    const createBindGroupLayout = device.createBindGroupLayout.bind(device);
    install("createBindGroupLayout", ((descriptor: GPUBindGroupLayoutDescriptor) => {
      const layout = createBindGroupLayout(descriptor);
      bindGroupLayouts.set(layout, normalizePsoBindGroupLayoutDescriptor(descriptor));
      return layout;
    }) as InstrumentedGpuDevice["createBindGroupLayout"]);

    const createShaderModule = device.createShaderModule.bind(device);
    install("createShaderModule", ((descriptor: GPUShaderModuleDescriptor) => {
      if (typeof descriptor.code !== "string") {
        throw new Error("PSO warmup observed non-WGSL Standard shader source");
      }
      const module = createShaderModule(descriptor);
      shaderModules.set(module, digestText(descriptor.code));
      shaderValidation.push(
        module.getCompilationInfo().then(
          (info) =>
            info.messages
              .filter((message) => message.type === "error")
              .map(
                (message) =>
                  `${descriptor.label ?? "shader"}:${message.lineNum}:${message.linePos}: ${message.message}`,
              ),
          (error) => [`Shader compilation inspection failed: ${String(error)}`],
        ),
      );
      return module;
    }) as InstrumentedGpuDevice["createShaderModule"]);

    const createPipelineLayout = device.createPipelineLayout.bind(device);
    install("createPipelineLayout", ((descriptor: GPUPipelineLayoutDescriptor) => {
      const layouts = Array.from(descriptor.bindGroupLayouts);
      if (layouts.some((layout) => layout === null)) {
        throw new Error("PSO warmup pipeline layout cannot contain an empty bind group");
      }
      const layout = createPipelineLayout(descriptor);
      pipelineLayouts.set(layout, Object.freeze(layouts as GPUBindGroupLayout[]));
      return layout;
    }) as InstrumentedGpuDevice["createPipelineLayout"]);

    const createRenderPipeline = device.createRenderPipeline.bind(device);
    install("createRenderPipeline", ((descriptor: GPURenderPipelineDescriptor) => {
      const state = normalizeObservedStandardPipeline(
        descriptor,
        bindGroupLayouts,
        pipelineLayouts,
        shaderModules,
      );
      if (!PSO_WARMUP_PIPELINES.some((entry) => canonicalEqual(state, entry.state))) {
        throw new Error(
          `PSO warmup observed Standard pipeline descriptor drift: ${JSON.stringify(state)}`,
        );
      }
      observedStates.push(state);
      return createRenderPipeline(descriptor);
    }) as InstrumentedGpuDevice["createRenderPipeline"]);
  } catch (error: unknown) {
    const restoreFailures = restorePatchedMethods();
    if (restoreFailures.length > 0) {
      throw primaryWithCleanupError(
        error,
        restoreFailures,
        "PSO warmup observer installation and GPUDevice restoration failed",
      );
    }
    throw error;
  }

  const dispose = (): void => {
    disposed = true;
    throwRestoreFailures(restorePatchedMethods());
  };

  const compileValidated = async (compile: () => void | Promise<void>): Promise<void> => {
    device.pushErrorScope("validation");
    let compileError: unknown;
    let failed = false;
    try {
      await compile();
    } catch (error: unknown) {
      failed = true;
      compileError = error;
    }
    const validationError = await device.popErrorScope();
    const messages = (await Promise.all(shaderValidation)).flat();
    if (validationError !== null) messages.push(validationError.message);
    if (messages.length > 0) {
      const error = new Error(`PSO warmup GPU validation failed: ${messages.join("; ")}`);
      if (failed)
        throw new AggregateError(
          [compileError, error],
          `${String(compileError)}; ${error.message}`,
        );
      throw error;
    }
    if (failed) throw compileError;
  };

  return Object.freeze({
    dispose,
    async registerAll(
      meshes: readonly Mesh[],
      compile: () => void | Promise<void>,
      pbrMeshes: readonly Mesh[] = [],
    ): Promise<ReadonlyMap<string, string>> {
      if (disposed) throw new Error("PSO warmup observer is already disposed");
      const digests = new Map<string, string>();
      try {
        if (meshes.length === 0) throw new Error("PSO warmup requires meshes");
        for (const mesh of meshes) {
          assertStandardOpaqueMaterial(mesh.material, mesh.name);
          assertGreyboxMeshFeatureKeyZero(mesh, true);
        }
        for (const mesh of pbrMeshes) {
          assertPbrOpaqueMaterial(mesh.material, mesh.name);
          assertGreyboxMeshFeatureKeyZero(mesh, true, true);
        }
        const start = observedStates.length;
        await compileValidated(compile);
        const states = observedStates.slice(start);
        const expectedEntries = PSO_WARMUP_PIPELINES.filter(
          (_, index) => index < 3 || pbrMeshes.length > 0,
        );
        for (const entry of expectedEntries) {
          const matches = states.filter((state) => canonicalEqual(state, entry.state));
          if (matches.length !== 1)
            throw new Error(
              `PSO warmup expected one ${entry.id} pipeline, observed ${matches.length}`,
            );
          digests.set(entry.id, digestValue(matches[0]));
        }
        if (states.length !== expectedEntries.length)
          throw new Error("PSO warmup observed unexpected pipelines");
      } catch (error: unknown) {
        try {
          dispose();
        } catch (cleanupError: unknown) {
          throw primaryWithCleanupError(
            error,
            cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError],
            "PSO warmup registration and GPUDevice restoration failed",
          );
        }
        throw error;
      }
      dispose();
      return digests;
    },
    async register(meshes: readonly Mesh[], compile: () => void | Promise<void>): Promise<string> {
      if (disposed) throw new Error("PSO warmup observer is already disposed");
      let primaryFailure: unknown;
      let hasPrimaryFailure = false;
      let digest: string | null = null;
      try {
        if (meshes.length === 0) {
          throw new Error("PSO warmup requires at least one Standard opaque greybox mesh");
        }
        for (const mesh of meshes) {
          assertStandardOpaqueMaterial(mesh.material, mesh.name);
          assertGreyboxMeshFeatureKeyZero(mesh);
        }
        const observedCountBeforeCompile = observedStates.length;
        await compileValidated(compile);
        const observedCompileCount = observedStates.length - observedCountBeforeCompile;
        if (observedCompileCount !== 1) {
          throw new Error(
            `PSO warmup expected one Standard pipeline creation, observed ${observedCompileCount}`,
          );
        }
        digest = digestValue(observedStates[observedCountBeforeCompile]);
        if (digest !== PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST) {
          throw new Error("PSO warmup observed Standard pipeline digest drift");
        }
      } catch (error: unknown) {
        primaryFailure = error;
        hasPrimaryFailure = true;
      }
      try {
        dispose();
      } catch (cleanupError: unknown) {
        if (hasPrimaryFailure) {
          const cleanupFailures =
            cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError];
          throw primaryWithCleanupError(
            primaryFailure,
            cleanupFailures,
            "PSO warmup registration and GPUDevice restoration failed",
          );
        }
        throw cleanupError;
      }
      if (hasPrimaryFailure) throw primaryFailure;
      if (digest === null) throw new Error("PSO warmup did not produce a pipeline digest");
      return digest;
    },
  });
}

function primaryWithCleanupError(
  primary: unknown,
  cleanupFailures: readonly unknown[],
  message: string,
): AggregateError {
  const primaryMessage = primary instanceof Error ? primary.message : String(primary);
  return new AggregateError([primary, ...cleanupFailures], `${primaryMessage}; ${message}`, {
    cause: primary,
  });
}

function assertStandardOpaqueMaterial(material: Mesh["material"], meshName: string): void {
  const candidate = material as Partial<StandardMaterialProps>;
  if (
    !isStandardMaterial(material) ||
    Reflect.get(material, "_buildGroup") !== CANONICAL_STANDARD_BUILD_GROUP ||
    candidate.alpha !== 1 ||
    candidate.diffuseTexture !== null ||
    candidate.emissiveTexture !== null ||
    candidate.bumpTexture !== null ||
    candidate.specularTexture !== null ||
    candidate.ambientTexture !== null ||
    candidate.lightmapTexture !== null ||
    candidate.opacityTexture !== null ||
    candidate.reflectionTexture !== null ||
    candidate.reflectionCubeTexture !== null ||
    candidate.backFaceCulling !== true ||
    candidate.disableLighting !== false ||
    candidate.plugins !== undefined ||
    candidate.stencil !== undefined ||
    Reflect.get(material, "_renderFeatures") !== undefined
  ) {
    throw new Error(`PSO warmup mesh ${meshName} is not Standard opaque material feature key 0`);
  }
}

function assertPbrOpaqueMaterial(material: Mesh["material"], meshName: string): void {
  if (
    !isPbrMaterial(material) ||
    Reflect.get(material, "_buildGroup") !== Reflect.get(createPbrMaterial(), "_buildGroup") ||
    !material.baseColorTexture ||
    !material.normalTexture ||
    !material.ormTexture ||
    !material.baseColorFactor ||
    material.baseColorFactor[3] !== 1 ||
    material.enableSpecularAA !== true ||
    material.occlusionStrength !== 1 ||
    material.doubleSided === true ||
    material.alphaBlend === true ||
    (material.alphaCutOff ?? 0) !== 0 ||
    (material.alpha ?? 1) !== 1 ||
    material.plugins !== undefined ||
    material.emissiveTexture !== undefined ||
    material.emissiveColor !== undefined ||
    material.specGlossTexture !== undefined ||
    material.gammaAlbedo === true ||
    material.clearCoat !== undefined ||
    material.sheen !== undefined ||
    material.anisotropy !== undefined ||
    material.subsurface !== undefined ||
    Reflect.get(material, "_renderFeatures") !== undefined
  )
    throw new Error(`PSO warmup mesh ${meshName} is not the qualified opaque PBR surface`);
}

export function normalizePsoBindGroupLayoutDescriptor(
  descriptor: GPUBindGroupLayoutDescriptor,
): CapturedBindGroupLayout {
  return Object.freeze({
    entries: Object.freeze(
      Array.from(descriptor.entries, (entry) =>
        Object.freeze({
          binding: entry.binding,
          resource: normalizeBindGroupResource(entry),
          visibility: entry.visibility,
        }),
      ),
    ),
  });
}

function normalizeObservedStandardPipeline(
  descriptor: GPURenderPipelineDescriptor,
  bindGroupLayouts: WeakMap<object, CapturedBindGroupLayout>,
  pipelineLayouts: WeakMap<object, readonly GPUBindGroupLayout[]>,
  shaderModules: WeakMap<object, string>,
): unknown {
  if (descriptor.layout === "auto") {
    throw new Error("PSO warmup Standard pipeline must use an explicit layout");
  }
  const layoutObjects = pipelineLayouts.get(descriptor.layout);
  if (layoutObjects === undefined) {
    throw new Error("PSO warmup Standard pipeline layout was not observed");
  }
  const groups = layoutObjects.map((layout, index) => {
    const observed = bindGroupLayouts.get(layout);
    if (observed === undefined) {
      throw new Error(`PSO warmup bind group layout ${index} was not observed`);
    }
    return {
      entries: observed.entries.map((entry) => ({
        binding: entry.binding,
        resource: entry.resource,
        visibility: entry.visibility,
      })),
      index,
    };
  });
  const vertexModuleSha256 = shaderModules.get(descriptor.vertex.module);
  const fragment = descriptor.fragment;
  const fragmentModuleSha256 =
    fragment === undefined ? undefined : shaderModules.get(fragment.module);
  const receiver =
    fragmentModuleSha256 === "3c1588e59ae59ac98bfd6f15e69f4f0335e5e71207262ef0d6a3c44ab13ae7de";
  const shadowDepth =
    fragmentModuleSha256 === "398f5ad7c1c86d2b49c9fd1eba0c481657bf2dfffabbe16c33e5e1cddd8703af";
  const pbr =
    vertexModuleSha256 === PBR_VERTEX_WGSL_SHA256 &&
    (fragmentModuleSha256 === PBR_FRAGMENT_WGSL_SHA256 ||
      fragmentModuleSha256 === PBR_DEPTH_FRAGMENT_WGSL_SHA256);
  const pbrDepth = pbr && fragmentModuleSha256 === PBR_DEPTH_FRAGMENT_WGSL_SHA256;
  if (
    !pbr &&
    (vertexModuleSha256 !== STANDARD_VERTEX_WGSL_SHA256 ||
      (!receiver && !shadowDepth && fragmentModuleSha256 !== STANDARD_FRAGMENT_WGSL_SHA256))
  ) {
    throw new Error("PSO warmup observed composed Standard WGSL drift");
  }
  if (
    fragment === undefined ||
    (shadowDepth || pbrDepth
      ? fragment.targets.length !== 0
      : fragment.targets.length !== 1 || fragment.targets[0] == null)
  ) {
    throw new Error("PSO warmup Standard pipeline must have one color target");
  }
  const color = fragment?.targets[0];
  const depth = descriptor.depthStencil;
  if (depth === undefined) {
    throw new Error("PSO warmup Standard pipeline must have depth-stencil state");
  }
  const primitive = descriptor.primitive;
  const multisample = descriptor.multisample;
  const buffers = descriptor.vertex.buffers ?? [];
  return {
    colorTarget:
      color == null
        ? null
        : {
            blend: color.blend ?? null,
            format: color.format,
            writeMask: color.writeMask ?? WEBGPU_COLOR_WRITE_ALL,
          },
    depthStencil: {
      depthBias: depth.depthBias ?? 0,
      depthBiasClamp: depth.depthBiasClamp ?? 0,
      depthBiasSlopeScale: depth.depthBiasSlopeScale ?? 0,
      depthCompare: depth.depthCompare ?? "always",
      depthWriteEnabled: depth.depthWriteEnabled ?? false,
      format: depth.format,
      stencilBack: depth.stencilBack ?? STENCIL_FACE_DEFAULT,
      stencilFront: depth.stencilFront ?? STENCIL_FACE_DEFAULT,
      stencilReadMask: depth.stencilReadMask ?? WEBGPU_ALL_BITS,
      stencilWriteMask: depth.stencilWriteMask ?? WEBGPU_ALL_BITS,
    },
    layout: {
      bindGroups: groups,
      mode: "explicit",
    },
    multisample: {
      alphaToCoverageEnabled: multisample?.alphaToCoverageEnabled ?? false,
      count: multisample?.count ?? 1,
      mask: multisample?.mask ?? WEBGPU_ALL_BITS,
    },
    primitive: {
      cullMode: primitive?.cullMode ?? "none",
      frontFace: primitive?.frontFace ?? "ccw",
      stripIndexFormat: primitive?.stripIndexFormat ?? null,
      topology: primitive?.topology ?? "triangle-list",
      unclippedDepth: primitive?.unclippedDepth ?? false,
    },
    shader: pbr
      ? {
          ...(pbrDepth ? PBR_DEPTH_STATE : PBR_COLOR_STATE).shader,
          vertexEntryPoint: descriptor.vertex.entryPoint ?? "main",
          fragmentEntryPoint: fragment?.entryPoint ?? "main",
        }
      : {
          family: "standard",
          fragmentEntryPoint: fragment?.entryPoint ?? "main",
          materialFeatureKey: shadowDepth ? 262144 : 0,
          meshFeatureKey: receiver ? 256 : 0,
          variantKey: receiver ? "1e" : "",
          vertexEntryPoint: descriptor.vertex.entryPoint ?? "main",
        },
    vertexBuffers: Array.from(buffers, (buffer) => {
      if (buffer === null) throw new Error("PSO warmup Standard vertex layout cannot be null");
      return {
        arrayStride: buffer.arrayStride,
        attributes: Array.from(buffer.attributes, (attribute) => ({
          format: attribute.format,
          offset: attribute.offset,
          shaderLocation: attribute.shaderLocation,
        })),
        stepMode: buffer.stepMode ?? "vertex",
      };
    }),
  };
}

function normalizeBindGroupResource(entry: GPUBindGroupLayoutEntry): CapturedBindGroupResource {
  const candidates: readonly {
    readonly kind: "buffer" | "externalTexture" | "sampler" | "storageTexture" | "texture";
    readonly value: unknown;
  }[] = [
    { kind: "buffer", value: entry.buffer },
    { kind: "sampler", value: entry.sampler },
    { kind: "texture", value: entry.texture },
    { kind: "storageTexture", value: entry.storageTexture },
    { kind: "externalTexture", value: entry.externalTexture },
  ];
  const alternatives = candidates.filter((alternative) => alternative.value !== undefined);
  if (alternatives.length !== 1) {
    throw new Error("PSO warmup bind group entry must have exactly one resource alternative");
  }
  const kind = alternatives[0]?.kind;
  assertOnlyKeys(entry, ["binding", "visibility", String(kind)], "bind group entry");
  switch (kind) {
    case "buffer": {
      const buffer = entry.buffer;
      if (buffer === undefined) throw new Error("PSO warmup buffer layout disappeared");
      assertOnlyKeys(
        buffer,
        ["hasDynamicOffset", "minBindingSize", "type"],
        "buffer binding layout",
      );
      return Object.freeze({
        hasDynamicOffset: buffer.hasDynamicOffset ?? false,
        kind,
        minBindingSize: Number(buffer.minBindingSize ?? 0),
        type: buffer.type ?? "uniform",
      });
    }
    case "sampler": {
      const sampler = entry.sampler;
      if (sampler === undefined) throw new Error("PSO warmup sampler layout disappeared");
      assertOnlyKeys(sampler, ["type"], "sampler binding layout");
      return Object.freeze({ kind, type: sampler.type ?? "filtering" });
    }
    case "texture": {
      const texture = entry.texture;
      if (texture === undefined) throw new Error("PSO warmup texture layout disappeared");
      assertOnlyKeys(
        texture,
        ["multisampled", "sampleType", "viewDimension"],
        "texture binding layout",
      );
      return Object.freeze({
        kind,
        multisampled: texture.multisampled ?? false,
        sampleType: texture.sampleType ?? "float",
        viewDimension: texture.viewDimension ?? "2d",
      });
    }
    case "storageTexture": {
      const storage = entry.storageTexture;
      if (storage === undefined) throw new Error("PSO warmup storage texture layout disappeared");
      assertOnlyKeys(
        storage,
        ["access", "format", "viewDimension"],
        "storage texture binding layout",
      );
      return Object.freeze({
        access: storage.access ?? "write-only",
        format: storage.format,
        kind,
        viewDimension: storage.viewDimension ?? "2d",
      });
    }
    case "externalTexture": {
      const external = entry.externalTexture;
      if (external === undefined) throw new Error("PSO warmup external texture layout disappeared");
      assertOnlyKeys(external, [], "external texture binding layout");
      return Object.freeze({ kind });
    }
    default:
      throw new Error("PSO warmup bind group resource alternative is unsupported");
  }
}

function assertOnlyKeys(input: object, allowed: readonly string[], label: string): void {
  const extras = Object.keys(input).filter((key) => !allowed.includes(key));
  if (extras.length !== 0) {
    throw new Error(`PSO warmup ${label} has unsupported keys: ${extras.join(", ")}`);
  }
}

function assertGreyboxMeshFeatureKeyZero(
  mesh: Mesh,
  allowReceiver = false,
  requireThinInstances = false,
): void {
  if (
    requireThinInstances &&
    (!mesh.thinInstances ||
      mesh.thinInstances.colors != null ||
      Reflect.get(mesh.thinInstances, "_gpuCullingEnabled") === true)
  )
    throw new Error(`PSO warmup mesh ${mesh.name} requires uncolored CPU thin instances`);
  const gpu = recordProperty(mesh, "_gpu");
  if (
    (mesh.receiveShadows && !allowReceiver) ||
    mesh.skeleton != null ||
    mesh.vat != null ||
    mesh.morphTargets != null ||
    (mesh.thinInstances != null && !requireThinInstances) ||
    gpu.tangentBuffer != null ||
    gpu.colorBuffer != null ||
    gpu.uv2Buffer != null ||
    Reflect.get(mesh, "_flatNormal") === true
  ) {
    throw new Error(`PSO warmup mesh ${mesh.name} does not have mesh feature key 0`);
  }
}

function recordProperty(input: object, key: string): Record<string, unknown> {
  const value = Reflect.get(input, key) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`PSO warmup cannot inspect ${key}`);
  }
  return value as Record<string, unknown>;
}

function digestValue(input: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(input))));
}

function digestText(input: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
