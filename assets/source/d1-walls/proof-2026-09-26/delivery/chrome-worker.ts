// Chrome/Babylon Lite inspection worker for the K1 timber-framed wall delivery candidate.
// Bundled by chrome-preview.mjs. It renders the runtime bytes through the engine's own streamed PBR
// upload (pre-encoded BC1/BC7 levels), material and plugins (rigid terrain drape, sun
// micro-shadowing, occluded ambient), AgX tone mapping and exposure, calibrated sun and sky, CSM
// and thin-instance pools: the production code paths. It bypasses only packaging and streaming,
// which installation (step 2) builds. The test house stands on the admitted D1 paving.
// Not a game worker: delivery inspection only.
import {
  addToScene,
  captureScreenshot,
  createDirectionalLight,
  createEngine,
  createFreeCamera,
  createHemisphericLight,
  createSceneContext,
  type EngineContext,
  enableMaterialPlugins,
  enablePbrMaterialPluginVertexData,
  enableThinInstanceDynamicDrawCount,
  type Mesh,
  markMaterialUboDirty,
  registerSceneWithShadowSupport,
  renderFrame,
  setEngineSize,
  setGpuTimingEnabled,
  setSubtreeVisible,
  setThinInstanceCount,
  setThinInstances,
  type Texture2D,
} from "@babylonjs/lite";
import { MeshoptDecoder } from "meshoptimizer";
import {
  createDirectionalShadows,
  excludeFromCsmCasters,
} from "../../../../../engine/src/render/directional-shadows";
import {
  GROUND_BOUNCE_ALBEDO,
  sampleEnvironmentLighting,
} from "../../../../../engine/src/render/environment-lighting";
import {
  createPbrAmbientState,
  PBR_AMBIENT_MESH_ID,
} from "../../../../../engine/src/render/pbr-ambient";
import {
  createStreamedPbrGeometry,
  createStreamedPbrMaterial,
  uploadStreamedPbrTexture,
  withPbrTextureAddressMode,
} from "../../../../../engine/src/render/streamed-pbr-asset";
import { createRigidTerrainDrapeField } from "../../../../../engine/src/render/terrain-drape";
import { PARALLAX_AGX_TONE_MAPPING } from "../../../../../engine/src/render/tone-mapping";
import { interleavedPositionBounds } from "../../../../../engine/src/streaming/streaming-dependency-contract";

type Vec3 = [number, number, number];
type Format = "bc1" | "bc7" | "rgba8";
interface TextureSpec {
  role: string;
  srgb: boolean;
  format: Format;
  /** A KTX2 container (BC formats), or raw RGBA8 mip files. */
  ktx2?: string;
  mips?: { file: string; width: number; height: number }[];
}
interface MaterialSpec {
  baseColor: string;
  normal: string;
  orm: string;
  address: "repeat" | "clamp-to-edge";
  metallicFactor: number;
  heightRangeMeters: number;
  /** A shared tiling detail layer (K2 delivery memory round). */
  detail?: { texture: string; uvScale: [number, number]; normalGain: number; albedoGain: number };
  /** A per-element tint carried in the UVs' integer parts (the K2 roof tiles). */
  tint?: {
    brightness: [number, number];
    cast: [number, number];
    castVector: [number, number, number];
  };
}
interface MeshSpec {
  /** Unique draw key: `<object>` for wall meshes, `paving-<part>` for the paving. */
  key: string;
  material: string;
  lods: { vertices: string; indices: string; meshopt?: { vertices: number; indices: number } }[];
  /** Instances as column-major LH world matrices (glTF frame already mirrored in X). */
  instances: number[][];
  castsShadows: boolean;
  /** LOD boundaries in metres, from each instance's bounds centre. */
  lodBoundaries: [number, number];
  centre: Vec3; // glTF-local bounds centre, for LOD distance
}
interface ViewSpec {
  name: string;
  width: number;
  height: number;
  eye: Vec3; // source frame (x along the front facade, y into the house, z up), metres
  target: Vec3;
  lens: number; // Blender focal length on a 36 mm sensor, fitted to the wider axis
  sun: [number, number]; // elevation and azimuth in the source frame, degrees
  weather: "clear" | "overcast";
  lodMode: "lod0" | "lod1" | "lod2" | "mixed";
  timingFrames: number;
  hide?: string[]; // mesh key prefixes to hide
  sunScale?: number;
  ambientScale?: number;
  /** Fix the exposure (the source renders at 1) instead of the game's partial adaptation. */
  exposure?: number;
}
interface Request {
  origin: string;
  textures: TextureSpec[];
  materials: Record<string, MaterialSpec>;
  meshes: MeshSpec[];
  views: ViewSpec[];
}

// Source frame (Blender z-up, house frame) to Lite's left-handed y-up world: the glTF frame
// (x, z, -y) with X mirrored, the same reflection every PBR instance matrix applies.
const toWorld = (p: Vec3): Vec3 => [-p[0], p[2], -p[1]];

self.onmessage = (event: MessageEvent<Request>): void => {
  void run(event.data).catch((error: unknown) => {
    self.postMessage({
      status: "failed",
      error: error instanceof Error ? error.stack : String(error),
    });
  });
};

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.arrayBuffer();
}

/** Plain (not supercompressed) KTX2 levels, largest first. */
function ktx2Levels(buffer: ArrayBuffer, format: Format) {
  const view = new DataView(buffer);
  const vkFormat = view.getUint32(12, true);
  const width = view.getUint32(20, true);
  const height = view.getUint32(24, true);
  const levelCount = view.getUint32(40, true);
  if (view.getUint32(44, true) !== 0) throw new Error("Supercompressed KTX2 in the preview");
  const expected = { bc1: [131, 132], bc7: [145, 146], rgba8: [37, 43] }[format];
  if (!expected.includes(vkFormat)) throw new Error(`KTX2 vkFormat ${vkFormat} is not ${format}`);
  const levels = [];
  for (let level = 0; level < levelCount; level++) {
    const offset = Number(view.getBigUint64(80 + level * 24, true));
    const length = Number(view.getBigUint64(88 + level * 24, true));
    levels.push({
      width: Math.max(1, width >> level),
      height: Math.max(1, height >> level),
      data: new Uint8Array(buffer, offset, length),
    });
  }
  return levels;
}

async function run(request: Request): Promise<void> {
  const first = request.views[0];
  if (first === undefined) throw new Error("No views");
  const canvas = new OffscreenCanvas(first.width, first.height);
  // Same surface options and scene set-up as the shipping render worker (lite-greybox-world.ts).
  const engine: EngineContext = await createEngine(canvas, {
    format: "bgra8unorm",
    msaaSamples: 4,
  });
  // Record every composed WGSL module and pipeline pairing: the PSO warmup contract pins the PBR
  // vertex, colour and depth modules by SHA-256, and a material-plugin change moves them.
  const device = Reflect.get(engine, "_device") as GPUDevice;
  const shaderModules = new Map<GPUShaderModule, string>();
  const moduleInfo: { sha256: string; bytes: number; markers: string[] }[] = [];
  const pipelines: { vertex: string | undefined; fragment: string | undefined; targets: number }[] =
    [];
  const createShaderModule = device.createShaderModule.bind(device);
  device.createShaderModule = (descriptor: GPUShaderModuleDescriptor) => {
    const module = createShaderModule(descriptor);
    const bytes = new TextEncoder().encode(descriptor.code);
    void crypto.subtle.digest("SHA-256", bytes).then((digest) => {
      const sha256 = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      shaderModules.set(module, sha256);
      moduleInfo.push({
        sha256,
        bytes: bytes.length,
        markers: ["msUvPerMeter", "microShadowSun", "@vertex", "@fragment", "csmSample"].filter(
          (m) => descriptor.code.includes(m),
        ),
      });
    });
    return module;
  };
  const recordPipeline = (descriptor: GPURenderPipelineDescriptor) =>
    pipelines.push({
      vertex: shaderModules.get(descriptor.vertex.module),
      fragment: descriptor.fragment ? shaderModules.get(descriptor.fragment.module) : undefined,
      targets: descriptor.fragment?.targets.length ?? 0,
    });
  const createRenderPipeline = device.createRenderPipeline.bind(device);
  device.createRenderPipeline = (descriptor: GPURenderPipelineDescriptor) => {
    queueMicrotask(() => recordPipeline(descriptor));
    return createRenderPipeline(descriptor);
  };
  const createRenderPipelineAsync = device.createRenderPipelineAsync.bind(device);
  device.createRenderPipelineAsync = (descriptor: GPURenderPipelineDescriptor) => {
    queueMicrotask(() => recordPipeline(descriptor));
    return createRenderPipelineAsync(descriptor);
  };
  const scene = createSceneContext(engine);
  enablePbrMaterialPluginVertexData();
  enableMaterialPlugins(scene);
  const drape = createRigidTerrainDrapeField(engine);
  scene.imageProcessing = {
    ...scene.imageProcessing,
    contrast: 1,
    toneMapping: PARALLAX_AGX_TONE_MAPPING,
    toneMappingEnabled: true,
  };
  const pbrAmbient = createPbrAmbientState();
  await MeshoptDecoder.ready;

  const uploadStarted = performance.now();
  const textures = new Map<string, Texture2D>();
  const textureGpuBytes: Record<string, number> = {};
  for (const spec of request.textures) {
    let levels: { width: number; height: number; data: Uint8Array }[];
    if (spec.ktx2 !== undefined)
      levels = ktx2Levels(await fetchBytes(`${request.origin}/${spec.ktx2}`), spec.format);
    else {
      levels = [];
      for (const mip of spec.mips ?? [])
        levels.push({
          width: mip.width,
          height: mip.height,
          data: new Uint8Array(await fetchBytes(`${request.origin}/${mip.file}`)),
        });
    }
    const uploaded = uploadStreamedPbrTexture(engine, levels, spec.format, spec.srgb);
    textures.set(spec.role, uploaded.texture);
    textureGpuBytes[spec.role] = uploaded.gpuBytes;
  }
  const texture = (role: string, mode: "repeat" | "clamp-to-edge") => {
    const t = textures.get(role);
    if (t === undefined) throw new Error(`Missing texture ${role}`);
    return withPbrTextureAddressMode(engine, t, mode);
  };
  const materials = new Map<string, ReturnType<typeof createStreamedPbrMaterial>>();
  for (const [name, m] of Object.entries(request.materials))
    materials.set(
      name,
      createStreamedPbrMaterial(
        {
          baseColor: texture(m.baseColor, m.address),
          normal: texture(m.normal, m.address),
          orm: texture(m.orm, m.address),
        },
        {
          baseColorFactor: [1, 1, 1],
          roughnessFactor: 1,
          metallicFactor: m.metallicFactor,
          normalScale: 1,
        },
        drape,
        pbrAmbient,
        { heightRangeMeters: m.heightRangeMeters },
        m.detail === undefined
          ? undefined
          : {
              texture: texture(m.detail.texture, "repeat"),
              uvScale: m.detail.uvScale,
              normalGain: m.detail.normalGain,
              albedoGain: m.detail.albedoGain,
            },
        m.tint ?? null,
      ),
    );

  interface Pool {
    spec: MeshSpec;
    lod: number;
    mesh: Mesh;
    triangles: number;
    matrices: Float32Array;
  }
  const pools: Pool[] = [];
  let geometryBytes = 0;
  for (const spec of request.meshes) {
    const material = materials.get(spec.material);
    if (material === undefined) throw new Error(`No material ${spec.material}`);
    for (const [lod, source] of spec.lods.entries()) {
      let v: Float32Array;
      let indices: Uint32Array;
      if (source.meshopt !== undefined) {
        const vb = new Uint8Array(source.meshopt.vertices * 32);
        MeshoptDecoder.decodeGltfBuffer(
          vb,
          source.meshopt.vertices,
          32,
          new Uint8Array(await fetchBytes(`${request.origin}/${source.vertices}`)),
          "ATTRIBUTES",
        );
        const ib = new Uint8Array(source.meshopt.indices * 4);
        MeshoptDecoder.decodeGltfBuffer(
          ib,
          source.meshopt.indices,
          4,
          new Uint8Array(await fetchBytes(`${request.origin}/${source.indices}`)),
          "TRIANGLES",
        );
        v = new Float32Array(vb.buffer);
        indices = new Uint32Array(ib.buffer);
      } else {
        v = new Float32Array(await fetchBytes(`${request.origin}/${source.vertices}`));
        indices = new Uint32Array(await fetchBytes(`${request.origin}/${source.indices}`));
      }
      geometryBytes += v.byteLength + indices.byteLength;
      // The runtime's storage-backed interleaved slab, so previews draw the game's pipelines.
      const { mesh } = createStreamedPbrGeometry(
        engine,
        `${spec.key}-lod${lod}`,
        { attributes: v.buffer, vertexCount: v.length / 8, ...interleavedPositionBounds(v) },
        { indices: indices.buffer, indexCount: indices.length },
      );
      mesh.id = PBR_AMBIENT_MESH_ID;
      mesh.material = material;
      mesh.receiveShadows = true;
      // As the game: relief a micro-shadow height field carries stays out of the CSM (D-206).
      if (!spec.castsShadows) excludeFromCsmCasters(mesh);
      const capacity = Math.max(1, spec.instances.length);
      const matrices = new Float32Array(16 * capacity);
      setThinInstances(mesh, matrices, capacity);
      enableThinInstanceDynamicDrawCount(mesh);
      setThinInstanceCount(mesh, 0);
      addToScene(scene, mesh);
      pools.push({ spec, lod, mesh, triangles: indices.length / 3, matrices });
    }
  }
  const uploadMs = performance.now() - uploadStarted;
  const ambient = createHemisphericLight();
  ambient.excludedMeshIds = new Set([PBR_AMBIENT_MESH_ID]);
  const sun = createDirectionalLight([0, -1, 0]);
  addToScene(scene, ambient);
  addToScene(scene, sun);
  const shadows = createDirectionalShadows(engine, sun);
  const camera = createFreeCamera({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 1 });
  scene.camera = camera;
  camera.nearPlane = 0.02;
  camera.farPlane = 400;
  shadows.synchronize(
    pools.map((p) => p.mesh),
    new Set(),
  );
  await registerSceneWithShadowSupport(scene);
  setGpuTimingEnabled(engine, true);

  const frames = [];
  for (const view of request.views) {
    if (canvas.width !== view.width || canvas.height !== view.height)
      setEngineSize(engine, view.width, view.height);
    const hfov = 2 * Math.atan(18 / view.lens);
    camera.fov =
      view.width >= view.height
        ? 2 * Math.atan(Math.tan(hfov / 2) * (view.height / view.width))
        : hfov;
    const eye = toWorld(view.eye);
    const target = toWorld(view.target);
    camera.position.set(eye[0], eye[1], eye[2]);
    camera.target.set(target[0], target[1], target[2]);
    // The game's calibrated lighting at the view's sun elevation (phase), with the source's
    // azimuth: applyEnvironmentLighting in lite-greybox-world.ts, with the matched direction.
    const [elevation, azimuth] = view.sun.map((d) => (d * Math.PI) / 180) as [number, number];
    const lighting = sampleEnvironmentLighting(elevation / (2 * Math.PI), view.weather);
    const toSun = toWorld([
      Math.cos(elevation) * Math.cos(azimuth),
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
    ]);
    const copy = (to: number[], from: readonly number[], k = 1) => {
      to[0] = (from[0] ?? 0) * k;
      to[1] = (from[1] ?? 0) * k;
      to[2] = (from[2] ?? 0) * k;
    };
    // Diagnostics: sunScale also scales the sun's share of the ground bounce (the ground's albedo
    // times its sky irradiance is the rest), so a sun-off view is lit by the sky alone.
    const sunScale = view.sunScale ?? 1;
    const ground = lighting.pbrGround.map((value, c) => {
      const skyBounce = (GROUND_BOUNCE_ALBEDO[c] ?? 0) * (lighting.pbrSky[c] ?? 0);
      return skyBounce + (value - skyBounce) * sunScale;
    });
    copy(pbrAmbient.sky, lighting.pbrSky, view.ambientScale ?? 1);
    copy(pbrAmbient.ground, ground, view.ambientScale ?? 1);
    copy(pbrAmbient.toSun, toSun);
    for (const [index, value] of lighting.pbrSkyShape.entries()) pbrAmbient.skyShape[index] = value;
    scene.imageProcessing.exposure = view.exposure ?? lighting.exposure;
    ambient.intensity = lighting.ambientIntensity;
    copy(ambient.diffuseColor, lighting.skyColor);
    copy(ambient.specularColor, [0, 0, 0]);
    copy(ambient.groundColor, lighting.groundColor);
    ambient.direction.set(0, 1, 0);
    sun.intensity = lighting.sunLightIntensity * (view.sunScale ?? 1);
    copy(sun.diffuse, lighting.sunColor);
    copy(sun.specular, [0, 0, 0]);
    sun.direction.set(-toSun[0], -toSun[1], -toSun[2]);
    scene.clearColor.r = lighting.clearColor[0];
    scene.clearColor.g = lighting.clearColor[1];
    scene.clearColor.b = lighting.clearColor[2];
    for (const material of materials.values()) markMaterialUboDirty(material);

    let visibleTriangles = 0;
    const counts = new Map<Pool, number>();
    for (const pool of pools) counts.set(pool, 0);
    for (const spec of request.meshes) {
      if (view.hide?.some((prefix) => spec.key.startsWith(prefix))) continue;
      const lodPools = pools.filter((p) => p.spec === spec);
      for (const m of spec.instances) {
        const c = spec.centre;
        const wx = (m[0] ?? 0) * c[0] + (m[4] ?? 0) * c[1] + (m[8] ?? 0) * c[2] + (m[12] ?? 0);
        const wy = (m[1] ?? 0) * c[0] + (m[5] ?? 0) * c[1] + (m[9] ?? 0) * c[2] + (m[13] ?? 0);
        const wz = (m[2] ?? 0) * c[0] + (m[6] ?? 0) * c[1] + (m[10] ?? 0) * c[2] + (m[14] ?? 0);
        const distance = Math.hypot(wx - eye[0], wy - eye[1], wz - eye[2]);
        const [near, far] = spec.lodBoundaries;
        const lod =
          view.lodMode === "mixed"
            ? distance <= near
              ? 0
              : distance <= far
                ? 1
                : 2
            : Number(view.lodMode.slice(3));
        const pool = lodPools[Math.min(lod, lodPools.length - 1)];
        if (pool === undefined) continue;
        const n = counts.get(pool) ?? 0;
        pool.matrices.set(m, n * 16);
        counts.set(pool, n + 1);
      }
    }
    for (const pool of pools) {
      const n = counts.get(pool) ?? 0;
      setThinInstanceCount(pool.mesh, n);
      setSubtreeVisible(pool.mesh, n > 0);
      visibleTriangles += n * pool.triangles;
    }
    shadows.synchronize(
      pools.map((p) => p.mesh),
      new Set(),
    );
    const gpu: number[] = [];
    const drawCalls: number[] = [];
    const warmup = view.timingFrames > 0 ? 60 : 12;
    for (let frame = 0; frame < warmup + view.timingFrames; frame++) {
      renderFrame(engine, 16);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (frame >= warmup) {
        gpu.push(engine.gpuFrameTimeMs);
        drawCalls.push(engine.drawCallCount);
      }
    }
    let settled = false;
    const capture = captureScreenshot(engine).finally(() => {
      settled = true;
    });
    for (let frame = 0; !settled && frame < 240; frame++) {
      renderFrame(engine, 16);
      await new Promise<void>((resolve) => setTimeout(resolve, 16));
    }
    if (!settled) throw new Error(`Capture timed out for ${view.name}`);
    const image = await capture;
    frames.push({
      name: view.name,
      width: image.width,
      height: image.height,
      rgba: new Uint8Array(image.data).buffer,
      visibleTriangles,
      gpuFrameMs: gpu,
      drawCalls: drawCalls.at(-1) ?? engine.drawCallCount,
    });
  }
  self.postMessage(
    {
      status: "passed",
      uploadMs,
      textureGpuBytes,
      geometryBytes,
      frames,
      shaders: {
        modules: moduleInfo,
        pipelines: pipelines.map((p) => ({
          ...p,
          vertex: p.vertex ?? "unhashed",
          fragment: p.fragment ?? "none",
        })),
      },
    },
    { transfer: frames.map((f) => f.rgba) },
  );
}
