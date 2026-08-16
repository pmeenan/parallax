import { runSimulationReplay, simulationWorldDefinition } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  GEAR_AFFIXES,
  ITEM_BUYBACK,
  ITEM_DEFINITIONS,
  itemIndex,
  MAXIMUM_GEAR_INSTANCES,
  RECIPES,
  VENDOR_OFFERS,
} from "../src/balance/items";
import { COMBAT_ACTION_DOWNED } from "../src/sim/combat-core";
import {
  addItemStack,
  assertItemState,
  awardMonsterLoot,
  buyVendorItem,
  consumeVigorHealing,
  craftRecipe,
  createInitialItemState,
  deserializeItemState,
  dropMaterialSatchel,
  equipGear,
  ITEM_STATE_BYTES,
  itemCombatBonuses,
  recoverMaterialSatchel,
  sellGear,
  sellItemStack,
  serializeItemState,
  stepItemEffects,
  unequipGear,
  useConsumable,
} from "../src/sim/items";
import {
  createCraftItemCommand,
  createGameSimulationAdapter,
  createGatherItemCommand,
  createUnequipGearCommand,
  createUseItemCommand,
} from "../src/sim/m3-simulation";
import { DISTRICT_1_GREYBOX_SPEC } from "../src/world/district-1.data";
import { DISTRICT_1_GATHERING_NODES } from "../src/world/gathering-nodes";
import { createGreyboxScene } from "../src/world/greybox-generator";

const world = createGreyboxScene(DISTRICT_1_GREYBOX_SPEC).world;
const context = Object.freeze({ timestepHz: 60, world: simulationWorldDefinition(world) });

function withStacks(
  state: ReturnType<typeof createInitialItemState>,
  values: readonly Readonly<{
    readonly id: Parameters<typeof addItemStack>[1];
    readonly quantity: number;
  }>[],
) {
  return values.reduce((next, value) => addItemStack(next, value.id, value.quantity), state);
}

describe("M3.5 items, crafting, economy, and loot", () => {
  it("keeps the complete authored surface stable, bounded, and easy to scan", () => {
    expect(new Set(ITEM_DEFINITIONS.map(({ id }) => id)).size).toBe(ITEM_DEFINITIONS.length);
    expect(new Set(RECIPES.map(({ id }) => id)).size).toBe(24);
    expect(RECIPES.filter(({ station }) => station === "forge")).toHaveLength(8);
    expect(RECIPES.filter(({ station }) => station === "alembic")).toHaveLength(9);
    expect(RECIPES.filter(({ station }) => station === "hearth")).toHaveLength(7);
    expect(
      RECIPES.every(({ ingredients }) => ingredients.length >= 2 && ingredients.length <= 3),
    ).toBe(true);
    expect(GEAR_AFFIXES).toHaveLength(10);
    expect(VENDOR_OFFERS.some(({ itemId }) => itemId === "ashwood-focus")).toBe(true);
  });

  it("starts with one readable loadout and a 25-mark purse", () => {
    const state = createInitialItemState(1);
    expect(state.marks).toBe(25);
    expect(state.gear.map(({ itemIndex: index }) => ITEM_DEFINITIONS[index]?.id)).toEqual([
      "sword",
      "leather-jack",
      "ashwood-focus",
    ]);
    expect(itemCombatBonuses(state)).toMatchObject({
      armorGuard: 2,
      armorSoakPhysical: 2,
      catalystPotency: 1,
      weaponAccuracy: 1,
      weaponBase: 10,
    });
  });

  it("crafts Fine gear from a short regional recipe and rolls one eligible affix", () => {
    let state = withStacks(createInitialItemState(7), [
      { id: "salvage-iron", quantity: 4 },
      { id: "dimstone-ore", quantity: 2 },
    ]);
    const result = craftRecipe(
      state,
      RECIPES.findIndex(({ id }) => id === "tempered-sword"),
      null,
      false,
    );
    expect(result.applied).toBe(true);
    state = result.state;
    const crafted = state.gear.at(-1);
    expect(crafted).toMatchObject({ rarity: "fine" });
    expect(ITEM_DEFINITIONS[crafted?.itemIndex ?? -1]?.id).toBe("tempered-sword");
    expect(crafted === undefined ? 0 : crafted.affixMask).not.toBe(0);
    expect(state.stackCounts[itemIndex("salvage-iron")]).toBe(0);
    expect(state.counters).toMatchObject({ craftCount: 1, gearCreatedCount: 4 });
  });

  it("makes Tinker's Thrift obvious by reducing each common ingredient once", () => {
    const recipe = RECIPES.findIndex(({ id }) => id === "hearthloaf");
    const state = withStacks(createInitialItemState(3), [
      { id: "grain", quantity: 3 },
      { id: "sea-salt", quantity: 1 },
    ]);
    const result = craftRecipe(state, recipe, null, true);
    expect(result.applied).toBe(true);
    expect(result.state.stackCounts[itemIndex("grain")]).toBe(0);
    expect(result.state.stackCounts[itemIndex("sea-salt")]).toBe(0);
    expect(result.state.stackCounts[itemIndex("hearthloaf")]).toBe(2);
  });

  it("keeps every fully vendor-funded recipe nonprofitable with or without Tinker's Thrift", () => {
    const vendorItems = new Set(VENDOR_OFFERS.map(({ itemId }) => itemId));
    const vendorFundedRecipes = RECIPES.filter((recipe) =>
      recipe.ingredients.every(({ itemId }) => vendorItems.has(itemId)),
    );
    expect(vendorFundedRecipes.map(({ id }) => id)).toEqual(["hearthloaf", "fishers-stew"]);
    const profitable = vendorFundedRecipes.flatMap((recipe) => {
      const sellPrice = Math.floor(
        ((ITEM_DEFINITIONS[itemIndex(recipe.outputItemId)]?.buyPrice ?? 0) *
          ITEM_BUYBACK.numerator) /
          ITEM_BUYBACK.denominator,
      );
      return [false, true].flatMap((tinkersThrift) => {
        const inputCost = recipe.ingredients.reduce((total, ingredient) => {
          const definition = ITEM_DEFINITIONS[itemIndex(ingredient.itemId)];
          const quantity =
            tinkersThrift && definition?.material?.tinkersThriftEligible === true
              ? Math.max(1, ingredient.quantity - 1)
              : ingredient.quantity;
          return total + quantity * (definition?.buyPrice ?? 0);
        }, 0);
        return sellPrice > inputCost
          ? [{ inputCost, recipeId: recipe.id, sellPrice, tinkersThrift }]
          : [];
      });
    });
    expect(profitable).toEqual([]);
  });

  it("keeps loot deterministic while giving every monster a material-and-marks result", () => {
    const run = () => {
      let state = createInitialItemState(0x1234_5678);
      for (const kitId of [
        "burrow-gnawer",
        "greymaw",
        "wayland-brigand",
        "skitterling",
        "hollow-warden",
        "warden-below",
      ]) {
        state = awardMonsterLoot(state, kitId).state;
      }
      const bytes = new Uint8Array(ITEM_STATE_BYTES);
      serializeItemState(new DataView(bytes.buffer), 0, state);
      return bytes;
    };
    expect(run()).toEqual(run());
    const state = deserializeItemState(new DataView(run().buffer), 0);
    expect(state.marks).toBeGreaterThan(25);
    expect(state.stackCounts[itemIndex("mythic-catalyst-core")]).toBe(1);
    expect(state.counters.lootAwardCount).toBe(6);
    const echo = state.gear.find(
      ({ itemIndex: index, rarity }) =>
        ITEM_DEFINITIONS[index]?.id === "resonant-focus" && rarity === "mythic",
    );
    if (echo === undefined) throw new Error("Warden's Echo reward is missing");
    expect(echo.uniqueProperty).toBe(1);
    expect(itemCombatBonuses(equipGear(state, echo.serial).state).catalystOmniResonance).toBe(true);
  });

  it("drops only loose materials and recovers the persistent satchel", () => {
    let state = withStacks(createInitialItemState(1), [
      { id: "grain", quantity: 3 },
      { id: "vigor-tonic", quantity: 2 },
      { id: "mythic-catalyst-core", quantity: 1 },
    ]);
    state = dropMaterialSatchel(state, [10, 2, 20]);
    expect(state.satchelActive).toBe(true);
    expect(state.stackCounts[itemIndex("grain")]).toBe(0);
    expect(state.stackCounts[itemIndex("vigor-tonic")]).toBe(2);
    expect(state.stackCounts[itemIndex("mythic-catalyst-core")]).toBe(1);
    const recovered = recoverMaterialSatchel(state);
    expect(recovered.applied).toBe(true);
    expect(recovered.state.stackCounts[itemIndex("grain")]).toBe(3);
    expect(recovered.state.satchelActive).toBe(false);
  });

  it("replaces an unrecovered satchel on the next defeat", () => {
    let state = withStacks(createInitialItemState(1), [{ id: "grain", quantity: 2 }]);
    state = dropMaterialSatchel(state, [10, 2, 20]);
    expect(state.satchelActive).toBe(true);
    state = dropMaterialSatchel(state, [30, 4, 40]);
    expect(state.satchelActive).toBe(false);
    expect(state.satchelCounts.every((count) => count === 0)).toBe(true);
  });

  it("makes food and equipment affect the combat profile without hidden stacking", () => {
    let state = withStacks(createInitialItemState(5), [{ id: "hunters-roast", quantity: 1 }]);
    state = useConsumable(state, "hunters-roast").state;
    const initial = itemCombatBonuses(state);
    expect(initial.mightBonus).toBe(1);
    expect(equipGear(state, state.equippedWeaponSerial).applied).toBe(false);

    state = withStacks(state, [
      { id: "salvage-iron", quantity: 5 },
      { id: "timber", quantity: 2 },
    ]);
    state = craftRecipe(
      state,
      RECIPES.findIndex(({ id }) => id === "tempered-axe"),
      null,
      false,
    ).state;
    const axe = state.gear.at(-1);
    if (axe === undefined) throw new Error("Crafted axe is missing");
    state = equipGear(state, axe.serial).state;
    expect(itemCombatBonuses(state)).toMatchObject({
      mightBonus: 1,
      weaponBase: 14,
      weaponRangeMeters: 2.2,
      weaponRecoveryTicksBonus: 4,
    });
  });

  it("runs a transparent half-price static economy with no hidden vendor mutation", () => {
    let state: ReturnType<typeof createInitialItemState> = Object.freeze({
      ...createInitialItemState(4),
      marks: 100,
    });
    const offer = VENDOR_OFFERS.findIndex(({ itemId }) => itemId === "vigor-tonic");
    state = buyVendorItem(state, offer).state;
    expect(state.marks).toBe(88);
    expect(state.stackCounts[itemIndex("vigor-tonic")]).toBe(1);
    state = sellItemStack(state, "vigor-tonic").state;
    expect(state.marks).toBe(94);
    expect(state.counters).toMatchObject({ buyCount: 1, sellCount: 1 });
  });

  it("pays exactly half authored price for crafted gear and cannot vendor-fund the forge", () => {
    let state = withStacks(createInitialItemState(4), [
      { id: "salvage-iron", quantity: 4 },
      { id: "dimstone-ore", quantity: 2 },
    ]);
    state = craftRecipe(
      state,
      RECIPES.findIndex(({ id }) => id === "tempered-sword"),
      null,
      false,
    ).state;
    const crafted = state.gear.at(-1);
    if (crafted === undefined) throw new Error("Crafted gear is missing");
    const sold = sellGear(state, crafted.serial);
    expect(sold.state.marks - state.marks).toBe(50);
    expect(VENDOR_OFFERS.some(({ itemId }) => itemId === "salvage-iron")).toBe(false);
  });

  it("lets every equipment slot return to empty through direct and command paths", () => {
    const state = createInitialItemState(3);
    const direct = unequipGear(state, "weapon");
    expect(direct.state.equippedWeaponSerial).toBe(0);
    expect(direct.state.counters.equipmentChangeCount).toBe(1);

    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(3);
    const commanded = adapter.applyCommand(initial, createUnequipGearCommand(0, 1, "armor"));
    expect(commanded.events[0]?.kind).toBe("items.equipped");
    expect(commanded.state.items.equippedArmorSerial).toBe(0);
  });

  it("applies Light independently to weapon stamina and shield block stamina", () => {
    let state = withStacks(createInitialItemState(5), [
      { id: "timber", quantity: 3 },
      { id: "salvage-iron", quantity: 3 },
    ]);
    state = craftRecipe(
      state,
      RECIPES.findIndex(({ id }) => id === "reinforced-buckler"),
      null,
      false,
    ).state;
    const shield = state.gear.at(-1);
    if (shield === undefined) throw new Error("Crafted shield is missing");
    const lightMask = 1 << GEAR_AFFIXES.findIndex(({ id }) => id === "light");
    state = Object.freeze({
      ...state,
      gear: Object.freeze(
        state.gear.map((instance) =>
          instance.serial === state.equippedWeaponSerial || instance.serial === shield.serial
            ? Object.freeze({ ...instance, affixMask: lightMask, rarity: "fine" as const })
            : instance,
        ),
      ),
    });
    state = equipGear(state, shield.serial).state;
    expect(itemCombatBonuses(state)).toMatchObject({
      blockStaminaCostNumerator: 3,
      weaponStaminaCostNumerator: 3,
    });
    expect(() => assertItemState(state)).not.toThrow();
  });

  it("authors Waybread as a five-minute food instead of inheriting the ten-minute meal duration", () => {
    let state = withStacks(createInitialItemState(2), [{ id: "waybread", quantity: 1 }]);
    state = useConsumable(state, "waybread").state;
    expect(state.foodTicks).toBe(18_000);
  });

  it("delivers Vigor's full 40-point eight-second heal deterministically", () => {
    let state = withStacks(createInitialItemState(8), [{ id: "vigor-tonic", quantity: 1 }]);
    state = useConsumable(state, "vigor-tonic").state;
    let healed = 0;
    for (let tick = 0; tick < 480; tick += 1) {
      const result = consumeVigorHealing(state);
      healed += result.amount;
      state = stepItemEffects(result.state);
    }
    expect(healed).toBe(40);
    expect(state).toMatchObject({ vigorRemaining: 0, vigorTicks: 0 });
  });

  it("suppresses Vigor while Envenomed and clears it before a downed state can heal", () => {
    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(8);
    const stocked = Object.freeze({
      ...initial,
      items: withStacks(initial.items, [{ id: "vigor-tonic", quantity: 1 }]),
    });
    const consumed = adapter.applyCommand(stocked, createUseItemCommand(0, 1, "vigor-tonic"));
    const primedItems = Object.freeze({ ...consumed.state.items, vigorAccumulator: 440 });
    const envenomed = Object.freeze({
      ...consumed.state,
      combat: Object.freeze({
        ...consumed.state.combat,
        player: Object.freeze({
          ...consumed.state.combat.player,
          conditions: Object.freeze({
            ...consumed.state.combat.player.conditions,
            envenomedTicks: 2,
          }),
          health: consumed.state.combat.player.health - 10,
        }),
      }),
      items: primedItems,
    });
    const suppressed = adapter.step(envenomed, 2).state;
    expect(suppressed.combat.player.health).toBeLessThanOrEqual(envenomed.combat.player.health);
    expect(suppressed.items.vigorRemaining).toBe(40);

    const downed = Object.freeze({
      ...consumed.state,
      combat: Object.freeze({
        ...consumed.state.combat,
        player: Object.freeze({
          ...consumed.state.combat.player,
          actionKind: COMBAT_ACTION_DOWNED,
          health: 0,
        }),
      }),
      items: primedItems,
    });
    const stepped = adapter.step(downed, 2).state;
    expect(stepped.combat.player.health).toBe(0);
    expect(stepped.items).toMatchObject({
      vigorAccumulator: 0,
      vigorRemaining: 0,
      vigorTicks: 0,
    });
    expect(() => adapter.serializeState(stepped)).not.toThrow();
  });

  it("preserves guaranteed mythic loot at cap and turns all overflow into visible marks", () => {
    const initial = createInitialItemState(0x1234);
    const template = initial.gear[0];
    if (template === undefined) throw new Error("Starter gear is missing");
    const fullGear = Object.freeze([
      ...initial.gear,
      ...Array.from({ length: MAXIMUM_GEAR_INSTANCES - initial.gear.length }, (_, index) =>
        Object.freeze({ ...template, serial: initial.nextGearSerial + index }),
      ),
    ]);
    const stackCounts = [...initial.stackCounts];
    stackCounts[itemIndex("mythic-catalyst-core")] = 9_999;
    stackCounts[itemIndex("relic-fragment")] = 9_999;
    const full = Object.freeze({
      ...initial,
      gear: fullGear,
      nextGearSerial: initial.nextGearSerial + fullGear.length - initial.gear.length,
      stackCounts: Object.freeze(stackCounts),
    });
    expect(() => assertItemState(full)).not.toThrow();
    const baseline = awardMonsterLoot(initial, "warden-below");
    const award = awardMonsterLoot(full, "warden-below");
    expect(award.state.gear).toHaveLength(MAXIMUM_GEAR_INSTANCES);
    expect(award.displacedGearSerial).toBe(fullGear.at(-1)?.serial);
    expect(award.gearSerial).not.toBe(0);
    expect(award.marks).toBeGreaterThan(baseline.marks);
    expect(
      award.state.gear.some(
        ({ itemIndex: index, rarity }) =>
          ITEM_DEFINITIONS[index]?.id === "resonant-focus" && rarity === "mythic",
      ),
    ).toBe(true);
  });

  it("preserves unique, rarer, and upgraded gear before considering base price", () => {
    const initial = createInitialItemState(0x1234);
    const template = initial.gear[0];
    if (template === undefined) throw new Error("Starter gear is missing");
    const commonTemperedSword = Object.freeze({
      ...template,
      itemIndex: itemIndex("tempered-sword"),
      serial: 4,
    });
    const upgradedCommonSword = Object.freeze({ ...template, serial: 5, upgrades: 1 });
    const exceptionalClothGarb = Object.freeze({
      ...template,
      affixMask: 1 << GEAR_AFFIXES.findIndex(({ id }) => id === "bulwark"),
      itemIndex: itemIndex("cloth-garb"),
      rarity: "exceptional" as const,
      serial: 6,
    });
    const commonClothGarb = Object.freeze({
      ...template,
      itemIndex: itemIndex("cloth-garb"),
      serial: 7,
    });
    const uniqueMythicFocus = Object.freeze({
      ...template,
      affixMask: 1 << GEAR_AFFIXES.findIndex(({ id }) => id === "attuned"),
      itemIndex: itemIndex("resonant-focus"),
      rarity: "mythic" as const,
      resonance: "aether" as const,
      serial: 8,
      uniqueProperty: 1 as const,
    });
    const filler = Array.from({ length: MAXIMUM_GEAR_INSTANCES - 8 }, (_, index) =>
      Object.freeze({
        ...template,
        affixMask:
          (1 << GEAR_AFFIXES.findIndex(({ id }) => id === "keen")) |
          (1 << GEAR_AFFIXES.findIndex(({ id }) => id === "weighted")),
        itemIndex: itemIndex("tempered-axe"),
        rarity: "mythic" as const,
        serial: 9 + index,
        upgrades: 1,
      }),
    );
    const full = Object.freeze({
      ...initial,
      gear: Object.freeze([
        ...initial.gear,
        commonTemperedSword,
        upgradedCommonSword,
        exceptionalClothGarb,
        commonClothGarb,
        uniqueMythicFocus,
        ...filler,
      ]),
      nextGearSerial: MAXIMUM_GEAR_INSTANCES + 1,
    });
    expect(() => assertItemState(full)).not.toThrow();

    const firstAward = awardMonsterLoot(full, "warden-below");
    const secondAward = awardMonsterLoot(firstAward.state, "warden-below");

    expect(firstAward.displacedGearSerial).toBe(commonClothGarb.serial);
    expect(secondAward.displacedGearSerial).toBe(commonTemperedSword.serial);
    expect(secondAward.state.gear).toContain(upgradedCommonSword);
    expect(secondAward.state.gear).toContain(exceptionalClothGarb);
    expect(secondAward.state.gear).toContain(uniqueMythicFocus);
  });

  it("keeps weapon oils in their authored elemental damage channel", () => {
    let state = withStacks(createInitialItemState(8), [{ id: "emberdust-oil", quantity: 1 }]);
    state = useConsumable(state, "emberdust-oil").state;
    expect(itemCombatBonuses(state)).toMatchObject({
      affixDamage: 0,
      weaponEmberDamage: 3,
      weaponFrostDamage: 0,
      weaponVenomDamage: 0,
    });
  });

  it("round-trips the canonical fixed block and rejects reserved-byte drift", () => {
    const state = awardMonsterLoot(createInitialItemState(99), "hollow-warden").state;
    const bytes = new Uint8Array(ITEM_STATE_BYTES);
    serializeItemState(new DataView(bytes.buffer), 0, state);
    expect(deserializeItemState(new DataView(bytes.buffer), 0)).toEqual(state);
    new DataView(bytes.buffer).setUint32(136, 1, true);
    expect(() => deserializeItemState(new DataView(bytes.buffer), 0)).toThrow(/reserved bytes/);
    expect(() => assertItemState({ ...state, stoneTonicTicks: 3_601 })).toThrow(/invalid/);

    const invalidSatchel = new Uint8Array(ITEM_STATE_BYTES);
    serializeItemState(new DataView(invalidSatchel.buffer), 0, createInitialItemState(1));
    const invalidView = new DataView(invalidSatchel.buffer);
    invalidView.setUint32(108, 1, true);
    const satchelOffset = 192 + ITEM_DEFINITIONS.length * 4;
    invalidView.setUint32(satchelOffset + itemIndex("sword") * 4, 1, true);
    expect(() => deserializeItemState(invalidView, 0)).toThrow(/invalid/);
  });

  it("applies gathering and crafting only through proximity-checked sim commands", () => {
    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(17);
    const node = DISTRICT_1_GATHERING_NODES[0];
    if (node === undefined) throw new Error("Gathering fixture is missing");
    const nearNode = Object.freeze({
      ...initial,
      playerPosition: Object.freeze([node.position[0], 0, node.position[1]] as const),
    });
    const gathered = adapter.applyCommand(nearNode, createGatherItemCommand(0, 1, node.id));
    expect(gathered.events[0]?.kind).toBe("items.gathered");
    expect(adapter.telemetryCounters(gathered.state)).toMatchObject({ itemGatherCount: 1 });
    expect(gathered.state.items.nodeCooldownTicks[0]).toBeGreaterThan(0);
    expect(
      adapter.applyCommand(gathered.state, createGatherItemCommand(1, 1, node.id)).events[0]?.kind,
    ).toBe("items.rejected");

    const stocked = Object.freeze({
      ...gathered.state,
      items: withStacks(gathered.state.items, [
        { id: "dimstone-ore", quantity: 2 },
        { id: "sea-salt", quantity: 1 },
      ]),
      playerPosition: Object.freeze([-752, 0, -96] as const),
    });
    const crafted = adapter.applyCommand(stocked, createCraftItemCommand(2, 1, "weapon-whetting"));
    expect(crafted.events[0]?.kind).toBe("items.crafted");
    expect(crafted.state.items.stackCounts[itemIndex("weapon-whetting")]).toBe(1);
    expect(() => assertItemState(crafted.state.items)).not.toThrow();
  });

  it("exposes a compact, queryable inventory snapshot for the later heavy-screen UI", () => {
    const adapter = createGameSimulationAdapter(context);
    const state = adapter.createInitialState(1);
    const payload = adapter.queryState?.(state, {
      kind: "inventory.snapshot@1",
      payload: new Uint8Array(),
    });
    const snapshot = JSON.parse(new TextDecoder().decode(payload)) as {
      gear: readonly unknown[];
      marks: number;
      version: number;
    };
    expect(snapshot).toMatchObject({ marks: 25, version: 1 });
    expect(snapshot.gear).toHaveLength(3);
  });

  it("hash-matches a replay that consumes the starter travel provision", () => {
    const commands = Object.freeze([createUseItemCommand(0, 1, "hearthloaf")]);
    const first = runSimulationReplay(createGameSimulationAdapter(context), 44, 60, commands, 120);
    const second = runSimulationReplay(createGameSimulationAdapter(context), 44, 60, commands, 120);
    expect(second.finalStateHash).toBe(first.finalStateHash);
    expect(first.gameCounters.itemConsumableUseCount).toBe(1);
    expect(first.gameCounters.itemStackCount).toBe(0);
  });

  it("clamps a boosted pool when its food expires", () => {
    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(23);
    const consumed = adapter.applyCommand(initial, createUseItemCommand(0, 1, "hearthloaf"));
    const expiring = Object.freeze({
      ...consumed.state,
      items: Object.freeze({ ...consumed.state.items, foodTicks: 1 }),
    });
    const stepped = adapter.step(expiring, 2).state;
    expect(stepped.items.activeFoodItemIndex).toBe(-1);
    expect(stepped.combat.player.stamina).toBe(initial.combat.player.stamina);
    expect(() => adapter.serializeState(stepped)).not.toThrow();
  });
});
