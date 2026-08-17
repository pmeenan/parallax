import type {
  GameSimulationAdapter,
  GameSimulationContext,
  GreyboxAabbCollider,
  SimulationCommand,
  SimulationGameStateQuery,
  SimulationPresentationEntity,
  SimulationStepResult,
  SimulationWorldDefinition,
} from "@parallax/engine";
import { CHARACTER_CONTROLLER_BALANCE } from "../balance/character-controller";
import { MONSTER_KITS, monsterKitIndex } from "../balance/combat";
import {
  GEAR_AFFIXES,
  type GearSlot,
  ITEM_DEFINITIONS,
  ITEM_INTERACTION_RADII_METERS,
  type ItemId,
  itemIndex,
  RECIPES,
  type Resonance,
  recipeIndex,
  VENDOR_OFFERS,
  vendorOfferIndex,
} from "../balance/items";
import { NPC_CROWD_BALANCE } from "../balance/npc-crowd";
import {
  PROGRESSION_ABILITIES,
  PROGRESSION_ATTRIBUTES,
  PROGRESSION_RESHAPE_MARK_COST,
  type ProgressionAbilityId,
  type ProgressionAttributeId,
} from "../balance/progression";
import {
  QUEST_DEFINITIONS,
  QUEST_INTENTS,
  questIndex,
  questIntentIndex,
  questObjectiveOffset,
} from "../balance/quests";
import { isConversationalNpcEntityId, NPC_ENTITY_ID_START } from "../npc/identity";
import { executeM3NpcKnowledgeQuery } from "../npc/knowledge";
import { M3_NPC_KNOWLEDGE_PROFILES } from "../npc/knowledge-data";
import { creatureSpawnsForDistrict } from "../world/creature-spawns";
import { GATHERING_NODES, gatheringNodeIndex } from "../world/gathering-nodes";
import { NAMED_LANDMARKS } from "../world/landmarks";
import { lowBitsMask } from "./bitmask";
import {
  COMBAT_ACTION_DOWNED,
  COMBAT_ACTION_IDLE,
  type CombatantSheet,
  derivePlayerSheet,
} from "./combat-core";
import {
  buildDeterministicNavigationMesh,
  type DeterministicNavigationMesh,
} from "./deterministic-navigation";
import {
  assertExplorationState,
  createInitialExplorationState,
  deserializeExplorationState,
  discoverNearbyLandmarks,
  EXPLORATION_STATE_BYTES,
  type ExplorationState,
  resolveNamedLandmarks,
  serializeExplorationState,
} from "./exploration";
import {
  applyGearUpgrade,
  assertItemState,
  awardMonsterLoot,
  buyVendorItem,
  clearVigorHealing,
  consumeVigorHealing,
  craftRecipe,
  createInitialItemState,
  deserializeItemState,
  dropMaterialSatchel,
  equipGear,
  equippedSerials,
  gatherItemNode,
  ITEM_STATE_BYTES,
  type ItemState,
  itemCombatBonuses,
  recoverMaterialSatchel,
  removeItemStack,
  resonanceCode,
  resonanceFromCode,
  sellGear,
  sellItemStack,
  serializeItemState,
  spendMarks,
  stepItemEffects,
  unequipGear,
  useConsumable,
} from "./items";
import {
  applyCombatInput,
  applyForestParleyPreparation,
  assertCombatState,
  COMBAT_PRESSED_DEBUG_SPAWN,
  COMBAT_PRESSED_MASK,
  COMBAT_STATE_BYTES,
  type CombatWorldView,
  combatTelemetryCounters,
  createInitialM3CombatState,
  deserializeCombatState,
  horizontalDistance,
  type M3CombatState,
  MONSTER_ENTITY_ID_START,
  MONSTER_HALF_HEIGHT_METERS,
  playerMovementProfile,
  serializeCombatState,
  spawnMonster,
  stepM3Combat,
} from "./m3-combat-system";
import { buildNpcScheduleSet, type NpcScheduleSet } from "./npc-schedules";
import {
  assertProgressionState,
  awardExperience,
  createInitialProgressionState,
  deserializeProgressionState,
  type ExperienceAwardResult,
  equipAbility,
  learnAbility,
  PROGRESSION_STATE_BYTES,
  type ProgressionState,
  progressionCombatProfile,
  reshapeProgression,
  serializeProgressionState,
  spendAttributePoint,
} from "./progression";
import {
  applyQuestSemanticEvents,
  assertQuestExplorationConsistency,
  assertQuestState,
  createInitialQuestState,
  deserializeQuestState,
  isLandmarkJournalKind,
  journalLocalizationKey,
  QUEST_JOURNAL_QUERY_MAXIMUM_ENTRIES,
  QUEST_STATE_BYTES,
  type QuestState,
  questPreparationRecorded,
  questPreparationSnapshot,
  serializeQuestState,
} from "./quests";

export const GAME_SIMULATION_STATE_SCHEMA_VERSION = 10;
export const PLAYER_ENTITY_ID = 1;
export { NPC_ENTITY_ID_START } from "../npc/identity";
export { MONSTER_ENTITY_ID_START } from "./m3-combat-system";

interface NpcAgentState {
  readonly dwellTicks: number;
  readonly entityId: number;
  readonly pathCursor: number;
  readonly position: readonly [number, number, number];
  readonly routeIndex: number;
  readonly targetStopIndex: number;
  readonly yawRadians: number;
}

interface M3SimulationState {
  readonly collisionResolutionCount: number;
  readonly combat: M3CombatState;
  readonly exploration: ExplorationState;
  readonly inputForward: number;
  readonly inputRight: number;
  readonly interactionActivationCount: number;
  readonly interactionAttemptCount: number;
  readonly interactionRequested: boolean;
  readonly items: ItemState;
  readonly lastInteractionMarkerIndex: number;
  readonly movementDistanceMeters: number;
  readonly npcAgents: readonly NpcAgentState[];
  readonly npcAvoidanceAdjustmentCount: number;
  readonly npcMovementDistanceMeters: number;
  readonly npcMovingAgentCount: number;
  readonly npcScheduleTransitionCount: number;
  readonly playerPosition: readonly [number, number, number];
  readonly playerYawRadians: number;
  readonly progression: ProgressionState;
  readonly quests: QuestState;
  readonly rngState: number;
  readonly schemaVersion: typeof GAME_SIMULATION_STATE_SCHEMA_VERSION;
}

interface ControllerWorld {
  readonly district: SimulationWorldDefinition;
  readonly obstacles: readonly GreyboxAabbCollider[];
  readonly transitionMarkerIndexes: readonly number[];
}

interface CrowdStep {
  readonly agents: readonly NpcAgentState[];
  readonly avoidanceAdjustmentCount: number;
  readonly movementDistanceMeters: number;
  readonly movingAgentCount: number;
  readonly scheduleTransitionCount: number;
}

type InteractionTarget =
  | Readonly<{ readonly kind: "npc"; readonly value: number }>
  | Readonly<{ readonly kind: "transition"; readonly value: number }>;

const EMPTY_EVENTS = Object.freeze([]);
const INPUT_COMMAND_KIND = "player.input-axes@3";
const INPUT_PAYLOAD_BYTES = 24;
const INPUT_INTERACT_PRESSED = 1;
const INPUT_BLOCK_HELD = 2;
const INPUT_FLAGS_MASK = INPUT_INTERACT_PRESSED | INPUT_BLOCK_HELD;
const SPAWN_COMMAND_KIND = "combat.spawn-monster@1";
const SPAWN_PAYLOAD_BYTES = 16;
const STATE_HEADER_BYTES = 96;
const NPC_STATE_BYTES = 32;
const NPC_BLOCK_BYTES = NPC_CROWD_BALANCE.agentCount * NPC_STATE_BYTES;
const STATE_BYTES = STATE_HEADER_BYTES + NPC_BLOCK_BYTES + COMBAT_STATE_BYTES;
const PROGRESSION_COMMAND_KIND = "progression.command@1";
const PROGRESSION_PAYLOAD_BYTES = 16;
const PROGRESSION_OP_SPEND_ATTRIBUTE = 1;
const PROGRESSION_OP_LEARN_ABILITY = 2;
const PROGRESSION_OP_EQUIP_ACTIVE = 3;
const PROGRESSION_OP_EQUIP_KNACK = 4;
const PROGRESSION_EMPTY_ABILITY = 0xffff_ffff;
const PROGRESSION_OFFSET = STATE_HEADER_BYTES + NPC_BLOCK_BYTES + COMBAT_STATE_BYTES;
const ITEM_OFFSET = PROGRESSION_OFFSET + PROGRESSION_STATE_BYTES;
const EXPLORATION_OFFSET = ITEM_OFFSET + ITEM_STATE_BYTES;
const QUEST_OFFSET = EXPLORATION_OFFSET + EXPLORATION_STATE_BYTES;
const VERSIONED_STATE_BYTES =
  STATE_BYTES +
  PROGRESSION_STATE_BYTES +
  ITEM_STATE_BYTES +
  EXPLORATION_STATE_BYTES +
  QUEST_STATE_BYTES;
const ITEM_COMMAND_KIND = "items.command@1";
const ITEM_PAYLOAD_BYTES = 24;
const ITEM_OPERATIONS = Object.freeze({
  buy: Object.freeze({ code: 3, eventKind: "items.purchased" }),
  craft: Object.freeze({ code: 2, eventKind: "items.crafted" }),
  equip: Object.freeze({ code: 6, eventKind: "items.equipped" }),
  gather: Object.freeze({ code: 1, eventKind: "items.gathered" }),
  recoverSatchel: Object.freeze({ code: 9, eventKind: "items.satchel-recovered" }),
  reshape: Object.freeze({ code: 10, eventKind: "progression.reshaped" }),
  sellGear: Object.freeze({ code: 5, eventKind: "items.sold" }),
  sellStack: Object.freeze({ code: 4, eventKind: "items.sold" }),
  upgrade: Object.freeze({ code: 8, eventKind: "items.upgraded" }),
  use: Object.freeze({ code: 7, eventKind: "items.consumed" }),
});
const ITEM_OPERATION_BY_CODE: ReadonlyMap<
  number,
  Readonly<{ readonly code: number; readonly eventKind: string }>
> = new Map(
  Object.values(ITEM_OPERATIONS).map((operation) => [operation.code, operation] as const),
);
const INVENTORY_QUERY_KIND = "inventory.snapshot@1";
const LANDMARK_QUERY_KIND = "landmarks.snapshot@1";
const QUEST_QUERY_KIND = "quests.snapshot@1";
const JOURNAL_QUERY_KIND = "journal.snapshot@1";
const QUEST_COMMAND_KIND = "quests.command@1";
const QUEST_PAYLOAD_BYTES = 16;
const QUEST_OP_ACCEPT = 1;
const QUEST_OP_INTENT = 2;
const INVENTORY_TEXT_ENCODER = new TextEncoder();

export function createGameSimulationAdapter(
  context: GameSimulationContext,
): GameSimulationAdapter<M3SimulationState> {
  if (!Number.isSafeInteger(context.timestepHz) || context.timestepHz <= 0) {
    throw new Error("Game simulation timestep is invalid");
  }
  const world = createControllerWorld(context.world);
  const navigation = buildDeterministicNavigationMesh(context.world, {
    agentRadiusMeters: NPC_CROWD_BALANCE.agentRadiusMeters,
    maximumGroundStepMeters: NPC_CROWD_BALANCE.maximumGroundStepMeters,
    sampleSpacingMeters: NPC_CROWD_BALANCE.navigationSampleSpacingMeters,
  });
  for (const node of GATHERING_NODES.filter(({ districtId }) => districtId === context.world.id)) {
    if (!navigation.isWalkablePosition(node.position[0], node.position[1])) {
      throw new Error(`Gathering node ${node.id} is outside the navigation projection`);
    }
  }
  const schedules = buildNpcScheduleSet(context.world, navigation);
  const landmarks = resolveNamedLandmarks(context.world);
  for (const { landmark, position } of landmarks) {
    if (!navigation.isWalkablePosition(position[0], position[2])) {
      throw new Error(`Named landmark ${landmark.id} is outside the navigation projection`);
    }
  }
  const spawnMarker = context.world.markers.find(({ tags }) => tags.includes("player-spawn"));
  if (spawnMarker === undefined) throw new Error("World has no authored player spawn marker");
  const spawnX = spawnMarker.position[0];
  const spawnZ = spawnMarker.position[2];
  const tickSeconds = 1 / context.timestepHz;
  const combatWorld: CombatWorldView = Object.freeze({
    canTraverseSegment: (
      start: readonly [number, number, number],
      target: readonly [number, number, number],
    ) => navigation.canTraverseSegment(start, target),
    groundHeight: (x: number, z: number) => navigation.groundHeight(x, z),
    isWalkablePosition: (x: number, z: number) => navigation.isWalkablePosition(x, z),
    maximumX: context.world.bounds.maximum[0],
    maximumZ: context.world.bounds.maximum[2],
    minimumX: context.world.bounds.minimum[0],
    minimumZ: context.world.bounds.minimum[2],
    obstacles: world.obstacles,
  });
  const spawnPointPosition = (): readonly [number, number, number] =>
    Object.freeze([
      spawnX,
      Math.fround(
        navigation.groundHeight(spawnX, spawnZ) + CHARACTER_CONTROLLER_BALANCE.halfHeightMeters,
      ),
      spawnZ,
    ]) as readonly [number, number, number];
  const applyQuestEvents = (
    result: SimulationStepResult<M3SimulationState>,
    tick: number,
  ): SimulationStepResult<M3SimulationState> => {
    const questResult = applyQuestSemanticEvents(result.state.quests, result.events, {
      exploration: result.state.exploration,
      items: result.state.items,
      tick,
    });
    // Every quest event, XP award, and preparation transition accompanies a quest-state
    // change, so an unchanged reducer result means there is nothing to append.
    if (questResult.state === result.state.quests) return result;
    let progression = result.state.progression;
    let combat = result.state.combat;
    const priorPreparation = questPreparationSnapshot(result.state.quests);
    const nextPreparation = questPreparationSnapshot(questResult.state);
    const preparationEvents: Readonly<{
      readonly kind: string;
      readonly payload: Uint8Array;
    }>[] = [];
    if (!priorPreparation.forestEntranceParleyed && nextPreparation.forestEntranceParleyed) {
      const prepared = applyForestParleyPreparation(combat);
      combat = prepared.state;
      preparationEvents.push(
        ...prepared.events.map((eventValue) =>
          Object.freeze({ kind: eventValue.kind, payload: combatEventPayload(eventValue.values) }),
        ),
      );
    }
    const experienceEvents: Readonly<{ readonly kind: string; readonly payload: Uint8Array }>[] =
      [];
    for (const awardDefinition of questResult.experienceAwards) {
      const award = awardExperience(progression, awardDefinition.amount);
      progression = award.state;
      experienceEvents.push(progressionExperienceEvent(awardDefinition.amount, award));
    }
    return Object.freeze({
      events: Object.freeze([
        ...result.events,
        ...questResult.events.map((eventValue) =>
          Object.freeze({ kind: eventValue.kind, payload: combatEventPayload(eventValue.values) }),
        ),
        ...preparationEvents,
        ...experienceEvents,
      ]),
      state: Object.freeze({
        ...result.state,
        combat,
        progression,
        quests: questResult.state,
      }),
    });
  };
  return Object.freeze({
    applyCommand(
      state: M3SimulationState,
      command: SimulationCommand,
    ): SimulationStepResult<M3SimulationState> {
      if (command.kind === QUEST_COMMAND_KIND) {
        if (command.payload.byteLength !== QUEST_PAYLOAD_BYTES) {
          throw new Error("Quest command payload is invalid");
        }
        const view = new DataView(
          command.payload.buffer,
          command.payload.byteOffset,
          command.payload.byteLength,
        );
        const operation = view.getUint32(0, true);
        const questIndexValue = view.getUint32(4, true);
        const intentIndex = view.getUint32(8, true);
        if (view.getUint32(12, true) !== 0) throw new Error("Quest command payload is invalid");
        const definition = QUEST_DEFINITIONS[questIndexValue];
        if (definition === undefined) throw new Error("Quest command identity is invalid");
        let items = state.items;
        let applied = false;
        let eventIntentIndex = intentIndex;
        if (operation === QUEST_OP_ACCEPT) {
          if (intentIndex !== 0) throw new Error("Quest accept command is invalid");
          const bit = 1 << questIndexValue;
          applied =
            (state.quests.activeQuestMask & bit) === 0 &&
            (state.quests.completedQuestMask & bit) === 0;
          eventIntentIndex = 0;
        } else if (operation === QUEST_OP_INTENT) {
          const intent = QUEST_INTENTS[intentIndex];
          const stageIndex = state.quests.questStageIndexes[questIndexValue] ?? 0;
          const stage = definition.stages[stageIndex];
          if (
            intent === undefined ||
            intent.questId !== definition.id ||
            intent.stageId !== stage?.id ||
            (state.quests.activeQuestMask & (1 << questIndexValue)) === 0 ||
            // A preparation already recorded is a no-op; reject it before any delivery
            // cost is validated or consumed so a repeated intent cannot double-charge.
            (intent.preparation !== undefined &&
              questPreparationRecorded(state.quests, intent.preparation))
          ) {
            applied = false;
          } else {
            applied = (intent.delivery ?? []).every(
              ({ itemId, quantity }) => (items.stackCounts[itemIndex(itemId)] ?? 0) >= quantity,
            );
            if (applied) {
              for (const delivery of intent.delivery ?? []) {
                items = removeItemStack(items, delivery.itemId, delivery.quantity);
              }
            }
          }
        } else {
          throw new Error("Quest command operation is invalid");
        }
        const source = Object.freeze({
          events: Object.freeze([
            Object.freeze({
              kind: applied ? "quest.intent-validated" : "quest.intent-rejected",
              payload: combatEventPayload([
                operation,
                questIndexValue,
                eventIntentIndex,
                operation === QUEST_OP_INTENT
                  ? (state.quests.questStageIndexes[questIndexValue] ?? 0)
                  : 0,
              ]),
            }),
          ]),
          state: applied && items !== state.items ? Object.freeze({ ...state, items }) : state,
        });
        return applied ? applyQuestEvents(source, command.targetTick) : source;
      }
      if (command.kind === ITEM_COMMAND_KIND) {
        if (command.payload.byteLength !== ITEM_PAYLOAD_BYTES) {
          throw new Error("Item command payload is invalid");
        }
        const view = new DataView(
          command.payload.buffer,
          command.payload.byteOffset,
          command.payload.byteLength,
        );
        const operation = view.getUint32(0, true);
        const primary = view.getUint32(4, true);
        const secondary = view.getUint32(8, true);
        const tertiary = view.getUint32(12, true);
        if (view.getUint32(16, true) !== 0 || view.getUint32(20, true) !== 0) {
          throw new Error("Item command payload is invalid");
        }
        if (tertiary !== 0) throw new Error("Item command payload is invalid");
        if (
          state.combat.player.actionKind !== COMBAT_ACTION_IDLE ||
          state.combat.queuedActionId !== -1
        ) {
          return applyQuestEvents(
            itemCommandResult(state, false, operation, primary, secondary),
            command.targetTick,
          );
        }
        const priorSheet = derivePlayerSheet(
          progressionCombatProfile(state.progression, itemCombatBonuses(state.items)),
        );
        let items = state.items;
        let progression = state.progression;
        let combat = state.combat;
        let applied = false;
        if (operation === ITEM_OPERATIONS.gather.code) {
          const node = GATHERING_NODES[primary];
          if (node === undefined || secondary !== 0) {
            throw new Error("Gather command is invalid");
          }
          if (
            node.districtId === context.world.id &&
            horizontalDistance(state.playerPosition, [node.position[0], 0, node.position[1]]) <=
              ITEM_INTERACTION_RADII_METERS.gathering
          ) {
            const result = gatherItemNode(
              items,
              primary,
              node.itemId,
              node.quantity,
              progression.knackSlots.includes("foragers-eye"),
            );
            items = result.state;
            applied = result.applied;
          }
        } else if (operation === ITEM_OPERATIONS.craft.code) {
          const recipe = RECIPES[primary];
          const resonance = resonanceFromCode(secondary);
          if (recipe === undefined || resonance === undefined) {
            throw new Error("Craft command is invalid");
          }
          if (
            nearMarkerTag(
              context.world,
              state.playerPosition,
              recipe.station,
              ITEM_INTERACTION_RADII_METERS.station,
            )
          ) {
            const result = craftRecipe(
              items,
              primary,
              resonance,
              progression.knackSlots.includes("tinkers-thrift"),
            );
            items = result.state;
            applied = result.applied;
          }
        } else if (operation === ITEM_OPERATIONS.buy.code) {
          const offer = VENDOR_OFFERS[primary];
          if (offer === undefined || secondary !== 0) {
            throw new Error("Buy command is invalid");
          }
          if (
            nearMarkerTag(
              context.world,
              state.playerPosition,
              offer.markerTag,
              ITEM_INTERACTION_RADII_METERS.station,
            )
          ) {
            const result = buyVendorItem(items, primary);
            items = result.state;
            applied = result.applied;
          }
        } else if (operation === ITEM_OPERATIONS.sellStack.code) {
          const item = ITEM_DEFINITIONS[primary];
          if (item === undefined || secondary !== 0) {
            throw new Error("Sell-stack command is invalid");
          }
          if (nearTradeMarker(context.world, state.playerPosition)) {
            const result = sellItemStack(items, item.id);
            items = result.state;
            applied = result.applied;
          }
        } else if (operation === ITEM_OPERATIONS.sellGear.code) {
          if (secondary !== 0) throw new Error("Sell-gear command is invalid");
          if (nearTradeMarker(context.world, state.playerPosition)) {
            const result = sellGear(items, primary);
            items = result.state;
            applied = result.applied;
          }
        } else if (operation === ITEM_OPERATIONS.equip.code) {
          const slot = gearSlotFromCode(secondary);
          if (secondary === 0) {
            const result = equipGear(items, primary);
            items = result.state;
            applied = result.applied;
          } else {
            if (primary !== 0 || slot === undefined) throw new Error("Equip command is invalid");
            const result = unequipGear(items, slot);
            items = result.state;
            applied = result.applied;
          }
        } else if (operation === ITEM_OPERATIONS.use.code) {
          const item = ITEM_DEFINITIONS[primary];
          if (item === undefined || secondary !== 0) {
            throw new Error("Use command is invalid");
          }
          const result = useConsumable(items, item.id);
          items = result.state;
          applied = result.applied;
          if (result.effect?.kind === "aether") {
            combat = Object.freeze({
              ...combat,
              player: Object.freeze({
                ...combat.player,
                aether: Math.min(priorSheet.maxAether, combat.player.aether + result.effect.aether),
              }),
            });
          }
          if (result.effect?.kind === "clearing") {
            combat = Object.freeze({
              ...combat,
              player: Object.freeze({
                ...combat.player,
                conditions: Object.freeze({
                  ...combat.player.conditions,
                  burningTicks: 0,
                  chilledTicks: 0,
                  envenomedTicks: 0,
                }),
              }),
            });
          }
        } else if (operation === ITEM_OPERATIONS.upgrade.code) {
          if (secondary !== 1 && secondary !== 2) {
            throw new Error("Upgrade command is invalid");
          }
          const result = applyGearUpgrade(
            items,
            primary,
            secondary === 1 ? "weapon-whetting" : "armor-fitting",
          );
          items = result.state;
          applied = result.applied;
        } else if (operation === ITEM_OPERATIONS.recoverSatchel.code) {
          if (primary !== 0 || secondary !== 0) {
            throw new Error("Satchel recovery command is invalid");
          }
          if (
            items.satchelActive &&
            horizontalDistance(state.playerPosition, items.satchelPosition) <=
              ITEM_INTERACTION_RADII_METERS.satchel
          ) {
            const result = recoverMaterialSatchel(items);
            items = result.state;
            applied = result.applied;
          }
        } else if (operation === ITEM_OPERATIONS.reshape.code) {
          if (primary !== 0 || secondary !== 0) {
            throw new Error("Reshape command is invalid");
          }
          if (
            items.marks >= PROGRESSION_RESHAPE_MARK_COST &&
            nearWaystone(context.world, state.playerPosition)
          ) {
            const reshaped = reshapeProgression(progression);
            if (!sameProgressionBuild(progression, reshaped)) {
              progression = reshaped;
              const payment = spendMarks(items, PROGRESSION_RESHAPE_MARK_COST);
              items = payment.state;
              applied = payment.applied;
            }
          }
        } else {
          throw new Error("Item command operation is invalid");
        }
        if (!applied) {
          return applyQuestEvents(
            itemCommandResult(state, false, operation, primary, secondary),
            command.targetTick,
          );
        }
        const nextSheet = derivePlayerSheet(
          progressionCombatProfile(progression, itemCombatBonuses(items)),
        );
        const next = Object.freeze({
          ...state,
          combat: reconcilePlayerCombatSheet(combat, priorSheet, nextSheet),
          items,
          progression,
        });
        return applyQuestEvents(
          itemCommandResult(next, true, operation, primary, secondary),
          command.targetTick,
        );
      }
      if (command.kind === PROGRESSION_COMMAND_KIND) {
        if (command.payload.byteLength !== PROGRESSION_PAYLOAD_BYTES) {
          throw new Error("Progression command payload is invalid");
        }
        const view = new DataView(
          command.payload.buffer,
          command.payload.byteOffset,
          command.payload.byteLength,
        );
        const operation = view.getUint32(0, true);
        const value = view.getUint32(4, true);
        const slot = view.getUint32(8, true);
        if (view.getUint32(12, true) !== 0) {
          throw new Error("Progression command payload is invalid");
        }
        if (
          state.combat.player.actionKind !== COMBAT_ACTION_IDLE ||
          state.combat.queuedActionId !== -1
        ) {
          return progressionCommandResult(state, false, operation, value, slot);
        }
        let progression = state.progression;
        if (operation === PROGRESSION_OP_SPEND_ATTRIBUTE) {
          const attribute = PROGRESSION_ATTRIBUTES[value];
          if (attribute === undefined || slot !== 0) {
            throw new Error("Progression attribute command is invalid");
          }
          progression = spendAttributePoint(progression, attribute);
        } else if (operation === PROGRESSION_OP_LEARN_ABILITY) {
          const ability = PROGRESSION_ABILITIES[value];
          if (ability === undefined || slot !== 0) {
            throw new Error("Progression learn command is invalid");
          }
          progression = learnAbility(progression, ability.id);
        } else if (
          operation === PROGRESSION_OP_EQUIP_ACTIVE ||
          operation === PROGRESSION_OP_EQUIP_KNACK
        ) {
          const ability = value === PROGRESSION_EMPTY_ABILITY ? null : PROGRESSION_ABILITIES[value];
          if (value !== PROGRESSION_EMPTY_ABILITY && ability === undefined) {
            throw new Error("Progression loadout command is invalid");
          }
          progression = equipAbility(
            progression,
            operation === PROGRESSION_OP_EQUIP_ACTIVE ? "active" : "knack",
            slot,
            ability?.id ?? null,
          );
        } else {
          throw new Error("Progression command operation is invalid");
        }
        if (progression === state.progression) {
          return progressionCommandResult(state, false, operation, value, slot);
        }
        const bonuses = itemCombatBonuses(state.items);
        const priorSheet = derivePlayerSheet(progressionCombatProfile(state.progression, bonuses));
        const nextSheet = derivePlayerSheet(progressionCombatProfile(progression, bonuses));
        return progressionCommandResult(
          Object.freeze({
            ...state,
            combat: reconcilePlayerCombatSheet(state.combat, priorSheet, nextSheet),
            progression,
          }),
          true,
          operation,
          value,
          slot,
        );
      }
      if (command.kind === SPAWN_COMMAND_KIND) {
        if (command.payload.byteLength !== SPAWN_PAYLOAD_BYTES) {
          throw new Error("Monster spawn command payload is invalid");
        }
        const view = new DataView(
          command.payload.buffer,
          command.payload.byteOffset,
          command.payload.byteLength,
        );
        const kitIndex = view.getUint32(0, true);
        const x = view.getFloat32(4, true);
        const z = view.getFloat32(8, true);
        if (view.getUint32(12, true) !== 0 || !Number.isFinite(x) || !Number.isFinite(z)) {
          throw new Error("Monster spawn command payload is invalid");
        }
        const spawned = spawnMonster(state.combat, kitIndex, x, z, combatWorld);
        if (spawned === null) return Object.freeze({ events: EMPTY_EVENTS, state });
        return Object.freeze({
          events: Object.freeze([
            Object.freeze({
              kind: "combat.spawned",
              payload: combatEventPayload([spawned.entityId, kitIndex, 0, 0]),
            }),
          ]),
          state: Object.freeze({ ...state, combat: spawned.state }),
        });
      }
      if (command.kind !== INPUT_COMMAND_KIND) {
        throw new Error(`Unsupported game simulation command ${command.kind}`);
      }
      if (command.payload.byteLength !== INPUT_PAYLOAD_BYTES) {
        throw new Error("Player input command payload is invalid");
      }
      const view = new DataView(
        command.payload.buffer,
        command.payload.byteOffset,
        command.payload.byteLength,
      );
      const inputForward = view.getFloat32(0, true);
      const inputRight = view.getFloat32(4, true);
      const playerYawRadians = view.getFloat32(8, true);
      const flags = view.getUint32(12, true);
      const combatPressed = view.getUint32(16, true);
      const reserved = view.getUint32(20, true);
      assertInputState(inputForward, inputRight, playerYawRadians, flags, combatPressed, reserved);
      const interactionPressed = (flags & INPUT_INTERACT_PRESSED) !== 0;
      const blockHeld = (flags & INPUT_BLOCK_HELD) !== 0;
      let combat = applyCombatInput(state.combat, combatPressed, blockHeld);
      const events: Readonly<{ readonly kind: string; readonly payload: Uint8Array }>[] = [
        Object.freeze({ kind: "input.command-applied", payload: command.payload.slice() }),
      ];
      if ((combatPressed & COMBAT_PRESSED_DEBUG_SPAWN) !== 0) {
        const spawnDistance = 8;
        const spawned = spawnMonster(
          combat,
          monsterKitIndex("greymaw"),
          state.playerPosition[0] + Math.sin(playerYawRadians) * spawnDistance,
          state.playerPosition[2] + Math.cos(playerYawRadians) * spawnDistance,
          combatWorld,
        );
        if (spawned !== null) {
          combat = spawned.state;
          events.push(
            Object.freeze({
              kind: "combat.spawned",
              payload: combatEventPayload([spawned.entityId, monsterKitIndex("greymaw"), 0, 0]),
            }),
          );
        }
      }
      return Object.freeze({
        events: Object.freeze(events),
        state: Object.freeze({
          ...state,
          combat,
          inputForward,
          inputRight,
          interactionAttemptCount: state.interactionAttemptCount + Number(interactionPressed),
          interactionRequested: state.interactionRequested || interactionPressed,
          playerYawRadians,
        }),
      });
    },
    createInitialState(seed: number): M3SimulationState {
      const progression = createInitialProgressionState();
      const items = createInitialItemState(seed);
      const playerSheet = derivePlayerSheet(
        progressionCombatProfile(progression, itemCombatBonuses(items)),
      );
      let combat = createInitialM3CombatState(seed, playerSheet);
      const encounterGroupByAuthoredPack = new Map<number, number>();
      for (const authored of creatureSpawnsForDistrict(context.world.id)) {
        if (!navigation.isWalkablePosition(authored.position[0], authored.position[1])) {
          throw new Error(`Creature spawn ${authored.id} is outside the navigation projection`);
        }
        const encounterGroupId =
          authored.packId === 0
            ? 0
            : (encounterGroupByAuthoredPack.get(authored.packId) ??
              MONSTER_ENTITY_ID_START + combat.spawnCounter);
        const spawned = spawnMonster(
          combat,
          monsterKitIndex(authored.kitId),
          authored.position[0],
          authored.position[1],
          combatWorld,
          encounterGroupId,
        );
        if (spawned === null)
          throw new Error(`Creature spawn ${authored.id} exceeds combat capacity`);
        if (authored.packId > 0 && !encounterGroupByAuthoredPack.has(authored.packId)) {
          encounterGroupByAuthoredPack.set(authored.packId, spawned.entityId);
        }
        combat = spawned.state;
      }
      return Object.freeze({
        collisionResolutionCount: 0,
        combat,
        exploration: createInitialExplorationState(),
        inputForward: 0,
        inputRight: 0,
        interactionActivationCount: 0,
        interactionAttemptCount: 0,
        interactionRequested: false,
        items,
        lastInteractionMarkerIndex: -1,
        movementDistanceMeters: 0,
        npcAgents: createInitialNpcAgents(navigation, schedules),
        npcAvoidanceAdjustmentCount: 0,
        npcMovementDistanceMeters: 0,
        npcMovingAgentCount: 0,
        npcScheduleTransitionCount: 0,
        playerPosition: Object.freeze([
          spawnX,
          navigation.groundHeight(spawnX, spawnZ) + CHARACTER_CONTROLLER_BALANCE.halfHeightMeters,
          spawnZ,
        ]) as readonly [number, number, number],
        playerYawRadians: 0,
        progression,
        quests: createInitialQuestState(),
        rngState: seed >>> 0,
        schemaVersion: GAME_SIMULATION_STATE_SCHEMA_VERSION,
      });
    },
    deserializeState(bytes: Uint8Array): M3SimulationState {
      if (bytes.byteLength !== VERSIONED_STATE_BYTES) {
        throw new Error("Game simulation state is truncated");
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (view.getUint32(0, true) !== GAME_SIMULATION_STATE_SCHEMA_VERSION) {
        throw new Error("Game simulation state schema is incompatible");
      }
      const interactionRequestedValue = view.getUint32(56, true);
      if (interactionRequestedValue !== 0 && interactionRequestedValue !== 1) {
        throw new Error("Game simulation state contains a noncanonical interaction flag");
      }
      if (view.getUint32(64, true) !== NPC_CROWD_BALANCE.agentCount) {
        throw new Error("Game simulation state has an incompatible NPC crowd size");
      }
      const npcAgents = Object.freeze(
        Array.from({ length: NPC_CROWD_BALANCE.agentCount }, (_, index) => {
          const offset = STATE_HEADER_BYTES + index * NPC_STATE_BYTES;
          if (view.getUint32(offset + 28, true) !== 0) {
            throw new Error("Game simulation NPC state contains noncanonical reserved bytes");
          }
          return Object.freeze({
            dwellTicks: view.getUint16(offset + 10, true),
            entityId: view.getUint32(offset, true),
            pathCursor: view.getUint16(offset + 8, true),
            position: Object.freeze([
              view.getFloat32(offset + 12, true),
              view.getFloat32(offset + 16, true),
              view.getFloat32(offset + 20, true),
            ]) as readonly [number, number, number],
            routeIndex: view.getUint16(offset + 4, true),
            targetStopIndex: view.getUint16(offset + 6, true),
            yawRadians: view.getFloat32(offset + 24, true),
          });
        }),
      );
      const progression = deserializeProgressionState(view, PROGRESSION_OFFSET);
      const items = deserializeItemState(view, ITEM_OFFSET);
      const state = Object.freeze({
        collisionResolutionCount: view.getUint32(44, true),
        combat: deserializeCombatState(view, STATE_HEADER_BYTES + NPC_BLOCK_BYTES),
        exploration: deserializeExplorationState(view, EXPLORATION_OFFSET),
        inputForward: view.getFloat32(8, true),
        inputRight: view.getFloat32(12, true),
        interactionActivationCount: view.getUint32(52, true),
        interactionAttemptCount: view.getUint32(48, true),
        interactionRequested: interactionRequestedValue === 1,
        items,
        lastInteractionMarkerIndex: view.getInt32(60, true),
        movementDistanceMeters: view.getFloat64(32, true),
        npcAgents,
        npcAvoidanceAdjustmentCount: view.getFloat64(68, true),
        npcMovementDistanceMeters: view.getFloat64(80, true),
        npcMovingAgentCount: view.getUint32(76, true),
        npcScheduleTransitionCount: view.getFloat64(88, true),
        playerPosition: Object.freeze([
          view.getFloat32(20, true),
          view.getFloat32(24, true),
          view.getFloat32(28, true),
        ]) as readonly [number, number, number],
        playerYawRadians: view.getFloat32(16, true),
        progression,
        quests: deserializeQuestState(view, QUEST_OFFSET),
        rngState: view.getUint32(4, true),
        schemaVersion: GAME_SIMULATION_STATE_SCHEMA_VERSION,
      });
      assertState(state, world.district.markers.length, navigation, schedules);
      return state;
    },
    presentationSnapshot(state: M3SimulationState): readonly SimulationPresentationEntity[] {
      return Object.freeze([
        Object.freeze({
          id: PLAYER_ENTITY_ID,
          position: state.playerPosition,
          yawRadians: state.playerYawRadians,
        }),
        ...state.npcAgents.map((agent) =>
          Object.freeze({
            id: agent.entityId,
            position: agent.position,
            yawRadians: agent.yawRadians,
          }),
        ),
        ...state.combat.monsters.map((monster) =>
          Object.freeze({
            id: monster.entityId,
            position: monster.position,
            yawRadians: monster.yawRadians,
          }),
        ),
      ]);
    },
    queryState(state: M3SimulationState, query: SimulationGameStateQuery): Uint8Array {
      assertState(state, world.district.markers.length, navigation, schedules);
      if (query.kind === INVENTORY_QUERY_KIND) {
        if (query.payload.byteLength !== 0) throw new Error("Inventory query payload is invalid");
        return inventoryQueryPayload(state.items);
      }
      if (query.kind === LANDMARK_QUERY_KIND) {
        if (query.payload.byteLength !== 0) throw new Error("Landmark query payload is invalid");
        return landmarkQueryPayload(state.exploration);
      }
      if (query.kind === QUEST_QUERY_KIND) {
        if (query.payload.byteLength !== 0) throw new Error("Quest query payload is invalid");
        return questQueryPayload(state.quests);
      }
      if (query.kind === JOURNAL_QUERY_KIND) {
        return journalQueryPayload(state.quests, query.payload);
      }
      return executeM3NpcKnowledgeQuery(
        query,
        context.world.id,
        M3_NPC_KNOWLEDGE_PROFILES.map((profile) => {
          const agent = state.npcAgents.find(
            ({ entityId }: NpcAgentState) => entityId === profile.entityId,
          );
          if (agent === undefined) {
            throw new Error(`NPC knowledge agent ${profile.npcId} is absent from simulation state`);
          }
          const route = schedules.routes[agent.routeIndex];
          if (route === undefined) throw new Error("NPC knowledge agent route is invalid");
          return Object.freeze({
            npcId: profile.npcId,
            pathCursor: agent.pathCursor,
            position: agent.position,
            routeId: route.id,
            targetStopIndex: agent.targetStopIndex,
          });
        }),
      );
    },
    serializeState(state: M3SimulationState): Uint8Array {
      assertState(state, world.district.markers.length, navigation, schedules);
      const bytes = new Uint8Array(VERSIONED_STATE_BYTES);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, state.schemaVersion, true);
      view.setUint32(4, state.rngState, true);
      view.setFloat32(8, state.inputForward, true);
      view.setFloat32(12, state.inputRight, true);
      view.setFloat32(16, state.playerYawRadians, true);
      view.setFloat32(20, state.playerPosition[0], true);
      view.setFloat32(24, state.playerPosition[1], true);
      view.setFloat32(28, state.playerPosition[2], true);
      view.setFloat64(32, state.movementDistanceMeters, true);
      view.setUint32(44, state.collisionResolutionCount, true);
      view.setUint32(48, state.interactionAttemptCount, true);
      view.setUint32(52, state.interactionActivationCount, true);
      view.setUint32(56, Number(state.interactionRequested), true);
      view.setInt32(60, state.lastInteractionMarkerIndex, true);
      view.setUint32(64, state.npcAgents.length, true);
      view.setFloat64(68, state.npcAvoidanceAdjustmentCount, true);
      view.setUint32(76, state.npcMovingAgentCount, true);
      view.setFloat64(80, state.npcMovementDistanceMeters, true);
      view.setFloat64(88, state.npcScheduleTransitionCount, true);
      for (const [index, agent] of state.npcAgents.entries()) {
        const offset = STATE_HEADER_BYTES + index * NPC_STATE_BYTES;
        view.setUint32(offset, agent.entityId, true);
        view.setUint16(offset + 4, agent.routeIndex, true);
        view.setUint16(offset + 6, agent.targetStopIndex, true);
        view.setUint16(offset + 8, agent.pathCursor, true);
        view.setUint16(offset + 10, agent.dwellTicks, true);
        view.setFloat32(offset + 12, agent.position[0], true);
        view.setFloat32(offset + 16, agent.position[1], true);
        view.setFloat32(offset + 20, agent.position[2], true);
        view.setFloat32(offset + 24, agent.yawRadians, true);
      }
      serializeCombatState(view, STATE_HEADER_BYTES + NPC_BLOCK_BYTES, state.combat);
      serializeProgressionState(view, PROGRESSION_OFFSET, state.progression);
      serializeItemState(view, ITEM_OFFSET, state.items);
      serializeExplorationState(view, EXPLORATION_OFFSET, state.exploration);
      serializeQuestState(view, QUEST_OFFSET, state.quests);
      return bytes;
    },
    step(state: M3SimulationState, _tick: number): SimulationStepResult<M3SimulationState> {
      const movementProfile = playerMovementProfile(state.combat);
      const movement = movePlayer(world, navigation, state, tickSeconds, movementProfile);
      const crowd = stepNpcCrowd(navigation, schedules, state, movement.position, tickSeconds);
      const vigor =
        state.combat.player.actionKind === COMBAT_ACTION_DOWNED
          ? Object.freeze({ amount: 0, state: clearVigorHealing(state.items) })
          : consumeVigorHealing(state.items, state.combat.player.conditions.envenomedTicks > 0);
      let items = stepItemEffects(vigor.state);
      const priorSheet = derivePlayerSheet(
        progressionCombatProfile(state.progression, itemCombatBonuses(state.items)),
      );
      const playerSheet = derivePlayerSheet(
        progressionCombatProfile(state.progression, itemCombatBonuses(items)),
      );
      const combatAfterEffectExpiry = reconcilePlayerCombatSheet(
        state.combat,
        priorSheet,
        playerSheet,
      );
      const combatBeforeStep =
        vigor.amount === 0
          ? combatAfterEffectExpiry
          : Object.freeze({
              ...combatAfterEffectExpiry,
              player: Object.freeze({
                ...combatAfterEffectExpiry.player,
                health: Math.min(
                  playerSheet.maxHealth,
                  combatAfterEffectExpiry.player.health + vigor.amount,
                ),
              }),
            });
      const combatStep = stepM3Combat(
        combatBeforeStep,
        combatWorld,
        movement.position,
        state.playerYawRadians,
        tickSeconds,
        playerSheet,
        questPreparationSnapshot(state.quests),
      );
      if (combatStep.state.player.actionKind === COMBAT_ACTION_DOWNED) {
        items = clearVigorHealing(items);
      }
      const defeatAwards = combatDefeatAwards(state.combat, combatStep.state, combatStep.events);
      const monsterDefeatEvents = defeatAwards.defeated.map(({ entityId, kit }) =>
        Object.freeze({
          kind: "combat.monster-defeated",
          payload: combatEventPayload([entityId, monsterKitIndex(kit.id), kit.xp, 0]),
        }),
      );
      const progressionAward =
        defeatAwards.experience === 0
          ? null
          : awardExperience(state.progression, defeatAwards.experience);
      const lootEvents: Readonly<{ readonly kind: string; readonly payload: Uint8Array }>[] = [];
      for (const { entityId, kit } of defeatAwards.defeated) {
        const award = awardMonsterLoot(items, kit.id);
        if (!award.applied) continue;
        items = award.state;
        lootEvents.push(
          Object.freeze({
            kind: "loot.awarded",
            payload: combatEventPayload([entityId, award.marks, award.gearSerial, kit.xp]),
          }),
        );
        if (award.displacedGearSerial !== 0) {
          lootEvents.push(
            Object.freeze({
              kind: "loot.gear-displaced",
              payload: combatEventPayload([
                award.displacedGearSerial,
                award.marks,
                award.gearSerial,
                entityId,
              ]),
            }),
          );
        }
      }
      if (combatStep.respawnPlayer) {
        items = dropMaterialSatchel(items, combatStep.playerPosition);
      }
      const playerPosition = combatStep.respawnPlayer
        ? spawnPointPosition()
        : combatStep.playerPosition;
      const exploration = discoverNearbyLandmarks(state.exploration, landmarks, playerPosition);
      let progression = progressionAward?.state ?? state.progression;
      const discoveryEvents: Readonly<{
        readonly kind: string;
        readonly payload: Uint8Array;
      }>[] = [];
      for (const discovery of exploration.discoveries) {
        const award = awardExperience(progression, discovery.landmark.experience);
        progression = award.state;
        discoveryEvents.push(
          Object.freeze({
            kind: "landmark.discovered",
            payload: combatEventPayload([
              discovery.index,
              discovery.landmark.experience,
              award.state.experience,
              award.state.level,
            ]),
          }),
          progressionExperienceEvent(discovery.landmark.experience, award),
        );
      }
      const interaction = state.interactionRequested
        ? nearestInteraction(world, crowd.agents, playerPosition)
        : null;
      const activated = interaction !== null;
      const next = Object.freeze({
        ...state,
        collisionResolutionCount: state.collisionResolutionCount + movement.collisionCount,
        combat: combatStep.state,
        exploration: exploration.state,
        interactionActivationCount: state.interactionActivationCount + Number(activated),
        interactionRequested: false,
        items,
        lastInteractionMarkerIndex:
          interaction?.kind === "transition" ? interaction.value : state.lastInteractionMarkerIndex,
        movementDistanceMeters: Math.fround(state.movementDistanceMeters + movement.distanceMeters),
        npcAgents: crowd.agents,
        npcAvoidanceAdjustmentCount:
          state.npcAvoidanceAdjustmentCount + crowd.avoidanceAdjustmentCount,
        npcMovementDistanceMeters: Math.fround(
          state.npcMovementDistanceMeters + crowd.movementDistanceMeters,
        ),
        npcMovingAgentCount: crowd.movingAgentCount,
        npcScheduleTransitionCount:
          state.npcScheduleTransitionCount + crowd.scheduleTransitionCount,
        playerPosition,
        progression,
      });
      return applyQuestEvents(
        Object.freeze({
          events: Object.freeze([
            ...interactionEvents(interaction),
            ...combatStep.events.map((event) =>
              Object.freeze({ kind: event.kind, payload: combatEventPayload(event.values) }),
            ),
            ...monsterDefeatEvents,
            ...lootEvents,
            ...(progressionAward === null
              ? []
              : [progressionExperienceEvent(defeatAwards.experience, progressionAward)]),
            ...discoveryEvents,
          ]),
          state: next,
        }),
        _tick,
      );
    },
    telemetryCounters(state: M3SimulationState): Readonly<Record<string, number>> {
      return Object.freeze({
        ...combatTelemetryCounters(state.combat),
        collisionResolutionCount: state.collisionResolutionCount,
        interactionActivationCount: state.interactionActivationCount,
        interactionAttemptCount: state.interactionAttemptCount,
        landmarkDiscoveredCount: state.exploration.discoveredLandmarkCount,
        landmarkNominalExperienceAwarded: state.exploration.landmarkNominalExperienceAwarded,
        movementDistanceMeters: state.movementDistanceMeters,
        itemBuyCount: state.items.counters.buyCount,
        itemConsumableUseCount: state.items.counters.consumableUseCount,
        itemCraftCount: state.items.counters.craftCount,
        itemEquipmentChangeCount: state.items.counters.equipmentChangeCount,
        itemGatherCount: state.items.counters.gatherCount,
        itemGearCount: state.items.gear.length,
        itemGearCreatedCount: state.items.counters.gearCreatedCount,
        itemLootAwardCount: state.items.counters.lootAwardCount,
        itemMarks: state.items.marks,
        itemMarksEarned: state.items.counters.marksEarned,
        itemMarksSpent: state.items.counters.marksSpent,
        itemSatchelActive: Number(state.items.satchelActive),
        itemSatchelDropCount: state.items.counters.satchelDropCount,
        itemSatchelRecoveryCount: state.items.counters.satchelRecoveryCount,
        itemSellCount: state.items.counters.sellCount,
        itemStackCount: state.items.stackCounts.reduce((sum, count) => sum + count, 0),
        itemUpgradeCount: state.items.counters.upgradeCount,
        navigationEdgeCount: navigation.telemetry.edgeCount,
        navigationExpandedNodeCount: schedules.expandedNodeCount,
        navigationGridBytes: navigation.telemetry.gridBytes,
        navigationNodeCount: navigation.telemetry.nodeCount,
        navigationPathNodeCount: schedules.pathNodeCount,
        navigationPathQueryCount: schedules.pathQueryCount,
        navigationTileCount: navigation.telemetry.tileCount,
        npcAgentCount: state.npcAgents.length,
        npcAvoidanceAdjustmentCount: state.npcAvoidanceAdjustmentCount,
        npcMovementDistanceMeters: state.npcMovementDistanceMeters,
        npcMovingAgentCount: state.npcMovingAgentCount,
        npcScheduleTransitionCount: state.npcScheduleTransitionCount,
        progressionAbilityLearnCount: state.progression.abilityLearnCount,
        progressionAttributeSpendCount: state.progression.attributeSpendCount,
        progressionExperience: state.progression.experience,
        progressionExperienceAwardCount: state.progression.experienceAwardCount,
        progressionLevel: state.progression.level,
        progressionLevelsGained: state.progression.levelsGained,
        progressionLoadoutChangeCount: state.progression.loadoutChangeCount,
        progressionUnspentAbilityPicks: state.progression.unspentAbilityPicks,
        progressionUnspentAttributePoints: state.progression.unspentAttributePoints,
        questAcceptedCount: state.quests.acceptedQuestCount,
        questActiveCount: popcount32(state.quests.activeQuestMask),
        questCompletedCount: state.quests.completedQuestCount,
        questJournalEntryCount: state.quests.journal.length,
        questNominalExperienceAwarded: state.quests.nominalExperienceAwarded,
        questObjectiveProgressCount: state.quests.objectiveProgressCount,
        questPreparationFlagCount: popcount32(state.quests.preparationFlags),
        questStageCompletionCount: state.quests.stageCompletionCount,
      });
    },
  });
}

function createInitialNpcAgents(
  navigation: DeterministicNavigationMesh,
  schedules: NpcScheduleSet,
): readonly NpcAgentState[] {
  return Object.freeze(
    Array.from({ length: NPC_CROWD_BALANCE.agentCount }, (_, index) => {
      const routeIndex = index % schedules.routes.length;
      const route = schedules.routes[routeIndex];
      if (route === undefined) throw new Error("NPC schedule route assignment failed");
      const routeAgentIndex = Math.floor(index / schedules.routes.length);
      const targetStopIndex = routeAgentIndex % route.stops.length;
      const segment = route.segments[targetStopIndex];
      if (segment === undefined || segment.nodes.length === 0) {
        throw new Error("NPC schedule segment is empty");
      }
      if (segment.nodes.length < 2) throw new Error("NPC schedule segment cannot phase agents");
      const laneSlot = Math.floor(routeAgentIndex / route.stops.length);
      const segmentLengthMeters = segment.nodes.slice(1).reduce((length, node, nodeIndex) => {
        const previous = segment.nodes[nodeIndex];
        if (previous === undefined) throw new Error("NPC schedule segment lost a node");
        return length + Math.hypot(node[0] - previous[0], node[2] - previous[2]);
      }, 0);
      const minimumSpawnClearanceMeters = NPC_CROWD_BALANCE.agentRadiusMeters * 2 + 0.05;
      const closeAvoidancePhase = 0.08 + minimumSpawnClearanceMeters / segmentLengthMeters;
      if (closeAvoidancePhase >= 0.32) {
        throw new Error("NPC schedule segment is too short for a collision-free crowd phase");
      }
      const phase = [0.08, closeAvoidancePhase, 0.32, 0.55, 0.78, 0.98][laneSlot];
      if (phase === undefined) throw new Error("NPC schedule phase assignment failed");
      const edgeProgress = phase * (segment.nodes.length - 1);
      const fromIndex = Math.min(segment.nodes.length - 2, Math.floor(edgeProgress));
      const pathCursor = fromIndex + 1;
      const from = segment.nodes[fromIndex];
      const to = segment.nodes[pathCursor];
      if (from === undefined || to === undefined)
        throw new Error("NPC schedule spawn edge is missing");
      const alpha = edgeProgress - fromIndex;
      const x = Math.fround(from[0] + (to[0] - from[0]) * alpha);
      const z = Math.fround(from[2] + (to[2] - from[2]) * alpha);
      const y = navigation.groundHeight(x, z);
      return Object.freeze({
        dwellTicks: 0,
        entityId: NPC_ENTITY_ID_START + index,
        pathCursor,
        position: npcCenterPosition([x, y, z]),
        routeIndex,
        targetStopIndex,
        yawRadians: 0,
      });
    }),
  );
}

function stepNpcCrowd(
  navigation: DeterministicNavigationMesh,
  schedules: NpcScheduleSet,
  state: M3SimulationState,
  playerPosition: readonly [number, number, number],
  tickSeconds: number,
): CrowdStep {
  let avoidanceAdjustmentCount = 0;
  let movementDistanceMeters = 0;
  let movingAgentCount = 0;
  let scheduleTransitionCount = 0;
  const agents = state.npcAgents.map((agent): NpcAgentState => {
    const route = schedules.routes[agent.routeIndex];
    if (route === undefined) throw new Error("NPC route disappeared during simulation");
    if (agent.dwellTicks > 0) return Object.freeze({ ...agent, dwellTicks: agent.dwellTicks - 1 });
    const segment = route.segments[agent.targetStopIndex];
    if (segment === undefined) throw new Error("NPC route segment disappeared during simulation");
    if (agent.pathCursor >= segment.nodes.length) {
      const targetStopIndex = (agent.targetStopIndex + 1) % route.stops.length;
      const nextSegment = route.segments[targetStopIndex];
      if (nextSegment === undefined || nextSegment.nodes.length === 0) {
        throw new Error("NPC route transition has no navigation path");
      }
      scheduleTransitionCount += 1;
      return Object.freeze({
        ...agent,
        dwellTicks: NPC_CROWD_BALANCE.scheduleDwellTicks,
        pathCursor: Math.min(1, nextSegment.nodes.length),
        targetStopIndex,
      });
    }
    const target = segment.nodes[agent.pathCursor];
    if (target === undefined) throw new Error("NPC path cursor is invalid");
    const deltaX = target[0] - agent.position[0];
    const deltaZ = target[2] - agent.position[2];
    const distance = Math.hypot(deltaX, deltaZ);
    const maximumStep = NPC_CROWD_BALANCE.movementMetersPerSecond * tickSeconds;
    if (distance <= NPC_CROWD_BALANCE.waypointArrivalMeters) {
      if (distance === 0) {
        return Object.freeze({ ...agent, pathCursor: agent.pathCursor + 1 });
      }
      const step = Math.min(maximumStep, distance);
      const reachedWaypoint = step >= distance;
      const x = reachedWaypoint
        ? target[0]
        : Math.fround(agent.position[0] + (deltaX / distance) * step);
      const z = reachedWaypoint
        ? target[2]
        : Math.fround(agent.position[2] + (deltaZ / distance) * step);
      const moved = Math.hypot(x - agent.position[0], z - agent.position[2]);
      movementDistanceMeters += moved;
      movingAgentCount += 1;
      return Object.freeze({
        ...agent,
        pathCursor: reachedWaypoint ? agent.pathCursor + 1 : agent.pathCursor,
        position: Object.freeze([
          x,
          Math.fround(navigation.groundHeight(x, z) + NPC_CROWD_BALANCE.agentHeightMeters / 2),
          z,
        ]) as readonly [number, number, number],
        yawRadians: Math.fround(Math.atan2(deltaX, deltaZ)),
      });
    }
    const separation = npcSeparation(agent, state.npcAgents, playerPosition);
    avoidanceAdjustmentCount += Number(separation.neighborCount > 0);
    const desiredX = deltaX / distance;
    const desiredZ = deltaZ / distance;
    let directionX = desiredX + separation.x * NPC_CROWD_BALANCE.avoidanceWeight;
    let directionZ = desiredZ + separation.z * NPC_CROWD_BALANCE.avoidanceWeight;
    const directionLength = Math.hypot(directionX, directionZ);
    if (directionLength > 0) {
      directionX /= directionLength;
      directionZ /= directionLength;
    }
    const step = Math.min(maximumStep, distance);
    let x = Math.fround(agent.position[0] + directionX * step);
    let z = Math.fround(agent.position[2] + directionZ * step);
    if (!npcMovementCandidateIsValid(navigation, agent.position, target, x, z)) {
      x = Math.fround(agent.position[0] + desiredX * step);
      z = Math.fround(agent.position[2] + desiredZ * step);
      if (!npcMovementCandidateIsValid(navigation, agent.position, target, x, z)) return agent;
    }
    const moved = Math.hypot(x - agent.position[0], z - agent.position[2]);
    if (moved <= 0) return agent;
    movementDistanceMeters += moved;
    movingAgentCount += 1;
    return Object.freeze({
      ...agent,
      position: Object.freeze([
        x,
        Math.fround(navigation.groundHeight(x, z) + NPC_CROWD_BALANCE.agentHeightMeters / 2),
        z,
      ]) as readonly [number, number, number],
      yawRadians: Math.fround(Math.atan2(x - agent.position[0], z - agent.position[2])),
    });
  });
  return Object.freeze({
    agents: Object.freeze(agents),
    avoidanceAdjustmentCount,
    movementDistanceMeters: Math.fround(movementDistanceMeters),
    movingAgentCount,
    scheduleTransitionCount,
  });
}

function npcMovementCandidateIsValid(
  navigation: DeterministicNavigationMesh,
  from: readonly [number, number, number],
  target: readonly [number, number, number],
  x: number,
  z: number,
): boolean {
  const candidate = Object.freeze([x, navigation.groundHeight(x, z), z] as const);
  return (
    navigation.canTraverseSegment(from, candidate) &&
    navigation.canTraverseSegment(candidate, target)
  );
}

function npcSeparation(
  agent: NpcAgentState,
  agents: readonly NpcAgentState[],
  playerPosition: readonly [number, number, number],
): Readonly<{ readonly neighborCount: number; readonly x: number; readonly z: number }> {
  let x = 0;
  let z = 0;
  let neighborCount = 0;
  const accumulate = (otherId: number, otherX: number, otherZ: number): void => {
    let deltaX = agent.position[0] - otherX;
    let deltaZ = agent.position[2] - otherZ;
    let distance = Math.hypot(deltaX, deltaZ);
    if (distance >= NPC_CROWD_BALANCE.avoidanceRadiusMeters) return;
    if (distance < 0.000_001) {
      const pairId = Math.min(agent.entityId, otherId);
      const angle = (pairId % 8) * (Math.PI / 4);
      const sign = agent.entityId < otherId ? -1 : 1;
      deltaX = Math.cos(angle) * sign;
      deltaZ = Math.sin(angle) * sign;
      distance = 1;
    }
    const weight =
      (NPC_CROWD_BALANCE.avoidanceRadiusMeters - distance) /
      NPC_CROWD_BALANCE.avoidanceRadiusMeters;
    x += (deltaX / distance) * weight;
    z += (deltaZ / distance) * weight;
    neighborCount += 1;
  };
  for (const other of agents) {
    if (other.entityId !== agent.entityId)
      accumulate(other.entityId, other.position[0], other.position[2]);
  }
  accumulate(PLAYER_ENTITY_ID, playerPosition[0], playerPosition[2]);
  if (neighborCount > 0) {
    x /= neighborCount;
    z /= neighborCount;
  }
  return Object.freeze({ neighborCount, x, z });
}

function npcCenterPosition(
  node: readonly [number, number, number],
): readonly [number, number, number] {
  return Object.freeze([
    node[0],
    Math.fround(node[1] + NPC_CROWD_BALANCE.agentHeightMeters / 2),
    node[2],
  ] as const);
}

function createControllerWorld(district: SimulationWorldDefinition): ControllerWorld {
  const obstacles = district.cells
    .flatMap((cell) => cell.collision.obstacles)
    .toSorted((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const transitionMarkerIndexes = district.markers.flatMap((marker, index) =>
    marker.kind === "transition" ? [index] : [],
  );
  return Object.freeze({
    district,
    obstacles: Object.freeze(obstacles),
    transitionMarkerIndexes: Object.freeze(transitionMarkerIndexes),
  });
}

function movePlayer(
  world: ControllerWorld,
  navigation: DeterministicNavigationMesh,
  state: M3SimulationState,
  tickSeconds: number,
  movementProfile: Readonly<{ readonly denominator: number; readonly numerator: number }>,
): Readonly<{
  readonly collisionCount: number;
  readonly distanceMeters: number;
  readonly position: readonly [number, number, number];
}> {
  const inputLength = Math.hypot(state.inputForward, state.inputRight);
  const scale = inputLength > 1 ? 1 / inputLength : 1;
  const forward = state.inputForward * scale;
  const right = state.inputRight * scale;
  const sine = Math.sin(state.playerYawRadians);
  const cosine = Math.cos(state.playerYawRadians);
  const distance =
    (CHARACTER_CONTROLLER_BALANCE.movementMetersPerSecond *
      tickSeconds *
      movementProfile.numerator) /
    movementProfile.denominator;
  const deltaX = (sine * forward + cosine * right) * distance;
  const deltaZ = (cosine * forward - sine * right) * distance;
  const oldX = state.playerPosition[0];
  const oldZ = state.playerPosition[2];
  const radius = CHARACTER_CONTROLLER_BALANCE.collisionRadiusMeters;
  const bounds = world.district.bounds;
  let x = Math.fround(clamp(oldX + deltaX, bounds.minimum[0] + radius, bounds.maximum[0] - radius));
  let collisionCount = 0;
  if (deltaX !== 0) {
    for (const obstacle of world.obstacles) {
      if (!overlapsExpandedAabb(x, oldZ, obstacle, radius)) continue;
      x = Math.fround(
        deltaX > 0
          ? obstacle.center[0] - obstacle.size[0] / 2 - radius
          : obstacle.center[0] + obstacle.size[0] / 2 + radius,
      );
      collisionCount += 1;
    }
  }
  let z = Math.fround(clamp(oldZ + deltaZ, bounds.minimum[2] + radius, bounds.maximum[2] - radius));
  if (deltaZ !== 0) {
    for (const obstacle of world.obstacles) {
      if (!overlapsExpandedAabb(x, z, obstacle, radius)) continue;
      z = Math.fround(
        deltaZ > 0
          ? obstacle.center[2] - obstacle.size[2] / 2 - radius
          : obstacle.center[2] + obstacle.size[2] / 2 + radius,
      );
      collisionCount += 1;
    }
  }
  const moved = Math.hypot(x - oldX, z - oldZ);
  return Object.freeze({
    collisionCount,
    distanceMeters: Math.fround(moved),
    position: Object.freeze([
      x,
      Math.fround(navigation.groundHeight(x, z) + CHARACTER_CONTROLLER_BALANCE.halfHeightMeters),
      z,
    ]) as readonly [number, number, number],
  });
}

function nearestInteraction(
  world: ControllerWorld,
  agents: readonly NpcAgentState[],
  position: readonly [number, number, number],
): InteractionTarget | null {
  let nearest: InteractionTarget | null = null;
  let nearestDistanceSquared = CHARACTER_CONTROLLER_BALANCE.interactionRangeMeters ** 2;
  for (const index of world.transitionMarkerIndexes) {
    const marker = world.district.markers[index];
    if (marker === undefined) continue;
    const distanceSquared =
      (marker.position[0] - position[0]) ** 2 + (marker.position[2] - position[2]) ** 2;
    if (distanceSquared <= nearestDistanceSquared) {
      nearest = Object.freeze({ kind: "transition", value: index });
      nearestDistanceSquared = distanceSquared;
    }
  }
  for (const agent of agents) {
    if (!isConversationalNpcEntityId(agent.entityId)) continue;
    const distanceSquared =
      (agent.position[0] - position[0]) ** 2 + (agent.position[2] - position[2]) ** 2;
    // Transition markers win exact ties, while an NPC exactly on the range boundary
    // remains interactable when there is no marker at that distance.
    if (
      distanceSquared < nearestDistanceSquared ||
      (nearest === null && distanceSquared === nearestDistanceSquared)
    ) {
      nearest = Object.freeze({ kind: "npc", value: agent.entityId });
      nearestDistanceSquared = distanceSquared;
    }
  }
  return nearest;
}

function overlapsExpandedAabb(
  x: number,
  z: number,
  obstacle: GreyboxAabbCollider,
  radius: number,
): boolean {
  return (
    x > obstacle.center[0] - obstacle.size[0] / 2 - radius &&
    x < obstacle.center[0] + obstacle.size[0] / 2 + radius &&
    z > obstacle.center[2] - obstacle.size[2] / 2 - radius &&
    z < obstacle.center[2] + obstacle.size[2] / 2 + radius
  );
}

function assertState(
  state: M3SimulationState,
  markerCount: number,
  navigation: DeterministicNavigationMesh,
  schedules: NpcScheduleSet,
): void {
  if (
    state.schemaVersion !== GAME_SIMULATION_STATE_SCHEMA_VERSION ||
    state.playerPosition.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(state.movementDistanceMeters) ||
    state.movementDistanceMeters < 0 ||
    !Number.isSafeInteger(state.collisionResolutionCount) ||
    !Number.isSafeInteger(state.interactionAttemptCount) ||
    !Number.isSafeInteger(state.interactionActivationCount) ||
    !Number.isSafeInteger(state.npcAvoidanceAdjustmentCount) ||
    !Number.isSafeInteger(state.npcMovingAgentCount) ||
    state.npcMovingAgentCount > state.npcAgents.length ||
    !Number.isSafeInteger(state.npcScheduleTransitionCount) ||
    !Number.isFinite(state.npcMovementDistanceMeters) ||
    state.npcMovementDistanceMeters < 0 ||
    state.npcAgents.length !== NPC_CROWD_BALANCE.agentCount ||
    (state.lastInteractionMarkerIndex !== -1 &&
      (state.lastInteractionMarkerIndex < 0 || state.lastInteractionMarkerIndex >= markerCount))
  ) {
    throw new Error("Game simulation state contains invalid controller or crowd values");
  }
  assertInputState(state.inputForward, state.inputRight, state.playerYawRadians, 0, 0, 0);
  assertProgressionState(state.progression);
  assertExplorationState(state.exploration);
  assertItemState(state.items);
  assertQuestState(state.quests);
  assertQuestExplorationConsistency(state.quests, state.exploration);
  const gatheringMask = lowBitsMask(GATHERING_NODES.length);
  if (
    (state.items.gatheredNodeMask & ~gatheringMask) !== 0 ||
    state.items.nodeCooldownTicks.some(
      (ticks, index) => index >= GATHERING_NODES.length && ticks !== 0,
    )
  ) {
    throw new Error("Game item state has unknown gathering-node identities");
  }
  assertCombatState(
    state.combat,
    derivePlayerSheet(progressionCombatProfile(state.progression, itemCombatBonuses(state.items))),
  );
  for (const monster of state.combat.monsters) {
    if (
      !navigation.isWalkablePosition(monster.position[0], monster.position[2]) ||
      !navigation.isWalkablePosition(monster.homePosition[0], monster.homePosition[2]) ||
      Math.abs(
        monster.position[1] -
          Math.fround(
            navigation.groundHeight(monster.position[0], monster.position[2]) +
              MONSTER_HALF_HEIGHT_METERS,
          ),
      ) > 0.000_1 ||
      Math.abs(
        monster.homePosition[1] -
          Math.fround(
            navigation.groundHeight(monster.homePosition[0], monster.homePosition[2]) +
              MONSTER_HALF_HEIGHT_METERS,
          ),
      ) > 0.000_1
    ) {
      throw new Error("Game simulation state contains an off-mesh creature pose");
    }
  }
  for (const [index, agent] of state.npcAgents.entries()) {
    const route = schedules.routes[agent.routeIndex];
    const segment = route?.segments[agent.targetStopIndex];
    if (
      agent.entityId !== NPC_ENTITY_ID_START + index ||
      route === undefined ||
      segment === undefined ||
      !Number.isSafeInteger(agent.pathCursor) ||
      agent.pathCursor < 0 ||
      agent.pathCursor > segment.nodes.length ||
      !Number.isSafeInteger(agent.dwellTicks) ||
      agent.dwellTicks < 0 ||
      agent.dwellTicks > NPC_CROWD_BALANCE.scheduleDwellTicks ||
      !Number.isFinite(agent.yawRadians) ||
      agent.position.some((value) => !Number.isFinite(value)) ||
      !navigation.isWalkablePosition(agent.position[0], agent.position[2]) ||
      Math.abs(
        agent.position[1] -
          Math.fround(
            navigation.groundHeight(agent.position[0], agent.position[2]) +
              NPC_CROWD_BALANCE.agentHeightMeters / 2,
          ),
      ) > 0.000_1 ||
      !npcPoseMatchesPath(agent, segment, navigation)
    ) {
      throw new Error("Game simulation state contains invalid NPC values");
    }
  }
}

function npcPoseMatchesPath(
  agent: NpcAgentState,
  segment: NpcScheduleSet["routes"][number]["segments"][number],
  navigation: DeterministicNavigationMesh,
): boolean {
  if (agent.pathCursor === 0) return false;
  if (agent.pathCursor >= segment.nodes.length) {
    const finalNode = segment.nodes.at(-1);
    return (
      finalNode !== undefined &&
      Math.hypot(finalNode[0] - agent.position[0], finalNode[2] - agent.position[2]) <=
        NPC_CROWD_BALANCE.waypointArrivalMeters + 0.000_1
    );
  }
  const target = segment.nodes[agent.pathCursor];
  return target !== undefined && navigation.canTraverseSegment(agent.position, target);
}

function assertInputState(
  inputForward: number,
  inputRight: number,
  yawRadians: number,
  flags: number,
  combatPressed: number,
  reserved: number,
): void {
  if (
    !Number.isFinite(inputForward) ||
    !Number.isFinite(inputRight) ||
    !Number.isFinite(yawRadians) ||
    Math.abs(inputForward) > 1 ||
    Math.abs(inputRight) > 1 ||
    !Number.isSafeInteger(flags) ||
    flags < 0 ||
    (flags & ~INPUT_FLAGS_MASK) !== 0 ||
    !Number.isSafeInteger(combatPressed) ||
    combatPressed < 0 ||
    (combatPressed & ~COMBAT_PRESSED_MASK) !== 0 ||
    reserved !== 0
  ) {
    throw new Error("Player input state values are invalid");
  }
}

export function createPlayerInputCommand(
  sequence: number,
  targetTick: number,
  input: Readonly<{
    readonly blockHeld?: boolean;
    readonly combatPressed?: number;
    readonly forward: number;
    readonly interactPressed?: boolean;
    readonly right: number;
    readonly yawRadians: number;
  }>,
): SimulationCommand {
  const payload = new Uint8Array(INPUT_PAYLOAD_BYTES);
  const view = new DataView(payload.buffer);
  view.setFloat32(0, input.forward, true);
  view.setFloat32(4, input.right, true);
  view.setFloat32(8, input.yawRadians, true);
  view.setUint32(
    12,
    (input.interactPressed === true ? INPUT_INTERACT_PRESSED : 0) |
      (input.blockHeld === true ? INPUT_BLOCK_HELD : 0),
    true,
  );
  view.setUint32(16, (input.combatPressed ?? 0) & COMBAT_PRESSED_MASK, true);
  view.setUint32(20, 0, true);
  return Object.freeze({ kind: INPUT_COMMAND_KIND, payload, sequence, targetTick });
}

export function createSpawnMonsterCommand(
  sequence: number,
  targetTick: number,
  kitId: string,
  x: number,
  z: number,
): SimulationCommand {
  const payload = new Uint8Array(SPAWN_PAYLOAD_BYTES);
  const view = new DataView(payload.buffer);
  view.setUint32(0, monsterKitIndex(kitId), true);
  view.setFloat32(4, x, true);
  view.setFloat32(8, z, true);
  view.setUint32(12, 0, true);
  return Object.freeze({ kind: SPAWN_COMMAND_KIND, payload, sequence, targetTick });
}

export function createSpendAttributeCommand(
  sequence: number,
  targetTick: number,
  attribute: ProgressionAttributeId,
): SimulationCommand {
  const attributeIndex = PROGRESSION_ATTRIBUTES.indexOf(attribute);
  if (attributeIndex < 0) throw new Error(`Unknown progression attribute ${attribute}`);
  return createProgressionCommand(
    sequence,
    targetTick,
    PROGRESSION_OP_SPEND_ATTRIBUTE,
    attributeIndex,
    0,
  );
}

export function createLearnAbilityCommand(
  sequence: number,
  targetTick: number,
  abilityId: ProgressionAbilityId,
): SimulationCommand {
  return createProgressionCommand(
    sequence,
    targetTick,
    PROGRESSION_OP_LEARN_ABILITY,
    progressionAbilityCommandIndex(abilityId),
    0,
  );
}

export function createEquipAbilityCommand(
  sequence: number,
  targetTick: number,
  kind: "active" | "knack",
  slot: number,
  abilityId: ProgressionAbilityId | null,
): SimulationCommand {
  return createProgressionCommand(
    sequence,
    targetTick,
    kind === "active" ? PROGRESSION_OP_EQUIP_ACTIVE : PROGRESSION_OP_EQUIP_KNACK,
    abilityId === null ? PROGRESSION_EMPTY_ABILITY : progressionAbilityCommandIndex(abilityId),
    slot,
  );
}

export function createGatherItemCommand(
  sequence: number,
  targetTick: number,
  nodeId: string,
): SimulationCommand {
  const nodeIndex = gatheringNodeIndex(nodeId);
  return createItemCommand(sequence, targetTick, ITEM_OPERATIONS.gather.code, nodeIndex, 0);
}

export function createCraftItemCommand(
  sequence: number,
  targetTick: number,
  recipeId: string,
  resonance: Resonance | null = null,
): SimulationCommand {
  const index = recipeIndex(recipeId);
  return createItemCommand(
    sequence,
    targetTick,
    ITEM_OPERATIONS.craft.code,
    index,
    resonanceCode(resonance),
  );
}

export function createBuyItemCommand(
  sequence: number,
  targetTick: number,
  itemId: ItemId,
): SimulationCommand {
  const offerIndex = vendorOfferIndex(itemId);
  return createItemCommand(sequence, targetTick, ITEM_OPERATIONS.buy.code, offerIndex, 0);
}

export function createSellItemStackCommand(
  sequence: number,
  targetTick: number,
  itemId: ItemId,
): SimulationCommand {
  return createItemCommand(
    sequence,
    targetTick,
    ITEM_OPERATIONS.sellStack.code,
    itemIndex(itemId),
    0,
  );
}

export function createSellGearCommand(
  sequence: number,
  targetTick: number,
  serial: number,
): SimulationCommand {
  return createItemCommand(sequence, targetTick, ITEM_OPERATIONS.sellGear.code, serial, 0);
}

export function createEquipGearCommand(
  sequence: number,
  targetTick: number,
  serial: number,
): SimulationCommand {
  return createItemCommand(sequence, targetTick, ITEM_OPERATIONS.equip.code, serial, 0);
}

export function createUnequipGearCommand(
  sequence: number,
  targetTick: number,
  slot: GearSlot,
): SimulationCommand {
  return createItemCommand(sequence, targetTick, ITEM_OPERATIONS.equip.code, 0, gearSlotCode(slot));
}

export function createUseItemCommand(
  sequence: number,
  targetTick: number,
  itemId: ItemId,
): SimulationCommand {
  return createItemCommand(sequence, targetTick, ITEM_OPERATIONS.use.code, itemIndex(itemId), 0);
}

export function createUpgradeGearCommand(
  sequence: number,
  targetTick: number,
  serial: number,
  upgrade: "armor-fitting" | "weapon-whetting",
): SimulationCommand {
  return createItemCommand(
    sequence,
    targetTick,
    ITEM_OPERATIONS.upgrade.code,
    serial,
    upgrade === "weapon-whetting" ? 1 : 2,
  );
}

export function createRecoverSatchelCommand(
  sequence: number,
  targetTick: number,
): SimulationCommand {
  return createItemCommand(sequence, targetTick, ITEM_OPERATIONS.recoverSatchel.code, 0, 0);
}

export function createReshapeCommand(sequence: number, targetTick: number): SimulationCommand {
  return createItemCommand(sequence, targetTick, ITEM_OPERATIONS.reshape.code, 0, 0);
}

export function createAcceptQuestCommand(
  sequence: number,
  targetTick: number,
  questId: string,
): SimulationCommand {
  return createQuestCommand(sequence, targetTick, QUEST_OP_ACCEPT, questIndex(questId), 0);
}

export function createQuestIntentCommand(
  sequence: number,
  targetTick: number,
  intentId: string,
): SimulationCommand {
  const intentIndex = questIntentIndex(intentId);
  const intent = QUEST_INTENTS[intentIndex];
  if (intent === undefined) throw new Error("Quest intent identity is invalid");
  return createQuestCommand(
    sequence,
    targetTick,
    QUEST_OP_INTENT,
    questIndex(intent.questId),
    intentIndex,
  );
}

export function createQuestSnapshotQuery(): SimulationGameStateQuery {
  return Object.freeze({ kind: QUEST_QUERY_KIND, payload: new Uint8Array() });
}

export function createJournalSnapshotQuery(
  fromSequence: number,
  maximumEntries: number,
): SimulationGameStateQuery {
  if (
    !Number.isSafeInteger(fromSequence) ||
    fromSequence < 0 ||
    fromSequence > 0xffff_ffff ||
    !Number.isSafeInteger(maximumEntries) ||
    maximumEntries <= 0 ||
    maximumEntries > QUEST_JOURNAL_QUERY_MAXIMUM_ENTRIES
  ) {
    throw new Error("Journal query range is invalid");
  }
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  view.setUint32(0, fromSequence, true);
  view.setUint16(4, maximumEntries, true);
  return Object.freeze({ kind: JOURNAL_QUERY_KIND, payload });
}

function createQuestCommand(
  sequence: number,
  targetTick: number,
  operation: number,
  questIndexValue: number,
  intentIndex: number,
): SimulationCommand {
  const payload = new Uint8Array(QUEST_PAYLOAD_BYTES);
  const view = new DataView(payload.buffer);
  view.setUint32(0, operation, true);
  view.setUint32(4, questIndexValue, true);
  view.setUint32(8, intentIndex, true);
  return Object.freeze({ kind: QUEST_COMMAND_KIND, payload, sequence, targetTick });
}

function createItemCommand(
  sequence: number,
  targetTick: number,
  operation: number,
  primary: number,
  secondary: number,
): SimulationCommand {
  const payload = new Uint8Array(ITEM_PAYLOAD_BYTES);
  const view = new DataView(payload.buffer);
  view.setUint32(0, operation, true);
  view.setUint32(4, primary, true);
  view.setUint32(8, secondary, true);
  return Object.freeze({ kind: ITEM_COMMAND_KIND, payload, sequence, targetTick });
}

function createProgressionCommand(
  sequence: number,
  targetTick: number,
  operation: number,
  value: number,
  slot: number,
): SimulationCommand {
  const payload = new Uint8Array(PROGRESSION_PAYLOAD_BYTES);
  const view = new DataView(payload.buffer);
  view.setUint32(0, operation, true);
  view.setUint32(4, value, true);
  view.setUint32(8, slot, true);
  view.setUint32(12, 0, true);
  return Object.freeze({ kind: PROGRESSION_COMMAND_KIND, payload, sequence, targetTick });
}

function progressionAbilityCommandIndex(abilityId: ProgressionAbilityId): number {
  const index = PROGRESSION_ABILITIES.findIndex((ability) => ability.id === abilityId);
  if (index < 0) throw new Error(`Unknown progression ability ${abilityId}`);
  return index;
}

function itemCommandResult(
  state: M3SimulationState,
  applied: boolean,
  operation: number,
  primary: number,
  secondary: number,
): SimulationStepResult<M3SimulationState> {
  const definition = ITEM_OPERATION_BY_CODE.get(operation);
  if (definition === undefined) throw new Error("Item command operation is invalid");
  return Object.freeze({
    events: Object.freeze([
      Object.freeze({
        kind: applied ? definition.eventKind : "items.rejected",
        payload: combatEventPayload([operation, primary, secondary, Number(applied)]),
      }),
    ]),
    state,
  });
}

function sameProgressionBuild(left: ProgressionState, right: ProgressionState): boolean {
  return (
    left.might === right.might &&
    left.finesse === right.finesse &&
    left.vitality === right.vitality &&
    left.attunement === right.attunement &&
    left.unspentAttributePoints === right.unspentAttributePoints &&
    left.unspentAbilityPicks === right.unspentAbilityPicks &&
    left.learnedAbilities.join("\0") === right.learnedAbilities.join("\0") &&
    left.activeSlots.join("\0") === right.activeSlots.join("\0") &&
    left.knackSlots.join("\0") === right.knackSlots.join("\0")
  );
}

function gearSlotCode(slot: GearSlot): number {
  return (["weapon", "armor", "shield", "catalyst"] as const).indexOf(slot) + 1;
}

function gearSlotFromCode(code: number): GearSlot | undefined {
  if (code === 0) return undefined;
  return (["weapon", "armor", "shield", "catalyst"] as const)[code - 1];
}

function nearMarkerTag(
  world: SimulationWorldDefinition,
  position: readonly [number, number, number],
  tag: string,
  radius: number,
): boolean {
  return world.markers.some(
    (marker) =>
      marker.tags.includes(tag) &&
      horizontalDistance(position, [marker.position[0], 0, marker.position[2]]) <= radius,
  );
}

function nearTradeMarker(
  world: SimulationWorldDefinition,
  position: readonly [number, number, number],
): boolean {
  return ["market", "forge", "alembic", "hearth"].some((tag) =>
    nearMarkerTag(world, position, tag, ITEM_INTERACTION_RADII_METERS.station),
  );
}

function nearWaystone(
  world: SimulationWorldDefinition,
  position: readonly [number, number, number],
): boolean {
  return world.markers.some(
    (marker) =>
      marker.tags.includes("waystone") &&
      horizontalDistance(position, [marker.position[0], 0, marker.position[2]]) <=
        ITEM_INTERACTION_RADII_METERS.waystone,
  );
}

function inventoryQueryPayload(state: ItemState): Uint8Array {
  const stacks = ITEM_DEFINITIONS.flatMap((definition, index) => {
    const quantity = state.stackCounts[index] ?? 0;
    return quantity === 0 ? [] : [Object.freeze({ itemId: definition.id, quantity })];
  });
  const gear = state.gear.map((instance) =>
    Object.freeze({
      affixes: GEAR_AFFIXES.flatMap((affix, index) =>
        (instance.affixMask & (1 << index)) === 0 ? [] : [affix.id],
      ),
      equipped: equippedSerials(state).includes(instance.serial),
      itemId: ITEM_DEFINITIONS[instance.itemIndex]?.id,
      rarity: instance.rarity,
      resonance: instance.resonance,
      serial: instance.serial,
      uniqueProperty: instance.uniqueProperty === 1 ? "warden-echo" : null,
      upgrades: instance.upgrades,
    }),
  );
  return INVENTORY_TEXT_ENCODER.encode(
    JSON.stringify({
      activeFoodItemId:
        state.activeFoodItemIndex < 0
          ? null
          : (ITEM_DEFINITIONS[state.activeFoodItemIndex]?.id ?? null),
      gear,
      marks: state.marks,
      satchelActive: state.satchelActive,
      stacks,
      version: state.version,
    }),
  );
}

function landmarkQueryPayload(state: ExplorationState): Uint8Array {
  return INVENTORY_TEXT_ENCODER.encode(
    JSON.stringify({
      discoveredCount: state.discoveredLandmarkCount,
      nominalExperienceAwarded: state.landmarkNominalExperienceAwarded,
      landmarks: NAMED_LANDMARKS.map((landmark, index) =>
        Object.freeze({
          discovered: (state.discoveredLandmarkMask & (1 << index)) !== 0,
          districtId: landmark.districtId,
          nominalExperience: landmark.experience,
          id: landmark.id,
          name: landmark.name,
        }),
      ),
      version: 1,
    }),
  );
}

function questQueryPayload(state: QuestState): Uint8Array {
  const preparation = questPreparationSnapshot(state);
  return INVENTORY_TEXT_ENCODER.encode(
    JSON.stringify({
      acceptedCount: state.acceptedQuestCount,
      activeCount: popcount32(state.activeQuestMask),
      completedCount: state.completedQuestCount,
      journalEntryCount: state.journal.length,
      nominalExperienceAwarded: state.nominalExperienceAwarded,
      preparation,
      quests: QUEST_DEFINITIONS.map((definition, questIndexValue) => {
        const active = (state.activeQuestMask & (1 << questIndexValue)) !== 0;
        const completed = (state.completedQuestMask & (1 << questIndexValue)) !== 0;
        const currentStageIndex = state.questStageIndexes[questIndexValue] ?? 0;
        return Object.freeze({
          currentStageIndex,
          id: definition.id,
          kind: definition.kind,
          localizationKey: definition.localizationKey,
          stages: definition.stages.map((stage, stageIndex) => {
            const objectiveOffset = questObjectiveOffset(questIndexValue, stageIndex);
            return Object.freeze({
              completion: stage.completion,
              completed: currentStageIndex > stageIndex,
              experience: stage.experience,
              id: stage.id,
              localizationKey: stage.localizationKey,
              objectives: stage.objectives.map((candidate, objectiveIndex) =>
                Object.freeze({
                  kind: candidate.kind,
                  localizationKey: candidate.localizationKey,
                  progress: state.objectiveProgress[objectiveOffset + objectiveIndex] ?? 0,
                  target: candidate.kind === "talk" ? 1 : candidate.count,
                }),
              ),
            });
          }),
          status: completed ? "completed" : active ? "active" : "available",
          systemTag: definition.systemTag,
        });
      }),
      version: 1,
    }),
  );
}

function journalQueryPayload(state: QuestState, payload: Uint8Array): Uint8Array {
  if (payload.byteLength !== 8) throw new Error("Journal query payload is invalid");
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const fromSequence = view.getUint32(0, true);
  const maximumEntries = view.getUint16(4, true);
  if (
    view.getUint16(6, true) !== 0 ||
    maximumEntries === 0 ||
    maximumEntries > QUEST_JOURNAL_QUERY_MAXIMUM_ENTRIES
  ) {
    throw new Error("Journal query payload is invalid");
  }
  const entries = state.journal.slice(fromSequence, fromSequence + maximumEntries).map((entry) => {
    const definition = QUEST_DEFINITIONS[entry.questIndex];
    const stage = definition?.stages[entry.stageIndex];
    const objective = stage?.objectives[entry.objectiveIndex];
    const landmark = NAMED_LANDMARKS[entry.subject];
    return Object.freeze({
      amount: entry.amount,
      localizationKey: journalLocalizationKey(entry.kind),
      objectiveId:
        objective === undefined ? null : `${definition?.id}:${stage?.id}:${entry.objectiveIndex}`,
      objectiveLocalizationKey: objective?.localizationKey ?? null,
      questId: definition?.id ?? null,
      questLocalizationKey: definition?.localizationKey ?? null,
      sequence: entry.sequence,
      stageId: stage?.id ?? null,
      stageLocalizationKey: stage?.localizationKey ?? null,
      subjectId: isLandmarkJournalKind(entry.kind) ? (landmark?.id ?? null) : null,
      subjectLocalizationKey:
        isLandmarkJournalKind(entry.kind) && landmark !== undefined
          ? `landmark.${landmark.id}.name`
          : null,
      tick: entry.tick,
    });
  });
  return INVENTORY_TEXT_ENCODER.encode(
    JSON.stringify({
      entries,
      fromSequence,
      nextSequence: Math.min(state.journal.length, fromSequence + entries.length),
      totalEntries: state.journal.length,
      version: 1,
    }),
  );
}

function progressionCommandResult(
  state: M3SimulationState,
  applied: boolean,
  operation: number,
  value: number,
  slot: number,
): SimulationStepResult<M3SimulationState> {
  return Object.freeze({
    events: Object.freeze([
      Object.freeze({
        kind: applied ? "progression.changed" : "progression.rejected",
        payload: combatEventPayload([operation, value, slot, Number(applied)]),
      }),
    ]),
    state,
  });
}

function progressionExperienceEvent(
  amount: number,
  award: ExperienceAwardResult,
): Readonly<{ readonly kind: string; readonly payload: Uint8Array }> {
  return Object.freeze({
    kind: "progression.experience-gained",
    payload: combatEventPayload([
      amount,
      award.state.experience,
      award.state.level,
      award.levelsGained,
    ]),
  });
}

function reconcilePlayerCombatSheet(
  combat: M3CombatState,
  prior: CombatantSheet,
  next: CombatantSheet,
): M3CombatState {
  const player = combat.player;
  return Object.freeze({
    ...combat,
    player: Object.freeze({
      ...player,
      aether: Math.min(
        next.maxAether,
        player.aether + Math.max(0, next.maxAether - prior.maxAether),
      ),
      health: Math.min(
        next.maxHealth,
        player.health + Math.max(0, next.maxHealth - prior.maxHealth),
      ),
      stamina: Math.min(
        next.maxStamina,
        player.stamina + Math.max(0, next.maxStamina - prior.maxStamina),
      ),
    }),
  });
}

function combatDefeatAwards(
  prior: M3CombatState,
  next: M3CombatState,
  events: readonly Readonly<{ readonly kind: string; readonly values: readonly number[] }>[],
): Readonly<{
  readonly defeated: readonly Readonly<{
    readonly entityId: number;
    readonly kit: (typeof MONSTER_KITS)[number];
  }>[];
  readonly experience: number;
}> {
  const defeated = new Set(
    events.flatMap((event) => {
      const entityId = event.values[0];
      return event.kind === "combat.defeated" &&
        entityId !== undefined &&
        entityId !== PLAYER_ENTITY_ID
        ? [entityId]
        : [];
    }),
  );
  let experience = 0;
  const awards: {
    readonly entityId: number;
    readonly kit: (typeof MONSTER_KITS)[number];
  }[] = [];
  for (const entityId of defeated) {
    const before = prior.monsters.find((monster) => monster.entityId === entityId);
    const after = next.monsters.find((monster) => monster.entityId === entityId);
    if (
      before === undefined ||
      after === undefined ||
      before.combat.health === 0 ||
      after.combat.health !== 0
    ) {
      continue;
    }
    const kit = MONSTER_KITS[after.kitIndex];
    if (kit === undefined) continue;
    experience += kit.xp;
    awards.push(Object.freeze({ entityId, kit }));
  }
  return Object.freeze({ defeated: Object.freeze(awards), experience });
}

function combatEventPayload(values: readonly [number, number, number, number]): Uint8Array {
  const payload = new Uint8Array(16);
  const view = new DataView(payload.buffer);
  for (const [index, value] of values.entries()) {
    view.setUint32(index * 4, value >>> 0, true);
  }
  return payload;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function popcount32(value: number): number {
  let remaining = value >>> 0;
  let count = 0;
  while (remaining !== 0) {
    remaining &= remaining - 1;
    count += 1;
  }
  return count;
}

function markerIndexPayload(markerIndex: number): Uint8Array {
  const payload = new Uint8Array(Uint32Array.BYTES_PER_ELEMENT);
  new DataView(payload.buffer).setUint32(0, markerIndex, true);
  return payload;
}

function interactionEvents(target: InteractionTarget | null) {
  if (target === null) return EMPTY_EVENTS;
  return Object.freeze([
    Object.freeze({
      kind: target.kind === "npc" ? "npc.interaction-activated" : "interaction.activated",
      payload: markerIndexPayload(target.value),
    }),
  ]);
}
