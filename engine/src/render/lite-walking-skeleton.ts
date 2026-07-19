import {
  addToScene,
  createArcRotateCamera,
  createBox,
  createEngine,
  createHemisphericLight,
  createSceneContext,
  createStandardMaterial,
  registerScene,
  renderFrame,
  setEngineSize,
} from "@babylonjs/lite";
import type { WalkingSkeletonScene } from "./render-protocol";

export async function createLiteWalkingSkeleton(
  canvas: OffscreenCanvas,
  width: number,
  height: number,
  config: WalkingSkeletonScene,
) {
  const engine = await createEngine(canvas, { msaaSamples: 4 });
  setEngineSize(engine, width, height);
  const scene = createSceneContext(engine);
  scene.clearColor = {
    a: config.clearColor[3],
    b: config.clearColor[2],
    g: config.clearColor[1],
    r: config.clearColor[0],
  };

  const camera = createArcRotateCamera(
    config.camera.alpha,
    config.camera.beta,
    config.camera.radius,
    {
      x: config.camera.target[0],
      y: config.camera.target[1],
      z: config.camera.target[2],
    },
  );
  camera.nearPlane = config.camera.minZ;
  scene.camera = camera;
  addToScene(
    scene,
    createHemisphericLight(
      [config.lightDirection[0], config.lightDirection[1], config.lightDirection[2]],
      1,
    ),
  );

  const box = createBox(engine, config.meshSize);
  const material = createStandardMaterial();
  material.diffuseColor = [config.meshColor[0], config.meshColor[1], config.meshColor[2]];
  box.material = material;
  addToScene(scene, box);
  await registerScene(scene);

  return {
    animationStartedAt: null as number | null,
    box,
    config,
    engine,
    previousTimestamp: null as number | null,
  };
}

export type LiteWalkingSkeleton = Awaited<ReturnType<typeof createLiteWalkingSkeleton>>;

export function renderLiteWalkingSkeleton(renderer: LiteWalkingSkeleton, timestamp: number): void {
  renderer.animationStartedAt ??= timestamp;
  const animationSeconds = (timestamp - renderer.animationStartedAt) / 1_000;
  renderer.box.rotation.x = animationSeconds * renderer.config.rotationRadiansPerSecond[0];
  renderer.box.rotation.y = animationSeconds * renderer.config.rotationRadiansPerSecond[1];
  renderFrame(
    renderer.engine,
    renderer.previousTimestamp === null ? 0 : timestamp - renderer.previousTimestamp,
  );
  renderer.previousTimestamp = timestamp;
}

export function resizeLiteWalkingSkeleton(
  renderer: LiteWalkingSkeleton,
  width: number,
  height: number,
): void {
  setEngineSize(renderer.engine, width, height);
}
