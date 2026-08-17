import { simulationWorldDefinition } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { monsterKitIndex } from "../src/balance/combat";
import { itemIndex, RECIPES, recipeIndex } from "../src/balance/items";
import { SCRIPTED_SLICE_XP_LEDGER } from "../src/balance/progression";
import {
  QUEST_CAPACITY,
  QUEST_DEFINITIONS,
  QUEST_INTENTS,
  QUEST_JOURNAL_CAPACITY,
  QUEST_OBJECTIVE_CAPACITY,
  QUEST_RULES_VERSION,
  questIndex,
  questIntentIndex,
  questObjectiveCount,
} from "../src/balance/quests";
import { addItemStack, dropMaterialSatchel, removeItemStack } from "../src/sim/items";
import {
  createAcceptQuestCommand,
  createGameSimulationAdapter,
  createJournalSnapshotQuery,
  createQuestIntentCommand,
  createQuestSnapshotQuery,
  createRecoverSatchelCommand,
} from "../src/sim/m3-simulation";
import {
  applyQuestSemanticEvents,
  createInitialQuestState,
  deserializeQuestState,
  QUEST_JOURNAL_ENTRY_BYTES,
  QUEST_STATE_BYTES,
  serializeQuestState,
} from "../src/sim/quests";
import { DISTRICT_1_GREYBOX_SPEC } from "../src/world/district-1.data";
import { createGreyboxScene } from "../src/world/greybox-generator";
import { NAMED_LANDMARKS } from "../src/world/landmarks";

const world = simulationWorldDefinition(createGreyboxScene(DISTRICT_1_GREYBOX_SPEC).world);
const context = Object.freeze({ timestepHz: 60, world });

describe("M3.5 quests and journal", () => {
  it("defines the six-stage main arc and eight system-tagged side quests as stable data", () => {
    expect(QUEST_DEFINITIONS).toHaveLength(9);
    expect(QUEST_DEFINITIONS[0]).toMatchObject({
      id: "the-undercroft-stirs",
      kind: "main",
    });
    expect(QUEST_DEFINITIONS[0]?.stages).toHaveLength(6);
    expect(QUEST_DEFINITIONS.slice(1)).toHaveLength(8);
    expect(new Set(QUEST_DEFINITIONS.slice(1).map(({ systemTag }) => systemTag)).size).toBe(8);
    expect(questObjectiveCount()).toBeLessThanOrEqual(QUEST_OBJECTIVE_CAPACITY);
    expect(new Set(QUEST_INTENTS.map(({ id }) => id)).size).toBe(QUEST_INTENTS.length);
    const questExperience = (kind: "main" | "side") =>
      QUEST_DEFINITIONS.filter((definition) => definition.kind === kind).reduce(
        (questTotal, definition) =>
          questTotal +
          definition.stages.reduce((stageTotal, stage) => stageTotal + stage.experience, 0),
        0,
      );
    expect(questExperience("main")).toBe(SCRIPTED_SLICE_XP_LEDGER.mainArc);
    expect(questExperience("side")).toBe(SCRIPTED_SLICE_XP_LEDGER.sideQuests);
    expect(
      RECIPES[recipeIndex("resonant-focus")]?.ingredients.map(({ itemId }) => itemId),
    ).not.toContain("mythic-catalyst-core");
  });

  it("accepts a side quest, advances it from landmark events, awards XP, and journals it", () => {
    const adapter = createGameSimulationAdapter(context);
    let state = adapter.step(adapter.createInitialState(17), 1).state;
    const accepted = adapter.applyCommand(
      state,
      createAcceptQuestCommand(0, 2, "the-painter-of-the-vista"),
    );
    state = accepted.state;
    expect(accepted.events.map(({ kind }) => kind)).toEqual([
      "quest.intent-validated",
      "quest.accepted",
      "quest.objective-progressed",
    ]);

    for (const [tick, position] of [
      [3, [0, 2, 768]],
      [4, [640, 2, 1_280]],
    ] as const) {
      const result = adapter.step(
        Object.freeze({ ...state, playerPosition: Object.freeze(position) }),
        tick,
      );
      state = result.state;
      if (tick === 4) {
        expect(result.events.map(({ kind }) => kind)).toEqual(
          expect.arrayContaining([
            "landmark.discovered",
            "quest.objective-progressed",
            "quest.stage-completed",
            "quest.completed",
            "progression.experience-gained",
          ]),
        );
      }
    }

    expect(adapter.telemetryCounters(state)).toMatchObject({
      questAcceptedCount: 1,
      questActiveCount: 0,
      questCompletedCount: 1,
      questNominalExperienceAwarded: 100,
      questStageCompletionCount: 1,
    });
    const questPayload = adapter.queryState?.(state, createQuestSnapshotQuery());
    if (questPayload === undefined) throw new Error("Quest query is unavailable");
    const snapshot = JSON.parse(new TextDecoder().decode(questPayload)) as Readonly<{
      readonly quests: readonly Readonly<{ readonly id: string; readonly status: string }>[];
      readonly version: number;
    }>;
    expect(snapshot.version).toBe(1);
    expect(snapshot.quests.find(({ id }) => id === "the-painter-of-the-vista")?.status).toBe(
      "completed",
    );

    const journalPayload = adapter.queryState?.(state, createJournalSnapshotQuery(0, 64));
    if (journalPayload === undefined) throw new Error("Journal query is unavailable");
    const journal = JSON.parse(new TextDecoder().decode(journalPayload)) as Readonly<{
      readonly entries: readonly Readonly<{
        readonly localizationKey: string;
        readonly sequence: number;
      }>[];
      readonly nextSequence: number;
      readonly totalEntries: number;
    }>;
    expect(journal.entries.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: journal.entries.length }, (_, index) => index),
    );
    expect(journal.entries.map(({ localizationKey }) => localizationKey)).toEqual(
      expect.arrayContaining([
        "journal.landmark.discovered",
        "journal.quest.accepted",
        "journal.quest.objective-progressed",
        "journal.quest.stage-completed",
        "journal.quest.completed",
      ]),
    );
    expect(journal.nextSequence).toBe(journal.totalEntries);
  });

  it("uses validated delivery intents to consume authored costs and complete a quest", () => {
    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(19);
    const suppliedItems = addItemStack(addItemStack(initial.items, "grain", 4), "bittergreen", 2);
    const supplied = Object.freeze({ ...initial, items: suppliedItems });
    const accepted = adapter.applyCommand(supplied, createAcceptQuestCommand(0, 1, "first-fruits"));
    expect(accepted.events.map(({ kind }) => kind)).toEqual([
      "quest.intent-validated",
      "quest.accepted",
      "quest.objective-progressed",
      "quest.objective-progressed",
    ]);
    const completed = adapter.applyCommand(
      accepted.state,
      createQuestIntentCommand(1, 2, "deliver-first-fruits"),
    );
    expect(completed.events.map(({ kind }) => kind)).toEqual([
      "quest.intent-validated",
      "quest.objective-progressed",
      "quest.stage-completed",
      "quest.completed",
      "progression.experience-gained",
    ]);
    expect(completed.state.items.stackCounts[0]).toBe(0);
    expect(completed.state.items.stackCounts[1]).toBe(0);
    expect(completed.state.progression.experience - initial.progression.experience).toBe(100);

    const rejected = adapter.applyCommand(
      supplied,
      createQuestIntentCommand(2, 3, "deliver-first-fruits"),
    );
    expect(rejected.events[0]?.kind).toBe("quest.intent-rejected");
    expect(rejected.state).toBe(supplied);
  });

  it("round-trips the fixed quest block and rejects rules, mask, and reserved-byte drift", () => {
    const adapter = createGameSimulationAdapter(context);
    const stepped = adapter.step(adapter.createInitialState(23), 1).state;
    const accepted = adapter.applyCommand(
      stepped,
      createAcceptQuestCommand(0, 2, "a-bounty-of-teeth"),
    ).state;
    const bytes = new Uint8Array(QUEST_STATE_BYTES);
    serializeQuestState(new DataView(bytes.buffer), 0, accepted.quests);
    expect(deserializeQuestState(new DataView(bytes.buffer), 0)).toEqual(accepted.quests);

    const view = new DataView(bytes.buffer);
    view.setUint32(40, QUEST_RULES_VERSION + 1, true);
    expect(() => deserializeQuestState(view, 0)).toThrow(/unsupported rules version/);
    view.setUint32(40, QUEST_RULES_VERSION, true);
    view.setUint32(44, 1, true);
    expect(() => deserializeQuestState(view, 0)).toThrow(/reserved bytes/);
    view.setUint32(44, 0, true);
    view.setUint32(0, 1 << QUEST_DEFINITIONS.length, true);
    expect(() => deserializeQuestState(view, 0)).toThrow(/quest state is invalid/i);

    serializeQuestState(view, 0, accepted.quests);
    const journalOffset = QUEST_STATE_BYTES - QUEST_JOURNAL_CAPACITY * QUEST_JOURNAL_ENTRY_BYTES;
    view.setUint32(journalOffset + 28, 26, true);
    expect(() => deserializeQuestState(view, 0)).toThrow(/landmark journal entry is invalid/i);

    expect(() =>
      adapter.serializeState(
        Object.freeze({
          ...accepted,
          exploration: Object.freeze({
            discoveredLandmarkCount: 0,
            discoveredLandmarkMask: 0,
            landmarkNominalExperienceAwarded: 0,
          }),
        }),
      ),
    ).toThrow(/journal disagrees with exploration/i);
  });

  it("reduces only semantic events and persists deterministic preparation flags", () => {
    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(29);
    const mainIndex = questIndex("the-undercroft-stirs");
    let questState = createInitialQuestState();
    const exploration = Object.freeze({
      discoveredLandmarkCount: 2,
      discoveredLandmarkMask: (1 << 3) | (1 << 5),
      landmarkNominalExperienceAwarded: 50,
    });
    const items = addItemStack(addItemStack(initial.items, "grain", 1), "relic-fragment", 1);
    const reduce = (
      events: readonly ReturnType<typeof semanticEvent>[],
      tick: number,
    ): ReturnType<typeof applyQuestSemanticEvents> => {
      const reduced = applyQuestSemanticEvents(questState, events, {
        exploration,
        items,
        tick,
      });
      questState = reduced.state;
      return reduced;
    };
    reduce(
      [
        semanticEvent([3, 25, 0, 0], "landmark.discovered"),
        semanticEvent([5, 25, 0, 0], "landmark.discovered"),
        semanticEvent([1, mainIndex, 0, 0], "quest.intent-validated"),
      ],
      1,
    );
    reduce(
      [
        semanticEvent(
          [2, mainIndex, questIntentIndex("report-field-signs"), 0],
          "quest.intent-validated",
        ),
      ],
      2,
    );
    reduce(
      Array.from({ length: 4 }, () =>
        semanticEvent([100, monsterKitIndex("skitterling"), 4, 0], "combat.monster-defeated"),
      ),
      3,
    );
    reduce(
      [
        semanticEvent([101, monsterKitIndex("hollow-warden"), 60, 0], "combat.monster-defeated"),
        semanticEvent([101, 0, 0, 60], "loot.awarded"),
      ],
      4,
    );
    reduce(
      [
        semanticEvent([2, recipeIndex("clearing-draught"), 0, 1], "items.crafted"),
        semanticEvent([2, recipeIndex("resonant-focus"), 0, 1], "items.crafted"),
      ],
      5,
    );
    const prepared = adapter.applyCommand(
      Object.freeze({ ...initial, exploration, quests: questState }),
      createQuestIntentCommand(0, 33, "parley-forest-brigands"),
    );
    expect(prepared.events.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        "quest.intent-validated",
        "quest.preparation-changed",
        "quest.objective-progressed",
        "quest.stage-completed",
        "creature.behavior-changed",
        "progression.experience-gained",
      ]),
    );
    expect(prepared.state.quests.preparationFlags).not.toBe(0);
    expect(prepared.state.quests.questStageIndexes[mainIndex]).toBe(5);
    expect(
      prepared.state.combat.monsters.find(
        ({ kitIndex }) => kitIndex === monsterKitIndex("wayland-brigand"),
      )?.behaviorMode,
    ).toBe(5);
  });

  it("reconciles collect objectives after satchel recovery so delivery completes the stage", () => {
    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(37);
    const satchelPosition = initial.playerPosition.map((value) => Math.fround(value)) as [
      number,
      number,
      number,
    ];
    const dropped = dropMaterialSatchel(
      addItemStack(initial.items, "relic-fragment", 4),
      satchelPosition,
    );
    expect(dropped.satchelActive).toBe(true);
    const accepted = adapter.applyCommand(
      Object.freeze({ ...initial, items: dropped }),
      createAcceptQuestCommand(0, 1, "relics-for-the-reliquary"),
    );
    // Accepting with the relics still in the satchel bootstraps nothing.
    expect(accepted.events.map(({ kind }) => kind)).toEqual([
      "quest.intent-validated",
      "quest.accepted",
    ]);
    const recovered = adapter.applyCommand(accepted.state, createRecoverSatchelCommand(1, 2));
    expect(recovered.events.map(({ kind }) => kind)).toEqual([
      "items.satchel-recovered",
      "quest.objective-progressed",
    ]);
    const relicIndex = itemIndex("relic-fragment");
    expect(recovered.state.items.stackCounts[relicIndex]).toBe(4);
    const delivered = adapter.applyCommand(
      recovered.state,
      createQuestIntentCommand(2, 3, "deliver-reliquary-relics"),
    );
    expect(delivered.events.map(({ kind }) => kind)).toEqual([
      "quest.intent-validated",
      "quest.objective-progressed",
      "quest.stage-completed",
      "quest.completed",
      "quest.preparation-changed",
      "progression.experience-gained",
    ]);
    expect(delivered.state.items.stackCounts[relicIndex]).toBe(0);
    expect(delivered.state.quests.completedQuestMask).toBe(
      1 << questIndex("relics-for-the-reliquary"),
    );
  });

  it("rejects a repeated preparation intent instead of consuming another delivery", () => {
    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(39);
    const mainIndex = questIndex("the-undercroft-stirs");
    const landmarkIndex = (id: string) =>
      NAMED_LANDMARKS.findIndex((landmark) => landmark.id === id);
    const forestThroat = landmarkIndex("forest-throat");
    const castleUndercroft = landmarkIndex("castle-undercroft");
    const landmarkExperience = (index: number) => NAMED_LANDMARKS[index]?.experience ?? 0;
    const exploration = Object.freeze({
      discoveredLandmarkCount: 2,
      discoveredLandmarkMask: ((1 << forestThroat) | (1 << castleUndercroft)) >>> 0,
      landmarkNominalExperienceAwarded:
        landmarkExperience(forestThroat) + landmarkExperience(castleUndercroft),
    });
    const items = addItemStack(
      addItemStack(addItemStack(initial.items, "grain", 1), "relic-fragment", 1),
      "clearing-draught",
      2,
    );
    let questState = createInitialQuestState();
    const reduce = (events: readonly ReturnType<typeof semanticEvent>[], tick: number) => {
      questState = applyQuestSemanticEvents(questState, events, { exploration, items, tick }).state;
    };
    reduce(
      [
        semanticEvent(
          [forestThroat, landmarkExperience(forestThroat), 0, 0],
          "landmark.discovered",
        ),
        semanticEvent(
          [castleUndercroft, landmarkExperience(castleUndercroft), 0, 0],
          "landmark.discovered",
        ),
        semanticEvent([1, mainIndex, 0, 0], "quest.intent-validated"),
        semanticEvent(
          [2, mainIndex, questIntentIndex("report-field-signs"), 0],
          "quest.intent-validated",
        ),
      ],
      1,
    );
    reduce(
      Array.from({ length: 4 }, () =>
        semanticEvent([100, monsterKitIndex("skitterling"), 4, 0], "combat.monster-defeated"),
      ),
      2,
    );
    reduce(
      [semanticEvent([101, monsterKitIndex("hollow-warden"), 60, 0], "combat.monster-defeated")],
      3,
    );
    expect(questState.questStageIndexes[mainIndex]).toBe(3);
    const state = Object.freeze({ ...initial, exploration, items, quests: questState });
    const draughtIndex = itemIndex("clearing-draught");
    const doused = adapter.applyCommand(state, createQuestIntentCommand(0, 10, "douse-boss-vents"));
    expect(doused.events.map(({ kind }) => kind)).toEqual([
      "quest.intent-validated",
      "quest.preparation-changed",
    ]);
    expect(doused.state.items.stackCounts[draughtIndex]).toBe(1);
    expect(doused.state.quests.preparationFlags).toBe(1);
    const repeated = adapter.applyCommand(
      doused.state,
      createQuestIntentCommand(1, 11, "douse-boss-vents"),
    );
    expect(repeated.events.map(({ kind }) => kind)).toEqual(["quest.intent-rejected"]);
    expect(repeated.state).toBe(doused.state);
    expect(repeated.state.items.stackCounts[draughtIndex]).toBe(1);
  });

  it("leaves quest state untouched on ticks without quest source events", () => {
    const adapter = createGameSimulationAdapter(context);
    const settled = adapter.step(adapter.createInitialState(51), 1).state;
    const accepted = adapter.applyCommand(
      settled,
      createAcceptQuestCommand(0, 2, "a-bounty-of-teeth"),
    ).state;
    const stepped = adapter.step(accepted, 3);
    expect(stepped.events.map(({ kind }) => kind)).not.toContain("landmark.discovered");
    expect(stepped.state.quests).toBe(accepted.quests);
    const irrelevant = applyQuestSemanticEvents(
      accepted.quests,
      [
        semanticEvent([1, 2, 3, 4], "combat.attack-started"),
        semanticEvent([9, 0, 0, 0], "items.rejected"),
      ],
      { exploration: accepted.exploration, items: accepted.items, tick: 3 },
    );
    expect(irrelevant.state).toBe(accepted.quests);
    expect(irrelevant.events).toEqual([]);
    expect(irrelevant.experienceAwards).toEqual([]);
  });

  it("persists one stage index per reserved quest identity", () => {
    expect(createInitialQuestState().questStageIndexes).toHaveLength(QUEST_CAPACITY + 1);
    expect(QUEST_STATE_BYTES - QUEST_JOURNAL_CAPACITY * QUEST_JOURNAL_ENTRY_BYTES).toBe(
      48 + (QUEST_CAPACITY + 1) + QUEST_OBJECTIVE_CAPACITY * 2,
    );
  });

  it("removes stack quantities atomically", () => {
    const adapter = createGameSimulationAdapter(context);
    const initial = addItemStack(adapter.createInitialState(31).items, "grain", 4);
    expect(removeItemStack(initial, "grain", 3).stackCounts[0]).toBe(1);
    expect(removeItemStack(initial, "grain", 5)).toBe(initial);
  });
});

function semanticEvent(
  values: readonly [number, number, number, number],
  kind: string,
): Readonly<{ readonly kind: string; readonly payload: Uint8Array }> {
  const payload = new Uint8Array(16);
  const view = new DataView(payload.buffer);
  values.forEach((value, index) => {
    view.setUint32(index * 4, value, true);
  });
  return Object.freeze({ kind, payload });
}
