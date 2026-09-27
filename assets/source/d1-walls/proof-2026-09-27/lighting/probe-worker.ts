// Engine package 7: white-probe radiance in pinned Chrome, for comparison with calibrate.py's
// Cycles probes. Bundled and driven by probes.mjs. A 0.2 m quad is drawn with the engine's
// streamed PBR material, ambient plugin, calibrated sun and sky and AgX tone map, facing each
// probe normal, and the camera looks straight at it. It is drawn twice, at albedo 0.25 (the
// albedo keeps the specular a small share) and at albedo 0 (the specular alone), each re-exposed
// to mid-grey. There is no ground geometry: the game's ground bounce is analytic.
import {
  addToScene,
  captureScreenshot,
  createDirectionalLight,
  createEngine,
  createFreeCamera,
  createSceneContext,
  type EngineContext,
  enableMaterialPlugins,
  enablePbrMaterialPluginVertexData,
  enableThinInstanceDynamicDrawCount,
  markMaterialUboDirty,
  registerSceneWithShadowSupport,
  renderFrame,
  setSubtreeVisible,
  setThinInstanceCount,
  setThinInstances,
} from "@babylonjs/lite";
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
} from "../../../../../engine/src/render/streamed-pbr-asset";
import { createRigidTerrainDrapeField } from "../../../../../engine/src/render/terrain-drape";
import {
  PARALLAX_AGX_TONE_MAPPING,
  parallaxAgxNeutralDisplay,
} from "../../../../../engine/src/render/tone-mapping";
import { interleavedPositionBounds } from "../../../../../engine/src/streaming/streaming-dependency-contract";

type Vec3 = [number, number, number];
interface ProbeSpec {
  name: string;
  /** Sun elevation and azimuth, degrees (the source's frame). */
  sun: [number, number];
  /** The probe normal in the source's frame (z up). */
  normal: Vec3;
  /** Sky only: the sun and its share of the ground bounce off, as calibrate.py's sky-only pass. */
  skyOnly: boolean;
}

const PROBE_ALBEDO = 0.25;
const SIZE = 64;
// The source frame (z up) to the engine's left-handed world: (x, z, -y) with X mirrored.
const toWorld = (p: readonly number[]): Vec3 => [-(p[0] ?? 0), p[2] ?? 0, -(p[1] ?? 0)];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalise = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};

self.onmessage = (event: MessageEvent<{ probes: ProbeSpec[] }>): void => {
  void run(event.data.probes).catch((error: unknown) => {
    self.postMessage({
      status: "failed",
      error: error instanceof Error ? error.stack : String(error),
    });
  });
};

function constant(engine: EngineContext, rgba: readonly number[], srgb: boolean) {
  const levels = [4, 2, 1].map((size) => ({
    width: size,
    height: size,
    data: new Uint8Array(size * size * 4).map((_, i) => rgba[i % 4] ?? 0),
  }));
  return uploadStreamedPbrTexture(engine, levels, "rgba8", srgb).texture;
}

// The linear value whose neutral display is `display` (bisection on the monotone curve).
function neutralLinear(display: number): number {
  let low = -14;
  let high = 2;
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    if (parallaxAgxNeutralDisplay(2 ** mid) < display) low = mid;
    else high = mid;
  }
  return 2 ** ((low + high) / 2);
}

async function run(probes: readonly ProbeSpec[]): Promise<void> {
  const engine = await createEngine(new OffscreenCanvas(SIZE, SIZE), {
    format: "bgra8unorm",
    msaaSamples: 4,
  });
  const scene = createSceneContext(engine);
  enablePbrMaterialPluginVertexData();
  enableMaterialPlugins(scene);
  scene.imageProcessing = {
    ...scene.imageProcessing,
    contrast: 1,
    toneMapping: PARALLAX_AGX_TONE_MAPPING,
    toneMappingEnabled: true,
  };
  const ambient = createPbrAmbientState();
  const drape = createRigidTerrainDrapeField(engine);
  // ORM: occlusion 1, roughness 1, metallic 0; a flat normal map.
  const textures = {
    baseColor: constant(engine, [255, 255, 255, 255], true),
    normal: constant(engine, [128, 128, 255, 255], false),
    orm: constant(engine, [255, 255, 0, 255], false),
  };
  // A 0.2 m quad facing +Z in the 32-byte position/normal/uv slab.
  const v = new Float32Array([
    -0.1, -0.1, 0, 0, 0, 1, 0, 1, 0.1, -0.1, 0, 0, 0, 1, 1, 1, 0.1, 0.1, 0, 0, 0, 1, 1, 0, -0.1,
    0.1, 0, 0, 0, 1, 0, 0,
  ]);
  const matrices = new Float32Array(16);
  const quads = [PROBE_ALBEDO, 0].map((albedo) => {
    const material = createStreamedPbrMaterial(
      textures,
      {
        baseColorFactor: [albedo, albedo, albedo],
        roughnessFactor: 1,
        metallicFactor: 0,
        normalScale: 1,
      },
      drape,
      ambient,
    );
    const { mesh } = createStreamedPbrGeometry(
      engine,
      `probe-${albedo}`,
      { attributes: v.buffer, vertexCount: 4, ...interleavedPositionBounds(v) },
      { indices: new Uint32Array([0, 2, 1, 0, 3, 2]).buffer, indexCount: 6 },
    );
    mesh.id = PBR_AMBIENT_MESH_ID;
    mesh.material = material;
    setThinInstances(mesh, matrices, 1);
    enableThinInstanceDynamicDrawCount(mesh);
    setThinInstanceCount(mesh, 1);
    addToScene(scene, mesh);
    return { albedo, mesh, material };
  });
  const sun = createDirectionalLight([0, -1, 0]);
  addToScene(scene, sun);
  // Magenta clear: a culled (wrongly wound) or missed quad cannot pass for a measurement.
  scene.clearColor.r = 1;
  scene.clearColor.g = 0;
  scene.clearColor.b = 1;
  const camera = createFreeCamera({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 1 });
  scene.camera = camera;
  camera.nearPlane = 0.01;
  camera.farPlane = 10;
  camera.fov = 0.2;
  await registerSceneWithShadowSupport(scene);

  // The mean display value (0-1) of the central 16 x 16 pixels, all on the quad.
  const captureCentre = async (name: string): Promise<number[]> => {
    for (let frame = 0; frame < 8; frame++) {
      renderFrame(engine, 16);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    let settled = false;
    const capture = captureScreenshot(engine).finally(() => {
      settled = true;
    });
    for (let frame = 0; !settled && frame < 240; frame++) {
      renderFrame(engine, 16);
      await new Promise<void>((resolve) => setTimeout(resolve, 16));
    }
    if (!settled) throw new Error(`Capture timed out for ${name}`);
    const image = await capture;
    const data = new Uint8Array(image.data);
    const sum = [0, 0, 0];
    for (let py = image.height / 2 - 8; py < image.height / 2 + 8; py++)
      for (let px = image.width / 2 - 8; px < image.width / 2 + 8; px++)
        for (let c = 0; c < 3; c++)
          sum[c] = (sum[c] ?? 0) + (data[(py * image.width + px) * 4 + c] ?? 0);
    return sum.map((value) => value / 256 / 255);
  };

  const results = [];
  for (const probe of probes) {
    // The game's calibrated lighting at the probe's sun elevation, with the source's azimuth
    // (applyEnvironmentLighting in lite-greybox-world.ts, with the matched direction).
    const [elevation, azimuth] = probe.sun.map((d) => (d * Math.PI) / 180) as [number, number];
    const lighting = sampleEnvironmentLighting(elevation / (2 * Math.PI), "clear");
    const toSun = toWorld([
      Math.cos(elevation) * Math.cos(azimuth),
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
    ]);
    for (let c = 0; c < 3; c++) {
      ambient.sky[c] = lighting.pbrSky[c] ?? 0;
      ambient.ground[c] = probe.skyOnly
        ? (GROUND_BOUNCE_ALBEDO[c] ?? 0) * (lighting.pbrSky[c] ?? 0)
        : (lighting.pbrGround[c] ?? 0);
      ambient.toSun[c] = toSun[c] ?? 0;
      sun.diffuse[c] = lighting.sunColor[c] ?? 0;
      sun.specular[c] = 0;
    }
    for (const [index, value] of lighting.pbrSkyShape.entries()) ambient.skyShape[index] = value;
    sun.intensity = probe.skyOnly ? 0 : lighting.sunLightIntensity;
    sun.direction.set(-toSun[0], -toSun[1], -toSun[2]);
    // Orient the quad's +Z to the normal (a proper rotation: columns x, y, n) at 1.5 m.
    const n = normalise(toWorld(probe.normal));
    const x = normalise(cross(Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], n));
    const y = cross(n, x);
    matrices.set([...x, 0, ...y, 0, ...n, 0, 0, 1.5, 0, 1]);
    // A slight tilt keeps the look-at frame defined for up and down probes (the diffuse term is
    // view-independent; the specular is subtracted).
    camera.position.set(
      n[0] * 0.3 + x[0] * 0.02,
      1.5 + n[1] * 0.3 + x[1] * 0.02,
      n[2] * 0.3 + x[2] * 0.02,
    );
    camera.target.set(0, 1.5, 0);
    const display: Record<string, number[]> = {};
    const exposure: Record<string, number> = {};
    for (const quad of quads) {
      for (const other of quads) {
        setThinInstanceCount(other.mesh, other === quad ? 1 : 0);
        setSubtreeVisible(other.mesh, other === quad);
        markMaterialUboDirty(other.material);
      }
      // Two captures: the first at the game's exposure, the second re-exposed so the probe sits at
      // mid-grey, where one 8-bit level is about 1% of radiance (at the curve's toe it is 4%).
      let multiplier = 1;
      let centre: number[] = [];
      for (const pass of [0, 1]) {
        scene.imageProcessing.exposure = lighting.exposure * multiplier;
        centre = await captureCentre(probe.name);
        if (pass === 0) {
          const grey =
            (centre[0] ?? 0) * 0.2126 + (centre[1] ?? 0) * 0.7152 + (centre[2] ?? 0) * 0.0722;
          multiplier = Math.min(512, Math.max(1 / 16, 0.18 / neutralLinear(grey)));
        }
      }
      exposure[String(quad.albedo)] = lighting.exposure * multiplier;
      display[String(quad.albedo)] = centre;
    }
    results.push({ name: probe.name, albedo: PROBE_ALBEDO, exposure, display });
  }
  self.postMessage({ status: "passed", results });
}
