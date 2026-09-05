import { createArcRotateCamera, type Mesh } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
// The pinned Lite draw-list cache observes this epoch. Its internal JS has no
// declarations; inspecting it here verifies cache invalidation, not just mesh flags.
// @ts-expect-error Test-only inspection of the pinned dependency's untyped cache epoch.
import { _vis as visibilityEpoch } from "../node_modules/@babylonjs/lite/lib/engine/engine.js";
import type { FlythroughScenarioSample } from "../src/flythrough/flythrough-contract";
import {
  applyFlythroughSample,
  applyGameplayPresentation,
  type LiteGreyboxWorld,
} from "../src/render/lite-greybox-world";

function mesh(visible: boolean): Mesh {
  // These presentation operations need only visibility and transform state, no GPU.
  return { visible, children: [], position: { set() {} }, rotation: { y: 0 } } as unknown as Mesh;
}

describe("greybox presentation draw-list invalidation", () => {
  it("invalidates cached preview/crowd draws at handoff and on gameplay resumption", () => {
    const player = mesh(true);
    const crowd = [mesh(true), mesh(true)];
    const preview = mesh(true);
    const streamed = mesh(false);
    const renderer = {
      camera: createArcRotateCamera(0, 1, 9, { x: 0, y: 0, z: 0 }),
      crowdMeshes: crowd,
      playerMesh: player,
      presentationOwner: "preview",
      previewMeshes: [preview],
      streamingCells: new Map([["cell", { meshes: [streamed] }]]),
    } as unknown as LiteGreyboxWorld;
    const sample: FlythroughScenarioSample = {
      observer: [0, 12, -1200],
      headingRadians: 0,
      distanceMeters: 600,
      elapsedMs: 50000,
      progress: 1 / 12,
      environment: {
        id: "clear-daylight-start",
        startMs: 0,
        endMs: 100000,
        timeOfDay: "daylight",
        timeOfDayPhase: 0.25,
        weather: "clear",
      },
    };
    const camera = { beta: Math.PI / 3, heightMeters: 28, radiusMeters: 120 };
    const before = visibilityEpoch;
    applyFlythroughSample(renderer, sample, camera);
    expect(visibilityEpoch).toBeGreaterThan(before);
    expect([player.visible, ...crowd.map((entry) => entry.visible), preview.visible]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(streamed.visible).toBe(true);
    const afterHandoff = visibilityEpoch;
    applyFlythroughSample(renderer, sample, camera);
    expect(visibilityEpoch).toBe(afterHandoff);

    applyGameplayPresentation(renderer, {
      cameraPitchRadians: 0,
      crowdEntities: [{ id: 1, position: [0, 0, 0], yawRadians: 0 }],
      playerPosition: [0, 0, 0],
      playerYawRadians: 0,
    });
    expect(visibilityEpoch).toBeGreaterThan(afterHandoff);
    expect([player.visible, ...crowd.map((entry) => entry.visible), preview.visible]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
