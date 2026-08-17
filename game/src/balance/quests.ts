import { NAMED_LANDMARKS } from "../world/landmarks";
import { MONSTER_KITS } from "./combat";
import { ITEM_DEFINITIONS, type ItemId, RECIPES } from "./items";

// Ruleset-v2 quest data. Array order is persistent save/command identity: append
// quests, stages, objectives, and intents; never reorder an existing entry.
export const QUEST_RULES_VERSION = 1;
export const QUEST_CAPACITY = 31;
export const QUEST_OBJECTIVE_CAPACITY = 64;
export const QUEST_JOURNAL_CAPACITY = 256;
export type QuestMonsterKitId = (typeof MONSTER_KITS)[number]["id"];

export type QuestObjectiveDefinition =
  | Readonly<{
      readonly count: number;
      readonly kind: "collect";
      readonly itemId: ItemId;
      readonly localizationKey: string;
    }>
  | Readonly<{
      readonly count: number;
      readonly kind: "craft";
      readonly localizationKey: string;
      readonly recipeIds: readonly string[];
    }>
  | Readonly<{
      readonly count: number;
      readonly kind: "defeat";
      readonly kitIds: readonly QuestMonsterKitId[];
      readonly localizationKey: string;
    }>
  | Readonly<{
      readonly count: number;
      readonly intentId: string;
      readonly itemId: ItemId;
      readonly kind: "deliver";
      readonly localizationKey: string;
    }>
  | Readonly<{
      readonly count: number;
      readonly kind: "reach";
      readonly landmarkIds: readonly string[];
      readonly localizationKey: string;
    }>
  | Readonly<{
      readonly intentId: string;
      readonly kind: "talk";
      readonly localizationKey: string;
    }>;

export interface QuestStageDefinition {
  readonly completion: "all" | "any";
  readonly id: string;
  readonly localizationKey: string;
  readonly objectives: readonly QuestObjectiveDefinition[];
  readonly experience: number;
}

export interface QuestDefinition {
  readonly id: string;
  readonly kind: "main" | "side";
  readonly localizationKey: string;
  readonly stages: readonly QuestStageDefinition[];
  readonly systemTag: string;
}

export interface QuestIntentDefinition {
  readonly delivery?: readonly Readonly<{ readonly itemId: ItemId; readonly quantity: number }>[];
  readonly id: string;
  readonly kind: "objective" | "preparation";
  readonly localizationKey: string;
  readonly preparation?: "boss-vents-doused" | "forest-entrance-parleyed";
  readonly questId: string;
  readonly stageId: string;
}

const objective = <T extends QuestObjectiveDefinition>(value: T): T => Object.freeze(value);
const stage = (
  id: string,
  localizationKey: string,
  experience: number,
  objectives: readonly QuestObjectiveDefinition[],
  completion: "all" | "any" = "all",
): QuestStageDefinition =>
  Object.freeze({
    completion,
    experience,
    id,
    localizationKey,
    objectives: Object.freeze(objectives),
  });
const quest = (
  id: string,
  kind: QuestDefinition["kind"],
  localizationKey: string,
  systemTag: string,
  stages: readonly QuestStageDefinition[],
): QuestDefinition =>
  Object.freeze({ id, kind, localizationKey, stages: Object.freeze(stages), systemTag });

export const QUEST_DEFINITIONS: readonly QuestDefinition[] = Object.freeze([
  quest("the-undercroft-stirs", "main", "quest.main.undercroft-stirs", "main-arc", [
    stage("signs-in-the-fields", "quest.main.stage.signs-in-the-fields", 150, [
      objective({
        count: 1,
        kind: "reach",
        landmarkIds: Object.freeze(["forest-throat"]),
        localizationKey: "quest.objective.reach-collapsed-tunnel",
      }),
      objective({
        count: 1,
        itemId: "grain",
        kind: "collect",
        localizationKey: "quest.objective.collect-gnawed-grain",
      }),
      objective({
        intentId: "report-field-signs",
        kind: "talk",
        localizationKey: "quest.objective.report-field-signs",
      }),
    ]),
    stage("the-sealed-door", "quest.main.stage.the-sealed-door", 150, [
      objective({
        count: 4,
        kind: "defeat",
        kitIds: Object.freeze(["skitterling"]),
        localizationKey: "quest.objective.clear-village-descent",
      }),
    ]),
    stage("words-with-the-wardens", "quest.main.stage.words-with-the-wardens", 175, [
      objective({
        count: 1,
        kind: "defeat",
        kitIds: Object.freeze(["hollow-warden"]),
        localizationKey: "quest.objective.defeat-hollow-warden",
      }),
      objective({
        count: 1,
        itemId: "relic-fragment",
        kind: "collect",
        localizationKey: "quest.objective.recover-relic-fragment",
      }),
      objective({
        count: 1,
        kind: "reach",
        landmarkIds: Object.freeze(["castle-undercroft"]),
        localizationKey: "quest.objective.surface-castle-entrance",
      }),
    ]),
    stage("the-apothecarys-ask", "quest.main.stage.the-apothecarys-ask", 175, [
      objective({
        count: 1,
        kind: "craft",
        localizationKey: "quest.objective.craft-clearing-draught",
        recipeIds: Object.freeze(["clearing-draught"]),
      }),
      objective({
        count: 1,
        kind: "craft",
        localizationKey: "quest.objective.craft-resonant-focus",
        recipeIds: Object.freeze(["resonant-focus"]),
      }),
    ]),
    stage(
      "the-forest-throat",
      "quest.main.stage.the-forest-throat",
      175,
      [
        objective({
          count: 3,
          kind: "defeat",
          kitIds: Object.freeze(["wayland-brigand"]),
          localizationKey: "quest.objective.stop-forest-brigands",
        }),
        objective({
          intentId: "parley-forest-brigands",
          kind: "talk",
          localizationKey: "quest.objective.parley-forest-brigands",
        }),
      ],
      "any",
    ),
    stage("the-warden-below", "quest.main.stage.the-warden-below", 200, [
      objective({
        count: 1,
        kind: "defeat",
        kitIds: Object.freeze(["warden-below"]),
        localizationKey: "quest.objective.defeat-warden-below",
      }),
      objective({
        intentId: "choose-sealing-epilogue",
        kind: "talk",
        localizationKey: "quest.objective.choose-sealing-epilogue",
      }),
    ]),
  ]),
  quest("a-bounty-of-teeth", "side", "quest.side.a-bounty-of-teeth", "combat", [
    stage("gnawer-cull", "quest.side.stage.gnawer-cull", 100, [
      objective({
        count: 3,
        kind: "defeat",
        kitIds: Object.freeze(["burrow-gnawer"]),
        localizationKey: "quest.objective.defeat-burrow-gnawers",
      }),
    ]),
  ]),
  quest("the-greymaw-alpha", "side", "quest.side.the-greymaw-alpha", "pack-ai", [
    stage("break-the-pack", "quest.side.stage.break-the-pack", 125, [
      objective({
        count: 2,
        kind: "defeat",
        kitIds: Object.freeze(["greymaw"]),
        localizationKey: "quest.objective.break-greymaw-pack",
      }),
    ]),
  ]),
  quest("the-smiths-commission", "side", "quest.side.the-smiths-commission", "forge", [
    stage("temper-a-weapon", "quest.side.stage.temper-a-weapon", 125, [
      objective({
        count: 1,
        kind: "craft",
        localizationKey: "quest.objective.craft-tempered-weapon",
        recipeIds: Object.freeze([
          "tempered-sword",
          "tempered-axe",
          "tempered-spear",
          "laminated-bow",
        ]),
      }),
    ]),
  ]),
  quest("cold-larder", "side", "quest.side.cold-larder", "hearth-shore", [
    stage("stock-the-larder", "quest.side.stage.stock-the-larder", 125, [
      objective({
        count: 1,
        kind: "craft",
        localizationKey: "quest.objective.craft-fishers-stew",
        recipeIds: Object.freeze(["fishers-stew"]),
      }),
      objective({
        count: 1,
        intentId: "deliver-cold-larder",
        itemId: "fishers-stew",
        kind: "deliver",
        localizationKey: "quest.objective.deliver-fishers-stew",
      }),
    ]),
  ]),
  quest("first-fruits", "side", "quest.side.first-fruits", "gathering-economy", [
    stage("field-basket", "quest.side.stage.field-basket", 100, [
      objective({
        count: 4,
        itemId: "grain",
        kind: "collect",
        localizationKey: "quest.objective.collect-grain",
      }),
      objective({
        count: 2,
        itemId: "bittergreen",
        kind: "collect",
        localizationKey: "quest.objective.collect-bittergreen",
      }),
      objective({
        count: 1,
        intentId: "deliver-first-fruits",
        itemId: "grain",
        kind: "deliver",
        localizationKey: "quest.objective.deliver-field-basket",
      }),
    ]),
  ]),
  quest("the-reluctant-witness", "side", "quest.side.the-reluctant-witness", "dialog", [
    stage("hear-the-salvager", "quest.side.stage.hear-the-salvager", 125, [
      objective({
        intentId: "record-reluctant-witness",
        kind: "talk",
        localizationKey: "quest.objective.record-reluctant-witness",
      }),
    ]),
  ]),
  quest(
    "relics-for-the-reliquary",
    "side",
    "quest.side.relics-for-the-reliquary",
    "catacomb-loop",
    [
      stage("restore-the-reliquary", "quest.side.stage.restore-the-reliquary", 125, [
        objective({
          count: 4,
          itemId: "relic-fragment",
          kind: "collect",
          localizationKey: "quest.objective.collect-relic-fragments",
        }),
        objective({
          count: 4,
          intentId: "deliver-reliquary-relics",
          itemId: "relic-fragment",
          kind: "deliver",
          localizationKey: "quest.objective.deliver-relic-fragments",
        }),
      ]),
    ],
  ),
  quest("the-painter-of-the-vista", "side", "quest.side.the-painter-of-the-vista", "exploration", [
    stage("three-vistas", "quest.side.stage.three-vistas", 100, [
      objective({
        count: 3,
        kind: "reach",
        landmarkIds: Object.freeze([
          "castle-gate-waystone",
          "forest-edge-waystone",
          "forest-throat",
        ]),
        localizationKey: "quest.objective.reach-three-vistas",
      }),
    ]),
  ]),
]);

export const QUEST_INTENTS: readonly QuestIntentDefinition[] = Object.freeze([
  Object.freeze({
    id: "report-field-signs",
    kind: "objective",
    localizationKey: "quest.intent.report-field-signs",
    questId: "the-undercroft-stirs",
    stageId: "signs-in-the-fields",
  }),
  Object.freeze({
    id: "douse-boss-vents",
    kind: "preparation",
    localizationKey: "quest.intent.douse-boss-vents",
    delivery: Object.freeze([Object.freeze({ itemId: "clearing-draught", quantity: 1 })]),
    preparation: "boss-vents-doused",
    questId: "the-undercroft-stirs",
    stageId: "the-apothecarys-ask",
  }),
  Object.freeze({
    id: "parley-forest-brigands",
    kind: "objective",
    localizationKey: "quest.intent.parley-forest-brigands",
    preparation: "forest-entrance-parleyed",
    questId: "the-undercroft-stirs",
    stageId: "the-forest-throat",
  }),
  Object.freeze({
    id: "choose-sealing-epilogue",
    kind: "objective",
    localizationKey: "quest.intent.choose-sealing-epilogue",
    questId: "the-undercroft-stirs",
    stageId: "the-warden-below",
  }),
  Object.freeze({
    delivery: Object.freeze([Object.freeze({ itemId: "fishers-stew", quantity: 1 })]),
    id: "deliver-cold-larder",
    kind: "objective",
    localizationKey: "quest.intent.deliver-cold-larder",
    questId: "cold-larder",
    stageId: "stock-the-larder",
  }),
  Object.freeze({
    delivery: Object.freeze([
      Object.freeze({ itemId: "grain", quantity: 4 }),
      Object.freeze({ itemId: "bittergreen", quantity: 2 }),
    ]),
    id: "deliver-first-fruits",
    kind: "objective",
    localizationKey: "quest.intent.deliver-first-fruits",
    questId: "first-fruits",
    stageId: "field-basket",
  }),
  Object.freeze({
    id: "record-reluctant-witness",
    kind: "objective",
    localizationKey: "quest.intent.record-reluctant-witness",
    questId: "the-reluctant-witness",
    stageId: "hear-the-salvager",
  }),
  Object.freeze({
    delivery: Object.freeze([Object.freeze({ itemId: "relic-fragment", quantity: 4 })]),
    id: "deliver-reliquary-relics",
    kind: "objective",
    localizationKey: "quest.intent.deliver-reliquary-relics",
    questId: "relics-for-the-reliquary",
    stageId: "restore-the-reliquary",
  }),
]);

export function questIndex(id: string): number {
  const index = QUEST_DEFINITIONS.findIndex((definition) => definition.id === id);
  if (index < 0) throw new Error(`Unknown quest ${id}`);
  return index;
}

export function questIntentIndex(id: string): number {
  const index = QUEST_INTENTS.findIndex((definition) => definition.id === id);
  if (index < 0) throw new Error(`Unknown quest intent ${id}`);
  return index;
}

export function questObjectiveOffset(questIndexValue: number, stageIndex: number): number {
  let offset = 0;
  for (const [candidateQuestIndex, definition] of QUEST_DEFINITIONS.entries()) {
    for (const [candidateStageIndex, candidateStage] of definition.stages.entries()) {
      if (candidateQuestIndex === questIndexValue && candidateStageIndex === stageIndex)
        return offset;
      offset += candidateStage.objectives.length;
    }
  }
  throw new Error("Quest stage identity is invalid");
}

export function questObjectiveCount(): number {
  return QUEST_DEFINITIONS.reduce(
    (questTotal, definition) =>
      questTotal +
      definition.stages.reduce((stageTotal, value) => stageTotal + value.objectives.length, 0),
    0,
  );
}

export function assertQuestDefinitions(): void {
  const questIds = new Set<string>();
  const stageIds = new Set<string>();
  const objectiveCount = questObjectiveCount();
  if (QUEST_DEFINITIONS.length > QUEST_CAPACITY || objectiveCount > QUEST_OBJECTIVE_CAPACITY) {
    throw new Error("Quest vocabulary exceeds persisted capacity");
  }
  for (const definition of QUEST_DEFINITIONS) {
    if (!validId(definition.id) || questIds.has(definition.id) || definition.stages.length === 0) {
      throw new Error("Quest definition is invalid");
    }
    questIds.add(definition.id);
    for (const value of definition.stages) {
      const stageIdentity = `${definition.id}:${value.id}`;
      if (
        !validId(value.id) ||
        stageIds.has(stageIdentity) ||
        value.objectives.length === 0 ||
        !Number.isSafeInteger(value.experience) ||
        value.experience <= 0
      ) {
        throw new Error("Quest stage definition is invalid");
      }
      stageIds.add(stageIdentity);
      for (const candidate of value.objectives) assertObjective(candidate);
    }
  }
  const intentIds = new Set<string>();
  for (const intent of QUEST_INTENTS) {
    if (
      !validId(intent.id) ||
      intentIds.has(intent.id) ||
      !stageIds.has(`${intent.questId}:${intent.stageId}`) ||
      (intent.kind === "preparation" && intent.preparation === undefined)
    ) {
      throw new Error("Quest intent definition is invalid");
    }
    intentIds.add(intent.id);
    for (const delivery of intent.delivery ?? []) {
      if (
        !ITEM_DEFINITIONS.some(({ id }) => id === delivery.itemId) ||
        !Number.isSafeInteger(delivery.quantity) ||
        delivery.quantity <= 0
      ) {
        throw new Error("Quest intent delivery is invalid");
      }
    }
  }
  const objectiveIntentReferences = new Map<string, number>();
  for (const definition of QUEST_DEFINITIONS) {
    for (const value of definition.stages) {
      for (const candidate of value.objectives) {
        if (candidate.kind === "talk" || candidate.kind === "deliver") {
          const intent = QUEST_INTENTS.find(({ id }) => id === candidate.intentId);
          if (
            intent === undefined ||
            intent.questId !== definition.id ||
            intent.stageId !== value.id
          ) {
            throw new Error("Quest objective references an unknown intent");
          }
          objectiveIntentReferences.set(
            candidate.intentId,
            (objectiveIntentReferences.get(candidate.intentId) ?? 0) + 1,
          );
        }
      }
    }
  }
  for (const intent of QUEST_INTENTS) {
    const references = objectiveIntentReferences.get(intent.id) ?? 0;
    if ((intent.kind === "objective" && references !== 1) || references > 1) {
      throw new Error("Quest objective intent binding is invalid");
    }
    const deliveryIds = (intent.delivery ?? []).map(({ itemId }) => itemId);
    if (new Set(deliveryIds).size !== deliveryIds.length) {
      throw new Error("Quest intent delivery contains duplicate items");
    }
  }
}

function assertObjective(value: QuestObjectiveDefinition): void {
  const count = value.kind === "talk" ? 1 : value.count;
  if (!validId(value.localizationKey) || !Number.isSafeInteger(count) || count <= 0) {
    throw new Error("Quest objective definition is invalid");
  }
  if (value.kind === "collect" || value.kind === "deliver") {
    if (!ITEM_DEFINITIONS.some(({ id }) => id === value.itemId))
      throw new Error("Quest objective item is invalid");
  } else if (value.kind === "craft") {
    if (
      value.recipeIds.length === 0 ||
      new Set(value.recipeIds).size !== value.recipeIds.length ||
      value.recipeIds.some((id) => !RECIPES.some((recipe) => recipe.id === id))
    ) {
      throw new Error("Quest objective recipe is invalid");
    }
  } else if (value.kind === "defeat") {
    if (
      value.kitIds.length === 0 ||
      new Set(value.kitIds).size !== value.kitIds.length ||
      value.kitIds.some((id) => !MONSTER_KITS.some((kit) => kit.id === id))
    ) {
      throw new Error("Quest objective monster is invalid");
    }
  } else if (value.kind === "reach") {
    if (
      value.landmarkIds.length < value.count ||
      new Set(value.landmarkIds).size !== value.landmarkIds.length ||
      value.landmarkIds.some((id) => !NAMED_LANDMARKS.some((landmark) => landmark.id === id))
    ) {
      throw new Error("Quest objective landmark is invalid");
    }
  }
}

function validId(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9.-]{0,127})$/u.test(value);
}

assertQuestDefinitions();
