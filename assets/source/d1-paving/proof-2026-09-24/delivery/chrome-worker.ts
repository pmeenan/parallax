// Chrome/Babylon Lite inspection worker for the photoreal paving delivery candidate.
// Bundled by chrome-preview.mjs. It renders the decoded runtime bytes through the engine's
// own PBR upload/material, repeat sampler, thin instances, environment lighting and CSM
// (the production code paths), bypassing only the streaming caps this module exceeds.
// Not a game worker: source-package inspection only.
import {
  addToScene,
  captureScreenshot,
  createDirectionalLight,
  createEngine,
  createFreeCamera,
  createHemisphericLight,
  createMeshFromData,
  createSceneContext,
  type EngineContext,
  enableThinInstanceDynamicDrawCount,
  type Mesh,
  registerSceneWithShadowSupport,
  renderFrame,
  setEngineSize,
  setGpuTimingEnabled,
  setSubtreeVisible,
  setThinInstanceCount,
  setThinInstances,
  type Texture2D,
} from "@babylonjs/lite";
import { createDirectionalShadows } from "../../../../../engine/src/render/directional-shadows";
import { sampleEnvironmentLighting } from "../../../../../engine/src/render/environment-lighting";
import {
  createStreamedPbrMaterial,
  uploadStreamedPbrTexture,
  withPbrTextureAddressMode,
} from "../../../../../engine/src/render/streamed-pbr-asset";
import { writePbrAssetMatrix } from "../../../../../engine/src/world/pbr-asset-transform";

type Vec3 = [number, number, number];
interface TextureSpec {
  role: string;
  srgb: boolean;
  levels: { width: number; height: number }[];
}
interface ViewSpec {
  name: string;
  width: number;
  height: number;
  eye: Vec3; // source coordinates (x, y, z up), metres
  target: Vec3;
  lens: number; // Blender focal length over a 36 mm sensor fitted to the wider axis
  sun: [number, number]; // elevation, azimuth in degrees (source frame)
  weather: "clear" | "overcast";
  tiles: [number, number][];
  lodMode: "lod0" | "mixed";
  timingFrames: number;
  // Diagnostics only: light scales and a flat ground normal map.
  sunScale?: number;
  ambientScale?: number;
  flatGroundNormal?: boolean;
  hideParts?: string[];
}
interface Request {
  origin: string;
  // Diagnostic: upload only mips no wider than this (e.g. 2048 drops the 4096 level).
  maxTextureWidth?: number;
  textures: TextureSpec[];
  parts: { part: string; lod: number }[];
  lodBoundaries: Record<string, [number, number]>;
  views: ViewSpec[];
}

const TILE = 4;
// Source (Blender, right-handed z-up) to Lite world (left-handed y-up) through the same
// glTF reflection the placement matrix applies: B = (2 - x, z, 2 - y) for tile (tx, ty)
// placed at (-4 tx, 0, -4 ty).
const toWorld = (p: Vec3): Vec3 => [2 - p[0], p[2], 2 - p[1]];

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

async function run(request: Request): Promise<void> {
  const first = request.views[0];
  if (first === undefined) throw new Error("No views");
  const canvas = new OffscreenCanvas(first.width, first.height);
  // Same surface options as the shipping render worker.
  const engine: EngineContext = await createEngine(canvas, {
    format: "bgra8unorm",
    msaaSamples: 4,
  });
  const scene = createSceneContext(engine);
  const uploadStarted = performance.now();
  const textures = new Map<string, Texture2D>();
  let textureGpuBytes = 0;
  for (const spec of request.textures) {
    const levels = [];
    for (const [index, level] of spec.levels.entries())
      if (level.width <= (request.maxTextureWidth ?? Number.POSITIVE_INFINITY))
        levels.push({
          width: level.width,
          height: level.height,
          rgba: await fetchBytes(
            `${request.origin}/decoded/${spec.role}-${String(index).padStart(2, "0")}.rgba`,
          ),
        });
    const uploaded = uploadStreamedPbrTexture(engine, levels, spec.srgb);
    textures.set(spec.role, uploaded.texture);
    textureGpuBytes += uploaded.gpuBytes;
  }
  const texture = (role: string, mode: "repeat" | "clamp-to-edge") => {
    const t = textures.get(role);
    if (t === undefined) throw new Error(`Missing texture ${role}`);
    return withPbrTextureAddressMode(engine, t, mode);
  };
  const factors = {
    baseColorFactor: [1, 1, 1] as const,
    roughnessFactor: 1,
    metallicFactor: 1,
    normalScale: 1,
  };
  const materials: Record<string, ReturnType<typeof createStreamedPbrMaterial>> = {
    ground: createStreamedPbrMaterial(
      {
        baseColor: texture("ground-basecolor", "repeat"),
        normal: texture("ground-normal", "repeat"),
        orm: texture("ground-orm", "repeat"),
      },
      factors,
    ),
    pebbles: createStreamedPbrMaterial(
      {
        baseColor: texture("ground-basecolor", "repeat"),
        normal: texture("pebble-normal", "repeat"),
        orm: texture("pebble-orm", "repeat"),
      },
      factors,
    ),
    groundFlat: createStreamedPbrMaterial(
      {
        baseColor: texture("ground-basecolor", "repeat"),
        normal: texture("pebble-normal", "repeat"),
        orm: texture("ground-orm", "repeat"),
      },
      factors,
    ),
    plants: createStreamedPbrMaterial(
      {
        baseColor: texture("plant-basecolor", "clamp-to-edge"),
        normal: texture("plant-normal", "clamp-to-edge"),
        orm: texture("plant-orm", "clamp-to-edge"),
      },
      factors,
    ),
  };
  const CAPACITY = 256;
  const meshes = new Map<string, { mesh: Mesh; triangles: number; matrices: Float32Array }>();
  let geometryBytes = 0;
  for (const { part, lod } of request.parts) {
    const v = new Float32Array(
      await fetchBytes(`${request.origin}/decoded/${part}-lod${lod}.vertices`),
    );
    const indices = new Uint32Array(
      await fetchBytes(`${request.origin}/decoded/${part}-lod${lod}.indices`),
    );
    geometryBytes += v.byteLength + indices.byteLength;
    const n = v.length / 8;
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      positions.set(v.subarray(i * 8, i * 8 + 3), i * 3);
      normals.set(v.subarray(i * 8 + 3, i * 8 + 6), i * 3);
      uvs.set(v.subarray(i * 8 + 6, i * 8 + 8), i * 2);
    }
    // Lite builds pipelines at registration; a material swap afterwards renders nothing,
    // so the flat-normal diagnostic gets its own registered ground meshes.
    for (const variant of part === "ground" ? ["ground", "groundFlat"] : [part]) {
      const mesh = createMeshFromData(
        engine,
        `${variant}-lod${lod}`,
        positions,
        normals,
        indices,
        uvs,
      );
      const material = materials[variant];
      if (material === undefined) throw new Error(`No material for ${variant}`);
      mesh.material = material;
      mesh.receiveShadows = true;
      // Same fixed-capacity pool + dynamic draw count as the render worker's PBR groups.
      const matrices = new Float32Array(16 * CAPACITY);
      setThinInstances(mesh, matrices, CAPACITY);
      enableThinInstanceDynamicDrawCount(mesh);
      setThinInstanceCount(mesh, 0);
      addToScene(scene, mesh);
      meshes.set(`${variant}:${lod}`, { mesh, triangles: indices.length / 3, matrices });
    }
  }
  const uploadMs = performance.now() - uploadStarted;
  const ambient = createHemisphericLight();
  const sun = createDirectionalLight([0, -1, 0]);
  addToScene(scene, ambient);
  addToScene(scene, sun);
  const shadows = createDirectionalShadows(engine, sun);
  const camera = createFreeCamera({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 1 });
  scene.camera = camera;
  camera.nearPlane = 0.02;
  camera.farPlane = 400;
  shadows.synchronize(
    [...meshes.values()].map((m) => m.mesh),
    new Set(),
  );
  await registerSceneWithShadowSupport(scene);
  setGpuTimingEnabled(engine, true);

  const frames = [];
  for (const view of request.views) {
    if (canvas.width !== view.width || canvas.height !== view.height)
      setEngineSize(engine, view.width, view.height);
    // Camera: Blender's horizontal fit of a 36 mm sensor, converted to Lite's vertical fov.
    const hfov = 2 * Math.atan(18 / view.lens);
    camera.fov = 2 * Math.atan(Math.tan(hfov / 2) * (view.height / view.width));
    const eye = toWorld(view.eye);
    const target = toWorld(view.target);
    camera.position.set(eye[0], eye[1], eye[2]);
    camera.target.set(target[0], target[1], target[2]);
    // Game lighting for this sun elevation and weather; azimuth matched to the source view.
    const [elevation, azimuth] = view.sun.map((d) => (d * Math.PI) / 180) as [number, number];
    const lighting = sampleEnvironmentLighting(
      (((elevation / (2 * Math.PI)) % 1) + 1) % 1,
      view.weather,
    );
    const s: Vec3 = [
      Math.cos(elevation) * Math.cos(azimuth),
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
    ];
    // applyEnvironmentLighting (lite-greybox-world.ts), except the matched sun azimuth.
    const copy = (to: number[], from: readonly number[]) => {
      to[0] = from[0] ?? 0;
      to[1] = from[1] ?? 0;
      to[2] = from[2] ?? 0;
    };
    ambient.intensity = lighting.ambientIntensity * (view.ambientScale ?? 1);
    copy(ambient.diffuseColor, lighting.skyColor);
    copy(ambient.specularColor, lighting.skyColor);
    copy(ambient.groundColor, lighting.groundColor);
    ambient.direction.set(0, 1, 0);
    sun.intensity = lighting.sunIntensity * (view.sunScale ?? 1);
    copy(sun.diffuse, lighting.sunColor);
    copy(sun.specular, lighting.sunColor);
    sun.direction.set(s[0], -s[2], s[1]);
    scene.clearColor.r = lighting.clearColor[0];
    scene.clearColor.g = lighting.clearColor[1];
    scene.clearColor.b = lighting.clearColor[2];
    // Per-tile LOD from the tile centre, with the proposed boundaries.
    const buckets = new Map<string, number[]>();
    for (const [tx, ty] of view.tiles) {
      const centre = toWorld([tx * TILE + 2, ty * TILE + 2, 0]);
      const distance = Math.hypot(centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]);
      for (const part of Object.keys(request.lodBoundaries)) {
        if (view.hideParts?.includes(part)) continue;
        const [near, far] = request.lodBoundaries[part] ?? [0, 0];
        const lod = view.lodMode === "lod0" ? 0 : distance <= near ? 0 : distance <= far ? 1 : 2;
        const variant = part === "ground" && view.flatGroundNormal ? "groundFlat" : part;
        const key = `${variant}:${lod}`;
        if (!meshes.has(key)) continue;
        const list = buckets.get(key) ?? [];
        list.push(tx, ty);
        buckets.set(key, list);
      }
    }
    let visibleTriangles = 0;
    for (const [key, entry] of meshes) {
      const list = buckets.get(key) ?? [];
      const count = list.length / 2;
      if (count > CAPACITY) throw new Error("Tile grid exceeds the instance pool");
      for (let i = 0; i < count; i++)
        writePbrAssetMatrix(entry.matrices, i * 16, {
          position: [-(list[i * 2] ?? 0) * TILE, 0, -(list[i * 2 + 1] ?? 0) * TILE],
          scale: [1, 1, 1],
          rotationYRadians: 0,
        });
      setThinInstanceCount(entry.mesh, count);
      setSubtreeVisible(entry.mesh, count > 0);
      visibleTriangles += count * entry.triangles;
    }
    shadows.synchronize(
      [...meshes.values()].map((m) => m.mesh),
      new Set(),
    );
    const gpu: number[] = [];
    const drawCalls: number[] = [];
    // Timed views warm up for 60 frames: the first view follows the multi-hundred-MB upload.
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
      drawCalls: drawCalls.at(-1) ?? 0,
    });
  }
  self.postMessage(
    { status: "passed", uploadMs, textureGpuBytes, geometryBytes, frames },
    { transfer: frames.map((f) => f.rgba) },
  );
}
