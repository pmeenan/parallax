import type { SimulationWorldDefinition } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { createM3HybridUiModel } from "../src/ui/m3-hybrid-ui";

describe("M3 hybrid UI model", () => {
  it("authors DOM HUD copy and render-worker transition anchors without platform access", () => {
    const model = createM3HybridUiModel(world());
    const initial = model.snapshot();

    expect(initial.revision).toBe(0);
    expect(initial.hud.messages).toEqual([
      "WASD move · mouse look · E interact · I inventory/craft · P progression · J journal",
    ]);
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
    expect(
      model.showDialog({
        body: "The road is quiet.",
        choices: [],
        speaker: "Mara Venn",
        textEntry: null,
        visible: true,
      }),
    ).toMatchObject({ dialog: { speaker: "Mara Venn", visible: true }, revision: 2 });
    expect(model.closeDialog()).toMatchObject({ dialog: { visible: false }, revision: 3 });
  });

  it("presents progression feel in the DOM HUD and worker-owned heavy screen", () => {
    const model = createM3HybridUiModel(world());
    const hud = model.updateHud({
      aether: 20,
      experienceForNextLevel: 200,
      experienceIntoLevel: 75,
      health: 70,
      ironsetTicks: 120,
      level: 2,
      levelCap: 10,
      maxAether: 40,
      maxHealth: 80,
      maxStamina: 100,
      stamina: 60,
      unspentAbilityPicks: 1,
      unspentAttributePoints: 1,
    });
    expect(hud?.hud.meters.map((meter) => meter.id)).toEqual([
      "health",
      "stamina",
      "aether",
      "experience",
      "ironset",
    ]);
    expect(hud?.hud.messages).toContain("UNSPENT · 1 attribute · 1 ability");
    expect(hud?.hud.messages).toContain(
      "IRONSET PLANTED · +4 guard · stagger immune · ×1/2 movement",
    );
    expect(hud?.hud.meters.find((meter) => meter.id === "ironset")).toMatchObject({
      maximum: 240,
      value: 120,
    });

    const screen = model.showScreen({
      actions: Object.freeze([
        Object.freeze({
          actionId: "progression:spend:might",
          disabled: false,
          label: "Raise Might",
        }),
      ]),
      id: "progression",
      lines: Object.freeze(["All slots available from level 2."]),
    });
    expect(screen.heavyScreen).toMatchObject({
      cancelActionId: "screen:close",
      focusActionId: "progression:spend:might",
      id: "progression",
      visible: true,
    });
    expect(screen.hud.messages).toContain("All slots available from level 2.");
    expect(model.closeScreen().heavyScreen).toBeNull();
  });
});

function world(): SimulationWorldDefinition {
  return {
    bounds: { maximum: [10, 10, 10], minimum: [-10, -10, -10] },
    cells: [],
    cellSizeMeters: 64,
    id: "test-district",
    markers: [
      { id: "gate", kind: "transition", position: [4, 3, 6], tags: [] },
      { id: "vista", kind: "vista", position: [1, 2, 3], tags: [] },
    ],
  };
}
