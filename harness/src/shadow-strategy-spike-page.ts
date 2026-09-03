import {
  type ArcRotateCamera,
  addToScene,
  captureScreenshot,
  createArcRotateCamera,
  createBox,
  createCsmDirectionalShadowGenerator,
  createDirectionalLight,
  createEngine,
  createEsmDirectionalShadowGenerator,
  createGround,
  createHemisphericLight,
  createPcfDirectionalShadowGenerator,
  createSceneContext,
  createSphere,
  createStandardMaterial,
  type EngineContext,
  getRenderTaskGpuTimings,
  isGpuTimingSupported,
  type Mesh,
  registerScene,
  registerSceneWithShadowSupport,
  renderFrame,
  type SceneContext,
  type ShadowGenerator,
  setEngineSize,
  setGpuTimingEnabled,
  setRenderTaskGpuTimingEnabled,
  setShadowTaskCasterMeshes,
} from "@babylonjs/lite";
import {
  finalizeShadowTaskSummary,
  isShadowStrategyArm,
  SHADOW_STRATEGY_CASTER_COUNT,
  SHADOW_STRATEGY_RENDER_HEIGHT,
  SHADOW_STRATEGY_RENDER_WIDTH,
  SHADOW_STRATEGY_RENDERER_ID,
  SHADOW_STRATEGY_SPHERE_SEGMENTS,
  SHADOW_STRATEGY_SPIKE_ID,
  SHADOW_STRATEGY_SPIKE_SCHEMA_VERSION,
  SHADOW_STRATEGY_WORKLOAD_ID,
  type ShadowStrategyArm,
  type ShadowStrategyCapture,
  type ShadowStrategyPageResult,
  summarizeShadowStrategySamples,
} from "./shadow-strategy-spike-contract";

const WARMUP_FRAMES = 240;
const MEASURED_FRAMES = 240;
const FRAME_DELTA_MS = 1_000 / 60;
const BOX_GRID_ROWS = 17;
const BOX_GRID_COLUMNS = 25;
const SPHERE_CASTER_COUNT = 128;
const CAPTURE_CHECKPOINTS = Object.freeze([
  Object.freeze({ alpha: -0.72, beta: 1.08, id: "near-casters", radius: 34 }),
  Object.freeze({ alpha: -1.42, beta: 1.17, id: "mid-range", radius: 72 }),
  Object.freeze({ alpha: -2.08, beta: 1.23, id: "long-vista", radius: 126 }),
]);

interface ShadowProbeApi {
  capture(checkpointIndex: number): Promise<ShadowStrategyCapture>;
  readonly error: string | null;
  readonly result: ShadowStrategyPageResult | null;
  readonly state: "failed" | "running" | "complete";
}

interface ProbeScene {
  readonly camera: ArcRotateCamera;
  readonly engine: EngineContext;
  readonly scene: SceneContext;
}

const armValue = new URL(location.href).searchParams.get("arm");
if (!isShadowStrategyArm(armValue)) {
  throw new Error(`Unsupported shadow strategy arm ${JSON.stringify(armValue)}`);
}
const arm = armValue;
const mutableApi: {
  error: string | null;
  result: ShadowStrategyPageResult | null;
  state: ShadowProbeApi["state"];
} = { error: null, result: null, state: "running" };
const api: ShadowProbeApi = Object.freeze({
  capture: async (checkpointIndex: number) => captureCheckpoint(checkpointIndex),
  get error() {
    return mutableApi.error;
  },
  get result() {
    return mutableApi.result;
  },
  get state() {
    return mutableApi.state;
  },
});
Object.defineProperty(globalThis, "__PARALLAX_SHADOW_STRATEGY_PROBE__", {
  configurable: false,
  enumerable: false,
  value: api,
  writable: false,
});

let activeScene: ProbeScene | null = null;
void run().catch((error: unknown) => {
  mutableApi.error = error instanceof Error ? error.message : String(error);
  mutableApi.state = "failed";
});

async function run(): Promise<void> {
  const canvas = document.querySelector("#probe-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Shadow probe canvas is missing");
  const probe = await createProbeScene(canvas, arm);
  activeScene = probe;
  setGpuTimingEnabled(probe.engine, true);
  await setRenderTaskGpuTimingEnabled(probe.engine, true);

  for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) {
    applyMotion(probe.camera, frame, WARMUP_FRAMES);
    renderFrame(probe.engine, FRAME_DELTA_MS);
    await nextAnimationFrame();
  }

  const cpuRenderCallMs: number[] = [];
  const drawCalls: number[] = [];
  const gpuFrameTimeMs: number[] = [];
  const sceneTaskGpuMs: number[] = [];
  const shadowTaskGpuMs: number[] = [];
  let droppedGpuTaskSamples = 0;
  for (let frame = 0; frame < MEASURED_FRAMES; frame += 1) {
    applyMotion(probe.camera, frame, MEASURED_FRAMES);
    const startedAt = performance.now();
    renderFrame(probe.engine, FRAME_DELTA_MS);
    cpuRenderCallMs.push(performance.now() - startedAt);
    drawCalls.push(probe.engine.drawCallCount);
    const timings = getRenderTaskGpuTimings(probe.engine);
    if (timings.status === "available") {
      droppedGpuTaskSamples += timings.droppedTaskCount;
      const sceneDuration = sumTaskDuration(timings.tasks, "scene");
      if (sceneDuration !== null) sceneTaskGpuMs.push(sceneDuration);
      const shadowDuration = sumTaskDuration(timings.tasks, "shadow");
      if (shadowDuration !== null) shadowTaskGpuMs.push(shadowDuration);
    }
    if (probe.engine.gpuFrameTimeMs > 0) gpuFrameTimeMs.push(probe.engine.gpuFrameTimeMs);
    await nextAnimationFrame();
  }

  const gpuTimingSupported = isGpuTimingSupported(probe.engine);
  if (gpuTimingSupported && gpuFrameTimeMs.length < MEASURED_FRAMES * 0.8) {
    throw new Error("Shadow probe did not collect enough GPU frame timing samples");
  }
  if (gpuTimingSupported && sceneTaskGpuMs.length < MEASURED_FRAMES * 0.8) {
    throw new Error("Shadow probe did not collect enough scene-task timing samples");
  }
  if (arm !== "no-shadow" && shadowTaskGpuMs.length < MEASURED_FRAMES * 0.8) {
    throw new Error("Shadow probe did not collect enough shadow-task timing samples");
  }
  mutableApi.result = Object.freeze({
    arm,
    casterCount: SHADOW_STRATEGY_CASTER_COUNT,
    configuration: shadowConfiguration(arm),
    configuredShadowMapTexels: configuredShadowMapTexels(arm),
    cpuRenderCallMs: summarizeShadowStrategySamples(cpuRenderCallMs),
    drawCalls: summarizeShadowStrategySamples(drawCalls),
    droppedGpuTaskSamples,
    gpuFrameTimeMs: summarizeShadowStrategySamples(gpuFrameTimeMs),
    gpuTimingSupported,
    measuredFrames: MEASURED_FRAMES,
    renderHeight: SHADOW_STRATEGY_RENDER_HEIGHT,
    renderWidth: SHADOW_STRATEGY_RENDER_WIDTH,
    renderer: SHADOW_STRATEGY_RENDERER_ID,
    scenarioId: SHADOW_STRATEGY_SPIKE_ID,
    sceneTaskGpuMs: summarizeShadowStrategySamples(sceneTaskGpuMs),
    schemaVersion: SHADOW_STRATEGY_SPIKE_SCHEMA_VERSION,
    shadowTaskGpuMs: finalizeShadowTaskSummary(arm, shadowTaskGpuMs),
    sphereCasterSegments: SHADOW_STRATEGY_SPHERE_SEGMENTS,
    warmupFrames: WARMUP_FRAMES,
    workloadId: SHADOW_STRATEGY_WORKLOAD_ID,
  });
  mutableApi.state = "complete";
}

async function createProbeScene(
  canvas: HTMLCanvasElement,
  selectedArm: ShadowStrategyArm,
): Promise<ProbeScene> {
  const engine = await createEngine(canvas, { format: "bgra8unorm", msaaSamples: 4 });
  setEngineSize(engine, SHADOW_STRATEGY_RENDER_WIDTH, SHADOW_STRATEGY_RENDER_HEIGHT);
  const scene = createSceneContext(engine);
  scene.clearColor = { a: 1, b: 0.23, g: 0.17, r: 0.1 };
  const camera = createArcRotateCamera(-0.72, 1.08, 34, { x: 0, y: 4, z: 0 });
  camera.nearPlane = 0.25;
  camera.farPlane = 220;
  scene.camera = camera;

  const ambient = createHemisphericLight([0, 1, 0], 0.32);
  ambient.diffuseColor = [0.48, 0.61, 0.82];
  ambient.groundColor = [0.09, 0.07, 0.055];
  const sun = createDirectionalLight([-0.48, -0.83, -0.28], 2.15);
  sun.diffuse = [1, 0.79, 0.57];
  sun.specular = [1, 0.88, 0.68];
  addToScene(scene, ambient);
  addToScene(scene, sun);

  const groundMaterial = createStandardMaterial();
  groundMaterial.diffuseColor = [0.31, 0.27, 0.19];
  const stoneMaterial = createStandardMaterial();
  stoneMaterial.diffuseColor = [0.48, 0.52, 0.58];
  const accentMaterial = createStandardMaterial();
  accentMaterial.diffuseColor = [0.74, 0.28, 0.09];
  const ground = createGround(engine, { height: 220, subdivisions: 1, width: 220 });
  ground.name = "probe-ground";
  ground.material = groundMaterial;
  ground.receiveShadows = selectedArm !== "no-shadow";
  addToScene(scene, ground);

  const casters: Mesh[] = [];
  const rowOffset = Math.floor(BOX_GRID_ROWS / 2);
  const columnOffset = Math.floor(BOX_GRID_COLUMNS / 2);
  for (let row = -rowOffset; row <= rowOffset; row += 1) {
    for (let column = -columnOffset; column <= columnOffset; column += 1) {
      const index = (row + rowOffset) * BOX_GRID_COLUMNS + column + columnOffset;
      const height = 2.5 + ((index * 17) % 11) * 0.72;
      const mesh = createBox(engine, 1);
      mesh.name = `probe-caster-${index}`;
      mesh.material = index % 9 === 0 ? accentMaterial : stoneMaterial;
      mesh.position.set(column * 7, height / 2, row * 8.5);
      mesh.scaling.set(2.1 + (index % 3) * 0.5, height, 2.1 + ((index + 1) % 4) * 0.4);
      mesh.receiveShadows = selectedArm !== "no-shadow";
      addToScene(scene, mesh);
      casters.push(mesh);
    }
  }
  for (let index = 0; index < SPHERE_CASTER_COUNT; index += 1) {
    const marker = createSphere(engine, {
      diameter: 2.2,
      segments: SHADOW_STRATEGY_SPHERE_SEGMENTS,
    });
    marker.name = `probe-sphere-${index}`;
    marker.material = accentMaterial;
    const angle = (index / SPHERE_CASTER_COUNT) * Math.PI * 2;
    const radius = 18 + (index % 8) * 10;
    marker.position.set(Math.cos(angle) * radius, 2.1 + (index % 3), Math.sin(angle) * radius);
    marker.receiveShadows = selectedArm !== "no-shadow";
    addToScene(scene, marker);
    casters.push(marker);
  }
  if (casters.length !== SHADOW_STRATEGY_CASTER_COUNT) {
    throw new Error(
      `Shadow workload configured ${casters.length} casters instead of ${SHADOW_STRATEGY_CASTER_COUNT}`,
    );
  }

  const shadowGenerator = createShadowGenerator(engine, sun, selectedArm);
  if (shadowGenerator === null) {
    await registerScene(scene);
  } else {
    sun.shadowGenerator = shadowGenerator;
    setShadowTaskCasterMeshes(shadowGenerator, casters);
    await registerSceneWithShadowSupport(scene);
  }
  return Object.freeze({ camera, engine, scene });
}

function createShadowGenerator(
  engine: EngineContext,
  light: Parameters<typeof createCsmDirectionalShadowGenerator>[1],
  selectedArm: ShadowStrategyArm,
): ShadowGenerator | null {
  switch (selectedArm) {
    case "no-shadow":
      return null;
    case "pcf-2048":
      return createPcfDirectionalShadowGenerator(engine, light, {
        ...shadowConfiguration(selectedArm),
      });
    case "esm-2048":
      return createEsmDirectionalShadowGenerator(engine, light, {
        ...shadowConfiguration(selectedArm),
      });
    case "csm-4x1024":
      return createCsmDirectionalShadowGenerator(engine, light, {
        ...shadowConfiguration(selectedArm),
      });
  }
}

function applyMotion(camera: ArcRotateCamera, frame: number, frameCount: number): void {
  const progress = frame / Math.max(1, frameCount - 1);
  camera.alpha = -0.72 - progress * 1.38;
  camera.beta = 1.08 + Math.sin(progress * Math.PI) * 0.13;
  camera.radius = 34 + progress * 92;
  camera.target.x = Math.sin(progress * Math.PI * 2) * 8;
  camera.target.y = 4;
  camera.target.z = Math.cos(progress * Math.PI) * 10;
}

async function captureCheckpoint(checkpointIndex: number): Promise<ShadowStrategyCapture> {
  if (mutableApi.state !== "complete" || activeScene === null) {
    throw new Error("Shadow probe capture requested before measurement completed");
  }
  const checkpoint = CAPTURE_CHECKPOINTS[checkpointIndex];
  if (checkpoint === undefined) throw new Error("Shadow probe capture checkpoint is invalid");
  activeScene.camera.alpha = checkpoint.alpha;
  activeScene.camera.beta = checkpoint.beta;
  activeScene.camera.radius = checkpoint.radius;
  activeScene.camera.target.x = 0;
  activeScene.camera.target.y = 4;
  activeScene.camera.target.z = 0;
  renderFrame(activeScene.engine, FRAME_DELTA_MS);
  await nextAnimationFrame();
  const pending = captureScreenshot(activeScene.engine);
  // The first capture lazy-loads Babylon Lite's readback hook. Give that module one
  // animation turn to register its queued request before submitting the capture frame.
  await nextAnimationFrame();
  renderFrame(activeScene.engine, FRAME_DELTA_MS);
  const screenshot = await pending;
  return Object.freeze({
    checkpointId: checkpoint.id,
    dataBase64: bytesToBase64(screenshot.data),
    height: screenshot.height,
    width: screenshot.width,
  });
}

function sumTaskDuration(
  tasks: readonly Readonly<{ readonly durationMs: number; readonly name: string }>[],
  name: string,
): number | null {
  const matching = tasks.filter((task) => task.name === name);
  return matching.length === 0 ? null : matching.reduce((sum, task) => sum + task.durationMs, 0);
}

function configuredShadowMapTexels(selectedArm: ShadowStrategyArm): number {
  switch (selectedArm) {
    case "no-shadow":
      return 0;
    case "pcf-2048":
    case "esm-2048":
      return 2_048 ** 2;
    case "csm-4x1024":
      return 4 * 1_024 ** 2;
  }
}

function shadowConfiguration(
  selectedArm: ShadowStrategyArm,
): Readonly<Record<string, boolean | number | string>> {
  switch (selectedArm) {
    case "no-shadow":
      return Object.freeze({ technique: "none" });
    case "pcf-2048":
      return Object.freeze({
        bias: 0.000_08,
        forceRefreshEveryFrame: true,
        mapSize: 2_048,
        normalBias: 0.02,
        orthoMaxZ: 220,
        orthoMinZ: 0.25,
        technique: "directional-pcf",
      });
    case "esm-2048":
      return Object.freeze({
        bias: 0.000_2,
        blurKernel: 3,
        blurScale: 2,
        depthScale: 48,
        forceRefreshEveryFrame: true,
        frustumEdgeFalloff: 0.08,
        mapSize: 2_048,
        orthoMaxZ: 220,
        orthoMinZ: 0.25,
        technique: "directional-esm",
      });
    case "csm-4x1024":
      return Object.freeze({
        cascadeBlendPercentage: 0.12,
        forceRefreshEveryFrame: true,
        lambda: 0.7,
        mapSize: 1_024,
        numCascades: 4,
        shadowMaxZ: 180,
        stabilizeCascades: true,
        technique: "directional-csm-pcf5",
        worldSpaceBias: 0.12,
      });
  }
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function bytesToBase64(bytes: Uint8ClampedArray): string {
  const chunkSize = 32_768;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
