import type {
  SimulationCommand,
  SimulationSemanticEvent,
  SimulationService,
} from "@parallax/engine";
import { simulationWorldDefinition } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import type { M3GameplayCommandFactory, M3GameplayRuntime } from "../src/sim/m3-gameplay-runtime";
import { createGameSimulationAdapter } from "../src/sim/m3-simulation";
import { createM3GameplayUiController } from "../src/ui/m3-gameplay-ui";
import { createM3HybridUiModel } from "../src/ui/m3-hybrid-ui";
import { DISTRICT_1_GREYBOX_SPEC } from "../src/world/district-1.data";
import { createGreyboxScene } from "../src/world/greybox-generator";

describe("M3.5 gameplay UI controller", () => {
  it("queries authoritative screens and turns worker actions into simulation commands", async () => {
    const world = simulationWorldDefinition(createGreyboxScene(DISTRICT_1_GREYBOX_SPEC).world);
    const adapter = createGameSimulationAdapter({ timestepHz: 60, world });
    const state = adapter.createInitialState(17);
    const queryState = adapter.queryState;
    if (queryState === undefined) throw new Error("Game-state query boundary is missing");
    let eventListener: ((events: readonly SimulationSemanticEvent[]) => void) | null = null;
    let telemetryListener: Parameters<SimulationService["subscribe"]>[0] | null = null;
    const telemetry = {
      gameCounters: adapter.telemetryCounters(state),
      loadCount: 0,
      state: "running" as const,
    } as ReturnType<SimulationService["snapshot"]>;
    const simulation = {
      queryGameState: async (query: Parameters<SimulationService["queryGameState"]>[0]) => ({
        payload: queryState(state, query),
        tick: 0,
      }),
      snapshot: () => telemetry,
      subscribe: (listener: Parameters<SimulationService["subscribe"]>[0]) => {
        telemetryListener = listener;
        listener(telemetry);
        return () => undefined;
      },
      subscribeAuthorityChanges: () => () => undefined,
      subscribeEvents: (listener: (events: readonly SimulationSemanticEvent[]) => void) => {
        eventListener = listener;
        return () => undefined;
      },
    } as unknown as SimulationService;
    const factories: M3GameplayCommandFactory[] = [];
    const gameplay = {
      enqueueCommand: (factory: M3GameplayCommandFactory) => factories.push(factory),
    } as unknown as M3GameplayRuntime;
    const model = createM3HybridUiModel(world);
    const controller = createM3GameplayUiController(simulation, gameplay, model);
    const presentations: ReturnType<typeof model.snapshot>[] = [];
    controller.subscribePresentations((presentation) => presentations.push(presentation));

    expect(controller.handleShortcut("KeyJ")).toBe(true);
    await expect
      .poll(() =>
        model
          .snapshot()
          .heavyScreen?.semanticActions.some(({ actionId }) =>
            actionId.startsWith("journal:accept:"),
          ),
      )
      .toBe(true);
    const journal = model.snapshot();
    const accept = journal.heavyScreen?.semanticActions.find(({ actionId }) =>
      actionId.startsWith("journal:accept:"),
    );
    if (accept === undefined) throw new Error("Journal did not expose an available quest");
    controller.handleAction({
      actionId: accept.actionId,
      inputSequence: 0,
      payload: null,
      presentationRevision: journal.revision,
      source: "heavy-screen-worker",
    });
    expect(factories).toHaveLength(1);
    const command = factories[0]?.(5, 9) as SimulationCommand;
    expect(command).toMatchObject({ kind: "quests.command@1", sequence: 5, targetTick: 9 });

    // A HUD-only telemetry update bumps the presentation revision mid-flight; an
    // action pinned to the pre-churn revision must still reach the simulation.
    const revisionBeforeChurn = model.snapshot().revision;
    const publishTelemetry = telemetryListener as
      | Parameters<SimulationService["subscribe"]>[0]
      | null;
    if (publishTelemetry === null) throw new Error("Telemetry subscription is missing");
    publishTelemetry({
      ...telemetry,
      gameCounters: { ...telemetry.gameCounters, combatPlayerStamina: 1 },
    });
    expect(model.snapshot().revision).toBeGreaterThan(revisionBeforeChurn);
    controller.handleAction({
      actionId: accept.actionId,
      inputSequence: 1,
      payload: null,
      presentationRevision: revisionBeforeChurn,
      source: "heavy-screen-worker",
    });
    expect(factories).toHaveLength(2);

    const publishEvents = eventListener as
      | ((events: readonly SimulationSemanticEvent[]) => void)
      | null;
    if (publishEvents === null) throw new Error("Semantic event subscription is missing");
    const payload = new Uint8Array(16);
    new DataView(payload.buffer).setUint32(0, 3, true);
    publishEvents([{ kind: "progression.level-up-payoff", payload, sequence: 1, tick: 10 }]);
    expect(model.snapshot().hud.messages).toContain(
      "LEVEL 3 · stamina and aether restored · health unchanged",
    );
    expect(presentations.length).toBeGreaterThan(2);
    controller.dispose();
  });
});
