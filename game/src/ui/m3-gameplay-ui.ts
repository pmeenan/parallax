import type {
  HybridUiAction,
  HybridUiPresentation,
  SimulationSemanticEvent,
  SimulationService,
  SimulationTelemetrySnapshot,
} from "@parallax/engine";
import { ITEM_DEFINITIONS, type ItemId, RECIPES } from "../balance/items";
import {
  cumulativeExperienceForLevel,
  PROGRESSION_ABILITIES,
  PROGRESSION_LEVEL_CAP,
  type ProgressionAbilityId,
  type ProgressionAttributeId,
} from "../balance/progression";
import type { M3GameplayRuntime } from "../sim/m3-gameplay-runtime";
import {
  createAcceptQuestCommand,
  createCraftItemCommand,
  createEquipAbilityCommand,
  createEquipGearCommand,
  createInventorySnapshotQuery,
  createJournalSnapshotQuery,
  createLearnAbilityCommand,
  createProgressionSnapshotQuery,
  createQuestSnapshotQuery,
  createSpendAttributeCommand,
  createUseItemCommand,
} from "../sim/m3-simulation";
import type {
  M3GameplayScreenAction,
  M3GameplayScreenId,
  M3HudStatus,
  M3HybridUiModel,
} from "./m3-hybrid-ui";

export interface M3GameplayUiController {
  dispose(): void;
  handleAction(action: HybridUiAction): void;
  handleShortcut(code: string): boolean;
  subscribePresentations(listener: (presentation: HybridUiPresentation) => void): () => void;
}

interface InventorySnapshot {
  readonly gear: readonly Readonly<{
    readonly equipped: boolean;
    readonly itemId: ItemId;
    readonly rarity: number;
    readonly serial: number;
    readonly upgrades: number;
  }>[];
  readonly marks: number;
  readonly satchelActive: boolean;
  readonly stacks: readonly Readonly<{ readonly itemId: ItemId; readonly quantity: number }>[];
  readonly version: 1;
}

interface ProgressionSnapshot {
  readonly abilities: readonly Readonly<{
    readonly id: ProgressionAbilityId;
    readonly kind: "active" | "knack" | "passive";
    readonly learned: boolean;
  }>[];
  readonly activeSlots: readonly (ProgressionAbilityId | null)[];
  readonly attributes: Readonly<Record<ProgressionAttributeId, number>>;
  readonly experience: number;
  readonly experienceForNextLevel: number;
  readonly experienceIntoLevel: number;
  readonly knackSlots: readonly (ProgressionAbilityId | null)[];
  readonly level: number;
  readonly levelCap: number;
  readonly slotAccess: Readonly<{
    readonly active: readonly boolean[];
    readonly knack: readonly boolean[];
    readonly rule: "all-from-level-2";
  }>;
  readonly unspentAbilityPicks: number;
  readonly unspentAttributePoints: number;
  readonly version: 1;
}

interface QuestSnapshot {
  readonly journalEntryCount: number;
  readonly quests: readonly Readonly<{
    readonly currentStageIndex: number;
    readonly id: string;
    readonly localizationKey: string;
    readonly stages: readonly Readonly<{
      readonly objectives: readonly Readonly<{
        readonly localizationKey: string;
        readonly progress: number;
        readonly target: number;
      }>[];
    }>[];
    readonly status: "active" | "available" | "completed";
  }>[];
  readonly version: 1;
}

interface JournalSnapshot {
  readonly entries: readonly Readonly<{
    readonly localizationKey: string;
    readonly objectiveLocalizationKey: string | null;
    readonly questLocalizationKey: string | null;
    readonly sequence: number;
    readonly subjectLocalizationKey: string | null;
  }>[];
  readonly totalEntries: number;
  readonly version: 1;
}

const decoder = new TextDecoder();
const ATTRIBUTES = Object.freeze([
  "might",
  "finesse",
  "vitality",
  "attunement",
] as const satisfies readonly ProgressionAttributeId[]);

export function createM3GameplayUiController(
  simulation: SimulationService,
  gameplay: M3GameplayRuntime,
  ui: M3HybridUiModel,
): M3GameplayUiController {
  const listeners = new Set<(presentation: HybridUiPresentation) => void>();
  let activeScreen: M3GameplayScreenId | null = null;
  let disposed = false;
  let inventoryRecipePage = 0;
  let refreshGeneration = 0;
  let inventory: InventorySnapshot | null = null;
  let observedLoadCount = simulation.snapshot().loadCount;
  let progression: ProgressionSnapshot | null = null;
  let quests: QuestSnapshot | null = null;

  const present = (presentation: HybridUiPresentation | null): void => {
    if (presentation === null) return;
    for (const listener of listeners) listener(presentation);
  };

  const refreshScreen = async (screen: M3GameplayScreenId): Promise<void> => {
    const generation = ++refreshGeneration;
    try {
      if (screen === "inventory") {
        const [inventoryResult, progressionResult] = await Promise.all([
          simulation.queryGameState(createInventorySnapshotQuery()),
          simulation.queryGameState(createProgressionSnapshotQuery()),
        ]);
        const nextInventory = decodeInventory(inventoryResult.payload);
        const nextProgression = decodeProgression(progressionResult.payload);
        if (disposed || generation !== refreshGeneration || activeScreen !== screen) return;
        inventory = nextInventory;
        progression = nextProgression;
        present(
          ui.showScreen(inventoryScreen(nextInventory, nextProgression, inventoryRecipePage)),
        );
        return;
      }
      if (screen === "progression") {
        const result = await simulation.queryGameState(createProgressionSnapshotQuery());
        const next = decodeProgression(result.payload);
        if (disposed || generation !== refreshGeneration || activeScreen !== screen) return;
        progression = next;
        present(ui.showScreen(progressionScreen(next)));
        return;
      }
      const questResult = await simulation.queryGameState(createQuestSnapshotQuery());
      const nextQuests = decodeQuests(questResult.payload);
      const fromSequence = Math.max(0, nextQuests.journalEntryCount - 8);
      const journalResult = await simulation.queryGameState(
        createJournalSnapshotQuery(fromSequence, 8),
      );
      const journal = decodeJournal(journalResult.payload);
      if (disposed || generation !== refreshGeneration || activeScreen !== screen) return;
      quests = nextQuests;
      present(ui.showScreen(journalScreen(nextQuests, journal)));
    } catch (error: unknown) {
      if (disposed || generation !== refreshGeneration || activeScreen !== screen) return;
      const message = error instanceof Error ? error.message : "state unavailable";
      present(
        ui.showScreen({
          actions: navigationActions(screen),
          id: screen,
          lines: Object.freeze([`${title(screen)} · unavailable`, message]),
        }),
      );
    }
  };

  const open = (screen: M3GameplayScreenId): void => {
    if (disposed || ui.snapshot().dialog.visible) return;
    activeScreen = screen;
    present(
      ui.showScreen({
        actions: navigationActions(screen),
        id: screen,
        lines: Object.freeze([`${title(screen)} · loading…`]),
      }),
    );
    void refreshScreen(screen);
  };

  const unsubscribeSimulation = simulation.subscribe((snapshot) => {
    const hud = hudStatus(snapshot);
    if (hud !== null) present(ui.updateHud(hud));
    if (snapshot.loadCount === observedLoadCount) return;
    observedLoadCount = snapshot.loadCount;
    inventory = null;
    progression = null;
    quests = null;
    if (activeScreen !== null && snapshot.state === "running") void refreshScreen(activeScreen);
  });
  const unsubscribeEvents = simulation.subscribeEvents((events) => {
    for (const event of events) {
      const message = semanticMessage(event);
      if (message !== null) present(ui.recordSemanticMessage(message));
    }
    if (activeScreen !== null && events.some(eventChangesGameplayScreen)) {
      void refreshScreen(activeScreen);
    }
  });
  const unsubscribeAuthority = simulation.subscribeAuthorityChanges(() => {
    refreshGeneration += 1;
  });

  return Object.freeze({
    dispose(): void {
      if (disposed) return;
      disposed = true;
      refreshGeneration += 1;
      unsubscribeAuthority();
      unsubscribeEvents();
      unsubscribeSimulation();
      listeners.clear();
    },
    handleAction(action: HybridUiAction): void {
      // The engine delivers a worker action only when it is valid against the current
      // heavy screen (an older pinned revision is accepted exactly when the screen is
      // action-identical), so requiring the latest revision here would re-drop
      // activations that raced a HUD-only presentation update.
      if (disposed || ui.snapshot().heavyScreen?.visible !== true) return;
      if (action.source !== "heavy-screen-worker") return;
      if (action.actionId === "screen:close") {
        activeScreen = null;
        refreshGeneration += 1;
        present(ui.closeScreen());
        return;
      }
      if (action.actionId.startsWith("screen:open:")) {
        const screen = action.actionId.slice("screen:open:".length);
        if (screen === "inventory" || screen === "progression" || screen === "journal")
          open(screen);
        return;
      }
      if (action.actionId.startsWith("inventory:craft:")) {
        const recipeId = action.actionId.slice("inventory:craft:".length);
        if (RECIPES.some((recipe) => recipe.id === recipeId)) {
          gameplay.enqueueCommand((sequence, targetTick) =>
            createCraftItemCommand(sequence, targetTick, recipeId),
          );
        }
        return;
      }
      if (
        action.actionId === "inventory:recipes:next" ||
        action.actionId === "inventory:recipes:previous"
      ) {
        const pageCount = Math.ceil(RECIPES.length / 6);
        inventoryRecipePage =
          action.actionId === "inventory:recipes:next"
            ? (inventoryRecipePage + 1) % pageCount
            : (inventoryRecipePage + pageCount - 1) % pageCount;
        if (inventory !== null && progression !== null) {
          present(ui.showScreen(inventoryScreen(inventory, progression, inventoryRecipePage)));
        }
        return;
      }
      if (action.actionId.startsWith("inventory:equip:")) {
        const serial = Number(action.actionId.slice("inventory:equip:".length));
        if (inventory?.gear.some((gear) => gear.serial === serial) === true) {
          gameplay.enqueueCommand((sequence, targetTick) =>
            createEquipGearCommand(sequence, targetTick, serial),
          );
        }
        return;
      }
      if (action.actionId.startsWith("inventory:use:")) {
        const itemId = action.actionId.slice("inventory:use:".length);
        if (isItemId(itemId)) {
          gameplay.enqueueCommand((sequence, targetTick) =>
            createUseItemCommand(sequence, targetTick, itemId),
          );
        }
        return;
      }
      if (action.actionId.startsWith("progression:spend:")) {
        const attribute = action.actionId.slice("progression:spend:".length);
        if (isAttribute(attribute)) {
          gameplay.enqueueCommand((sequence, targetTick) =>
            createSpendAttributeCommand(sequence, targetTick, attribute),
          );
        }
        return;
      }
      if (action.actionId.startsWith("progression:learn:")) {
        const abilityId = action.actionId.slice("progression:learn:".length);
        if (isAbilityId(abilityId)) {
          gameplay.enqueueCommand((sequence, targetTick) =>
            createLearnAbilityCommand(sequence, targetTick, abilityId),
          );
        }
        return;
      }
      if (action.actionId.startsWith("progression:equip:")) {
        const abilityId = action.actionId.slice("progression:equip:".length);
        const ability = progression?.abilities.find((candidate) => candidate.id === abilityId);
        if (ability === undefined || ability.kind === "passive" || !ability.learned) return;
        const kind = ability.kind;
        const slots = kind === "active" ? progression?.activeSlots : progression?.knackSlots;
        const slot = slots?.indexOf(null) ?? -1;
        gameplay.enqueueCommand((sequence, targetTick) =>
          createEquipAbilityCommand(sequence, targetTick, kind, slot < 0 ? 0 : slot, ability.id),
        );
        return;
      }
      if (action.actionId.startsWith("journal:accept:")) {
        const questId = action.actionId.slice("journal:accept:".length);
        if (quests?.quests.some((quest) => quest.id === questId && quest.status === "available")) {
          gameplay.enqueueCommand((sequence, targetTick) =>
            createAcceptQuestCommand(sequence, targetTick, questId),
          );
        }
      }
    },
    handleShortcut(code: string): boolean {
      if (disposed || ui.snapshot().dialog.visible) return false;
      const screen =
        code === "KeyI"
          ? "inventory"
          : code === "KeyP"
            ? "progression"
            : code === "KeyJ"
              ? "journal"
              : null;
      if (screen === null) return false;
      if (activeScreen === screen) {
        activeScreen = null;
        refreshGeneration += 1;
        present(ui.closeScreen());
      } else {
        open(screen);
      }
      return true;
    },
    subscribePresentations(listener: (presentation: HybridUiPresentation) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

function navigationActions(active: M3GameplayScreenId): readonly M3GameplayScreenAction[] {
  return Object.freeze(
    (["inventory", "progression", "journal"] as const).map((screen) =>
      Object.freeze({
        actionId: `screen:open:${screen}`,
        disabled: screen === active,
        label: title(screen),
        tone: screen === active ? ("disabled" as const) : ("neutral" as const),
      }),
    ),
  );
}

function inventoryScreen(
  state: InventorySnapshot,
  progression: ProgressionSnapshot,
  recipePage: number,
): Readonly<{
  readonly actions: readonly M3GameplayScreenAction[];
  readonly id: "inventory";
  readonly lines: readonly string[];
}> {
  const quantities = new Map(state.stacks.map((stack) => [stack.itemId, stack.quantity]));
  const tinkersThrift = progression.abilities.some(
    (ability) => ability.id === "tinkers-thrift" && ability.learned,
  );
  const pageCount = Math.ceil(RECIPES.length / 6);
  const normalizedPage = recipePage % pageCount;
  const craftActions = RECIPES.slice(normalizedPage * 6, normalizedPage * 6 + 6).map((recipe) => {
    const craftable = recipe.ingredients.every((ingredient) => {
      const definition = ITEM_DEFINITIONS.find((item) => item.id === ingredient.itemId);
      const reduction = tinkersThrift && definition?.material?.tinkersThriftEligible ? 1 : 0;
      return (
        (quantities.get(ingredient.itemId) ?? 0) >= Math.max(1, ingredient.quantity - reduction)
      );
    });
    return Object.freeze({
      actionId: `inventory:craft:${recipe.id}`,
      disabled: !craftable,
      label: `Craft ${displayName(recipe.outputItemId)} at ${recipe.station}`,
    });
  });
  const gearActions = state.gear
    .filter((gear) => !gear.equipped)
    .slice(0, 2)
    .map((gear) =>
      Object.freeze({
        actionId: `inventory:equip:${gear.serial}`,
        disabled: false,
        label: `Equip ${displayName(gear.itemId)} #${gear.serial}`,
      }),
    );
  const usableActions = state.stacks
    .filter(
      (stack) => ITEM_DEFINITIONS.find((item) => item.id === stack.itemId)?.kind === "consumable",
    )
    .slice(0, 2)
    .map((stack) =>
      Object.freeze({
        actionId: `inventory:use:${stack.itemId}`,
        disabled: false,
        label: `Use ${displayName(stack.itemId)} (${stack.quantity})`,
      }),
    );
  const stackLines = state.stacks
    .slice(0, 8)
    .map((stack) => `${displayName(stack.itemId)} ×${stack.quantity}`);
  const gearLines = state.gear
    .slice(0, 4)
    .map(
      (gear) =>
        `${gear.equipped ? "Equipped" : "Pack"} · ${displayName(gear.itemId)} #${gear.serial}`,
    );
  return Object.freeze({
    actions: Object.freeze(
      [
        ...navigationActions("inventory"),
        Object.freeze({
          actionId: "inventory:recipes:previous",
          disabled: false,
          label: "Previous recipe page",
        }),
        Object.freeze({
          actionId: "inventory:recipes:next",
          disabled: false,
          label: "Next recipe page",
        }),
        ...craftActions,
        ...gearActions,
        ...usableActions,
      ].slice(0, 15),
    ),
    id: "inventory" as const,
    lines: Object.freeze([
      `INVENTORY & CRAFTING · ${state.marks} marks${state.satchelActive ? " · satchel dropped" : ""} · recipes ${normalizedPage + 1}/${pageCount}`,
      "Crafting actions require the matching nearby station.",
      ...(stackLines.length === 0 ? ["No carried stacks."] : stackLines),
      ...gearLines,
    ]),
  });
}

function progressionScreen(state: ProgressionSnapshot) {
  const spendActions = ATTRIBUTES.map((attribute) =>
    Object.freeze({
      actionId: `progression:spend:${attribute}`,
      disabled: state.unspentAttributePoints === 0 || state.attributes[attribute] >= 10,
      label: `Raise ${displayName(attribute)}`,
    }),
  );
  const learnActions = state.abilities
    .filter((ability) => !ability.learned)
    .slice(0, 4)
    .map((ability) =>
      Object.freeze({
        actionId: `progression:learn:${ability.id}`,
        disabled: state.unspentAbilityPicks === 0,
        label: `Learn ${displayName(ability.id)} (${ability.kind})`,
      }),
    );
  const equipActions = state.abilities
    .filter(
      (ability) =>
        ability.learned &&
        ability.kind !== "passive" &&
        !(ability.kind === "active" ? state.activeSlots : state.knackSlots).includes(ability.id),
    )
    .slice(0, 4)
    .map((ability) =>
      Object.freeze({
        actionId: `progression:equip:${ability.id}`,
        disabled: false,
        label: `Equip ${displayName(ability.id)} in next ${ability.kind} slot`,
      }),
    );
  return Object.freeze({
    actions: Object.freeze(
      [
        ...navigationActions("progression"),
        ...spendActions,
        ...learnActions,
        ...equipActions,
      ].slice(0, 15),
    ),
    id: "progression" as const,
    lines: Object.freeze([
      `PROGRESSION · level ${state.level}/${state.levelCap} · ${state.experienceIntoLevel}/${state.experienceForNextLevel || "CAP"} XP`,
      `UNSPENT · ${state.unspentAttributePoints} attribute · ${state.unspentAbilityPicks} ability`,
      `Might ${state.attributes.might} · Finesse ${state.attributes.finesse} · Vitality ${state.attributes.vitality} · Attunement ${state.attributes.attunement}`,
      `Active 1–4 · ${state.activeSlots.map((ability) => displayName(ability ?? "empty")).join(" · ")}`,
      `Knacks 1–2 · ${state.knackSlots.map((ability) => displayName(ability ?? "empty")).join(" · ")}`,
      "All four active and two knack slots are available from level 2.",
    ]),
  });
}

function journalScreen(state: QuestSnapshot, journal: JournalSnapshot) {
  const active = state.quests.filter((quest) => quest.status === "active");
  const available = state.quests.filter((quest) => quest.status === "available");
  const questLines = active.slice(0, 5).map((quest) => {
    const stage = quest.stages[quest.currentStageIndex];
    const objectives =
      stage?.objectives.map(
        (objective) =>
          `${displayLocalization(objective.localizationKey)} ${objective.progress}/${objective.target}`,
      ) ?? [];
    return `${displayLocalization(quest.localizationKey)} · ${objectives.join(", ")}`;
  });
  const journalLines = journal.entries.slice(-6).map((entry) => {
    const subject =
      entry.objectiveLocalizationKey ??
      entry.subjectLocalizationKey ??
      entry.questLocalizationKey ??
      entry.localizationKey;
    return `#${entry.sequence + 1} ${displayLocalization(entry.localizationKey)} · ${displayLocalization(subject)}`;
  });
  const acceptActions = available.slice(0, 8).map((quest) =>
    Object.freeze({
      actionId: `journal:accept:${quest.id}`,
      disabled: false,
      label: `Accept ${displayLocalization(quest.localizationKey)}`,
    }),
  );
  return Object.freeze({
    actions: Object.freeze([...navigationActions("journal"), ...acceptActions]),
    id: "journal" as const,
    lines: Object.freeze([
      `QUESTS & JOURNAL · ${active.length} active · ${journal.totalEntries} recorded beats`,
      ...(questLines.length === 0 ? ["No active quests."] : questLines),
      "RECENT HISTORY",
      ...(journalLines.length === 0 ? ["No journal entries yet."] : journalLines),
    ]),
  });
}

function hudStatus(snapshot: SimulationTelemetrySnapshot): M3HudStatus | null {
  const counters = snapshot.gameCounters;
  const level = counters.progressionLevel;
  if (snapshot.state !== "running" || level === undefined) return null;
  const levelCap = PROGRESSION_LEVEL_CAP;
  const levelFloor = cumulativeExperienceForLevel(level);
  const experience = counters.progressionExperience ?? levelFloor;
  return Object.freeze({
    aether: counters.combatPlayerAether ?? 0,
    experienceForNextLevel:
      level === levelCap ? 0 : cumulativeExperienceForLevel(level + 1) - levelFloor,
    experienceIntoLevel: level === levelCap ? 0 : experience - levelFloor,
    health: counters.combatPlayerHealth ?? 0,
    ironsetTicks: counters.combatPlayerIronsetTicks ?? 0,
    level,
    levelCap,
    maxAether: counters.combatPlayerMaxAether ?? 1,
    maxHealth: counters.combatPlayerMaxHealth ?? Math.max(1, counters.combatPlayerHealth ?? 1),
    maxStamina: counters.combatPlayerMaxStamina ?? Math.max(1, counters.combatPlayerStamina ?? 1),
    stamina: counters.combatPlayerStamina ?? 0,
    unspentAbilityPicks: counters.progressionUnspentAbilityPicks ?? 0,
    unspentAttributePoints: counters.progressionUnspentAttributePoints ?? 0,
  });
}

function semanticMessage(event: SimulationSemanticEvent): string | null {
  if (event.kind === "progression.level-up-payoff") {
    return `LEVEL ${eventValue(event, 0)} · stamina and aether restored · health unchanged`;
  }
  if (event.kind === "combat.ironset-started") return "IRONSET PLANTED";
  if (event.kind === "combat.ironset-ended") {
    const reason = eventValue(event, 1);
    return `IRONSET RELEASED · ${reason === 2 ? "stamina spent" : reason === 3 ? "downed" : "duration ended"}`;
  }
  if (event.kind === "progression.changed") return "Build updated";
  if (event.kind === "progression.rejected") return "Build change rejected";
  if (event.kind === "items.crafted") return "Craft completed";
  if (event.kind === "items.rejected") return "Item action unavailable here";
  if (event.kind === "quest.accepted") return "Quest accepted";
  if (event.kind === "quest.stage-completed") return "Quest stage completed";
  return null;
}

function eventChangesGameplayScreen(event: SimulationSemanticEvent): boolean {
  return (
    event.kind.startsWith("items.") ||
    event.kind.startsWith("loot.") ||
    event.kind.startsWith("progression.") ||
    event.kind.startsWith("quest.") ||
    event.kind === "landmark.discovered"
  );
}

function eventValue(event: SimulationSemanticEvent, index: number): number {
  if (event.payload.byteLength !== 16) return 0;
  return new DataView(
    event.payload.buffer,
    event.payload.byteOffset,
    event.payload.byteLength,
  ).getUint32(index * 4, true);
}

function decodeInventory(payload: Uint8Array): InventorySnapshot {
  const value = parseObject(payload, "inventory");
  if (value.version !== 1 || !Array.isArray(value.stacks) || !Array.isArray(value.gear)) {
    throw new Error("Inventory snapshot is invalid");
  }
  return value as unknown as InventorySnapshot;
}

function decodeProgression(payload: Uint8Array): ProgressionSnapshot {
  const value = parseObject(payload, "progression");
  if (value.version !== 1 || !Array.isArray(value.abilities) || !Array.isArray(value.activeSlots)) {
    throw new Error("Progression snapshot is invalid");
  }
  return value as unknown as ProgressionSnapshot;
}

function decodeQuests(payload: Uint8Array): QuestSnapshot {
  const value = parseObject(payload, "quest");
  if (value.version !== 1 || !Array.isArray(value.quests))
    throw new Error("Quest snapshot is invalid");
  return value as unknown as QuestSnapshot;
}

function decodeJournal(payload: Uint8Array): JournalSnapshot {
  const value = parseObject(payload, "journal");
  if (value.version !== 1 || !Array.isArray(value.entries)) {
    throw new Error("Journal snapshot is invalid");
  }
  return value as unknown as JournalSnapshot;
}

function parseObject(payload: Uint8Array, label: string): Record<string, unknown> {
  const value: unknown = JSON.parse(decoder.decode(payload));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} snapshot is invalid`);
  }
  return value as Record<string, unknown>;
}

function isItemId(value: string): value is ItemId {
  return ITEM_DEFINITIONS.some((item) => item.id === value);
}

function isAbilityId(value: string): value is ProgressionAbilityId {
  return PROGRESSION_ABILITIES.some((ability) => ability.id === value);
}

function isAttribute(value: string): value is ProgressionAttributeId {
  return ATTRIBUTES.includes(value as ProgressionAttributeId);
}

function title(screen: M3GameplayScreenId): string {
  if (screen === "inventory") return "Inventory & crafting";
  if (screen === "progression") return "Progression & loadout";
  return "Quests & journal";
}

function displayLocalization(value: string): string {
  return displayName(value.split(".").at(-1) ?? value);
}

function displayName(value: string): string {
  return value
    .split("-")
    .map((part) => (part.length === 0 ? part : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`))
    .join(" ");
}
