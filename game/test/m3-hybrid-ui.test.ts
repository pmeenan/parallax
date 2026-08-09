import type { SimulationWorldDefinition } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { createM3HybridUiModel } from "../src/ui/m3-hybrid-ui";

describe("M3 hybrid UI model", () => {
  it("authors DOM HUD copy and render-worker transition anchors without platform access", () => {
    const model = createM3HybridUiModel(world());
    const initial = model.snapshot();

    expect(initial.revision).toBe(0);
    expect(initial.hud.messages).toEqual(["WASD to move · mouse to look · E to interact"]);
    expect(initial.worldAnchors).toEqual([
      {
        id: "transition-anchor:gate",
        position: [4, 5.25, 6],
        sizeMeters: [0.45, 0.45],
        tone: "accent",
        visible: true,
      },
    ]);

    expect(model.recordInteraction("gate")).toMatchObject({
      hud: { messages: [expect.any(String), "Activated gate"] },
      revision: 1,
    });
  });
});

function world(): SimulationWorldDefinition {
  return {
    bounds: { maximum: [10, 10, 10], minimum: [-10, -10, -10] },
    cells: [],
    cellSizeMeters: 64,
    markers: [
      { id: "gate", kind: "transition", position: [4, 3, 6], tags: [] },
      { id: "vista", kind: "vista", position: [1, 2, 3], tags: [] },
    ],
  };
}
