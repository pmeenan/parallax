import { COMBAT_EQUIPMENT_DEFAULTS } from "../balance/combat";
import {
  type ConsumableEffect,
  type FoodBonuses,
  GATHERING_NODE_CAPACITY,
  GATHERING_REGROWTH_TICKS,
  GEAR_AFFIXES,
  type GearAffixId,
  type GearSlot,
  ITEM_BUYBACK,
  ITEM_DEFINITIONS,
  ITEM_RULES_VERSION,
  ITEM_STACK_LIMIT,
  ITEM_STARTING_MARKS,
  type ItemId,
  type ItemRarity,
  itemIndex,
  LOOT_RARITY_BALANCE,
  MAXIMUM_GEAR_INSTANCES,
  MONSTER_LOOT,
  RECIPES,
  type Resonance,
  VENDOR_OFFERS,
} from "../balance/items";
import { nextRandomU32 } from "./combat-core";

export const ITEM_STATE_HEADER_BYTES = 192;
export const GEAR_INSTANCE_BYTES = 24;
export const ITEM_STATE_BYTES =
  ITEM_STATE_HEADER_BYTES +
  ITEM_DEFINITIONS.length * Uint32Array.BYTES_PER_ELEMENT * 2 +
  MAXIMUM_GEAR_INSTANCES * GEAR_INSTANCE_BYTES +
  GATHERING_NODE_CAPACITY * Uint32Array.BYTES_PER_ELEMENT;
const RARITIES: readonly ItemRarity[] = Object.freeze(["common", "fine", "exceptional", "mythic"]);
const RESONANCES: readonly (Resonance | null)[] = Object.freeze([null, "ember", "frost", "aether"]);
const COUNTER_KEYS = Object.freeze([
  "buyCount",
  "consumableUseCount",
  "craftCount",
  "equipmentChangeCount",
  "gatherCount",
  "gearCreatedCount",
  "lootAwardCount",
  "marksEarned",
  "marksSpent",
  "satchelDropCount",
  "satchelRecoveryCount",
  "sellCount",
  "upgradeCount",
] as const satisfies readonly (keyof ItemCounters)[]);
const CONSUMABLE_EFFECTS = ITEM_DEFINITIONS.flatMap(({ consumable }) =>
  consumable === undefined ? [] : [consumable],
);
const maximumEffectDuration = (kind: ConsumableEffect["kind"]): number =>
  Math.max(
    0,
    ...CONSUMABLE_EFFECTS.flatMap((effect) =>
      effect.kind === kind && "durationTicks" in effect ? [effect.durationTicks] : [],
    ),
  );
const MAXIMUM_FOOD_TICKS = maximumEffectDuration("food");
const MAXIMUM_OIL_TICKS = maximumEffectDuration("oil");
const MAXIMUM_STONE_TICKS = maximumEffectDuration("stone");
const VIGOR_EFFECT = (() => {
  const effect = CONSUMABLE_EFFECTS.find(
    (candidate): candidate is Extract<ConsumableEffect, { readonly kind: "vigor" }> =>
      candidate.kind === "vigor",
  );
  if (effect === undefined) throw new Error("Vigor consumable balance is missing");
  return effect;
})();
const EMPTY_FOOD_BONUSES: FoodBonuses = Object.freeze({});

export interface GearInstance {
  readonly affixMask: number;
  readonly itemIndex: number;
  readonly rarity: ItemRarity;
  readonly resonance: Resonance | null;
  readonly serial: number;
  readonly uniqueProperty: 0 | 1;
  readonly upgrades: number;
}

export interface ItemCounters {
  readonly buyCount: number;
  readonly consumableUseCount: number;
  readonly craftCount: number;
  readonly equipmentChangeCount: number;
  readonly gatherCount: number;
  readonly gearCreatedCount: number;
  readonly lootAwardCount: number;
  readonly marksEarned: number;
  readonly marksSpent: number;
  readonly satchelDropCount: number;
  readonly satchelRecoveryCount: number;
  readonly sellCount: number;
  readonly upgradeCount: number;
}

export interface ItemState {
  readonly activeFoodItemIndex: number;
  readonly counters: ItemCounters;
  readonly equippedArmorSerial: number;
  readonly equippedCatalystSerial: number;
  readonly equippedShieldSerial: number;
  readonly equippedWeaponSerial: number;
  readonly foodTicks: number;
  readonly gatheredNodeMask: number;
  readonly gear: readonly GearInstance[];
  readonly lootRngState: number;
  readonly marks: number;
  readonly nextGearSerial: number;
  readonly nodeCooldownTicks: readonly number[];
  readonly oilKind: 0 | 1 | 2;
  readonly oilTicks: number;
  readonly satchelActive: boolean;
  readonly satchelCounts: readonly number[];
  readonly satchelPosition: readonly [number, number, number];
  readonly stackCounts: readonly number[];
  readonly stoneTonicTicks: number;
  readonly version: typeof ITEM_RULES_VERSION;
  readonly vigorAccumulator: number;
  readonly vigorRemaining: number;
  readonly vigorTicks: number;
}

export interface ItemOperationResult {
  readonly applied: boolean;
  readonly state: ItemState;
}

export interface UseConsumableResult extends ItemOperationResult {
  readonly effect: ConsumableEffect | null;
}

export interface LootAwardResult extends ItemOperationResult {
  readonly displacedGearSerial: number;
  readonly gearSerial: number;
  readonly marks: number;
}

export interface ItemCombatBonuses {
  readonly affixAccuracy: number;
  readonly affixBracing: boolean;
  readonly affixDamage: number;
  readonly affixNimble: boolean;
  readonly affixPotency: number;
  readonly armorGuard: number;
  readonly armorSoakElemental: number;
  readonly armorSoakPhysical: number;
  readonly attunementBonus: number;
  readonly blockStaminaCostNumerator: number;
  readonly catalystOmniResonance: boolean;
  readonly catalystPotency: number;
  readonly catalystResonance: Resonance | null;
  readonly finesseBonus: number;
  readonly healthRegenOutOfCombat: number;
  readonly maxHealthBonus: number;
  readonly maxStaminaBonus: number;
  readonly mightBonus: number;
  readonly staminaRegenBonus: number;
  readonly weaponAccuracy: number;
  readonly weaponBase: number;
  readonly weaponEmberDamage: number;
  readonly weaponFrostDamage: number;
  readonly weaponKeenCondition: "envenomed" | null;
  readonly weaponRangeMeters: number;
  readonly weaponRecoveryTicksBonus: number;
  readonly weaponStaminaCostNumerator: number;
  readonly weaponVenomDamage: number;
}

const ZERO_COUNTERS: ItemCounters = Object.freeze({
  buyCount: 0,
  consumableUseCount: 0,
  craftCount: 0,
  equipmentChangeCount: 0,
  gatherCount: 0,
  gearCreatedCount: 0,
  lootAwardCount: 0,
  marksEarned: 0,
  marksSpent: 0,
  satchelDropCount: 0,
  satchelRecoveryCount: 0,
  sellCount: 0,
  upgradeCount: 0,
});

function blankCounts(): readonly number[] {
  return Object.freeze(Array.from({ length: ITEM_DEFINITIONS.length }, () => 0));
}

export function createInitialItemState(seed: number): ItemState {
  let state: ItemState = Object.freeze({
    activeFoodItemIndex: -1,
    counters: ZERO_COUNTERS,
    equippedArmorSerial: 0,
    equippedCatalystSerial: 0,
    equippedShieldSerial: 0,
    equippedWeaponSerial: 0,
    foodTicks: 0,
    gatheredNodeMask: 0,
    gear: Object.freeze([]),
    lootRngState: (seed ^ 0x1656_67b1) >>> 0 || 0x1656_67b1,
    marks: ITEM_STARTING_MARKS,
    nextGearSerial: 1,
    nodeCooldownTicks: Object.freeze(Array.from({ length: GATHERING_NODE_CAPACITY }, () => 0)),
    oilKind: 0,
    oilTicks: 0,
    satchelActive: false,
    satchelCounts: blankCounts(),
    satchelPosition: Object.freeze([0, 0, 0] as const),
    stackCounts: blankCounts(),
    stoneTonicTicks: 0,
    version: ITEM_RULES_VERSION,
    vigorAccumulator: 0,
    vigorRemaining: 0,
    vigorTicks: 0,
  });
  for (const itemId of ["sword", "leather-jack", "ashwood-focus"] as const) {
    state = createGear(state, itemId, "common", null, false).state;
  }
  const [weapon, armor, catalyst] = state.gear;
  if (weapon === undefined || armor === undefined || catalyst === undefined) {
    throw new Error("Starter gear creation failed");
  }
  const equipped = Object.freeze({
    ...state,
    equippedArmorSerial: armor.serial,
    equippedCatalystSerial: catalyst.serial,
    equippedWeaponSerial: weapon.serial,
  });
  return addItemStack(equipped, "hearthloaf", 1);
}

export function addItemStack(state: ItemState, id: ItemId, quantity: number): ItemState {
  const definition = ITEM_DEFINITIONS[itemIndex(id)];
  if (definition?.kind === "gear" || !Number.isSafeInteger(quantity) || quantity <= 0) return state;
  const index = itemIndex(id);
  if ((state.stackCounts[index] ?? 0) + quantity > ITEM_STACK_LIMIT) return state;
  const counts = [...state.stackCounts];
  counts[index] = (counts[index] ?? 0) + quantity;
  return Object.freeze({ ...state, stackCounts: Object.freeze(counts) });
}

export function gatherItemNode(
  state: ItemState,
  nodeIndex: number,
  id: ItemId,
  quantity: number,
  foragersEye: boolean,
): ItemOperationResult {
  if (
    !Number.isSafeInteger(nodeIndex) ||
    nodeIndex < 0 ||
    nodeIndex >= GATHERING_NODE_CAPACITY ||
    (state.nodeCooldownTicks[nodeIndex] ?? 0) > 0
  ) {
    return Object.freeze({ applied: false, state });
  }
  const next = addItemStack(state, id, quantity + Number(foragersEye));
  if (next === state) return Object.freeze({ applied: false, state });
  return Object.freeze({
    applied: true,
    state: Object.freeze({
      ...next,
      counters: incrementCounter(next.counters, "gatherCount"),
      gatheredNodeMask: (state.gatheredNodeMask | (1 << nodeIndex)) >>> 0,
      nodeCooldownTicks: Object.freeze(
        state.nodeCooldownTicks.map((ticks, index) =>
          index === nodeIndex ? GATHERING_REGROWTH_TICKS : ticks,
        ),
      ),
    }),
  });
}

export function craftRecipe(
  state: ItemState,
  recipeIndexValue: number,
  resonance: Resonance | null,
  tinkersThrift: boolean,
): ItemOperationResult {
  const recipe = RECIPES[recipeIndexValue];
  if (recipe === undefined) return Object.freeze({ applied: false, state });
  if (recipe.outputItemId === "resonant-focus" && resonance === null) {
    return Object.freeze({ applied: false, state });
  }
  if (recipe.outputItemId !== "resonant-focus" && resonance !== null) {
    return Object.freeze({ applied: false, state });
  }
  const costs = recipe.ingredients.map(({ itemId, quantity }) => {
    const definition = ITEM_DEFINITIONS[itemIndex(itemId)];
    const thriftApplies = tinkersThrift && definition?.material?.tinkersThriftEligible === true;
    return Object.freeze({ itemId, quantity: Math.max(1, quantity - Number(thriftApplies)) });
  });
  if (
    costs.some(({ itemId, quantity }) => (state.stackCounts[itemIndex(itemId)] ?? 0) < quantity)
  ) {
    return Object.freeze({ applied: false, state });
  }
  const counts = [...state.stackCounts];
  for (const cost of costs) {
    const index = itemIndex(cost.itemId);
    counts[index] = (counts[index] ?? 0) - cost.quantity;
  }
  let next: ItemState = Object.freeze({ ...state, stackCounts: Object.freeze(counts) });
  const output = ITEM_DEFINITIONS[itemIndex(recipe.outputItemId)];
  if (output?.kind === "gear") {
    const created = createGear(next, recipe.outputItemId, "fine", resonance, true);
    if (!created.applied) return Object.freeze({ applied: false, state });
    next = created.state;
  } else {
    next = addItemStack(next, recipe.outputItemId, 1);
    if (
      next.stackCounts[itemIndex(recipe.outputItemId)] ===
      state.stackCounts[itemIndex(recipe.outputItemId)]
    ) {
      return Object.freeze({ applied: false, state });
    }
  }
  return Object.freeze({
    applied: true,
    state: Object.freeze({
      ...next,
      counters: incrementCounter(next.counters, "craftCount"),
    }),
  });
}

export function buyVendorItem(state: ItemState, offerIndex: number): ItemOperationResult {
  const offer = VENDOR_OFFERS[offerIndex];
  if (offer === undefined) return Object.freeze({ applied: false, state });
  const definition = ITEM_DEFINITIONS[itemIndex(offer.itemId)];
  if (definition === undefined || definition.buyPrice <= 0 || state.marks < definition.buyPrice) {
    return Object.freeze({ applied: false, state });
  }
  let next = Object.freeze({ ...state, marks: state.marks - definition.buyPrice });
  if (definition.kind === "gear") {
    const created = createGear(next, offer.itemId, "common", null, false);
    if (!created.applied) return Object.freeze({ applied: false, state });
    next = created.state;
  } else {
    const stacked = addItemStack(next, offer.itemId, 1);
    if (stacked === next) return Object.freeze({ applied: false, state });
    next = stacked;
  }
  return Object.freeze({
    applied: true,
    state: Object.freeze({
      ...next,
      counters: Object.freeze({
        ...next.counters,
        buyCount: next.counters.buyCount + 1,
        marksSpent: next.counters.marksSpent + definition.buyPrice,
      }),
    }),
  });
}

export function sellItemStack(state: ItemState, id: ItemId): ItemOperationResult {
  const index = itemIndex(id);
  const definition = ITEM_DEFINITIONS[index];
  const value = definition === undefined ? 0 : buybackValue(definition.buyPrice);
  if (definition?.kind === "gear" || value <= 0 || (state.stackCounts[index] ?? 0) <= 0) {
    return Object.freeze({ applied: false, state });
  }
  const counts = [...state.stackCounts];
  counts[index] = (counts[index] ?? 0) - 1;
  return Object.freeze({
    applied: true,
    state: Object.freeze({
      ...state,
      counters: Object.freeze({
        ...state.counters,
        marksEarned: state.counters.marksEarned + value,
        sellCount: state.counters.sellCount + 1,
      }),
      marks: state.marks + value,
      stackCounts: Object.freeze(counts),
    }),
  });
}

export function sellGear(state: ItemState, serial: number): ItemOperationResult {
  const index = state.gear.findIndex((candidate) => candidate.serial === serial);
  const instance = state.gear[index];
  const definition = instance === undefined ? undefined : ITEM_DEFINITIONS[instance.itemIndex];
  const equipped = equippedSerials(state).includes(serial);
  if (
    instance === undefined ||
    definition === undefined ||
    equipped ||
    instance.rarity === "mythic"
  ) {
    return Object.freeze({ applied: false, state });
  }
  const value = buybackValue(definition.buyPrice);
  if (value <= 0) return Object.freeze({ applied: false, state });
  return Object.freeze({
    applied: true,
    state: Object.freeze({
      ...state,
      counters: Object.freeze({
        ...state.counters,
        marksEarned: state.counters.marksEarned + value,
        sellCount: state.counters.sellCount + 1,
      }),
      gear: Object.freeze(state.gear.filter((_, gearIndex) => gearIndex !== index)),
      marks: state.marks + value,
    }),
  });
}

export function equipGear(state: ItemState, serial: number): ItemOperationResult {
  const instance = state.gear.find((candidate) => candidate.serial === serial);
  const definition = instance === undefined ? undefined : ITEM_DEFINITIONS[instance.itemIndex];
  const slot = definition?.gear?.slot;
  if (instance === undefined || slot === undefined) return Object.freeze({ applied: false, state });
  const key = equippedKey(slot);
  if (state[key] === serial) return Object.freeze({ applied: false, state });
  return Object.freeze({
    applied: true,
    state: Object.freeze({
      ...state,
      [key]: serial,
      counters: incrementCounter(state.counters, "equipmentChangeCount"),
    }),
  });
}

export function unequipGear(state: ItemState, slot: GearSlot): ItemOperationResult {
  const key = equippedKey(slot);
  if (state[key] === 0) return Object.freeze({ applied: false, state });
  return Object.freeze({
    applied: true,
    state: Object.freeze({
      ...state,
      [key]: 0,
      counters: incrementCounter(state.counters, "equipmentChangeCount"),
    }),
  });
}

export function applyGearUpgrade(
  state: ItemState,
  serial: number,
  upgradeId: "armor-fitting" | "weapon-whetting",
): ItemOperationResult {
  const gearIndex = state.gear.findIndex((candidate) => candidate.serial === serial);
  const instance = state.gear[gearIndex];
  const definition = instance === undefined ? undefined : ITEM_DEFINITIONS[instance.itemIndex];
  const upgradeDefinition = ITEM_DEFINITIONS[itemIndex(upgradeId)]?.upgrade;
  const stackIndex = itemIndex(upgradeId);
  if (
    instance === undefined ||
    upgradeDefinition === undefined ||
    definition?.gear?.slot !== upgradeDefinition.slot ||
    (instance.upgrades & upgradeDefinition.bit) !== 0 ||
    (state.stackCounts[stackIndex] ?? 0) <= 0
  ) {
    return Object.freeze({ applied: false, state });
  }
  const counts = [...state.stackCounts];
  counts[stackIndex] = (counts[stackIndex] ?? 0) - 1;
  const gear = [...state.gear];
  gear[gearIndex] = Object.freeze({
    ...instance,
    upgrades: instance.upgrades | upgradeDefinition.bit,
  });
  return Object.freeze({
    applied: true,
    state: Object.freeze({
      ...state,
      counters: incrementCounter(state.counters, "upgradeCount"),
      gear: Object.freeze(gear),
      stackCounts: Object.freeze(counts),
    }),
  });
}

export function useConsumable(state: ItemState, id: ItemId): UseConsumableResult {
  const index = itemIndex(id);
  const effect = ITEM_DEFINITIONS[index]?.consumable;
  if (effect === undefined || (state.stackCounts[index] ?? 0) <= 0) {
    return Object.freeze({ applied: false, effect: null, state });
  }
  const counts = [...state.stackCounts];
  counts[index] = (counts[index] ?? 0) - 1;
  const food = effect.kind === "food";
  const oil = effect.kind === "oil";
  const stone = effect.kind === "stone";
  const vigor = effect.kind === "vigor";
  return Object.freeze({
    applied: true,
    effect,
    state: Object.freeze({
      ...state,
      activeFoodItemIndex: food ? index : state.activeFoodItemIndex,
      counters: incrementCounter(state.counters, "consumableUseCount"),
      foodTicks: food ? effect.durationTicks : state.foodTicks,
      oilKind: oil ? (effect.channel === "ember" ? 1 : 2) : state.oilKind,
      oilTicks: oil ? effect.durationTicks : state.oilTicks,
      stackCounts: Object.freeze(counts),
      stoneTonicTicks: stone ? effect.durationTicks : state.stoneTonicTicks,
      vigorAccumulator: vigor ? 0 : state.vigorAccumulator,
      vigorRemaining: vigor ? effect.healing : state.vigorRemaining,
      vigorTicks: vigor ? effect.durationTicks : state.vigorTicks,
    }),
  });
}

export function stepItemEffects(state: ItemState): ItemState {
  const foodTicks = Math.max(0, state.foodTicks - 1);
  const oilTicks = Math.max(0, state.oilTicks - 1);
  const stoneTonicTicks = Math.max(0, state.stoneTonicTicks - 1);
  const vigorTicks = Math.max(0, state.vigorTicks - 1);
  const nodeCooldownTicks = state.nodeCooldownTicks.some((ticks) => ticks > 0)
    ? Object.freeze(state.nodeCooldownTicks.map((ticks) => Math.max(0, ticks - 1)))
    : state.nodeCooldownTicks;
  if (
    foodTicks === state.foodTicks &&
    oilTicks === state.oilTicks &&
    stoneTonicTicks === state.stoneTonicTicks &&
    vigorTicks === state.vigorTicks &&
    nodeCooldownTicks === state.nodeCooldownTicks
  ) {
    return state;
  }
  return Object.freeze({
    ...state,
    activeFoodItemIndex: foodTicks === 0 ? -1 : state.activeFoodItemIndex,
    foodTicks,
    oilKind: oilTicks === 0 ? 0 : state.oilKind,
    oilTicks,
    nodeCooldownTicks,
    stoneTonicTicks,
    vigorAccumulator: vigorTicks === 0 ? 0 : state.vigorAccumulator,
    vigorRemaining: vigorTicks === 0 ? 0 : state.vigorRemaining,
    vigorTicks,
  });
}

export function consumeVigorHealing(
  state: ItemState,
  suppressed = false,
): Readonly<{ readonly amount: number; readonly state: ItemState }> {
  if (state.vigorRemaining === 0 || suppressed) return Object.freeze({ amount: 0, state });
  const accumulator = state.vigorAccumulator + VIGOR_EFFECT.healing;
  const amount = Math.min(
    state.vigorRemaining,
    Math.floor(accumulator / VIGOR_EFFECT.durationTicks),
  );
  return Object.freeze({
    amount,
    state: Object.freeze({
      ...state,
      vigorAccumulator: accumulator % VIGOR_EFFECT.durationTicks,
      vigorRemaining: state.vigorRemaining - amount,
    }),
  });
}

export function clearVigorHealing(state: ItemState): ItemState {
  if (state.vigorRemaining === 0 && state.vigorTicks === 0 && state.vigorAccumulator === 0) {
    return state;
  }
  return Object.freeze({ ...state, vigorAccumulator: 0, vigorRemaining: 0, vigorTicks: 0 });
}

export function spendMarks(state: ItemState, amount: number): ItemOperationResult {
  if (!Number.isSafeInteger(amount) || amount <= 0 || state.marks < amount) {
    return Object.freeze({ applied: false, state });
  }
  return Object.freeze({
    applied: true,
    state: Object.freeze({
      ...state,
      counters: Object.freeze({
        ...state.counters,
        marksSpent: state.counters.marksSpent + amount,
      }),
      marks: state.marks - amount,
    }),
  });
}

export function awardMonsterLoot(state: ItemState, kitId: string): LootAwardResult {
  const table = MONSTER_LOOT.find((candidate) => candidate.kitId === kitId);
  if (table === undefined) {
    return Object.freeze({
      applied: false,
      displacedGearSerial: 0,
      gearSerial: 0,
      marks: 0,
      state,
    });
  }
  let rng = state.lootRngState;
  const randomRange = (minimum: number, maximum: number): number => {
    rng = nextRandomU32(rng);
    return minimum + (rng % (maximum - minimum + 1));
  };
  let next = state;
  let overflowMarks = 0;
  for (const material of table.materialDrops) {
    const quantity = randomRange(material.minimum, material.maximum);
    const index = itemIndex(material.itemId);
    const available = Math.max(0, ITEM_STACK_LIMIT - (next.stackCounts[index] ?? 0));
    const accepted = Math.min(quantity, available);
    if (accepted > 0) next = addItemStack(next, material.itemId, accepted);
    const overflow = quantity - accepted;
    if (overflow > 0) {
      const definition = ITEM_DEFINITIONS[index];
      overflowMarks += overflow * Math.max(1, buybackValue(definition?.buyPrice ?? 0));
    }
  }
  const baseMarks = randomRange(table.marksMinimum, table.marksMaximum);
  let gearSerial = 0;
  let displacedGearSerial = 0;
  rng = nextRandomU32(rng);
  if (table.gearPool.length > 0 && rng % 10_000 < table.gearChancePerTenThousand) {
    rng = nextRandomU32(rng);
    const itemId = table.gearPool[rng % table.gearPool.length];
    if (itemId !== undefined) {
      const rarity = lootRarity(kitId, rng);
      if (next.gear.length >= MAXIMUM_GEAR_INSTANCES) {
        if (rarity === "mythic") {
          const eviction = evictGearForMythicLoot(next);
          next = eviction.state;
          displacedGearSerial = eviction.serial;
          overflowMarks += eviction.marks;
        } else {
          overflowMarks += buybackValue(ITEM_DEFINITIONS[itemIndex(itemId)]?.buyPrice ?? 0);
        }
      }
      const created = createGear(
        Object.freeze({ ...next, lootRngState: rng }),
        itemId,
        rarity,
        null,
        true,
      );
      next = created.state;
      gearSerial = created.gearSerial;
      rng = next.lootRngState;
    }
  }
  const marks = baseMarks + overflowMarks;
  next = Object.freeze({
    ...next,
    counters: Object.freeze({
      ...next.counters,
      lootAwardCount: next.counters.lootAwardCount + 1,
      marksEarned: next.counters.marksEarned + marks,
    }),
    lootRngState: rng,
    marks: next.marks + marks,
  });
  return Object.freeze({ applied: true, displacedGearSerial, gearSerial, marks, state: next });
}

export function dropMaterialSatchel(
  state: ItemState,
  position: readonly [number, number, number],
): ItemState {
  const satchel = state.stackCounts.map((count, index) => {
    const definition = ITEM_DEFINITIONS[index];
    return definition?.material?.satchelEligible === true ? count : 0;
  });
  if (satchel.every((count) => count === 0)) {
    if (!state.satchelActive) return state;
    return Object.freeze({ ...state, satchelActive: false, satchelCounts: blankCounts() });
  }
  const counts = state.stackCounts.map((count, index) => count - (satchel[index] ?? 0));
  return Object.freeze({
    ...state,
    counters: incrementCounter(state.counters, "satchelDropCount"),
    satchelActive: true,
    satchelCounts: Object.freeze(satchel),
    satchelPosition: Object.freeze([...position] as [number, number, number]),
    stackCounts: Object.freeze(counts),
  });
}

export function recoverMaterialSatchel(state: ItemState): ItemOperationResult {
  if (!state.satchelActive) return Object.freeze({ applied: false, state });
  const counts = state.stackCounts.map((count, index) => count + (state.satchelCounts[index] ?? 0));
  if (counts.some((count) => count > ITEM_STACK_LIMIT))
    return Object.freeze({ applied: false, state });
  return Object.freeze({
    applied: true,
    state: Object.freeze({
      ...state,
      counters: incrementCounter(state.counters, "satchelRecoveryCount"),
      satchelActive: false,
      satchelCounts: blankCounts(),
      stackCounts: Object.freeze(counts),
    }),
  });
}

export function itemCombatBonuses(state: ItemState): ItemCombatBonuses {
  const equipped = equippedSerials(state)
    .map((serial) => state.gear.find((instance) => instance.serial === serial))
    .filter((instance): instance is GearInstance => instance !== undefined);
  let armorGuard = 0;
  let armorSoakElemental = 0;
  const stoneEffect = CONSUMABLE_EFFECTS.find(
    (effect): effect is Extract<ConsumableEffect, { readonly kind: "stone" }> =>
      effect.kind === "stone",
  );
  let armorSoakPhysical = state.stoneTonicTicks > 0 ? (stoneEffect?.physicalSoak ?? 0) : 0;
  let catalystPotency = 0;
  let weaponAccuracy = 0;
  let weaponBase = 0;
  let weaponRangeMeters: number = COMBAT_EQUIPMENT_DEFAULTS.weaponRangeMeters;
  let weaponRecoveryTicksBonus = 0;
  let catalystResonance: Resonance | null = null;
  let catalystOmniResonance = false;
  let equipmentStaminaRegenBonus = 0;
  let affixAccuracy = 0;
  let affixDamage = 0;
  let affixPotency = 0;
  let affixBracing = false;
  let affixNimble = false;
  let blockStaminaCostNumerator: number = COMBAT_EQUIPMENT_DEFAULTS.staminaCostNumerator;
  let weaponStaminaCostNumerator: number = COMBAT_EQUIPMENT_DEFAULTS.staminaCostNumerator;
  let weaponEmberDamage = 0;
  let weaponFrostDamage = 0;
  let weaponVenomDamage = 0;
  let weaponKeenCondition: "envenomed" | null = null;
  const activeAffixes = new Set<GearAffixId>();
  for (const instance of equipped) {
    const values = ITEM_DEFINITIONS[instance.itemIndex]?.gear;
    if (values === undefined) continue;
    armorGuard += values.guard ?? 0;
    armorSoakElemental += values.soakElemental ?? 0;
    armorSoakPhysical += values.soakPhysical ?? 0;
    catalystPotency += values.potency ?? 0;
    equipmentStaminaRegenBonus += values.staminaRegenBonus ?? 0;
    weaponAccuracy += values.accuracy ?? 0;
    weaponBase += values.baseDamage ?? 0;
    weaponRangeMeters = values.weaponRangeMeters ?? weaponRangeMeters;
    weaponRecoveryTicksBonus += values.recoveryTicksBonus ?? 0;
    if (values.slot === "catalyst") {
      catalystResonance = instance.resonance;
      catalystOmniResonance = instance.uniqueProperty === 1;
    }
    for (const { upgrade } of ITEM_DEFINITIONS) {
      if (upgrade === undefined || (instance.upgrades & upgrade.bit) === 0) continue;
      if (upgrade.bonus.kind === "weapon-damage") weaponBase += upgrade.bonus.amount;
      if (upgrade.bonus.kind === "armor-guard") armorGuard += upgrade.bonus.amount;
    }
    for (let index = 0; index < GEAR_AFFIXES.length; index += 1) {
      if ((instance.affixMask & (1 << index)) === 0) continue;
      const affix = GEAR_AFFIXES[index];
      if (affix === undefined) continue;
      if (affix.effect.kind === "stamina-cost") {
        if (values.slot === "weapon") weaponStaminaCostNumerator = affix.effect.numerator;
        if (values.slot === "shield") blockStaminaCostNumerator = affix.effect.numerator;
        continue;
      }
      if (activeAffixes.has(affix.id)) continue;
      activeAffixes.add(affix.id);
      const effect = affix.effect;
      if (effect.kind === "accuracy") affixAccuracy += effect.amount;
      if (effect.kind === "physical-damage") affixDamage += effect.amount;
      if (effect.kind === "guard") armorGuard += effect.amount;
      if (effect.kind === "potency") affixPotency += effect.amount;
      if (effect.kind === "channel-damage") {
        if (effect.channel === "ember") weaponEmberDamage += effect.amount;
        if (effect.channel === "frost") weaponFrostDamage += effect.amount;
        if (effect.channel === "venom") weaponVenomDamage += effect.amount;
        weaponKeenCondition = effect.conditionOnKeen ?? weaponKeenCondition;
      }
      if (effect.kind === "bracing") affixBracing = true;
      if (effect.kind === "nimble") affixNimble = true;
    }
  }
  const oilChannel = state.oilKind === 1 ? "ember" : state.oilKind === 2 ? "frost" : null;
  const oilEffect = CONSUMABLE_EFFECTS.find(
    (effect): effect is Extract<ConsumableEffect, { readonly kind: "oil" }> =>
      effect.kind === "oil" && effect.channel === oilChannel,
  );
  if (state.oilTicks > 0 && oilEffect?.channel === "ember") {
    weaponEmberDamage += oilEffect.damage;
  }
  if (state.oilTicks > 0 && oilEffect?.channel === "frost") {
    weaponFrostDamage += oilEffect.damage;
  }
  const activeFood =
    state.activeFoodItemIndex < 0
      ? undefined
      : ITEM_DEFINITIONS[state.activeFoodItemIndex]?.consumable;
  const foodBonuses = activeFood?.kind === "food" ? activeFood.bonuses : EMPTY_FOOD_BONUSES;
  return Object.freeze({
    affixAccuracy,
    affixBracing,
    affixDamage,
    affixNimble,
    affixPotency,
    armorGuard,
    armorSoakElemental,
    armorSoakPhysical,
    attunementBonus: foodBonuses.attunement ?? 0,
    blockStaminaCostNumerator,
    catalystOmniResonance,
    catalystPotency,
    catalystResonance,
    finesseBonus: foodBonuses.finesse ?? 0,
    healthRegenOutOfCombat: foodBonuses.healthRegenOutOfCombat ?? 0,
    maxHealthBonus: foodBonuses.maxHealth ?? 0,
    maxStaminaBonus: foodBonuses.maxStamina ?? 0,
    mightBonus: foodBonuses.might ?? 0,
    staminaRegenBonus: equipmentStaminaRegenBonus + (foodBonuses.staminaRegen ?? 0),
    weaponAccuracy,
    weaponBase,
    weaponEmberDamage,
    weaponFrostDamage,
    weaponKeenCondition,
    weaponRangeMeters,
    weaponRecoveryTicksBonus,
    weaponStaminaCostNumerator,
    weaponVenomDamage,
  });
}

export function serializeItemState(view: DataView, offset: number, state: ItemState): void {
  assertItemState(state);
  view.setUint32(offset, state.version, true);
  view.setUint32(offset + 4, state.marks, true);
  view.setUint32(offset + 8, state.nextGearSerial, true);
  view.setUint32(offset + 12, state.lootRngState, true);
  view.setUint32(offset + 16, state.gatheredNodeMask, true);
  view.setUint32(offset + 20, state.equippedWeaponSerial, true);
  view.setUint32(offset + 24, state.equippedArmorSerial, true);
  view.setUint32(offset + 28, state.equippedShieldSerial, true);
  view.setUint32(offset + 32, state.equippedCatalystSerial, true);
  view.setInt32(offset + 36, state.activeFoodItemIndex, true);
  view.setUint32(offset + 40, state.foodTicks, true);
  view.setUint32(offset + 44, state.stoneTonicTicks, true);
  view.setUint32(offset + 48, state.oilKind, true);
  view.setUint32(offset + 52, state.oilTicks, true);
  COUNTER_KEYS.forEach((key, index) => {
    view.setUint32(offset + 56 + index * 4, state.counters[key], true);
  });
  view.setUint32(offset + 108, Number(state.satchelActive), true);
  view.setFloat32(offset + 112, state.satchelPosition[0], true);
  view.setFloat32(offset + 116, state.satchelPosition[1], true);
  view.setFloat32(offset + 120, state.satchelPosition[2], true);
  view.setUint32(offset + 124, state.vigorRemaining, true);
  view.setUint32(offset + 128, state.vigorTicks, true);
  view.setUint32(offset + 132, state.vigorAccumulator, true);
  const stacksOffset = offset + ITEM_STATE_HEADER_BYTES;
  state.stackCounts.forEach((count, index) => {
    view.setUint32(stacksOffset + index * 4, count, true);
  });
  const satchelOffset = stacksOffset + ITEM_DEFINITIONS.length * 4;
  state.satchelCounts.forEach((count, index) => {
    view.setUint32(satchelOffset + index * 4, count, true);
  });
  const gearOffset = satchelOffset + ITEM_DEFINITIONS.length * 4;
  state.gear.forEach((instance, index) => {
    writeGear(view, gearOffset + index * GEAR_INSTANCE_BYTES, instance);
  });
  const gatheringOffset = gearOffset + MAXIMUM_GEAR_INSTANCES * GEAR_INSTANCE_BYTES;
  state.nodeCooldownTicks.forEach((ticks, index) => {
    view.setUint32(gatheringOffset + index * 4, ticks, true);
  });
}

export function deserializeItemState(view: DataView, offset: number): ItemState {
  for (let reserved = 136; reserved < ITEM_STATE_HEADER_BYTES; reserved += 4) {
    if (view.getUint32(offset + reserved, true) !== 0)
      throw new Error("Item state has noncanonical reserved bytes");
  }
  const readCounts = (start: number): readonly number[] =>
    Object.freeze(
      Array.from({ length: ITEM_DEFINITIONS.length }, (_, index) =>
        view.getUint32(start + index * 4, true),
      ),
    );
  const stacksOffset = offset + ITEM_STATE_HEADER_BYTES;
  const satchelOffset = stacksOffset + ITEM_DEFINITIONS.length * 4;
  const gearOffset = satchelOffset + ITEM_DEFINITIONS.length * 4;
  const gatheringOffset = gearOffset + MAXIMUM_GEAR_INSTANCES * GEAR_INSTANCE_BYTES;
  const gear: GearInstance[] = [];
  let sawEmptyGear = false;
  for (let index = 0; index < MAXIMUM_GEAR_INSTANCES; index += 1) {
    const instance = readGear(view, gearOffset + index * GEAR_INSTANCE_BYTES);
    if (instance === null) {
      sawEmptyGear = true;
    } else {
      if (sawEmptyGear) throw new Error("Item gear entries are not canonically packed");
      gear.push(instance);
    }
  }
  const satchelActiveValue = view.getUint32(offset + 108, true);
  if (satchelActiveValue !== 0 && satchelActiveValue !== 1) {
    throw new Error("Item state has a noncanonical satchel flag");
  }
  const counterValues = Array.from({ length: COUNTER_KEYS.length }, (_, index) =>
    view.getUint32(offset + 56 + index * 4, true),
  );
  const counters = Object.fromEntries(
    COUNTER_KEYS.map((key, index) => [key, counterValues[index] ?? 0]),
  ) as unknown as ItemCounters;
  const state: ItemState = Object.freeze({
    activeFoodItemIndex: view.getInt32(offset + 36, true),
    counters: Object.freeze(counters),
    equippedArmorSerial: view.getUint32(offset + 24, true),
    equippedCatalystSerial: view.getUint32(offset + 32, true),
    equippedShieldSerial: view.getUint32(offset + 28, true),
    equippedWeaponSerial: view.getUint32(offset + 20, true),
    foodTicks: view.getUint32(offset + 40, true),
    gatheredNodeMask: view.getUint32(offset + 16, true),
    gear: Object.freeze(gear),
    lootRngState: view.getUint32(offset + 12, true),
    marks: view.getUint32(offset + 4, true),
    nextGearSerial: view.getUint32(offset + 8, true),
    nodeCooldownTicks: Object.freeze(
      Array.from({ length: GATHERING_NODE_CAPACITY }, (_, index) =>
        view.getUint32(gatheringOffset + index * 4, true),
      ),
    ),
    oilKind: view.getUint32(offset + 48, true) as 0 | 1 | 2,
    oilTicks: view.getUint32(offset + 52, true),
    satchelActive: satchelActiveValue === 1,
    satchelCounts: readCounts(satchelOffset),
    satchelPosition: Object.freeze([
      view.getFloat32(offset + 112, true),
      view.getFloat32(offset + 116, true),
      view.getFloat32(offset + 120, true),
    ] as const),
    stackCounts: readCounts(stacksOffset),
    stoneTonicTicks: view.getUint32(offset + 44, true),
    version: view.getUint32(offset, true) as typeof ITEM_RULES_VERSION,
    vigorAccumulator: view.getUint32(offset + 132, true),
    vigorRemaining: view.getUint32(offset + 124, true),
    vigorTicks: view.getUint32(offset + 128, true),
  });
  assertItemState(state);
  return state;
}

export function assertItemState(state: ItemState): void {
  const isUint32 = (value: number): boolean =>
    Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff;
  const serials = new Set(state.gear.map(({ serial }) => serial));
  const equipped = equippedSerials(state);
  if (
    state.version !== ITEM_RULES_VERSION ||
    !isUint32(state.marks) ||
    !isUint32(state.nextGearSerial) ||
    state.nextGearSerial === 0 ||
    !isUint32(state.lootRngState) ||
    state.lootRngState === 0 ||
    !isUint32(state.gatheredNodeMask) ||
    state.stackCounts.length !== ITEM_DEFINITIONS.length ||
    state.satchelCounts.length !== ITEM_DEFINITIONS.length ||
    state.stackCounts.some(
      (count) => !Number.isSafeInteger(count) || count < 0 || count > ITEM_STACK_LIMIT,
    ) ||
    state.satchelCounts.some(
      (count) => !Number.isSafeInteger(count) || count < 0 || count > ITEM_STACK_LIMIT,
    ) ||
    state.stackCounts.some(
      (count, index) => ITEM_DEFINITIONS[index]?.kind === "gear" && count !== 0,
    ) ||
    state.gear.length > MAXIMUM_GEAR_INSTANCES ||
    state.nodeCooldownTicks.length !== GATHERING_NODE_CAPACITY ||
    state.nodeCooldownTicks.some(
      (ticks) => !Number.isSafeInteger(ticks) || ticks < 0 || ticks > GATHERING_REGROWTH_TICKS,
    ) ||
    serials.size !== state.gear.length ||
    state.gear.some((instance) => !validGear(instance)) ||
    equipped.some((serial) => serial !== 0 && !serials.has(serial)) ||
    !validEquippedSlot(state, "weapon", state.equippedWeaponSerial) ||
    !validEquippedSlot(state, "armor", state.equippedArmorSerial) ||
    !validEquippedSlot(state, "shield", state.equippedShieldSerial) ||
    !validEquippedSlot(state, "catalyst", state.equippedCatalystSerial) ||
    state.nextGearSerial <= Math.max(0, ...serials) ||
    state.activeFoodItemIndex < -1 ||
    state.activeFoodItemIndex >= ITEM_DEFINITIONS.length ||
    (state.activeFoodItemIndex >= 0 &&
      ITEM_DEFINITIONS[state.activeFoodItemIndex]?.consumable?.kind !== "food") ||
    (state.foodTicks === 0) !== (state.activeFoodItemIndex === -1) ||
    !Number.isSafeInteger(state.foodTicks) ||
    state.foodTicks < 0 ||
    state.foodTicks > MAXIMUM_FOOD_TICKS ||
    !Number.isSafeInteger(state.stoneTonicTicks) ||
    state.stoneTonicTicks < 0 ||
    state.stoneTonicTicks > MAXIMUM_STONE_TICKS ||
    ![0, 1, 2].includes(state.oilKind) ||
    (state.oilTicks === 0) !== (state.oilKind === 0) ||
    !Number.isSafeInteger(state.oilTicks) ||
    state.oilTicks < 0 ||
    state.oilTicks > MAXIMUM_OIL_TICKS ||
    (!state.satchelActive && state.satchelCounts.some((count) => count !== 0)) ||
    state.satchelCounts.some(
      (count, index) => count > 0 && ITEM_DEFINITIONS[index]?.material?.satchelEligible !== true,
    ) ||
    state.satchelPosition.some(
      (value) => !Number.isFinite(value) || Math.fround(value) !== value,
    ) ||
    !Number.isSafeInteger(state.vigorRemaining) ||
    state.vigorRemaining < 0 ||
    state.vigorRemaining > VIGOR_EFFECT.healing ||
    !Number.isSafeInteger(state.vigorTicks) ||
    state.vigorTicks < 0 ||
    state.vigorTicks > VIGOR_EFFECT.durationTicks ||
    (state.vigorTicks === 0) !== (state.vigorRemaining === 0) ||
    !Number.isSafeInteger(state.vigorAccumulator) ||
    state.vigorAccumulator < 0 ||
    state.vigorAccumulator >= VIGOR_EFFECT.durationTicks ||
    (state.vigorRemaining === 0 && state.vigorAccumulator !== 0) ||
    COUNTER_KEYS.some((key) => !isUint32(state.counters[key]))
  ) {
    throw new Error("Item state is invalid");
  }
}

export function equippedSerials(state: ItemState): readonly number[] {
  return Object.freeze([
    state.equippedWeaponSerial,
    state.equippedArmorSerial,
    state.equippedShieldSerial,
    state.equippedCatalystSerial,
  ]);
}

export function resonanceCode(resonance: Resonance | null): number {
  return RESONANCES.indexOf(resonance);
}

export function resonanceFromCode(code: number): Resonance | null | undefined {
  return RESONANCES[code];
}

function buybackValue(buyPrice: number): number {
  return Math.floor((buyPrice * ITEM_BUYBACK.numerator) / ITEM_BUYBACK.denominator);
}

function evictGearForMythicLoot(
  state: ItemState,
): Readonly<{ readonly marks: number; readonly serial: number; readonly state: ItemState }> {
  const equipped = new Set(equippedSerials(state));
  const candidate = state.gear
    .filter(({ serial }) => !equipped.has(serial))
    .toSorted(compareMythicEvictionPriority)[0];
  if (candidate === undefined) {
    throw new Error("Full inventory has no unequipped slot for guaranteed mythic loot");
  }
  return Object.freeze({
    marks: buybackValue(ITEM_DEFINITIONS[candidate.itemIndex]?.buyPrice ?? 0),
    serial: candidate.serial,
    state: Object.freeze({
      ...state,
      gear: Object.freeze(state.gear.filter(({ serial }) => serial !== candidate.serial)),
    }),
  });
}

function compareMythicEvictionPriority(left: GearInstance, right: GearInstance): number {
  if (left.uniqueProperty !== right.uniqueProperty) {
    return left.uniqueProperty - right.uniqueProperty;
  }
  const rarityDifference = RARITIES.indexOf(left.rarity) - RARITIES.indexOf(right.rarity);
  if (rarityDifference !== 0) return rarityDifference;
  const upgradeDifference = countBits(left.upgrades) - countBits(right.upgrades);
  if (upgradeDifference !== 0) return upgradeDifference;
  const leftPrice = ITEM_DEFINITIONS[left.itemIndex]?.buyPrice ?? 0;
  const rightPrice = ITEM_DEFINITIONS[right.itemIndex]?.buyPrice ?? 0;
  if (leftPrice !== rightPrice) return leftPrice - rightPrice;
  return right.serial - left.serial;
}

function createGear(
  state: ItemState,
  id: ItemId,
  rarity: ItemRarity,
  resonance: Resonance | null,
  rollAffixes: boolean,
): Readonly<{ readonly applied: boolean; readonly gearSerial: number; readonly state: ItemState }> {
  const definitionIndex = itemIndex(id);
  const definition = ITEM_DEFINITIONS[definitionIndex];
  if (
    definition?.kind !== "gear" ||
    state.gear.length >= MAXIMUM_GEAR_INSTANCES ||
    state.nextGearSerial >= 0xffff_ffff
  ) {
    return Object.freeze({ applied: false, gearSerial: 0, state });
  }
  let rng = state.lootRngState;
  const affixCount = rarity === "common" ? 0 : rarity === "fine" ? 1 : 2;
  let affixMask = 0;
  if (rollAffixes) {
    const eligible = GEAR_AFFIXES.map((affix, index) => ({ affix, index }))
      .filter(({ affix }) => affix.slots.includes(definition.gear?.slot as GearSlot))
      .filter(
        ({ affix }) =>
          rarity === "exceptional" ||
          rarity === "mythic" ||
          (affix.id !== "bracing" && affix.id !== "nimble"),
      );
    for (let pick = 0; pick < Math.min(affixCount, eligible.length); pick += 1) {
      rng = nextRandomU32(rng);
      const selectedIndex = rng % eligible.length;
      const selected = eligible.splice(selectedIndex, 1)[0];
      if (selected !== undefined) affixMask |= 1 << selected.index;
    }
  }
  const serial = state.nextGearSerial;
  const instance: GearInstance = Object.freeze({
    affixMask,
    itemIndex: definitionIndex,
    rarity,
    resonance: id === "resonant-focus" ? (resonance ?? "aether") : null,
    serial,
    uniqueProperty: rarity === "mythic" && id === "resonant-focus" ? 1 : 0,
    upgrades: 0,
  });
  return Object.freeze({
    applied: true,
    gearSerial: serial,
    state: Object.freeze({
      ...state,
      counters: incrementCounter(state.counters, "gearCreatedCount"),
      gear: Object.freeze([...state.gear, instance]),
      lootRngState: rng,
      nextGearSerial: serial + 1,
    }),
  });
}

function lootRarity(kitId: string, rng: number): ItemRarity {
  if (kitId === LOOT_RARITY_BALANCE.bossKitId) return LOOT_RARITY_BALANCE.bossRarity;
  const roll = rng % 10_000;
  if (kitId === LOOT_RARITY_BALANCE.eliteKitId) {
    return roll < LOOT_RARITY_BALANCE.eliteExceptionalPerTenThousand ? "exceptional" : "fine";
  }
  return roll < LOOT_RARITY_BALANCE.ordinaryExceptionalPerTenThousand
    ? "exceptional"
    : roll < LOOT_RARITY_BALANCE.ordinaryFinePerTenThousand
      ? "fine"
      : "common";
}

function incrementCounter(counters: ItemCounters, key: keyof ItemCounters): ItemCounters {
  return Object.freeze({ ...counters, [key]: counters[key] + 1 });
}

function equippedKey(
  slot: GearSlot,
):
  | "equippedArmorSerial"
  | "equippedCatalystSerial"
  | "equippedShieldSerial"
  | "equippedWeaponSerial" {
  if (slot === "armor") return "equippedArmorSerial";
  if (slot === "catalyst") return "equippedCatalystSerial";
  if (slot === "shield") return "equippedShieldSerial";
  return "equippedWeaponSerial";
}

function validEquippedSlot(state: ItemState, slot: GearSlot, serial: number): boolean {
  if (serial === 0) return true;
  const instance = state.gear.find((candidate) => candidate.serial === serial);
  return instance !== undefined && ITEM_DEFINITIONS[instance.itemIndex]?.gear?.slot === slot;
}

function validGear(instance: GearInstance): boolean {
  const definition = ITEM_DEFINITIONS[instance.itemIndex];
  const rarityIndex = RARITIES.indexOf(instance.rarity);
  const affixCount = countBits(instance.affixMask);
  const maximumAffixes = rarityIndex === 0 ? 0 : rarityIndex === 1 ? 1 : 2;
  const affixesEligible = GEAR_AFFIXES.every((affix, index) => {
    if ((instance.affixMask & (1 << index)) === 0) return true;
    if (!affix.slots.includes(definition?.gear?.slot as GearSlot)) return false;
    return (
      (affix.id !== "bracing" && affix.id !== "nimble") ||
      instance.rarity === "exceptional" ||
      instance.rarity === "mythic"
    );
  });
  const slot = definition?.gear?.slot;
  return (
    definition?.kind === "gear" &&
    Number.isSafeInteger(instance.itemIndex) &&
    instance.itemIndex >= 0 &&
    instance.itemIndex < ITEM_DEFINITIONS.length &&
    Number.isSafeInteger(instance.serial) &&
    instance.serial > 0 &&
    instance.serial <= 0xffff_ffff &&
    rarityIndex >= 0 &&
    affixCount <= maximumAffixes &&
    affixesEligible &&
    Number.isSafeInteger(instance.affixMask) &&
    instance.affixMask >= 0 &&
    (instance.affixMask & ~((1 << GEAR_AFFIXES.length) - 1)) === 0 &&
    Number.isSafeInteger(instance.upgrades) &&
    instance.upgrades >= 0 &&
    (instance.upgrades & ~3) === 0 &&
    ((instance.upgrades & 1) === 0 || slot === "weapon") &&
    ((instance.upgrades & 2) === 0 || slot === "armor") &&
    instance.uniqueProperty ===
      (instance.rarity === "mythic" && definition.id === "resonant-focus" ? 1 : 0) &&
    (definition.id === "resonant-focus" ? instance.resonance !== null : instance.resonance === null)
  );
}

function countBits(value: number): number {
  let count = 0;
  let remaining = value >>> 0;
  while (remaining !== 0) {
    count += remaining & 1;
    remaining >>>= 1;
  }
  return count;
}

function writeGear(view: DataView, offset: number, instance: GearInstance): void {
  view.setUint32(offset, instance.serial, true);
  view.setUint16(offset + 4, instance.itemIndex, true);
  view.setUint8(offset + 6, RARITIES.indexOf(instance.rarity));
  view.setUint8(offset + 7, RESONANCES.indexOf(instance.resonance));
  view.setUint16(offset + 8, instance.affixMask, true);
  view.setUint16(offset + 10, instance.upgrades, true);
  view.setUint32(offset + 12, instance.uniqueProperty, true);
}

function readGear(view: DataView, offset: number): GearInstance | null {
  const serial = view.getUint32(offset, true);
  if (serial === 0) {
    for (let index = 4; index < GEAR_INSTANCE_BYTES; index += 4) {
      if (view.getUint32(offset + index, true) !== 0)
        throw new Error("Item gear padding is noncanonical");
    }
    return null;
  }
  if (view.getUint32(offset + 16, true) !== 0 || view.getUint32(offset + 20, true) !== 0) {
    throw new Error("Item gear reserved bytes are noncanonical");
  }
  const rarity = RARITIES[view.getUint8(offset + 6)];
  const resonance = RESONANCES[view.getUint8(offset + 7)];
  if (rarity === undefined || resonance === undefined)
    throw new Error("Item gear identity is invalid");
  return Object.freeze({
    affixMask: view.getUint16(offset + 8, true),
    itemIndex: view.getUint16(offset + 4, true),
    rarity,
    resonance,
    serial,
    uniqueProperty: view.getUint32(offset + 12, true) as 0 | 1,
    upgrades: view.getUint16(offset + 10, true),
  });
}
