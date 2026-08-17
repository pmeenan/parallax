import { MONSTER_KITS } from "../balance/combat";
import { itemIndex, RECIPES, VENDOR_OFFERS } from "../balance/items";
import {
  QUEST_CAPACITY,
  QUEST_DEFINITIONS,
  QUEST_INTENTS,
  QUEST_JOURNAL_CAPACITY,
  QUEST_OBJECTIVE_CAPACITY,
  QUEST_RULES_VERSION,
  type QuestIntentDefinition,
  type QuestObjectiveDefinition,
  questObjectiveCount,
  questObjectiveOffset,
} from "../balance/quests";
import { GATHERING_NODES } from "../world/gathering-nodes";
import { NAMED_LANDMARKS } from "../world/landmarks";
import { lowBitsMask } from "./bitmask";
import type { ExplorationState } from "./exploration";
import type { ItemState } from "./items";

export const QUEST_STATE_BYTES = 8_400;
export const QUEST_JOURNAL_ENTRY_BYTES = 32;
export const QUEST_JOURNAL_QUERY_MAXIMUM_ENTRIES = 64;

const QUEST_STATE_HEADER_BYTES = 48;
// One stage-index byte per reserved quest identity plus one reserved zero byte, so the
// persisted representation matches QUEST_CAPACITY instead of silently truncating it.
const QUEST_STAGE_INDEX_CAPACITY = QUEST_CAPACITY + 1;
const QUEST_STAGE_BYTES = QUEST_STAGE_INDEX_CAPACITY;
const QUEST_OBJECTIVE_BYTES = QUEST_OBJECTIVE_CAPACITY * Uint16Array.BYTES_PER_ELEMENT;
const QUEST_JOURNAL_OFFSET = QUEST_STATE_HEADER_BYTES + QUEST_STAGE_BYTES + QUEST_OBJECTIVE_BYTES;
const QUEST_PREPARATION_BOSS_VENTS_DOUSED = 1;
const QUEST_PREPARATION_FOREST_PARLEYED = 2;
const QUEST_PREPARATION_WARDEN_INSIGHTS = 4;
const QUEST_PREPARATION_MASK =
  QUEST_PREPARATION_BOSS_VENTS_DOUSED |
  QUEST_PREPARATION_FOREST_PARLEYED |
  QUEST_PREPARATION_WARDEN_INSIGHTS;
const JOURNAL_KIND_QUEST_ACCEPTED = 1;
const JOURNAL_KIND_OBJECTIVE_PROGRESS = 2;
const JOURNAL_KIND_STAGE_COMPLETED = 3;
const JOURNAL_KIND_QUEST_COMPLETED = 4;
const JOURNAL_KIND_LANDMARK_DISCOVERED = 5;
const JOURNAL_KIND_PREPARATION_CHANGED = 6;
const NO_INDEX = 0xffff;
// Item-command operation codes whose semantic events the reducer consumes (see the
// `items.command@1` operation table in m3-simulation).
const ITEM_OPERATION_GATHER = 1;
const ITEM_OPERATION_CRAFT = 2;
const ITEM_OPERATION_BUY = 3;
const ITEM_OPERATION_RECOVER_SATCHEL = 9;
// Every event kind that can change quest state. Any other event is skipped before any
// per-quest work so a steady-state tick costs one Set lookup per event.
const QUEST_SOURCE_EVENT_KINDS: ReadonlySet<string> = new Set([
  "combat.monster-defeated",
  "items.crafted",
  "items.gathered",
  "items.purchased",
  "items.satchel-recovered",
  "landmark.discovered",
  "loot.awarded",
  "quest.intent-validated",
]);
// Every event after which held stack counts may have grown; collect objectives reconcile
// against the inventory on each of these so no acquisition path can strand a stage.
const COLLECT_SOURCE_EVENT_KINDS: ReadonlySet<string> = new Set([
  "items.crafted",
  "items.gathered",
  "items.purchased",
  "items.satchel-recovered",
  "loot.awarded",
  "quest.intent-validated",
]);
const EMPTY_QUEST_EVENTS: readonly Readonly<{
  readonly kind: string;
  readonly values: readonly [number, number, number, number];
}>[] = Object.freeze([]);
const EMPTY_EXPERIENCE_AWARDS: readonly Readonly<{
  readonly amount: number;
  readonly questIndex: number;
  readonly stageIndex: number;
}>[] = Object.freeze([]);

if (
  QUEST_JOURNAL_OFFSET + QUEST_JOURNAL_CAPACITY * QUEST_JOURNAL_ENTRY_BYTES !==
  QUEST_STATE_BYTES
) {
  throw new Error("Quest state byte layout is inconsistent");
}
const maximumAuthoredJournalEntries =
  NAMED_LANDMARKS.length +
  QUEST_DEFINITIONS.length * 2 +
  QUEST_DEFINITIONS.reduce(
    (questTotal, definition) =>
      questTotal +
      definition.stages.reduce(
        (stageTotal, stage) =>
          stageTotal +
          1 +
          stage.objectives.reduce(
            (objectiveTotal, candidate) => objectiveTotal + objectiveTarget(candidate),
            0,
          ),
        0,
      ),
    0,
  ) +
  3;
if (maximumAuthoredJournalEntries > QUEST_JOURNAL_CAPACITY) {
  throw new Error("Authored quest history exceeds the append-only journal capacity");
}

export interface QuestJournalEntry {
  readonly amount: number;
  readonly kind: number;
  readonly objectiveIndex: number;
  readonly questIndex: number;
  readonly sequence: number;
  readonly stageIndex: number;
  readonly subject: number;
  readonly tick: number;
}

export interface QuestState {
  readonly acceptedQuestCount: number;
  readonly activeQuestMask: number;
  readonly completedQuestCount: number;
  readonly completedQuestMask: number;
  readonly journal: readonly QuestJournalEntry[];
  readonly nextJournalSequence: number;
  readonly nominalExperienceAwarded: number;
  readonly objectiveProgress: readonly number[];
  readonly objectiveProgressCount: number;
  readonly preparationFlags: number;
  readonly questStageIndexes: readonly number[];
  readonly stageCompletionCount: number;
}

export interface QuestSemanticEvent {
  readonly kind: string;
  readonly payload: Uint8Array;
}

export interface QuestProgressionResult {
  readonly events: readonly Readonly<{
    readonly kind: string;
    readonly values: readonly [number, number, number, number];
  }>[];
  readonly experienceAwards: readonly Readonly<{
    readonly amount: number;
    readonly questIndex: number;
    readonly stageIndex: number;
  }>[];
  readonly state: QuestState;
}

export function createInitialQuestState(): QuestState {
  return Object.freeze({
    acceptedQuestCount: 0,
    activeQuestMask: 0,
    completedQuestCount: 0,
    completedQuestMask: 0,
    journal: Object.freeze([]),
    nextJournalSequence: 0,
    nominalExperienceAwarded: 0,
    objectiveProgress: Object.freeze(Array.from({ length: QUEST_OBJECTIVE_CAPACITY }, () => 0)),
    objectiveProgressCount: 0,
    preparationFlags: 0,
    questStageIndexes: Object.freeze(Array.from({ length: QUEST_STAGE_INDEX_CAPACITY }, () => 0)),
    stageCompletionCount: 0,
  });
}

export function applyQuestSemanticEvents(
  initial: QuestState,
  sourceEvents: readonly QuestSemanticEvent[],
  context: Readonly<{
    readonly exploration: ExplorationState;
    readonly items: ItemState;
    readonly tick: number;
  }>,
): QuestProgressionResult {
  // Steady-state ticks carry no quest source events; leave without allocating or
  // revalidating so the reducer is free on the 60 Hz path (assertions run on change and
  // at the save/load/query boundaries).
  let relevant = false;
  for (const sourceEvent of sourceEvents) {
    if (QUEST_SOURCE_EVENT_KINDS.has(sourceEvent.kind)) {
      relevant = true;
      break;
    }
  }
  if (!relevant)
    return Object.freeze({
      events: EMPTY_QUEST_EVENTS,
      experienceAwards: EMPTY_EXPERIENCE_AWARDS,
      state: initial,
    });
  let state = initial;
  const events: Readonly<{
    readonly kind: string;
    readonly values: readonly [number, number, number, number];
  }>[] = [];
  const experienceAwards: Readonly<{
    readonly amount: number;
    readonly questIndex: number;
    readonly stageIndex: number;
  }>[] = [];
  for (const sourceEvent of sourceEvents) {
    if (!QUEST_SOURCE_EVENT_KINDS.has(sourceEvent.kind)) continue;
    const values = readEventValues(sourceEvent);
    assertQuestSourceEvent(state, sourceEvent.kind, values);
    if (sourceEvent.kind === "landmark.discovered") {
      state = appendJournal(
        state,
        context.tick,
        JOURNAL_KIND_LANDMARK_DISCOVERED,
        NO_INDEX,
        NO_INDEX,
        NO_INDEX,
        values[0],
        values[1],
      );
    }
    if (sourceEvent.kind === "quest.intent-validated" && values[0] === 1) {
      const questIndex = values[1];
      const definition = QUEST_DEFINITIONS[questIndex];
      const bit = questIndex < 31 ? 1 << questIndex : 0;
      if (
        definition !== undefined &&
        (state.activeQuestMask & bit) === 0 &&
        (state.completedQuestMask & bit) === 0
      ) {
        state = Object.freeze({
          ...state,
          acceptedQuestCount: state.acceptedQuestCount + 1,
          activeQuestMask: (state.activeQuestMask | bit) >>> 0,
        });
        state = appendJournal(
          state,
          context.tick,
          JOURNAL_KIND_QUEST_ACCEPTED,
          questIndex,
          0,
          NO_INDEX,
          0,
          1,
        );
        events.push(event("quest.accepted", questIndex, 0, definition.kind === "main" ? 1 : 2, 0));
      }
    }
    state = applyPreparationIntent(state, sourceEvent, values, context.tick, events);
    for (const [questIndex, definition] of QUEST_DEFINITIONS.entries()) {
      const bit = 1 << questIndex;
      if ((state.activeQuestMask & bit) === 0) continue;
      const stageIndex = state.questStageIndexes[questIndex] ?? 0;
      const stage = definition.stages[stageIndex];
      if (stage === undefined) throw new Error("Active quest stage is invalid");
      const objectiveOffset = questObjectiveOffset(questIndex, stageIndex);
      let objectiveProgress = state.objectiveProgress;
      let changed = false;
      for (const [objectiveIndex, candidate] of stage.objectives.entries()) {
        const progressIndex = objectiveOffset + objectiveIndex;
        const prior = objectiveProgress[progressIndex] ?? 0;
        const next = objectiveProgressForEvent(
          candidate,
          prior,
          questIndex,
          sourceEvent,
          values,
          context.exploration,
          context.items,
        );
        if (next === prior) continue;
        const mutable = [...objectiveProgress];
        mutable[progressIndex] = next;
        objectiveProgress = Object.freeze(mutable);
        changed = true;
        state = Object.freeze({
          ...state,
          objectiveProgress,
          objectiveProgressCount: state.objectiveProgressCount + 1,
        });
        state = appendJournal(
          state,
          context.tick,
          JOURNAL_KIND_OBJECTIVE_PROGRESS,
          questIndex,
          stageIndex,
          objectiveIndex,
          next,
          next - prior,
        );
        events.push(
          event("quest.objective-progressed", questIndex, stageIndex, objectiveIndex, next),
        );
      }
      if (
        !changed ||
        !stageComplete(stage.objectives, objectiveProgress, objectiveOffset, stage.completion)
      ) {
        continue;
      }
      const nextStageIndex = stageIndex + 1;
      const completed = nextStageIndex === definition.stages.length;
      const stageIndexes = [...state.questStageIndexes];
      stageIndexes[questIndex] = nextStageIndex;
      state = Object.freeze({
        ...state,
        activeQuestMask: completed ? (state.activeQuestMask & ~bit) >>> 0 : state.activeQuestMask,
        completedQuestCount: state.completedQuestCount + Number(completed),
        completedQuestMask: completed
          ? (state.completedQuestMask | bit) >>> 0
          : state.completedQuestMask,
        nominalExperienceAwarded: state.nominalExperienceAwarded + stage.experience,
        questStageIndexes: Object.freeze(stageIndexes),
        stageCompletionCount: state.stageCompletionCount + 1,
      });
      state = appendJournal(
        state,
        context.tick,
        JOURNAL_KIND_STAGE_COMPLETED,
        questIndex,
        stageIndex,
        NO_INDEX,
        stage.experience,
        1,
      );
      events.push(
        event("quest.stage-completed", questIndex, stageIndex, stage.experience, nextStageIndex),
      );
      experienceAwards.push(Object.freeze({ amount: stage.experience, questIndex, stageIndex }));
      if (completed) {
        state = appendJournal(
          state,
          context.tick,
          JOURNAL_KIND_QUEST_COMPLETED,
          questIndex,
          stageIndex,
          NO_INDEX,
          stage.experience,
          1,
        );
        events.push(event("quest.completed", questIndex, stageIndex, stage.experience, 0));
        if (definition.id === "relics-for-the-reliquary") {
          state = setPreparation(
            state,
            QUEST_PREPARATION_WARDEN_INSIGHTS,
            context.tick,
            questIndex,
            stageIndex,
            events,
          );
        }
      } else {
        state = bootstrapPersistentObjectives(state, questIndex, nextStageIndex, context, events);
      }
    }
  }
  if (state !== initial) assertQuestState(state);
  return Object.freeze({
    events: Object.freeze(events),
    experienceAwards: Object.freeze(experienceAwards),
    state,
  });
}

export function questPreparationRecorded(
  state: QuestState,
  preparation: NonNullable<QuestIntentDefinition["preparation"]>,
): boolean {
  return (state.preparationFlags & preparationFlag(preparation)) !== 0;
}

export function serializeQuestState(view: DataView, offset: number, state: QuestState): void {
  assertQuestState(state);
  view.setUint32(offset, state.activeQuestMask, true);
  view.setUint32(offset + 4, state.completedQuestMask, true);
  view.setUint32(offset + 8, state.journal.length, true);
  view.setUint32(offset + 12, state.nextJournalSequence, true);
  view.setUint32(offset + 16, state.nominalExperienceAwarded, true);
  view.setUint32(offset + 20, state.acceptedQuestCount, true);
  view.setUint32(offset + 24, state.objectiveProgressCount, true);
  view.setUint32(offset + 28, state.stageCompletionCount, true);
  view.setUint32(offset + 32, state.completedQuestCount, true);
  view.setUint32(offset + 36, state.preparationFlags, true);
  view.setUint32(offset + 40, QUEST_RULES_VERSION, true);
  view.setUint32(offset + 44, 0, true);
  for (let index = 0; index < QUEST_STAGE_INDEX_CAPACITY; index += 1) {
    view.setUint8(offset + QUEST_STATE_HEADER_BYTES + index, state.questStageIndexes[index] ?? 0);
  }
  const objectiveOffset = offset + QUEST_STATE_HEADER_BYTES + QUEST_STAGE_BYTES;
  for (let index = 0; index < QUEST_OBJECTIVE_CAPACITY; index += 1) {
    view.setUint16(objectiveOffset + index * 2, state.objectiveProgress[index] ?? 0, true);
  }
  for (const [index, entry] of state.journal.entries()) {
    const entryOffset = offset + QUEST_JOURNAL_OFFSET + index * QUEST_JOURNAL_ENTRY_BYTES;
    view.setUint32(entryOffset, entry.sequence, true);
    view.setUint32(entryOffset + 4, 0, true);
    view.setBigUint64(entryOffset + 8, BigInt(entry.tick), true);
    view.setUint16(entryOffset + 16, entry.kind, true);
    view.setUint16(entryOffset + 18, entry.questIndex, true);
    view.setUint16(entryOffset + 20, entry.stageIndex, true);
    view.setUint16(entryOffset + 22, entry.objectiveIndex, true);
    view.setUint32(entryOffset + 24, entry.subject, true);
    view.setUint32(entryOffset + 28, entry.amount, true);
  }
}

export function deserializeQuestState(view: DataView, offset: number): QuestState {
  if (
    view.getUint32(offset + 40, true) !== QUEST_RULES_VERSION ||
    view.getUint32(offset + 44, true) !== 0
  ) {
    throw new Error("Game quest state has an unsupported rules version or reserved bytes");
  }
  const journalCount = view.getUint32(offset + 8, true);
  if (journalCount > QUEST_JOURNAL_CAPACITY) throw new Error("Game quest journal exceeds capacity");
  const questStageIndexes = Object.freeze(
    Array.from({ length: QUEST_STAGE_INDEX_CAPACITY }, (_, index) =>
      view.getUint8(offset + QUEST_STATE_HEADER_BYTES + index),
    ),
  );
  const objectiveOffset = offset + QUEST_STATE_HEADER_BYTES + QUEST_STAGE_BYTES;
  const objectiveProgress = Object.freeze(
    Array.from({ length: QUEST_OBJECTIVE_CAPACITY }, (_, index) =>
      view.getUint16(objectiveOffset + index * 2, true),
    ),
  );
  const journal = Object.freeze(
    Array.from({ length: journalCount }, (_, index) => {
      const entryOffset = offset + QUEST_JOURNAL_OFFSET + index * QUEST_JOURNAL_ENTRY_BYTES;
      if (view.getUint32(entryOffset + 4, true) !== 0) {
        throw new Error("Game quest journal contains noncanonical reserved bytes");
      }
      const tick = Number(view.getBigUint64(entryOffset + 8, true));
      return Object.freeze({
        amount: view.getUint32(entryOffset + 28, true),
        kind: view.getUint16(entryOffset + 16, true),
        objectiveIndex: view.getUint16(entryOffset + 22, true),
        questIndex: view.getUint16(entryOffset + 18, true),
        sequence: view.getUint32(entryOffset, true),
        stageIndex: view.getUint16(entryOffset + 20, true),
        subject: view.getUint32(entryOffset + 24, true),
        tick,
      });
    }),
  );
  const state = Object.freeze({
    acceptedQuestCount: view.getUint32(offset + 20, true),
    activeQuestMask: view.getUint32(offset, true),
    completedQuestCount: view.getUint32(offset + 32, true),
    completedQuestMask: view.getUint32(offset + 4, true),
    journal,
    nextJournalSequence: view.getUint32(offset + 12, true),
    nominalExperienceAwarded: view.getUint32(offset + 16, true),
    objectiveProgress,
    objectiveProgressCount: view.getUint32(offset + 24, true),
    preparationFlags: view.getUint32(offset + 36, true),
    questStageIndexes,
    stageCompletionCount: view.getUint32(offset + 28, true),
  });
  assertQuestState(state);
  return state;
}

export function assertQuestState(state: QuestState): void {
  const knownMask = lowBitsMask(QUEST_DEFINITIONS.length);
  if (
    (state.activeQuestMask & ~knownMask) !== 0 ||
    (state.completedQuestMask & ~knownMask) !== 0 ||
    (state.activeQuestMask & state.completedQuestMask) !== 0 ||
    (state.preparationFlags & ~QUEST_PREPARATION_MASK) !== 0 ||
    state.questStageIndexes.length !== QUEST_STAGE_INDEX_CAPACITY ||
    state.objectiveProgress.length !== QUEST_OBJECTIVE_CAPACITY ||
    state.journal.length > QUEST_JOURNAL_CAPACITY ||
    state.nextJournalSequence !== state.journal.length ||
    !unsigned32(state.objectiveProgressCount) ||
    !unsigned32(state.acceptedQuestCount) ||
    !unsigned32(state.completedQuestCount) ||
    !unsigned32(state.nominalExperienceAwarded) ||
    !unsigned32(state.stageCompletionCount)
  ) {
    throw new Error("Game quest state is invalid");
  }
  let expectedAccepted = 0;
  let expectedCompleted = 0;
  let expectedStages = 0;
  let expectedExperience = 0;
  for (const [questIndex, definition] of QUEST_DEFINITIONS.entries()) {
    const stageIndex = state.questStageIndexes[questIndex] ?? 0;
    const active = (state.activeQuestMask & (1 << questIndex)) !== 0;
    const completed = (state.completedQuestMask & (1 << questIndex)) !== 0;
    if (
      stageIndex > definition.stages.length ||
      (active && stageIndex >= definition.stages.length) ||
      (!active && !completed && stageIndex !== 0) ||
      completed !== (stageIndex === definition.stages.length)
    ) {
      throw new Error("Game quest state contains an invalid stage");
    }
    expectedAccepted += Number(active || completed);
    expectedCompleted += Number(completed);
    expectedStages += stageIndex;
    for (let completedStage = 0; completedStage < stageIndex; completedStage += 1) {
      expectedExperience += definition.stages[completedStage]?.experience ?? 0;
    }
    for (const [candidateStageIndex, stage] of definition.stages.entries()) {
      const progressOffset = questObjectiveOffset(questIndex, candidateStageIndex);
      for (const [objectiveIndex, candidate] of stage.objectives.entries()) {
        const progress = state.objectiveProgress[progressOffset + objectiveIndex] ?? 0;
        const target = objectiveTarget(candidate);
        if (progress > target || (candidateStageIndex > stageIndex && progress !== 0)) {
          throw new Error("Game quest objective progress is invalid");
        }
      }
      if (
        candidateStageIndex < stageIndex &&
        !stageComplete(stage.objectives, state.objectiveProgress, progressOffset, stage.completion)
      ) {
        throw new Error("Game quest completed stage has incomplete objectives");
      }
    }
  }
  if (
    state.acceptedQuestCount !== expectedAccepted ||
    state.completedQuestCount !== expectedCompleted ||
    state.stageCompletionCount !== expectedStages ||
    state.nominalExperienceAwarded !== expectedExperience ||
    !state.questStageIndexes.slice(QUEST_DEFINITIONS.length).every((value) => value === 0) ||
    !state.objectiveProgress.slice(questObjectiveCount()).every((value) => value === 0)
  ) {
    throw new Error("Game quest state counters or reserved identities are invalid");
  }
  let reconstructedAcceptedMask = 0;
  let reconstructedCompletedMask = 0;
  let reconstructedObjectiveProgressCount = 0;
  let reconstructedPreparationFlags = 0;
  const reconstructedStages = Array.from({ length: QUEST_STAGE_INDEX_CAPACITY }, () => 0);
  const reconstructedObjectiveProgress = Array.from({ length: QUEST_OBJECTIVE_CAPACITY }, () => 0);
  for (const [index, entry] of state.journal.entries()) {
    if (
      entry.sequence !== index ||
      !Number.isSafeInteger(entry.tick) ||
      entry.tick < 0 ||
      !unsigned32(entry.amount) ||
      !unsigned32(entry.subject) ||
      entry.kind < JOURNAL_KIND_QUEST_ACCEPTED ||
      entry.kind > JOURNAL_KIND_PREPARATION_CHANGED ||
      (entry.questIndex !== NO_INDEX && entry.questIndex >= QUEST_DEFINITIONS.length)
    ) {
      throw new Error("Game quest journal entry is invalid");
    }
    if (entry.kind === JOURNAL_KIND_LANDMARK_DISCOVERED) {
      const landmark = NAMED_LANDMARKS[entry.subject];
      if (
        entry.questIndex !== NO_INDEX ||
        entry.stageIndex !== NO_INDEX ||
        entry.objectiveIndex !== NO_INDEX ||
        landmark === undefined ||
        entry.amount !== landmark.experience
      ) {
        throw new Error("Game landmark journal entry is invalid");
      }
      continue;
    }
    const definition = QUEST_DEFINITIONS[entry.questIndex];
    const stage = definition?.stages[entry.stageIndex];
    if (definition === undefined || stage === undefined) {
      throw new Error("Game quest journal identity is invalid");
    }
    const questBit = 1 << entry.questIndex;
    if (entry.kind !== JOURNAL_KIND_OBJECTIVE_PROGRESS && entry.objectiveIndex !== NO_INDEX) {
      throw new Error("Game quest journal non-objective entry names an objective");
    }
    if (entry.kind === JOURNAL_KIND_QUEST_ACCEPTED) {
      if (
        entry.stageIndex !== 0 ||
        entry.subject !== 0 ||
        entry.amount !== 1 ||
        (reconstructedAcceptedMask & questBit) !== 0
      ) {
        throw new Error("Game quest acceptance journal entry is invalid");
      }
      reconstructedAcceptedMask = (reconstructedAcceptedMask | questBit) >>> 0;
    } else if (entry.kind === JOURNAL_KIND_OBJECTIVE_PROGRESS) {
      const objective = stage.objectives[entry.objectiveIndex];
      const progressIndex =
        questObjectiveOffset(entry.questIndex, entry.stageIndex) + entry.objectiveIndex;
      const prior = reconstructedObjectiveProgress[progressIndex] ?? 0;
      if (
        objective === undefined ||
        (reconstructedAcceptedMask & questBit) === 0 ||
        reconstructedStages[entry.questIndex] !== entry.stageIndex ||
        entry.subject === 0 ||
        entry.subject > objectiveTarget(objective) ||
        entry.amount === 0 ||
        entry.subject !== prior + entry.amount
      ) {
        throw new Error("Game quest journal objective is invalid");
      }
      reconstructedObjectiveProgress[progressIndex] = entry.subject;
      reconstructedObjectiveProgressCount += 1;
    } else if (entry.kind === JOURNAL_KIND_STAGE_COMPLETED) {
      if (
        entry.subject !== stage.experience ||
        entry.amount !== 1 ||
        (reconstructedAcceptedMask & questBit) === 0 ||
        reconstructedStages[entry.questIndex] !== entry.stageIndex
      ) {
        throw new Error("Game quest stage journal entry is invalid");
      }
      reconstructedStages[entry.questIndex] = entry.stageIndex + 1;
    } else if (entry.kind === JOURNAL_KIND_QUEST_COMPLETED) {
      if (
        entry.stageIndex !== definition.stages.length - 1 ||
        entry.subject !== stage.experience ||
        entry.amount !== 1 ||
        reconstructedStages[entry.questIndex] !== definition.stages.length ||
        (reconstructedCompletedMask & questBit) !== 0
      ) {
        throw new Error("Game quest completion journal entry is invalid");
      }
      reconstructedCompletedMask = (reconstructedCompletedMask | questBit) >>> 0;
    } else if (entry.kind === JOURNAL_KIND_PREPARATION_CHANGED) {
      if (
        entry.subject === 0 ||
        (entry.subject & (entry.subject - 1)) !== 0 ||
        (entry.subject & ~QUEST_PREPARATION_MASK) !== 0 ||
        entry.amount !== 1 ||
        (reconstructedAcceptedMask & questBit) === 0 ||
        (reconstructedPreparationFlags & entry.subject) !== 0 ||
        !preparationJournalIdentityMatches(definition.id, stage.id, entry.subject)
      ) {
        throw new Error("Game quest preparation journal entry is invalid");
      }
      reconstructedPreparationFlags |= entry.subject;
    }
  }
  const acceptedMask = (state.activeQuestMask | state.completedQuestMask) >>> 0;
  if (
    reconstructedAcceptedMask !== acceptedMask ||
    reconstructedCompletedMask !== state.completedQuestMask ||
    reconstructedObjectiveProgressCount !== state.objectiveProgressCount ||
    reconstructedPreparationFlags !== state.preparationFlags ||
    reconstructedStages.some((value, index) => value !== state.questStageIndexes[index]) ||
    reconstructedObjectiveProgress.some((value, index) => value !== state.objectiveProgress[index])
  ) {
    throw new Error("Game quest state disagrees with the append-only journal");
  }
}

export function assertQuestExplorationConsistency(
  state: QuestState,
  exploration: ExplorationState,
): void {
  const landmarkEntries = state.journal.filter(
    ({ kind }) => kind === JOURNAL_KIND_LANDMARK_DISCOVERED,
  );
  const journalMask = landmarkEntries.reduce((mask, entry) => mask | (1 << entry.subject), 0) >>> 0;
  if (
    landmarkEntries.length !== exploration.discoveredLandmarkCount ||
    new Set(landmarkEntries.map(({ subject }) => subject)).size !== landmarkEntries.length ||
    journalMask !== exploration.discoveredLandmarkMask
  ) {
    throw new Error("Game quest journal disagrees with exploration discoveries");
  }
}

export function questPreparationSnapshot(state: QuestState): Readonly<{
  readonly bossVentsDoused: boolean;
  readonly forestEntranceParleyed: boolean;
  readonly wardenInsightsRecorded: boolean;
}> {
  return Object.freeze({
    bossVentsDoused: (state.preparationFlags & QUEST_PREPARATION_BOSS_VENTS_DOUSED) !== 0,
    forestEntranceParleyed: (state.preparationFlags & QUEST_PREPARATION_FOREST_PARLEYED) !== 0,
    wardenInsightsRecorded: (state.preparationFlags & QUEST_PREPARATION_WARDEN_INSIGHTS) !== 0,
  });
}

export function journalLocalizationKey(kind: number): string {
  const keys = [
    "",
    "journal.quest.accepted",
    "journal.quest.objective-progressed",
    "journal.quest.stage-completed",
    "journal.quest.completed",
    "journal.landmark.discovered",
    "journal.quest.preparation-changed",
  ];
  const value = keys[kind];
  if (value === undefined || value === "") throw new Error("Quest journal kind is invalid");
  return value;
}

export function isLandmarkJournalKind(kind: number): boolean {
  return kind === JOURNAL_KIND_LANDMARK_DISCOVERED;
}

function bootstrapPersistentObjectives(
  state: QuestState,
  questIndex: number,
  stageIndex: number,
  context: Readonly<{
    readonly exploration: ExplorationState;
    readonly items: ItemState;
    readonly tick: number;
  }>,
  events: Readonly<{
    readonly kind: string;
    readonly values: readonly [number, number, number, number];
  }>[],
): QuestState {
  const stage = QUEST_DEFINITIONS[questIndex]?.stages[stageIndex];
  if (stage === undefined) throw new Error("Quest stage bootstrap identity is invalid");
  const offset = questObjectiveOffset(questIndex, stageIndex);
  let next = state;
  for (const [objectiveIndex, objective] of stage.objectives.entries()) {
    let progress = 0;
    if (objective.kind === "reach") {
      progress = Math.min(
        objective.count,
        objective.landmarkIds.filter((id) => {
          const landmarkIndex = NAMED_LANDMARKS.findIndex((landmark) => landmark.id === id);
          return (
            landmarkIndex >= 0 &&
            (context.exploration.discoveredLandmarkMask & (1 << landmarkIndex)) !== 0
          );
        }).length,
      );
    } else if (objective.kind === "collect") {
      progress = Math.min(
        objective.count,
        context.items.stackCounts[itemIndex(objective.itemId)] ?? 0,
      );
    }
    if (progress === 0) continue;
    const objectiveProgress = [...next.objectiveProgress];
    objectiveProgress[offset + objectiveIndex] = progress;
    next = Object.freeze({
      ...next,
      objectiveProgress: Object.freeze(objectiveProgress),
      objectiveProgressCount: next.objectiveProgressCount + 1,
    });
    next = appendJournal(
      next,
      context.tick,
      JOURNAL_KIND_OBJECTIVE_PROGRESS,
      questIndex,
      stageIndex,
      objectiveIndex,
      progress,
      progress,
    );
    events.push(
      event("quest.objective-progressed", questIndex, stageIndex, objectiveIndex, progress),
    );
  }
  return next;
}

function assertQuestSourceEvent(
  state: QuestState,
  kind: string,
  values: readonly [number, number, number, number],
): void {
  if (kind === "landmark.discovered") {
    const landmark = NAMED_LANDMARKS[values[0]];
    if (landmark === undefined || values[1] !== landmark.experience) {
      throw new Error("Quest landmark source event is invalid");
    }
    return;
  }
  if (kind === "combat.monster-defeated") {
    const kit = MONSTER_KITS[values[1]];
    if (kit === undefined || values[2] !== kit.xp || values[3] !== 0) {
      throw new Error("Quest combat source event is invalid");
    }
    return;
  }
  if (kind === "items.crafted") {
    if (values[0] !== ITEM_OPERATION_CRAFT || RECIPES[values[1]] === undefined || values[3] !== 1) {
      throw new Error("Quest craft source event is invalid");
    }
    return;
  }
  if (kind === "items.gathered") {
    if (
      values[0] !== ITEM_OPERATION_GATHER ||
      GATHERING_NODES[values[1]] === undefined ||
      values[3] !== 1
    ) {
      throw new Error("Quest gathering source event is invalid");
    }
    return;
  }
  if (kind === "items.purchased") {
    if (
      values[0] !== ITEM_OPERATION_BUY ||
      VENDOR_OFFERS[values[1]] === undefined ||
      values[3] !== 1
    ) {
      throw new Error("Quest purchase source event is invalid");
    }
    return;
  }
  if (kind === "items.satchel-recovered") {
    if (
      values[0] !== ITEM_OPERATION_RECOVER_SATCHEL ||
      values[1] !== 0 ||
      values[2] !== 0 ||
      values[3] !== 1
    ) {
      throw new Error("Quest satchel source event is invalid");
    }
    return;
  }
  if (kind !== "quest.intent-validated") return;
  const definition = QUEST_DEFINITIONS[values[1]];
  if (definition === undefined) throw new Error("Quest intent source quest is invalid");
  if (values[0] === 1) {
    if (values[2] !== 0 || values[3] !== 0) {
      throw new Error("Quest accept source event is invalid");
    }
    return;
  }
  const intent = QUEST_INTENTS[values[2]];
  const stageIndex = state.questStageIndexes[values[1]] ?? 0;
  if (
    values[0] !== 2 ||
    intent === undefined ||
    intent.questId !== definition.id ||
    intent.stageId !== definition.stages[stageIndex]?.id ||
    values[3] !== stageIndex ||
    (state.activeQuestMask & (1 << values[1])) === 0
  ) {
    throw new Error("Quest objective intent source event is invalid");
  }
}

function applyPreparationIntent(
  initial: QuestState,
  sourceEvent: QuestSemanticEvent,
  values: readonly [number, number, number, number],
  tick: number,
  events: Readonly<{
    readonly kind: string;
    readonly values: readonly [number, number, number, number];
  }>[],
): QuestState {
  if (sourceEvent.kind !== "quest.intent-validated" || values[0] !== 2) return initial;
  const intent = QUEST_INTENTS[values[2]];
  if (intent?.preparation === undefined) return initial;
  return setPreparation(
    initial,
    preparationFlag(intent.preparation),
    tick,
    values[1],
    values[3],
    events,
  );
}

function preparationFlag(preparation: NonNullable<QuestIntentDefinition["preparation"]>): number {
  return preparation === "boss-vents-doused"
    ? QUEST_PREPARATION_BOSS_VENTS_DOUSED
    : QUEST_PREPARATION_FOREST_PARLEYED;
}

function setPreparation(
  state: QuestState,
  flag: number,
  tick: number,
  questIndex: number,
  stageIndex: number,
  events: Readonly<{
    readonly kind: string;
    readonly values: readonly [number, number, number, number];
  }>[],
): QuestState {
  if ((state.preparationFlags & flag) !== 0) return state;
  let next = Object.freeze({ ...state, preparationFlags: state.preparationFlags | flag });
  next = appendJournal(
    next,
    tick,
    JOURNAL_KIND_PREPARATION_CHANGED,
    questIndex,
    stageIndex,
    NO_INDEX,
    flag,
    1,
  );
  events.push(event("quest.preparation-changed", questIndex, stageIndex, flag, 1));
  return next;
}

function objectiveProgressForEvent(
  objective: QuestObjectiveDefinition,
  prior: number,
  questIndex: number,
  sourceEvent: QuestSemanticEvent,
  values: readonly [number, number, number, number],
  exploration: ExplorationState,
  items: ItemState,
): number {
  const target = objectiveTarget(objective);
  if (prior >= target) return prior;
  if (objective.kind === "reach") {
    if (
      sourceEvent.kind !== "landmark.discovered" &&
      !(
        sourceEvent.kind === "quest.intent-validated" &&
        values[0] === 1 &&
        values[1] === questIndex
      )
    ) {
      return prior;
    }
    const discovered = objective.landmarkIds.filter((id) => {
      const index = NAMED_LANDMARKS.findIndex((landmark) => landmark.id === id);
      return index >= 0 && (exploration.discoveredLandmarkMask & (1 << index)) !== 0;
    }).length;
    return Math.min(target, Math.max(prior, discovered));
  }
  if (objective.kind === "collect") {
    if (
      sourceEvent.kind === "quest.intent-validated" &&
      (values[0] !== 1 || values[1] !== questIndex)
    ) {
      return prior;
    }
    if (!COLLECT_SOURCE_EVENT_KINDS.has(sourceEvent.kind)) return prior;
    return Math.min(target, Math.max(prior, items.stackCounts[itemIndex(objective.itemId)] ?? 0));
  }
  if (objective.kind === "defeat" && sourceEvent.kind === "combat.monster-defeated") {
    const kit = values[1];
    const matches = objective.kitIds.some((id) => MONSTER_KIT_INDEX_BY_ID.get(id) === kit);
    return matches ? Math.min(target, prior + 1) : prior;
  }
  if (objective.kind === "craft" && sourceEvent.kind === "items.crafted") {
    const recipe = RECIPES[values[1]];
    return recipe !== undefined && objective.recipeIds.includes(recipe.id)
      ? Math.min(target, prior + 1)
      : prior;
  }
  if (
    (objective.kind === "talk" || objective.kind === "deliver") &&
    sourceEvent.kind === "quest.intent-validated" &&
    values[0] === 2
  ) {
    const intent = QUEST_INTENTS[values[2]];
    return intent?.id === objective.intentId ? target : prior;
  }
  return prior;
}

const MONSTER_KIT_INDEX_BY_ID = new Map(MONSTER_KITS.map(({ id }, index) => [id, index] as const));

function objectiveTarget(objective: QuestObjectiveDefinition): number {
  return objective.kind === "talk" ? 1 : objective.count;
}

function preparationJournalIdentityMatches(
  questId: string,
  stageId: string,
  flag: number,
): boolean {
  if (flag === QUEST_PREPARATION_BOSS_VENTS_DOUSED) {
    return questId === "the-undercroft-stirs" && stageId === "the-apothecarys-ask";
  }
  if (flag === QUEST_PREPARATION_FOREST_PARLEYED) {
    return questId === "the-undercroft-stirs" && stageId === "the-forest-throat";
  }
  return questId === "relics-for-the-reliquary" && stageId === "restore-the-reliquary";
}

function stageComplete(
  objectives: readonly QuestObjectiveDefinition[],
  progress: readonly number[],
  offset: number,
  completion: "all" | "any",
): boolean {
  const complete = objectives.map(
    (candidate, index) => (progress[offset + index] ?? 0) >= objectiveTarget(candidate),
  );
  return completion === "all" ? complete.every(Boolean) : complete.some(Boolean);
}

function appendJournal(
  state: QuestState,
  tick: number,
  kind: number,
  questIndex: number,
  stageIndex: number,
  objectiveIndex: number,
  subject: number,
  amount: number,
): QuestState {
  if (state.journal.length >= QUEST_JOURNAL_CAPACITY)
    throw new Error("Quest journal capacity is exhausted");
  const entry = Object.freeze({
    amount,
    kind,
    objectiveIndex,
    questIndex,
    sequence: state.nextJournalSequence,
    stageIndex,
    subject,
    tick,
  });
  return Object.freeze({
    ...state,
    journal: Object.freeze([...state.journal, entry]),
    nextJournalSequence: state.nextJournalSequence + 1,
  });
}

function readEventValues(
  eventValue: QuestSemanticEvent,
): readonly [number, number, number, number] {
  if (eventValue.payload.byteLength !== 16) {
    if (QUEST_SOURCE_EVENT_KINDS.has(eventValue.kind)) {
      throw new Error(`Quest source event ${eventValue.kind} has an invalid payload`);
    }
    return [0, 0, 0, 0];
  }
  const view = new DataView(
    eventValue.payload.buffer,
    eventValue.payload.byteOffset,
    eventValue.payload.byteLength,
  );
  return [
    view.getUint32(0, true),
    view.getUint32(4, true),
    view.getUint32(8, true),
    view.getUint32(12, true),
  ];
}

function event(
  kind: string,
  first: number,
  second: number,
  third: number,
  fourth: number,
): Readonly<{ readonly kind: string; readonly values: readonly [number, number, number, number] }> {
  const values: readonly [number, number, number, number] = Object.freeze([
    first,
    second,
    third,
    fourth,
  ]);
  return Object.freeze({ kind, values });
}

function unsigned32(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff;
}
