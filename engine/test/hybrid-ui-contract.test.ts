import { describe, expect, it } from "vitest";
import {
  freezeHybridUiPresentation,
  HYBRID_UI_HEAVY_PRIMITIVE_CAPACITY,
  HYBRID_UI_SEMANTIC_ACTION_CAPACITY,
  HYBRID_UI_WORLD_ANCHOR_CAPACITY,
  type HybridUiPresentation,
  hybridUiHeavyScreenGeometryEqual,
  hybridUiWorkerActionAllowed,
  idleHybridUiWorkerTelemetry,
  requireHybridUiWorkerInput,
  validateHybridUiWorkerAction,
  validateHybridUiWorkerTelemetry,
} from "../src/ui/hybrid-ui-contract";

describe("hybrid UI contract", () => {
  it("freezes one hybrid presentation and preserves the per-surface authority split", () => {
    const frozen = freezeHybridUiPresentation(presentation());

    expect(frozen).toMatchObject({
      dialog: { speaker: "Mara", visible: true },
      heavyScreen: { id: "inventory", semanticActions: [{ actionId: "item:1" }] },
      hud: { meters: [{ id: "health", maximum: 100, value: 80 }] },
      revision: 4,
      worldAnchors: [{ id: "anchor:gate", tone: "accent" }],
    });
    expect(Object.isFrozen(frozen.heavyScreen?.primitives[0]?.rect)).toBe(true);
    expect(Object.isFrozen(frozen.worldAnchors[0]?.position)).toBe(true);
  });

  it("enforces fixed render pools and the sparse semantic bridge", () => {
    const base = presentation();
    const screen = requireHeavyScreen(base);
    expect(() =>
      freezeHybridUiPresentation({
        ...base,
        worldAnchors: Array.from({ length: HYBRID_UI_WORLD_ANCHOR_CAPACITY + 1 }, (_, index) => ({
          id: `anchor:${index}`,
          position: [index, 1, 2] as const,
          sizeMeters: [1, 1] as const,
          tone: "neutral" as const,
          visible: true,
        })),
      }),
    ).toThrow(/world-anchor capacity/);
    expect(() =>
      freezeHybridUiPresentation({
        ...base,
        heavyScreen: {
          ...screen,
          primitives: Array.from(
            { length: HYBRID_UI_HEAVY_PRIMITIVE_CAPACITY + 1 },
            (_, index) => ({
              actionId: null,
              disabled: false,
              id: `primitive:${index}`,
              layer: index,
              rect: { height: 0.1, width: 0.1, x: 0, y: 0 },
              tone: "neutral" as const,
            }),
          ),
        },
      }),
    ).toThrow(/primitive capacity/);
    expect(() =>
      freezeHybridUiPresentation({
        ...base,
        heavyScreen: {
          ...screen,
          semanticActions: Array.from(
            { length: HYBRID_UI_SEMANTIC_ACTION_CAPACITY + 1 },
            (_, index) => ({ actionId: `item:${index}`, disabled: false, label: `Item ${index}` }),
          ),
        },
      }),
    ).toThrow(/semantic bridge capacity/);
  });

  it("rejects duplicate actions, orphaned semantics, invalid ranges, and stale-shaped input", () => {
    const base = presentation();
    const screen = requireHeavyScreen(base);
    const primitive = screen.primitives[0];
    const anchor = base.worldAnchors[0];
    if (primitive === undefined) throw new Error("Test heavy screen lacks its primitive");
    if (anchor === undefined) throw new Error("Test presentation lacks its world anchor");
    expect(() =>
      freezeHybridUiPresentation({
        ...base,
        heavyScreen: {
          ...screen,
          primitives: [primitive, { ...primitive, id: "primitive:2", layer: 1 }],
        },
      }),
    ).toThrow(/action ID .* duplicated/);
    expect(() =>
      freezeHybridUiPresentation({
        ...base,
        heavyScreen: {
          ...screen,
          semanticActions: [{ actionId: "missing", disabled: false, label: "Missing" }],
        },
      }),
    ).toThrow(/no in-canvas primitive/);
    expect(() =>
      freezeHybridUiPresentation({
        ...base,
        heavyScreen: {
          ...screen,
          primitives: [
            {
              ...primitive,
              rect: { height: 0.5, width: 0.5, x: 0.75, y: 0.75 },
            },
          ],
        },
      }),
    ).toThrow(/normalized screen space/);
    expect(() =>
      requireHybridUiWorkerInput({ kind: "pointer-activate", sequence: 0, x: 1.1, y: 0.5 }),
    ).toThrow(/normalized coordinates/);
    expect(() => requireHybridUiWorkerInput({ kind: "unknown", sequence: 1 } as never)).toThrow(
      /kind is invalid/,
    );
    expect(() =>
      freezeHybridUiPresentation({
        ...base,
        worldAnchors: [
          {
            ...anchor,
            position: [1] as unknown as readonly [number, number, number],
          },
        ],
      }),
    ).toThrow(/world-anchor position is invalid/);
  });

  it("validates worker telemetry capacity and monotonic counters", () => {
    expect(validateHybridUiWorkerTelemetry(idleHybridUiWorkerTelemetry())).toMatchObject({
      actionCount: 0,
      presentationRevision: null,
    });
    expect(() =>
      validateHybridUiWorkerTelemetry({
        ...idleHybridUiWorkerTelemetry(),
        worldAnchorCount: HYBRID_UI_WORLD_ANCHOR_CAPACITY + 1,
      }),
    ).toThrow(/telemetry is invalid/);
    expect(() =>
      validateHybridUiWorkerTelemetry({
        ...idleHybridUiWorkerTelemetry(),
        actionCount: 1,
      }),
    ).toThrow(/telemetry is invalid/);
  });

  it("validates worker actions against the active presentation authority", () => {
    const active = freezeHybridUiPresentation(presentation());
    const action = validateHybridUiWorkerAction({
      actionId: "item:1",
      inputSequence: 7,
      payload: null,
      presentationRevision: active.revision,
      source: "heavy-screen-worker",
    });
    expect(hybridUiWorkerActionAllowed(action, active)).toBe(true);
    expect(
      hybridUiWorkerActionAllowed(
        { ...action, actionId: "inventory:close", presentationRevision: active.revision },
        active,
      ),
    ).toBe(true);
    expect(hybridUiWorkerActionAllowed({ ...action, actionId: "missing" }, active)).toBe(false);
    expect(() => validateHybridUiWorkerAction({ ...action, source: "dialog-dom" })).toThrow(
      /invalid source or payload/,
    );
  });

  it("keeps semantic and visual disabled state in lockstep", () => {
    const base = presentation();
    const screen = requireHeavyScreen(base);
    expect(() =>
      freezeHybridUiPresentation({
        ...base,
        heavyScreen: {
          ...screen,
          semanticActions: [{ actionId: "item:1", disabled: true, label: "Travel satchel" }],
        },
      }),
    ).toThrow(/disabled state differs/);
  });

  it("keeps visual layering ordered and cancel authority disjoint", () => {
    const base = presentation();
    const screen = requireHeavyScreen(base);
    const primitive = screen.primitives[0];
    if (primitive === undefined) throw new Error("Test heavy screen lacks its primitive");
    expect(() =>
      freezeHybridUiPresentation({
        ...base,
        heavyScreen: {
          ...screen,
          primitives: [
            { ...primitive, actionId: null, layer: 2 },
            { ...primitive, id: "primitive:2", layer: 1 },
          ],
        },
      }),
    ).toThrow(/layers must be strictly increasing/);
    expect(() =>
      freezeHybridUiPresentation({
        ...base,
        heavyScreen: {
          ...screen,
          primitives: [
            { ...primitive, actionId: null },
            { ...primitive, actionId: null, id: "primitive:2" },
          ],
          semanticActions: [],
        },
      }),
    ).toThrow(/layers must be strictly increasing/);
    expect(() =>
      freezeHybridUiPresentation({
        ...base,
        heavyScreen: { ...screen, cancelActionId: "item:1" },
      }),
    ).toThrow(/cancel action must be distinct/);
    expect(() =>
      freezeHybridUiPresentation({
        ...base,
        dialog: {
          ...base.dialog,
          choices: [
            { actionId: "dialog:submit", disabled: false, id: "choice:1", label: "Submit" },
          ],
          textEntry: { label: "Name", submitActionId: "dialog:submit", value: "" },
        },
      }),
    ).toThrow(/text-entry action must be distinct/);
    expect(hybridUiHeavyScreenGeometryEqual(screen, { ...screen, id: "journal" })).toBe(false);
  });
});

function requireHeavyScreen(
  value: HybridUiPresentation,
): NonNullable<HybridUiPresentation["heavyScreen"]> {
  if (value.heavyScreen === null) throw new Error("Test presentation lacks its heavy screen");
  return value.heavyScreen;
}

function presentation(): HybridUiPresentation {
  return {
    dialog: {
      body: "The east road is secure.",
      choices: [
        { actionId: "dialog:continue", disabled: false, id: "continue", label: "Continue" },
      ],
      speaker: "Mara",
      textEntry: null,
      visible: true,
    },
    heavyScreen: {
      cancelActionId: "inventory:close",
      focusActionId: "item:1",
      id: "inventory",
      primitives: [
        {
          actionId: "item:1",
          disabled: false,
          id: "primitive:1",
          layer: 0,
          rect: { height: 0.2, width: 0.2, x: 0.1, y: 0.1 },
          tone: "neutral",
        },
      ],
      semanticActions: [{ actionId: "item:1", disabled: false, label: "Travel satchel" }],
      textEntry: null,
      visible: true,
    },
    hud: {
      meters: [{ id: "health", label: "Health", maximum: 100, value: 80 }],
      messages: ["East road"],
      visible: true,
    },
    revision: 4,
    worldAnchors: [
      {
        id: "anchor:gate",
        position: [1, 2, 3],
        sizeMeters: [0.5, 0.5],
        tone: "accent",
        visible: true,
      },
    ],
  };
}
