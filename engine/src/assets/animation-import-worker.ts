import {
  addToScene,
  captureScreenshot,
  createArcRotateCamera,
  createEngine,
  createHemisphericLight,
  createSceneContext,
  disposeEngine,
  disposeScene,
  getContainerMeshes,
  goToFrame,
  playAnimation,
  registerScene,
  renderFrame,
  stopAnimation,
} from "@babylonjs/lite";
import { type AnimationImportExpectation, importAnimationForQa } from "./lite-animation-import";

export interface AnimationImportWorkerRequest {
  readonly bytes: ArrayBuffer;
  readonly expected: AnimationImportExpectation;
  readonly camera: { readonly target: readonly [number, number, number]; readonly radius: number };
}

// Separate QA entry point, not a game worker or a loader for source files during gameplay.
self.onmessage = (event: MessageEvent<AnimationImportWorkerRequest>): void => {
  void run(event.data).catch((error: unknown) => {
    self.postMessage({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

async function run(request: AnimationImportWorkerRequest): Promise<void> {
  const engine = await createEngine(new OffscreenCanvas(256, 256));
  const scene = createSceneContext(engine);
  try {
    const { bytes, expected, camera } = request;
    const { container, importDurationMs } = await importAnimationForQa(engine, bytes, expected);
    scene.clearColor = { r: 0, g: 0, b: 0, a: 1 };
    scene.camera = createArcRotateCamera(Math.PI / 2, Math.PI / 2, camera.radius, {
      x: camera.target[0],
      y: camera.target[1],
      z: camera.target[2],
    });
    scene.camera.nearPlane = Math.min(0.01, camera.radius / 10);
    scene.camera.farPlane = Math.max(100, camera.radius * 10);
    addToScene(scene, createHemisphericLight([0, 1, 0], 1));
    addToScene(scene, container);
    await registerScene(scene);
    const frames: {
      clip: string;
      sample: number;
      timeSeconds: number;
      rgba: ArrayBuffer;
      width: number;
      height: number;
    }[] = [];
    for (const group of container.animationGroups ?? []) {
      for (const other of container.animationGroups ?? []) {
        stopAnimation(other);
        other.weight = 0;
      }
      group.weight = 1;
      group.loopAnimation = false;
      playAnimation(group);
      for (const sample of [0, 0.25, 0.5, 1]) {
        const time = group.duration * sample;
        goToFrame(group, time * (group.frameRate ?? 60), engine);
        let settled = false;
        const capture = captureScreenshot(engine).finally(() => {
          settled = true;
        });
        // Lite lazily installs its capture service. Service it through normal frames
        // with frozen animation time while its module import/GPU readback settles.
        for (let frame = 0; !settled && frame < 120; frame++) {
          renderFrame(engine, 0);
          await new Promise<void>((resolve) => setTimeout(resolve, 16));
        }
        if (!settled) throw new Error(`Capture timed out for ${group.name} at ${time}s`);
        const image = await capture;
        if (Math.abs(group.currentTime - time) > 0.00001)
          throw new Error("Clip seek did not reach the requested time");
        const rgba = new Uint8Array(image.data).buffer;
        frames.push({
          clip: group.name,
          sample,
          timeSeconds: group.currentTime,
          rgba,
          width: image.width,
          height: image.height,
        });
      }
    }
    self.postMessage(
      {
        status: "passed",
        importDurationMs,
        meshes: getContainerMeshes(container).length,
        joints: container.skeletons?.flatMap((skeleton) => skeleton.bones.map((bone) => bone.name)),
        frames,
      },
      { transfer: frames.map((frame) => frame.rgba) },
    );
  } catch (error: unknown) {
    self.postMessage({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    disposeScene(scene);
    disposeEngine(engine);
  }
}
