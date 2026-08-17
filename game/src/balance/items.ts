import { COMBAT_EQUIPMENT_DEFAULTS } from "./combat";

// Ruleset-v2 item, recipe, vendor, and loot data (D-165). Array order is a
// persistent command/save identity: append entries, never reorder them.

export const ITEM_RULES_VERSION = 1;
export const ITEM_STACK_LIMIT = 9_999;
export const MAXIMUM_GEAR_INSTANCES = 32;
export const GATHERING_NODE_CAPACITY = 32;
export const ITEM_STARTING_MARKS = 25;
export const ITEM_BUYBACK = Object.freeze({ denominator: 2, numerator: 1 });
export const ITEM_INTERACTION_RADII_METERS = Object.freeze({
  gathering: 4,
  satchel: 3,
  station: 12,
  waystone: 12,
});
export const GATHERING_REGROWTH_TICKS = 18_000;

export type CraftingStation = "alembic" | "forge" | "hearth";
export type GearSlot = "armor" | "catalyst" | "shield" | "weapon";
export type ItemKind = "consumable" | "gear" | "material" | "upgrade";
export type ItemRarity = "common" | "exceptional" | "fine" | "mythic";
export type Resonance = "aether" | "ember" | "frost";

export interface FoodBonuses {
  readonly attunement?: number;
  readonly finesse?: number;
  readonly healthRegenOutOfCombat?: number;
  readonly maxHealth?: number;
  readonly maxStamina?: number;
  readonly might?: number;
  readonly staminaRegen?: number;
}

export type ConsumableEffect =
  | Readonly<{
      readonly durationTicks: number;
      readonly kind: "food";
      readonly bonuses: FoodBonuses;
    }>
  | Readonly<{
      readonly durationTicks: number;
      readonly kind: "oil";
      readonly channel: "ember" | "frost";
      readonly damage: number;
    }>
  | Readonly<{
      readonly durationTicks: number;
      readonly kind: "stone";
      readonly physicalSoak: number;
    }>
  | Readonly<{ readonly durationTicks: number; readonly healing: number; readonly kind: "vigor" }>
  | Readonly<{ readonly aether: number; readonly kind: "aether" }>
  | Readonly<{ readonly kind: "clearing" }>;

export type GearAffixEffect =
  | Readonly<{ readonly amount: number; readonly kind: "accuracy" }>
  | Readonly<{ readonly amount: number; readonly kind: "physical-damage" }>
  | Readonly<{ readonly amount: number; readonly kind: "guard" }>
  | Readonly<{ readonly amount: number; readonly kind: "potency" }>
  | Readonly<{
      readonly amount: number;
      readonly channel: "ember" | "frost" | "venom";
      readonly conditionOnKeen?: "envenomed";
      readonly kind: "channel-damage";
    }>
  | Readonly<{ readonly kind: "stamina-cost"; readonly numerator: number }>
  | Readonly<{ readonly kind: "bracing" }>
  | Readonly<{ readonly kind: "nimble" }>;

export interface GearUpgradeDefinition {
  readonly bit: 1 | 2;
  readonly bonus: Readonly<{
    readonly amount: number;
    readonly kind: "armor-guard" | "weapon-damage";
  }>;
  readonly slot: GearSlot;
}

export type ItemId =
  | "grain"
  | "bittergreen"
  | "emberpetal"
  | "timber"
  | "game-meat"
  | "greymaw-pelt"
  | "fish"
  | "sea-salt"
  | "salvage-iron"
  | "dimstone-ore"
  | "relic-fragment"
  | "skitterling-venom"
  | "hide"
  | "sinew"
  | "sword"
  | "axe"
  | "spear"
  | "bow"
  | "cloth-garb"
  | "leather-jack"
  | "scale-coat"
  | "reinforced-buckler"
  | "ashwood-focus"
  | "glazed-focus"
  | "resonant-focus"
  | "tempered-sword"
  | "tempered-axe"
  | "tempered-spear"
  | "laminated-bow"
  | "weapon-whetting"
  | "armor-fitting"
  | "vigor-tonic"
  | "stone-tonic"
  | "clearing-draught"
  | "emberdust-oil"
  | "frostglass-oil"
  | "aether-salts"
  | "hearthloaf"
  | "fishers-stew"
  | "orchard-preserve"
  | "hunters-roast"
  | "tidebroth"
  | "waybread"
  | "mulled-cordial"
  | "mythic-catalyst-core";

export type GearAffixId =
  | "keen"
  | "weighted"
  | "bulwark"
  | "attuned"
  | "emberbound"
  | "frostbound"
  | "venombound"
  | "light"
  | "bracing"
  | "nimble";

export interface ItemDefinition {
  readonly buyPrice: number;
  readonly consumable?: ConsumableEffect;
  readonly gear?: Readonly<{
    readonly accuracy?: number;
    readonly baseDamage?: number;
    readonly guard?: number;
    readonly potency?: number;
    readonly recoveryTicksBonus?: number;
    readonly staminaRegenBonus?: number;
    readonly slot: GearSlot;
    readonly soakElemental?: number;
    readonly soakPhysical?: number;
    readonly weaponRangeMeters?: number;
  }>;
  readonly id: ItemId;
  readonly kind: ItemKind;
  readonly material?: Readonly<{
    readonly satchelEligible: boolean;
    readonly tinkersThriftEligible: boolean;
  }>;
  readonly upgrade?: GearUpgradeDefinition;
}

const material = (
  id: ItemId,
  buyPrice: number,
  tinkersThriftEligible: boolean,
  satchelEligible = true,
): ItemDefinition =>
  Object.freeze({
    buyPrice,
    id,
    kind: "material" as const,
    material: Object.freeze({ satchelEligible, tinkersThriftEligible }),
  });
const consumable = (id: ItemId, buyPrice: number, effect: ConsumableEffect): ItemDefinition =>
  Object.freeze({ buyPrice, consumable: Object.freeze(effect), id, kind: "consumable" as const });
const upgrade = (id: ItemId, buyPrice: number, definition: GearUpgradeDefinition): ItemDefinition =>
  Object.freeze({ buyPrice, id, kind: "upgrade" as const, upgrade: Object.freeze(definition) });
const gear = (
  id: ItemId,
  buyPrice: number,
  values: NonNullable<ItemDefinition["gear"]>,
): ItemDefinition => Object.freeze({ buyPrice, gear: Object.freeze(values), id, kind: "gear" });

export const ITEM_DEFINITIONS: readonly ItemDefinition[] = Object.freeze([
  material("grain", 1, true),
  material("bittergreen", 2, true),
  material("emberpetal", 3, false),
  material("timber", 2, true),
  material("game-meat", 3, false),
  material("greymaw-pelt", 4, false),
  material("fish", 3, false),
  material("sea-salt", 1, true),
  material("salvage-iron", 3, false),
  material("dimstone-ore", 4, false),
  material("relic-fragment", 4, false),
  material("skitterling-venom", 4, false),
  material("hide", 2, true),
  material("sinew", 2, true),
  gear("sword", 35, {
    accuracy: 1,
    baseDamage: 10,
    slot: "weapon",
    weaponRangeMeters: COMBAT_EQUIPMENT_DEFAULTS.weaponRangeMeters,
  }),
  gear("axe", 40, {
    baseDamage: 12,
    recoveryTicksBonus: 4,
    slot: "weapon",
    weaponRangeMeters: COMBAT_EQUIPMENT_DEFAULTS.weaponRangeMeters,
  }),
  gear("spear", 35, { accuracy: 1, baseDamage: 9, slot: "weapon", weaponRangeMeters: 2.7 }),
  gear("bow", 45, { accuracy: 2, baseDamage: 8, slot: "weapon", weaponRangeMeters: 24 }),
  gear("cloth-garb", 30, { guard: 1, slot: "armor", soakPhysical: 1 }),
  gear("leather-jack", 45, { guard: 2, slot: "armor", soakPhysical: 2 }),
  gear("scale-coat", 60, { guard: 3, slot: "armor", soakPhysical: 4, staminaRegenBonus: -5 }),
  gear("reinforced-buckler", 55, { guard: 1, slot: "shield" }),
  gear("ashwood-focus", 30, { potency: 1, slot: "catalyst" }),
  gear("glazed-focus", 90, { potency: 2, slot: "catalyst" }),
  gear("resonant-focus", 150, { potency: 3, slot: "catalyst" }),
  gear("tempered-sword", 100, {
    accuracy: 1,
    baseDamage: 12,
    slot: "weapon",
    weaponRangeMeters: COMBAT_EQUIPMENT_DEFAULTS.weaponRangeMeters,
  }),
  gear("tempered-axe", 110, {
    baseDamage: 14,
    recoveryTicksBonus: 4,
    slot: "weapon",
    weaponRangeMeters: COMBAT_EQUIPMENT_DEFAULTS.weaponRangeMeters,
  }),
  gear("tempered-spear", 100, {
    accuracy: 1,
    baseDamage: 11,
    slot: "weapon",
    weaponRangeMeters: 2.7,
  }),
  gear("laminated-bow", 120, {
    accuracy: 2,
    baseDamage: 10,
    slot: "weapon",
    weaponRangeMeters: 24,
  }),
  upgrade("weapon-whetting", 30, {
    bit: 1,
    bonus: Object.freeze({ amount: 2, kind: "weapon-damage" }),
    slot: "weapon",
  }),
  upgrade("armor-fitting", 30, {
    bit: 2,
    bonus: Object.freeze({ amount: 1, kind: "armor-guard" }),
    slot: "armor",
  }),
  consumable("vigor-tonic", 12, { durationTicks: 480, healing: 40, kind: "vigor" }),
  consumable("stone-tonic", 15, {
    durationTicks: 3_600,
    kind: "stone",
    physicalSoak: 2,
  }),
  consumable("clearing-draught", 12, { kind: "clearing" }),
  consumable("emberdust-oil", 15, {
    channel: "ember",
    damage: 3,
    durationTicks: 7_200,
    kind: "oil",
  }),
  consumable("frostglass-oil", 15, {
    channel: "frost",
    damage: 3,
    durationTicks: 7_200,
    kind: "oil",
  }),
  consumable("aether-salts", 10, { aether: 30, kind: "aether" }),
  consumable("hearthloaf", 8, {
    bonuses: Object.freeze({ maxStamina: 10 }),
    durationTicks: 36_000,
    kind: "food",
  }),
  consumable("fishers-stew", 12, {
    bonuses: Object.freeze({ maxHealth: 10 }),
    durationTicks: 36_000,
    kind: "food",
  }),
  consumable("orchard-preserve", 12, {
    bonuses: Object.freeze({ finesse: 1 }),
    durationTicks: 36_000,
    kind: "food",
  }),
  consumable("hunters-roast", 12, {
    bonuses: Object.freeze({ might: 1 }),
    durationTicks: 36_000,
    kind: "food",
  }),
  consumable("tidebroth", 12, {
    bonuses: Object.freeze({ attunement: 1 }),
    durationTicks: 36_000,
    kind: "food",
  }),
  consumable("waybread", 15, {
    bonuses: Object.freeze({ healthRegenOutOfCombat: 1 }),
    durationTicks: 18_000,
    kind: "food",
  }),
  consumable("mulled-cordial", 10, {
    bonuses: Object.freeze({ staminaRegen: 5 }),
    durationTicks: 36_000,
    kind: "food",
  }),
  material("mythic-catalyst-core", 0, false, false),
]);

export interface RecipeIngredient {
  readonly itemId: ItemId;
  readonly quantity: number;
}

export interface RecipeDefinition {
  readonly id: string;
  readonly ingredients: readonly RecipeIngredient[];
  readonly outputItemId: ItemId;
  readonly station: CraftingStation;
}

const ingredient = (itemId: ItemId, quantity: number): RecipeIngredient =>
  Object.freeze({ itemId, quantity });
const recipe = (
  id: string,
  station: CraftingStation,
  outputItemId: ItemId,
  ingredients: readonly RecipeIngredient[],
): RecipeDefinition =>
  Object.freeze({ id, ingredients: Object.freeze(ingredients), outputItemId, station });

// Short ingredient lists deliberately make the station and the source region the
// memory aid. Tinker's Thrift reduces each common ingredient by one (minimum 1).
export const RECIPES: readonly RecipeDefinition[] = Object.freeze([
  recipe("tempered-sword", "forge", "tempered-sword", [
    ingredient("salvage-iron", 4),
    ingredient("dimstone-ore", 2),
  ]),
  recipe("tempered-axe", "forge", "tempered-axe", [
    ingredient("salvage-iron", 5),
    ingredient("timber", 2),
  ]),
  recipe("tempered-spear", "forge", "tempered-spear", [
    ingredient("salvage-iron", 3),
    ingredient("timber", 3),
  ]),
  recipe("laminated-bow", "forge", "laminated-bow", [
    ingredient("timber", 4),
    ingredient("sinew", 3),
  ]),
  recipe("scale-coat", "forge", "scale-coat", [
    ingredient("salvage-iron", 6),
    ingredient("hide", 3),
  ]),
  recipe("reinforced-buckler", "forge", "reinforced-buckler", [
    ingredient("timber", 3),
    ingredient("salvage-iron", 3),
  ]),
  recipe("weapon-whetting", "forge", "weapon-whetting", [
    ingredient("dimstone-ore", 2),
    ingredient("sea-salt", 1),
  ]),
  recipe("armor-fitting", "forge", "armor-fitting", [
    ingredient("hide", 2),
    ingredient("salvage-iron", 2),
  ]),
  recipe("ashwood-focus", "alembic", "ashwood-focus", [
    ingredient("timber", 2),
    ingredient("emberpetal", 1),
  ]),
  recipe("glazed-focus", "alembic", "glazed-focus", [
    ingredient("timber", 2),
    ingredient("relic-fragment", 2),
  ]),
  recipe("resonant-focus", "alembic", "resonant-focus", [
    ingredient("dimstone-ore", 3),
    ingredient("relic-fragment", 2),
    ingredient("emberpetal", 2),
  ]),
  recipe("vigor-tonic", "alembic", "vigor-tonic", [
    ingredient("bittergreen", 2),
    ingredient("emberpetal", 1),
  ]),
  recipe("stone-tonic", "alembic", "stone-tonic", [
    ingredient("bittergreen", 1),
    ingredient("dimstone-ore", 2),
  ]),
  recipe("clearing-draught", "alembic", "clearing-draught", [
    ingredient("bittergreen", 2),
    ingredient("sea-salt", 1),
    ingredient("skitterling-venom", 1),
  ]),
  recipe("emberdust-oil", "alembic", "emberdust-oil", [
    ingredient("emberpetal", 2),
    ingredient("salvage-iron", 1),
  ]),
  recipe("frostglass-oil", "alembic", "frostglass-oil", [
    ingredient("sea-salt", 2),
    ingredient("relic-fragment", 1),
  ]),
  recipe("aether-salts", "alembic", "aether-salts", [
    ingredient("sea-salt", 2),
    ingredient("relic-fragment", 1),
  ]),
  recipe("hearthloaf", "hearth", "hearthloaf", [ingredient("grain", 4), ingredient("sea-salt", 1)]),
  recipe("fishers-stew", "hearth", "fishers-stew", [
    ingredient("fish", 2),
    ingredient("bittergreen", 1),
  ]),
  recipe("orchard-preserve", "hearth", "orchard-preserve", [
    ingredient("grain", 2),
    ingredient("emberpetal", 1),
  ]),
  recipe("hunters-roast", "hearth", "hunters-roast", [
    ingredient("game-meat", 2),
    ingredient("sea-salt", 1),
  ]),
  recipe("tidebroth", "hearth", "tidebroth", [
    ingredient("fish", 1),
    ingredient("relic-fragment", 1),
  ]),
  recipe("waybread", "hearth", "waybread", [
    ingredient("grain", 2),
    ingredient("game-meat", 1),
    ingredient("bittergreen", 1),
  ]),
  recipe("mulled-cordial", "hearth", "mulled-cordial", [
    ingredient("grain", 1),
    ingredient("emberpetal", 1),
    ingredient("bittergreen", 1),
  ]),
]);

export const GEAR_AFFIXES: readonly Readonly<{
  readonly effect: GearAffixEffect;
  readonly id: GearAffixId;
  readonly slots: readonly GearSlot[];
}>[] = Object.freeze([
  Object.freeze({
    effect: Object.freeze({ amount: 1, kind: "accuracy" as const }),
    id: "keen",
    slots: Object.freeze(["weapon"] as const),
  }),
  Object.freeze({
    effect: Object.freeze({ amount: 2, kind: "physical-damage" as const }),
    id: "weighted",
    slots: Object.freeze(["weapon"] as const),
  }),
  Object.freeze({
    effect: Object.freeze({ amount: 1, kind: "guard" as const }),
    id: "bulwark",
    slots: Object.freeze(["armor", "shield"] as const),
  }),
  Object.freeze({
    effect: Object.freeze({ amount: 1, kind: "potency" as const }),
    id: "attuned",
    slots: Object.freeze(["catalyst"] as const),
  }),
  Object.freeze({
    effect: Object.freeze({
      amount: 3,
      channel: "ember" as const,
      kind: "channel-damage" as const,
    }),
    id: "emberbound",
    slots: Object.freeze(["weapon"] as const),
  }),
  Object.freeze({
    effect: Object.freeze({
      amount: 3,
      channel: "frost" as const,
      kind: "channel-damage" as const,
    }),
    id: "frostbound",
    slots: Object.freeze(["weapon"] as const),
  }),
  Object.freeze({
    effect: Object.freeze({
      amount: 2,
      channel: "venom" as const,
      conditionOnKeen: "envenomed" as const,
      kind: "channel-damage" as const,
    }),
    id: "venombound",
    slots: Object.freeze(["weapon"] as const),
  }),
  Object.freeze({
    effect: Object.freeze({ kind: "stamina-cost" as const, numerator: 3 }),
    id: "light",
    slots: Object.freeze(["weapon", "shield"] as const),
  }),
  Object.freeze({
    effect: Object.freeze({ kind: "bracing" as const }),
    id: "bracing",
    slots: Object.freeze(["armor", "shield"] as const),
  }),
  Object.freeze({
    effect: Object.freeze({ kind: "nimble" as const }),
    id: "nimble",
    slots: Object.freeze(["armor"] as const),
  }),
]);

export interface MonsterLootDefinition {
  readonly gearChancePerTenThousand: number;
  readonly gearPool: readonly ItemId[];
  readonly kitId: string;
  readonly materialDrops: readonly Readonly<{
    readonly itemId: ItemId;
    readonly maximum: number;
    readonly minimum: number;
  }>[];
  readonly marksMaximum: number;
  readonly marksMinimum: number;
}

export const LOOT_RARITY_BALANCE = Object.freeze({
  bossKitId: "warden-below",
  bossRarity: "mythic" as const,
  eliteExceptionalPerTenThousand: 2_500,
  eliteKitId: "hollow-warden",
  ordinaryExceptionalPerTenThousand: 500,
  ordinaryFinePerTenThousand: 4_000,
});

const drop = (itemId: ItemId, minimum: number, maximum: number) =>
  Object.freeze({ itemId, maximum, minimum });

export const MONSTER_LOOT: readonly MonsterLootDefinition[] = Object.freeze([
  Object.freeze({
    gearChancePerTenThousand: 150,
    gearPool: Object.freeze([]),
    kitId: "burrow-gnawer",
    materialDrops: Object.freeze([drop("hide", 0, 1), drop("sinew", 0, 1)]),
    marksMaximum: 2,
    marksMinimum: 0,
  }),
  Object.freeze({
    gearChancePerTenThousand: 500,
    gearPool: Object.freeze(["leather-jack", "bow"] as const),
    kitId: "greymaw",
    materialDrops: Object.freeze([drop("greymaw-pelt", 1, 2), drop("sinew", 1, 2)]),
    marksMaximum: 5,
    marksMinimum: 1,
  }),
  Object.freeze({
    gearChancePerTenThousand: 1_200,
    gearPool: Object.freeze(["sword", "axe", "spear", "reinforced-buckler"] as const),
    kitId: "wayland-brigand",
    materialDrops: Object.freeze([drop("salvage-iron", 1, 2)]),
    marksMaximum: 12,
    marksMinimum: 4,
  }),
  Object.freeze({
    gearChancePerTenThousand: 200,
    gearPool: Object.freeze([]),
    kitId: "skitterling",
    materialDrops: Object.freeze([drop("skitterling-venom", 1, 2)]),
    marksMaximum: 3,
    marksMinimum: 0,
  }),
  Object.freeze({
    gearChancePerTenThousand: 3_500,
    gearPool: Object.freeze(["scale-coat", "glazed-focus"] as const),
    kitId: "hollow-warden",
    materialDrops: Object.freeze([drop("relic-fragment", 2, 4), drop("dimstone-ore", 1, 2)]),
    marksMaximum: 20,
    marksMinimum: 10,
  }),
  Object.freeze({
    gearChancePerTenThousand: 10_000,
    gearPool: Object.freeze(["resonant-focus"] as const),
    kitId: "warden-below",
    materialDrops: Object.freeze([
      drop("mythic-catalyst-core", 1, 1),
      drop("relic-fragment", 4, 6),
    ]),
    marksMaximum: 80,
    marksMinimum: 60,
  }),
]);

export const VENDOR_OFFERS: readonly Readonly<{
  readonly itemId: ItemId;
  readonly markerTag: "alembic" | "forge" | "hearth" | "market";
}>[] = Object.freeze([
  Object.freeze({ itemId: "sword", markerTag: "forge" }),
  Object.freeze({ itemId: "axe", markerTag: "forge" }),
  Object.freeze({ itemId: "spear", markerTag: "forge" }),
  Object.freeze({ itemId: "leather-jack", markerTag: "forge" }),
  Object.freeze({ itemId: "ashwood-focus", markerTag: "alembic" }),
  Object.freeze({ itemId: "vigor-tonic", markerTag: "alembic" }),
  Object.freeze({ itemId: "clearing-draught", markerTag: "alembic" }),
  Object.freeze({ itemId: "hearthloaf", markerTag: "hearth" }),
  Object.freeze({ itemId: "fishers-stew", markerTag: "hearth" }),
  ...(["grain", "bittergreen", "timber", "fish", "sea-salt"] as const).map((itemId) =>
    Object.freeze({ itemId, markerTag: "market" as const }),
  ),
]);

const ITEM_INDEX_BY_ID = new Map(ITEM_DEFINITIONS.map(({ id }, index) => [id, index] as const));

export function itemIndex(itemId: ItemId): number {
  const index = ITEM_INDEX_BY_ID.get(itemId);
  if (index === undefined) throw new Error(`Unknown item ${itemId}`);
  return index;
}

export function recipeIndex(recipeId: string): number {
  const index = RECIPES.findIndex(({ id }) => id === recipeId);
  if (index < 0) throw new Error(`Unknown recipe ${recipeId}`);
  return index;
}

export function vendorOfferIndex(itemId: ItemId): number {
  const index = VENDOR_OFFERS.findIndex((offer) => offer.itemId === itemId);
  if (index < 0) throw new Error(`Item ${itemId} is not sold by a vendor`);
  return index;
}
