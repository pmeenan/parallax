// Pure deterministic combat core for ruleset v2 (D-142/D-165). Rules math is
// integer-only (design implication #8): pools, ratings, damage, and durations are
// integers; per-second rates accrue through per-tick sixtieths accumulators; and
// multipliers use floor division. Spatial concerns (positions, reach, arcs) belong to
// the caller — the sim adapter and the headless balancer both drive this module.
import {
  ANSWERING_STRIKE_WINDOW_TICKS,
  BRACING_AFFIX,
  COMBAT_ABILITIES,
  COMBAT_BLOCK,
  COMBAT_CHECK,
  COMBAT_CONDITION,
  COMBAT_DODGE,
  COMBAT_EQUIPMENT_DEFAULTS,
  COMBAT_KEEN_SPELL_REFUND_DENOMINATOR,
  COMBAT_PLAYER_ATTACKS,
  COMBAT_POOLS,
  type CombatAbilityDefinition,
  type CombatAbilityId,
  type CombatantProfile,
  type DamageChannel,
  IRONSET_STANCE,
  MONSTER_KITS,
  type MonsterAttackDefinition,
  type MonsterClass,
  NIMBLE_AFFIX,
  SIM_TICKS_PER_SECOND,
} from "../balance/combat";
import { WELLSPRING_STAMINA_REGEN_PER_SECOND } from "../balance/progression";

const MENDWEAVE_HEAL_PER_SECOND =
  COMBAT_ABILITIES.mendweave.kind === "spell" ? COMBAT_ABILITIES.mendweave.healPerSecond : 0;

export const COMBAT_ACTION_IDLE = 0;
export const COMBAT_ACTION_WINDUP = 1;
export const COMBAT_ACTION_ACTIVE = 2;
export const COMBAT_ACTION_RECOVERY = 3;
export const COMBAT_ACTION_DODGE = 4;
export const COMBAT_ACTION_STAGGERED = 5;
export const COMBAT_ACTION_DOWNED = 6;

// Player action references: 0 light, 1 heavy, 2 dodge, 3+n = loadout slot n, 100 =
// the innate catalyst bolt (Aetherspark), outside the loadout slots.
export const PLAYER_ACTION_LIGHT = 0;
export const PLAYER_ACTION_HEAVY = 1;
export const PLAYER_ACTION_DODGE = 2;
export const PLAYER_ACTION_SLOT_BASE = 3;
export const PLAYER_ACTION_AETHERSPARK = 100;

export interface CombatantSheet {
  readonly abilities: readonly (CombatAbilityId | null)[];
  readonly accuracy: number;
  readonly affixBracing: boolean;
  readonly affixDamage: number;
  readonly affixNimble: boolean;
  readonly answeringStrike: boolean;
  readonly attunement: number;
  readonly blockStaminaCostNumerator: number;
  readonly catalystOmniResonance: boolean;
  readonly catalystResonance: DamageChannel | null;
  readonly guard: number;
  readonly hasCatalyst: boolean;
  readonly healthRegenOutOfCombat: number;
  readonly maxAether: number;
  readonly maxHealth: number;
  readonly maxStamina: number;
  readonly might: number;
  readonly monsterAttacks: readonly MonsterAttackDefinition[];
  readonly monsterClass: MonsterClass | null;
  readonly potency: number;
  readonly quietTread: boolean;
  readonly resist: number;
  readonly soakElemental: number;
  readonly soakPhysical: number;
  readonly staggerImmune: boolean;
  readonly staminaRegenBonus: number;
  readonly wellspring: boolean;
  readonly weaponBase: number;
  readonly weaponEmberDamage: number;
  readonly weaponFrostDamage: number;
  readonly weaponKeenCondition: ConditionId | null;
  readonly weaponRangeMeters: number;
  readonly weaponRecoveryTicksBonus: number;
  readonly weaponStaminaCostNumerator: number;
  readonly weaponVenomDamage: number;
}

export interface CombatConditionsState {
  readonly burningTicks: number;
  readonly chilledTicks: number;
  readonly envenomedTicks: number;
  readonly exposedTicks: number;
}

export interface CombatantCombatState {
  readonly actionId: number;
  readonly actionKind: number;
  readonly actionTicksRemaining: number;
  readonly aether: number;
  readonly aetherAccumulator: number;
  readonly answeringTicks: number;
  readonly blockHeldTicks: number;
  readonly blockLockoutTicks: number;
  readonly burningAccumulator: number;
  readonly conditions: CombatConditionsState;
  readonly envenomedAccumulator: number;
  readonly healAccumulator: number;
  readonly healRemainingTicks: number;
  readonly health: number;
  readonly ironsetTicks: number;
  readonly nimbleTicks: number;
  readonly stamina: number;
  readonly staminaAccumulator: number;
  readonly staminaDelayTicks: number;
  readonly wardAmount: number;
  readonly wardTicks: number;
}

export type CombatCoreEvent =
  | Readonly<{ readonly kind: "avoided" }>
  | Readonly<{ readonly amount: number; readonly caught: boolean; readonly kind: "blocked" }>
  | Readonly<{ readonly condition: ConditionId; readonly kind: "condition-applied" }>
  | Readonly<{
      readonly applied: ConditionId | "staggered";
      readonly consumed: ConditionId;
      readonly kind: "condition-consumed";
    }>
  | Readonly<{ readonly kind: "deflected" }>
  | Readonly<{ readonly kind: "downed" }>
  | Readonly<{
      readonly amount: number;
      readonly baseline: boolean;
      readonly channel: DamageChannel;
      readonly keen: boolean;
      readonly kind: "hit";
    }>
  | Readonly<{ readonly kind: "resisted" }>
  | Readonly<{ readonly kind: "staggered" }>
  | Readonly<{ readonly amount: number; readonly kind: "ward-absorbed" }>;

export type ConditionId = "burning" | "chilled" | "envenomed" | "exposed";

export function applyCombatCondition(
  state: CombatantCombatState,
  condition: ConditionId,
): CombatantCombatState {
  const conditions = { ...state.conditions };
  if (condition === "burning") conditions.burningTicks = COMBAT_CONDITION.burning.durationTicks;
  if (condition === "chilled") conditions.chilledTicks = COMBAT_CONDITION.chilled.durationTicks;
  if (condition === "envenomed") {
    conditions.envenomedTicks = COMBAT_CONDITION.envenomed.durationTicks;
  }
  if (condition === "exposed") conditions.exposedTicks = COMBAT_CONDITION.exposed.durationTicks;
  return Object.freeze({ ...state, conditions: Object.freeze(conditions) });
}

export interface AttackSpec {
  readonly answeringEligible: boolean;
  readonly appliesCondition: ConditionId | null;
  readonly appliesConditionOnKeen: ConditionId | null;
  readonly bonusDamage: readonly Readonly<{
    readonly channel: DamageChannel;
    readonly raw: number;
  }>[];
  readonly channel: DamageChannel;
  readonly checkType: "spell" | "weapon";
  readonly ignoresHalfSoak: boolean;
  readonly raw: number;
  readonly staggersNonElite: boolean;
}

export interface AttackResolution {
  readonly attacker: CombatantCombatState;
  readonly baselineCheck: boolean;
  readonly defender: CombatantCombatState;
  readonly events: readonly CombatCoreEvent[];
  readonly outcome: "avoided" | "deflected" | "hit" | "keen" | "resisted";
  readonly rngState: number;
}

const EMPTY_BONUS_DAMAGE: AttackSpec["bonusDamage"] = Object.freeze([]);

function weaponBonusDamage(sheet: CombatantSheet): AttackSpec["bonusDamage"] {
  const damage: Readonly<{ readonly channel: DamageChannel; readonly raw: number }>[] = [];
  if (sheet.weaponEmberDamage > 0) {
    damage.push(Object.freeze({ channel: "ember", raw: sheet.weaponEmberDamage }));
  }
  if (sheet.weaponFrostDamage > 0) {
    damage.push(Object.freeze({ channel: "frost", raw: sheet.weaponFrostDamage }));
  }
  if (sheet.weaponVenomDamage > 0) {
    damage.push(Object.freeze({ channel: "venom", raw: sheet.weaponVenomDamage }));
  }
  return Object.freeze(damage);
}

export function derivePlayerSheet(profile: CombatantProfile): CombatantSheet {
  return Object.freeze({
    abilities: profile.loadout,
    accuracy: profile.finesse + profile.weaponAccuracy + profile.affixAccuracy,
    affixBracing: profile.affixBracing,
    affixDamage: profile.affixDamage,
    affixNimble: profile.affixNimble,
    answeringStrike: profile.answeringStrike,
    attunement: profile.attunement,
    blockStaminaCostNumerator: profile.blockStaminaCostNumerator,
    catalystOmniResonance: profile.catalystOmniResonance,
    catalystResonance: profile.catalystResonance,
    guard: Math.floor(profile.finesse / 2) + profile.armorGuard,
    hasCatalyst: profile.catalystPotency > 0,
    healthRegenOutOfCombat: profile.healthRegenOutOfCombat,
    maxAether: COMBAT_POOLS.aetherBase + COMBAT_POOLS.aetherPerAttunement * profile.attunement,
    maxHealth:
      COMBAT_POOLS.healthBase +
      COMBAT_POOLS.healthPerVitality * profile.vitality +
      profile.maxHealthBonus,
    maxStamina:
      COMBAT_POOLS.staminaBase +
      COMBAT_POOLS.staminaPerVitality * profile.vitality +
      profile.maxStaminaBonus,
    might: profile.might,
    monsterAttacks: Object.freeze([]),
    monsterClass: null,
    potency: profile.attunement + profile.catalystPotency + profile.affixPotency,
    quietTread: profile.quietTread,
    resist: Math.floor(profile.vitality / 2),
    soakElemental: profile.armorSoakElemental,
    soakPhysical: profile.armorSoakPhysical,
    staggerImmune: false,
    staminaRegenBonus: profile.staminaRegenBonus,
    weaponBase: profile.weaponBase,
    weaponEmberDamage: profile.weaponEmberDamage,
    weaponFrostDamage: profile.weaponFrostDamage,
    weaponKeenCondition: profile.weaponKeenCondition,
    weaponRangeMeters: profile.weaponRangeMeters,
    weaponRecoveryTicksBonus: profile.weaponRecoveryTicksBonus,
    weaponStaminaCostNumerator: profile.weaponStaminaCostNumerator,
    weaponVenomDamage: profile.weaponVenomDamage,
    wellspring: profile.wellspring,
  });
}

export function deriveMonsterSheet(kitIndex: number): CombatantSheet {
  const kit = MONSTER_KITS[kitIndex];
  if (kit === undefined) throw new Error(`Unknown monster kit index ${kitIndex}`);
  return Object.freeze({
    abilities: Object.freeze([]),
    accuracy: kit.accuracy,
    affixBracing: false,
    affixDamage: 0,
    affixNimble: false,
    answeringStrike: false,
    attunement: 0,
    blockStaminaCostNumerator: COMBAT_EQUIPMENT_DEFAULTS.staminaCostNumerator,
    catalystOmniResonance: false,
    catalystResonance: null,
    guard: kit.guard,
    hasCatalyst: false,
    healthRegenOutOfCombat: 0,
    maxAether: 0,
    maxHealth: kit.healthMax,
    maxStamina: kit.staminaMax,
    might: 0,
    monsterAttacks: kit.attacks,
    monsterClass: kit.monsterClass,
    potency: 0,
    quietTread: false,
    resist: kit.resist,
    soakElemental: kit.soakElemental,
    soakPhysical: kit.soakPhysical,
    staggerImmune: kit.staggerImmune,
    staminaRegenBonus: 0,
    weaponBase: 0,
    weaponEmberDamage: 0,
    weaponFrostDamage: 0,
    weaponKeenCondition: null,
    weaponRangeMeters: 0,
    weaponRecoveryTicksBonus: 0,
    weaponStaminaCostNumerator: 4,
    weaponVenomDamage: 0,
    wellspring: false,
  });
}

export function createCombatantState(sheet: CombatantSheet): CombatantCombatState {
  return Object.freeze({
    actionId: 0,
    actionKind: COMBAT_ACTION_IDLE,
    actionTicksRemaining: 0,
    aether: sheet.maxAether,
    aetherAccumulator: 0,
    answeringTicks: 0,
    blockHeldTicks: 0,
    blockLockoutTicks: 0,
    burningAccumulator: 0,
    conditions: Object.freeze({
      burningTicks: 0,
      chilledTicks: 0,
      envenomedTicks: 0,
      exposedTicks: 0,
    }),
    envenomedAccumulator: 0,
    healAccumulator: 0,
    healRemainingTicks: 0,
    health: sheet.maxHealth,
    ironsetTicks: 0,
    nimbleTicks: 0,
    stamina: sheet.maxStamina,
    staminaAccumulator: 0,
    staminaDelayTicks: 0,
    wardAmount: 0,
    wardTicks: 0,
  });
}

export function nextRandomU32(state: number): number {
  let x = state >>> 0;
  if (x === 0) x = 0x9e37_79b9;
  x ^= (x << 13) >>> 0;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  return x >>> 0;
}

export interface CheckResult {
  readonly outcome: "fail" | "keen" | "success";
  readonly rngState: number;
  readonly roll: number;
}

export function resolveCheck(
  rngState: number,
  attackRating: number,
  defendRating: number,
): CheckResult {
  const next = nextRandomU32(rngState);
  const roll = COMBAT_CHECK.rollMinimum + (next % COMBAT_CHECK.rollSpan);
  const score = roll + attackRating - defendRating;
  const rollMaximum = COMBAT_CHECK.rollMinimum + COMBAT_CHECK.rollSpan - 1;
  let outcome: CheckResult["outcome"];
  if (roll === COMBAT_CHECK.rollMinimum) {
    outcome = "fail";
  } else if (roll === rollMaximum) {
    outcome = score >= COMBAT_CHECK.keenScoreThreshold ? "keen" : "success";
  } else if (score < 0) {
    outcome = "fail";
  } else {
    outcome = score >= COMBAT_CHECK.keenScoreThreshold ? "keen" : "success";
  }
  return Object.freeze({ outcome, rngState: next, roll });
}

export function exactSuccessSeventeenths(attackRating: number, defendRating: number): number {
  const rollMaximum = COMBAT_CHECK.rollMinimum + COMBAT_CHECK.rollSpan - 1;
  let successes = 0;
  for (let roll = COMBAT_CHECK.rollMinimum; roll <= rollMaximum; roll += 1) {
    if (roll === COMBAT_CHECK.rollMinimum) continue;
    if (roll === rollMaximum || roll + attackRating - defendRating >= 0) successes += 1;
  }
  return successes;
}

export function playerAbility(sheet: CombatantSheet, slot: number): CombatAbilityDefinition {
  const id = sheet.abilities[slot];
  if (id === undefined || id === null) throw new Error(`Player loadout slot ${slot} is empty`);
  return COMBAT_ABILITIES[id];
}

export interface StartActionResult {
  readonly started: boolean;
  readonly state: CombatantCombatState;
}

function actionBusy(state: CombatantCombatState): boolean {
  return state.actionKind !== COMBAT_ACTION_IDLE;
}

export function playerActionTiming(
  sheet: CombatantSheet,
  actionId: number,
): Readonly<{ activeTicks: number; recoveryTicks: number; windupTicks: number }> {
  if (actionId === PLAYER_ACTION_LIGHT || actionId === PLAYER_ACTION_HEAVY) {
    const timing =
      actionId === PLAYER_ACTION_LIGHT ? COMBAT_PLAYER_ATTACKS.light : COMBAT_PLAYER_ATTACKS.heavy;
    if (sheet.weaponRecoveryTicksBonus === 0) return timing;
    return Object.freeze({
      ...timing,
      recoveryTicks: timing.recoveryTicks + sheet.weaponRecoveryTicksBonus,
    });
  }
  if (actionId === PLAYER_ACTION_DODGE) {
    return Object.freeze({
      activeTicks: COMBAT_DODGE.totalTicks,
      recoveryTicks: 0,
      windupTicks: 0,
    });
  }
  if (actionId === PLAYER_ACTION_AETHERSPARK) return COMBAT_ABILITIES.aetherspark.timing;
  const ability = playerAbility(sheet, actionId - PLAYER_ACTION_SLOT_BASE);
  return ability.kind === "martial" && sheet.weaponRecoveryTicksBonus !== 0
    ? Object.freeze({
        ...ability.timing,
        recoveryTicks: ability.timing.recoveryTicks + sheet.weaponRecoveryTicksBonus,
      })
    : ability.timing;
}

export function startPlayerAction(
  state: CombatantCombatState,
  sheet: CombatantSheet,
  actionId: number,
): StartActionResult {
  if (actionBusy(state) || state.blockHeldTicks > 0) {
    return Object.freeze({ started: false, state });
  }
  if (actionId === PLAYER_ACTION_DODGE) {
    if (state.stamina < COMBAT_DODGE.staminaCost) return Object.freeze({ started: false, state });
    return Object.freeze({
      started: true,
      state: Object.freeze({
        ...spendStamina(state, COMBAT_DODGE.staminaCost),
        actionId,
        actionKind: COMBAT_ACTION_DODGE,
        actionTicksRemaining: COMBAT_DODGE.totalTicks,
      }),
    });
  }
  let staminaCost = 0;
  let aetherCost = 0;
  let usesWeaponStamina = false;
  if (actionId === PLAYER_ACTION_LIGHT) {
    staminaCost = COMBAT_PLAYER_ATTACKS.light.staminaCost;
    usesWeaponStamina = true;
  } else if (actionId === PLAYER_ACTION_HEAVY) {
    staminaCost = COMBAT_PLAYER_ATTACKS.heavy.staminaCost;
    usesWeaponStamina = true;
  } else if (actionId === PLAYER_ACTION_AETHERSPARK) {
    if (!sheet.hasCatalyst) return Object.freeze({ started: false, state });
  } else {
    // An unbound loadout slot (or any unknown action reference) is a no-op, never a
    // fault: input can legitimately press keys the current loadout leaves empty.
    if (
      actionId < PLAYER_ACTION_SLOT_BASE ||
      sheet.abilities[actionId - PLAYER_ACTION_SLOT_BASE] == null
    ) {
      return Object.freeze({ started: false, state });
    }
    const ability = playerAbility(sheet, actionId - PLAYER_ACTION_SLOT_BASE);
    if (ability.kind === "martial") {
      staminaCost = ability.staminaCost;
      usesWeaponStamina = true;
    } else if (ability.kind === "stance") {
      staminaCost = ability.staminaCost;
    } else {
      if (!sheet.hasCatalyst) return Object.freeze({ started: false, state });
      aetherCost = ability.aetherCost;
    }
  }
  if (staminaCost > 0 && usesWeaponStamina && sheet.weaponStaminaCostNumerator !== 4) {
    staminaCost = Math.floor((staminaCost * sheet.weaponStaminaCostNumerator) / 4);
  }
  // The Answering Strike window makes the next light attack free.
  if (actionId === PLAYER_ACTION_LIGHT && state.answeringTicks > 0) staminaCost = 0;
  if (state.stamina < staminaCost || state.aether < aetherCost) {
    return Object.freeze({ started: false, state });
  }
  const timing = playerActionTiming(sheet, actionId);
  const paid = spendStamina(state, staminaCost);
  return Object.freeze({
    started: true,
    state: Object.freeze({
      ...paid,
      actionId,
      actionKind: COMBAT_ACTION_WINDUP,
      actionTicksRemaining: timing.windupTicks,
      aether: paid.aether - aetherCost,
    }),
  });
}

export function startMonsterAttack(
  state: CombatantCombatState,
  sheet: CombatantSheet,
  attackIndex: number,
): StartActionResult {
  if (actionBusy(state)) return Object.freeze({ started: false, state });
  const attack = sheet.monsterAttacks[attackIndex];
  if (attack === undefined) return Object.freeze({ started: false, state });
  return Object.freeze({
    started: true,
    state: Object.freeze({
      ...state,
      actionId: attackIndex,
      actionKind: COMBAT_ACTION_WINDUP,
      actionTicksRemaining: attack.timing.windupTicks,
    }),
  });
}

function spendStamina(state: CombatantCombatState, cost: number): CombatantCombatState {
  if (cost === 0) return state;
  return Object.freeze({
    ...state,
    stamina: state.stamina - cost,
    staminaDelayTicks: COMBAT_POOLS.staminaRegenDelayTicks,
  });
}

export interface TickContext {
  readonly blockHeld: boolean;
  readonly inCombat: boolean;
}

export interface TickResult {
  readonly activeStartedActionId: number;
  readonly downed: boolean;
  readonly state: CombatantCombatState;
}

// Advances one tick of a combatant's timers, pools, and phase machine. Returns the
// action ID whose active phase begins this tick (contact resolution is the caller's
// job), or -1. Damage-over-time can down a combatant here.
export function tickCombatant(
  state: CombatantCombatState,
  sheet: CombatantSheet,
  timing: Readonly<{ activeTicks: number; recoveryTicks: number }> | null,
  context: TickContext,
): TickResult {
  if (state.actionKind === COMBAT_ACTION_DOWNED) {
    return Object.freeze({ activeStartedActionId: -1, downed: false, state });
  }
  const next: {
    -readonly [Key in keyof CombatantCombatState]: CombatantCombatState[Key];
  } = { ...state, conditions: state.conditions };
  let activeStartedActionId = -1;
  const chilled = state.conditions.chilledTicks > 0;

  // Phase machine.
  if (next.actionKind !== COMBAT_ACTION_IDLE) {
    next.actionTicksRemaining -= 1;
    if (next.actionTicksRemaining <= 0) {
      if (next.actionKind === COMBAT_ACTION_WINDUP) {
        if (timing === null) throw new Error("Combatant action timing is required for wind-up");
        next.actionKind = COMBAT_ACTION_ACTIVE;
        next.actionTicksRemaining = timing.activeTicks;
        activeStartedActionId = next.actionId;
      } else if (next.actionKind === COMBAT_ACTION_ACTIVE) {
        if (timing === null) throw new Error("Combatant action timing is required for recovery");
        const recovery = chilled
          ? Math.floor(
              (timing.recoveryTicks * COMBAT_CONDITION.chilled.recoveryNumerator) /
                COMBAT_CONDITION.chilled.recoveryDenominator,
            )
          : timing.recoveryTicks;
        if (recovery > 0) {
          next.actionKind = COMBAT_ACTION_RECOVERY;
          next.actionTicksRemaining = recovery;
        } else {
          next.actionKind = COMBAT_ACTION_IDLE;
          next.actionTicksRemaining = 0;
        }
      } else {
        next.actionKind = COMBAT_ACTION_IDLE;
        next.actionTicksRemaining = 0;
      }
    }
  }

  // Blocking intent: raising requires idle and no lockout; holding accrues held ticks.
  if (context.blockHeld && next.actionKind === COMBAT_ACTION_IDLE && next.blockLockoutTicks === 0) {
    next.blockHeldTicks = Math.min(next.blockHeldTicks + 1, 30_000);
  } else {
    next.blockHeldTicks = 0;
  }
  if (next.blockLockoutTicks > 0) next.blockLockoutTicks -= 1;
  if (next.answeringTicks > 0) next.answeringTicks -= 1;
  if (next.nimbleTicks > 0) next.nimbleTicks -= 1;

  // Ironset is a bounded planted stance. Five stamina/second is exactly one point
  // every 12 ticks, avoiding a second serialized accumulator.
  if (next.ironsetTicks > 0) {
    next.ironsetTicks -= 1;
    next.staminaDelayTicks = Math.max(next.staminaDelayTicks, 1);
    const drainIntervalTicks = Math.floor(
      SIM_TICKS_PER_SECOND / IRONSET_STANCE.staminaDrainPerSecond,
    );
    if (next.ironsetTicks % drainIntervalTicks === 0) {
      if (next.stamina === 0) {
        next.stamina = 0;
        next.ironsetTicks = 0;
      } else {
        next.stamina -= 1;
      }
    }
  }

  // Stamina regeneration.
  if (next.staminaDelayTicks > 0) {
    next.staminaDelayTicks -= 1;
  } else if (next.stamina < sheet.maxStamina) {
    let rate: number =
      next.blockHeldTicks > 0
        ? COMBAT_POOLS.staminaRegenBlockingPerSecond
        : COMBAT_POOLS.staminaRegenPerSecond;
    if (sheet.wellspring) rate += WELLSPRING_STAMINA_REGEN_PER_SECOND;
    rate += sheet.staminaRegenBonus;
    if (chilled) {
      rate = Math.floor(
        (rate * COMBAT_CONDITION.chilled.staminaRegenNumerator) /
          COMBAT_CONDITION.chilled.staminaRegenDenominator,
      );
    }
    next.staminaAccumulator += rate;
    const gained = Math.floor(next.staminaAccumulator / SIM_TICKS_PER_SECOND);
    if (gained > 0) {
      next.staminaAccumulator -= gained * SIM_TICKS_PER_SECOND;
      next.stamina = Math.min(sheet.maxStamina, next.stamina + gained);
    }
  }

  // Aether regeneration.
  if (sheet.maxAether > 0 && next.aether < sheet.maxAether) {
    next.aetherAccumulator += context.inCombat
      ? COMBAT_POOLS.aetherRegenCombatPerSecond
      : COMBAT_POOLS.aetherRegenRestPerSecond;
    const gained = Math.floor(next.aetherAccumulator / SIM_TICKS_PER_SECOND);
    if (gained > 0) {
      next.aetherAccumulator -= gained * SIM_TICKS_PER_SECOND;
      next.aether = Math.min(sheet.maxAether, next.aether + gained);
    }
  }

  // Heal over time and Waybread's out-of-combat trickle (both suppressed while
  // Envenomed and sharing the canonical healing accumulator).
  const mendweaveActive = next.healRemainingTicks > 0;
  if (mendweaveActive) next.healRemainingTicks -= 1;
  const passiveHealRate = context.inCombat ? 0 : sheet.healthRegenOutOfCombat;
  if (
    next.health < sheet.maxHealth &&
    (mendweaveActive || passiveHealRate > 0) &&
    state.conditions.envenomedTicks === 0
  ) {
    next.healAccumulator += (mendweaveActive ? MENDWEAVE_HEAL_PER_SECOND : 0) + passiveHealRate;
    const healed = Math.floor(next.healAccumulator / SIM_TICKS_PER_SECOND);
    if (healed > 0) {
      next.healAccumulator -= healed * SIM_TICKS_PER_SECOND;
      next.health = Math.min(sheet.maxHealth, next.health + healed);
    }
  } else if (next.health >= sheet.maxHealth) {
    next.healAccumulator = 0;
  }

  // Ward expiry.
  if (next.wardTicks > 0) {
    next.wardTicks -= 1;
    if (next.wardTicks === 0) next.wardAmount = 0;
  }

  // Conditions: damage over time and duration countdown.
  let damage = 0;
  const conditions = { ...state.conditions };
  if (conditions.burningTicks > 0) {
    conditions.burningTicks -= 1;
    next.burningAccumulator += COMBAT_CONDITION.burning.damagePerSecond;
    const burned = Math.floor(next.burningAccumulator / SIM_TICKS_PER_SECOND);
    if (burned > 0) {
      next.burningAccumulator -= burned * SIM_TICKS_PER_SECOND;
      damage += burned;
    }
  } else {
    next.burningAccumulator = 0;
  }
  if (conditions.envenomedTicks > 0) {
    conditions.envenomedTicks -= 1;
    next.envenomedAccumulator += COMBAT_CONDITION.envenomed.damagePerSecond;
    const poisoned = Math.floor(next.envenomedAccumulator / SIM_TICKS_PER_SECOND);
    if (poisoned > 0) {
      next.envenomedAccumulator -= poisoned * SIM_TICKS_PER_SECOND;
      damage += poisoned;
    }
  } else {
    next.envenomedAccumulator = 0;
  }
  if (conditions.chilledTicks > 0) conditions.chilledTicks -= 1;
  if (conditions.exposedTicks > 0) conditions.exposedTicks -= 1;
  next.conditions = Object.freeze(conditions);

  let downed = false;
  if (damage > 0) {
    next.health -= damage;
    if (next.health <= 0) {
      next.health = 0;
      next.actionKind = COMBAT_ACTION_DOWNED;
      next.actionTicksRemaining = 0;
      downed = true;
    }
  }
  return Object.freeze({
    activeStartedActionId,
    downed,
    state: Object.freeze(next),
  });
}

export function dodgeAvoidanceActive(state: CombatantCombatState): boolean {
  if (state.actionKind !== COMBAT_ACTION_DODGE) return false;
  const elapsed = COMBAT_DODGE.totalTicks - state.actionTicksRemaining;
  return elapsed >= COMBAT_DODGE.avoidanceStartTick && elapsed <= COMBAT_DODGE.avoidanceEndTick;
}

export function playerAttackSpec(sheet: CombatantSheet, actionId: number): AttackSpec | null {
  if (actionId === PLAYER_ACTION_DODGE) return null;
  if (actionId === PLAYER_ACTION_LIGHT || actionId === PLAYER_ACTION_HEAVY) {
    const attack =
      actionId === PLAYER_ACTION_LIGHT ? COMBAT_PLAYER_ATTACKS.light : COMBAT_PLAYER_ATTACKS.heavy;
    const weaponRaw = sheet.weaponBase + sheet.might + sheet.affixDamage;
    return Object.freeze({
      answeringEligible: actionId === PLAYER_ACTION_LIGHT,
      appliesCondition: null,
      appliesConditionOnKeen: sheet.weaponKeenCondition,
      bonusDamage: weaponBonusDamage(sheet),
      channel: "physical" as const,
      checkType: "weapon" as const,
      ignoresHalfSoak: false,
      raw: Math.floor((weaponRaw * attack.rawNumerator) / attack.rawDenominator),
      staggersNonElite: false,
    });
  }
  const ability =
    actionId === PLAYER_ACTION_AETHERSPARK
      ? COMBAT_ABILITIES.aetherspark
      : playerAbility(sheet, actionId - PLAYER_ACTION_SLOT_BASE);
  if (ability.kind === "stance") return null;
  if (ability.kind === "martial") {
    const weaponRaw = sheet.weaponBase + sheet.might + sheet.affixDamage;
    return Object.freeze({
      answeringEligible: false,
      appliesCondition: null,
      appliesConditionOnKeen: sheet.weaponKeenCondition,
      bonusDamage: weaponBonusDamage(sheet),
      channel: "physical" as const,
      checkType: "weapon" as const,
      ignoresHalfSoak: ability.ignoresHalfSoak,
      raw: Math.floor((weaponRaw * ability.rawNumerator) / ability.rawDenominator),
      staggersNonElite: false,
    });
  }
  if (ability.baseDamage === 0) return null;
  let raw = ability.baseDamage + sheet.attunement;
  if (sheet.catalystOmniResonance || sheet.catalystResonance === ability.channel) {
    raw = Math.floor((raw * 5) / 4);
  }
  return Object.freeze({
    answeringEligible: false,
    appliesCondition: ability.appliesCondition,
    appliesConditionOnKeen: ability.appliesConditionOnKeen,
    bonusDamage: EMPTY_BONUS_DAMAGE,
    channel: ability.channel,
    checkType: "spell" as const,
    ignoresHalfSoak: false,
    raw,
    staggersNonElite: ability.staggersNonElite,
  });
}

export function monsterAttackSpec(sheet: CombatantSheet, attackIndex: number): AttackSpec {
  const attack = sheet.monsterAttacks[attackIndex];
  if (attack === undefined) throw new Error(`Monster attack index ${attackIndex} is invalid`);
  return Object.freeze({
    answeringEligible: false,
    appliesCondition: null,
    appliesConditionOnKeen: attack.appliesConditionOnKeen,
    bonusDamage: EMPTY_BONUS_DAMAGE,
    channel: attack.channel,
    checkType: attack.spellPotency === null ? ("weapon" as const) : ("spell" as const),
    ignoresHalfSoak: false,
    raw: attack.raw,
    staggersNonElite: attack.staggers,
  });
}

export interface AttackerContext {
  readonly sheet: CombatantSheet;
  readonly spellPotencyOverride: number | null;
  readonly state: CombatantCombatState;
}

export interface DefenderContext {
  readonly sheet: CombatantSheet;
  readonly state: CombatantCombatState;
}

// Resolves one attack contact. The caller has already established spatial contact and
// pays nothing here; this is the rules boundary: check, damage, block/dodge, ward,
// conditions, thermal-shock interactions, stagger, downed.
export function resolveAttack(
  rngState: number,
  attacker: AttackerContext,
  defender: DefenderContext,
  spec: AttackSpec,
): AttackResolution {
  const events: CombatCoreEvent[] = [];
  let attackerState = attacker.state;
  let defenderState = defender.state;

  // Dodge avoidance frames defeat the attack before any check.
  if (dodgeAvoidanceActive(defenderState)) {
    events.push(Object.freeze({ kind: "avoided" as const }));
    if (defender.sheet.affixNimble) {
      defenderState = Object.freeze({
        ...defenderState,
        nimbleTicks: NIMBLE_AFFIX.durationTicks,
      });
    }
    return Object.freeze({
      attacker: attackerState,
      baselineCheck: false,
      defender: defenderState,
      events: Object.freeze(events),
      outcome: "avoided",
      rngState,
    });
  }

  const blocking = defenderState.blockHeldTicks > 0 && spec.checkType === "weapon";
  const caughtBlock = blocking && defenderState.blockHeldTicks <= COMBAT_BLOCK.caughtWindowTicks;
  const nimbleActive = attackerState.nimbleTicks > 0 && attacker.sheet.affixNimble;
  const exposed = defenderState.conditions.exposedTicks > 0;
  const answering =
    spec.answeringEligible && attacker.sheet.answeringStrike && attackerState.answeringTicks > 0;
  const baselineCheck = !blocking && !nimbleActive && !exposed && !answering;

  let attackRating: number;
  let defendRating: number;
  if (spec.checkType === "weapon") {
    attackRating = attacker.sheet.accuracy + (nimbleActive ? NIMBLE_AFFIX.accuracyBonus : 0);
    defendRating =
      defender.sheet.guard + (defender.state.ironsetTicks > 0 ? IRONSET_STANCE.guardBonus : 0);
    if (blocking) defendRating += COMBAT_BLOCK.guardBonus;
    if (exposed) defendRating -= COMBAT_CONDITION.exposed.guardPenalty;
  } else {
    attackRating = attacker.spellPotencyOverride ?? attacker.sheet.potency;
    defendRating = defender.sheet.resist;
  }

  let outcome: "fail" | "keen" | "success";
  let nextRngState = rngState;
  if (answering) {
    // An armed Answering Strike lands as a keen hit without a roll.
    outcome = "keen";
    attackerState = Object.freeze({ ...attackerState, answeringTicks: 0 });
  } else {
    const check = resolveCheck(rngState, attackRating, defendRating);
    outcome = check.outcome;
    nextRngState = check.rngState;
  }

  if (outcome === "fail") {
    if (blocking) {
      // A held block turns a failed weapon check into the block interaction: the
      // deflection costs stamina unless the block was caught.
      const totalRaw = spec.raw + spec.bonusDamage.reduce((sum, bonus) => sum + bonus.raw, 0);
      const drain = caughtBlock
        ? 0
        : blockStaminaDrain(totalRaw, defender.sheet.blockStaminaCostNumerator);
      defenderState = applyBlockDrain(defenderState, drain, events);
      events.push(Object.freeze({ amount: 0, caught: caughtBlock, kind: "blocked" as const }));
      if (caughtBlock && defender.sheet.answeringStrike) {
        defenderState = Object.freeze({
          ...defenderState,
          answeringTicks: ANSWERING_STRIKE_WINDOW_TICKS,
        });
      }
      if (caughtBlock && defender.sheet.affixBracing) {
        defenderState = Object.freeze({
          ...defenderState,
          stamina: Math.min(
            defender.sheet.maxStamina,
            defenderState.stamina + BRACING_AFFIX.staminaRestore,
          ),
        });
      }
    } else {
      events.push(
        Object.freeze({
          kind: spec.checkType === "weapon" ? ("deflected" as const) : ("resisted" as const),
        }),
      );
    }
    return Object.freeze({
      attacker: attackerState,
      baselineCheck,
      defender: defenderState,
      events: Object.freeze(events),
      outcome: spec.checkType === "weapon" ? "deflected" : "resisted",
      rngState: nextRngState,
    });
  }

  // Damage.
  const keen = outcome === "keen";
  let raw = spec.raw;
  if (keen) {
    raw = Math.floor((raw * COMBAT_CHECK.keenNumerator) / COMBAT_CHECK.keenDenominator);
  }
  let soak =
    spec.channel === "physical" ? defender.sheet.soakPhysical : defender.sheet.soakElemental;
  if (spec.ignoresHalfSoak) soak = Math.floor(soak / 2);
  let dealt = Math.max(1, raw - soak);
  for (const bonus of spec.bonusDamage) {
    const bonusSoak =
      bonus.channel === "physical" ? defender.sheet.soakPhysical : defender.sheet.soakElemental;
    dealt += Math.max(0, bonus.raw - bonusSoak);
  }
  if (blocking) {
    dealt = Math.max(
      1,
      Math.floor(
        (dealt * COMBAT_BLOCK.blockedDamageNumerator) / COMBAT_BLOCK.blockedDamageDenominator,
      ),
    );
    const totalRaw = raw + spec.bonusDamage.reduce((sum, bonus) => sum + bonus.raw, 0);
    const drain = caughtBlock
      ? 0
      : blockStaminaDrain(totalRaw, defender.sheet.blockStaminaCostNumerator);
    defenderState = applyBlockDrain(defenderState, drain, events);
    events.push(Object.freeze({ amount: dealt, caught: caughtBlock, kind: "blocked" as const }));
    if (caughtBlock && defender.sheet.answeringStrike) {
      defenderState = Object.freeze({
        ...defenderState,
        answeringTicks: ANSWERING_STRIKE_WINDOW_TICKS,
      });
    }
    if (caughtBlock && defender.sheet.affixBracing) {
      defenderState = Object.freeze({
        ...defenderState,
        stamina: Math.min(
          defender.sheet.maxStamina,
          defenderState.stamina + BRACING_AFFIX.staminaRestore,
        ),
      });
    }
  }

  // Ward absorbs before health.
  if (defenderState.wardAmount > 0) {
    const absorbed = Math.min(defenderState.wardAmount, dealt);
    defenderState = Object.freeze({
      ...defenderState,
      wardAmount: defenderState.wardAmount - absorbed,
      wardTicks: defenderState.wardAmount - absorbed === 0 ? 0 : defenderState.wardTicks,
    });
    dealt -= absorbed;
    events.push(Object.freeze({ amount: absorbed, kind: "ward-absorbed" as const }));
  }

  const defenderWasWindingUp = defenderState.actionKind === COMBAT_ACTION_WINDUP;
  defenderState = Object.freeze({ ...defenderState, health: defenderState.health - dealt });
  events.push(
    Object.freeze({
      amount: dealt,
      baseline: baselineCheck,
      channel: spec.channel,
      keen,
      kind: "hit" as const,
    }),
  );

  // Conditions from the attack itself.
  const conditions = { ...defenderState.conditions };
  const applyCondition = (condition: ConditionId): void => {
    if (condition === "burning") conditions.burningTicks = COMBAT_CONDITION.burning.durationTicks;
    if (condition === "chilled") conditions.chilledTicks = COMBAT_CONDITION.chilled.durationTicks;
    if (condition === "envenomed") {
      conditions.envenomedTicks = COMBAT_CONDITION.envenomed.durationTicks;
    }
    if (condition === "exposed") conditions.exposedTicks = COMBAT_CONDITION.exposed.durationTicks;
    events.push(Object.freeze({ condition, kind: "condition-applied" as const }));
  };
  if (spec.appliesCondition !== null) applyCondition(spec.appliesCondition);
  if (keen && spec.appliesConditionOnKeen !== null) applyCondition(spec.appliesConditionOnKeen);

  // Thermal-shock pair: exactly these two interactions exist in the slice.
  let interactionStagger = false;
  if (spec.channel === "ember" && conditions.chilledTicks > 0) {
    conditions.chilledTicks = 0;
    interactionStagger = true;
    events.push(
      Object.freeze({
        applied: "staggered" as const,
        consumed: "chilled" as const,
        kind: "condition-consumed" as const,
      }),
    );
  } else if (spec.channel === "frost" && conditions.burningTicks > 0) {
    conditions.burningTicks = 0;
    conditions.exposedTicks = COMBAT_CONDITION.exposed.durationTicks;
    events.push(
      Object.freeze({
        applied: "exposed" as const,
        consumed: "burning" as const,
        kind: "condition-consumed" as const,
      }),
    );
  }
  defenderState = Object.freeze({ ...defenderState, conditions: Object.freeze(conditions) });

  // Stagger: keen mid-wind-up, any hit while Exposed, authored staggers, or the
  // ember-consumes-Chilled interaction — elites and the boss are immune.
  const shouldStagger =
    !defender.sheet.staggerImmune &&
    defenderState.ironsetTicks === 0 &&
    ((keen && defenderWasWindingUp) ||
      exposed ||
      interactionStagger ||
      (spec.staggersNonElite &&
        defender.sheet.monsterClass !== "elite" &&
        defender.sheet.monsterClass !== "boss"));
  if (shouldStagger && defenderState.health > 0) {
    defenderState = Object.freeze({
      ...defenderState,
      actionId: 0,
      actionKind: COMBAT_ACTION_STAGGERED,
      actionTicksRemaining: COMBAT_CONDITION.staggered.lockoutTicks,
      blockHeldTicks: 0,
    });
    events.push(Object.freeze({ kind: "staggered" as const }));
  }

  if (defenderState.health <= 0) {
    defenderState = Object.freeze({
      ...defenderState,
      actionKind: COMBAT_ACTION_DOWNED,
      actionTicksRemaining: 0,
      health: 0,
    });
    events.push(Object.freeze({ kind: "downed" as const }));
  }

  return Object.freeze({
    attacker: attackerState,
    baselineCheck,
    defender: defenderState,
    events: Object.freeze(events),
    outcome: keen ? "keen" : "hit",
    rngState: nextRngState,
  });
}

function blockStaminaDrain(totalRaw: number, staminaCostNumerator: number): number {
  return Math.floor(
    (Math.floor(totalRaw / COMBAT_BLOCK.staminaDrainDenominator) * staminaCostNumerator) /
      COMBAT_BLOCK.staminaCostDenominator,
  );
}

function applyBlockDrain(
  state: CombatantCombatState,
  drain: number,
  events: CombatCoreEvent[],
): CombatantCombatState {
  if (drain === 0) return state;
  if (drain >= state.stamina) {
    // The block breaks: stamina empties, Exposed applies, and re-raising is locked out.
    events.push(
      Object.freeze({ condition: "exposed" as const, kind: "condition-applied" as const }),
    );
    return Object.freeze({
      ...state,
      blockHeldTicks: 0,
      blockLockoutTicks: COMBAT_BLOCK.breakLockoutTicks,
      conditions: Object.freeze({
        ...state.conditions,
        exposedTicks: COMBAT_CONDITION.exposed.durationTicks,
      }),
      stamina: 0,
      staminaDelayTicks: COMBAT_POOLS.staminaRegenDelayTicks,
    });
  }
  return Object.freeze({
    ...state,
    stamina: state.stamina - drain,
    staminaDelayTicks: COMBAT_POOLS.staminaRegenDelayTicks,
  });
}

// Applies the non-damaging effects of a player spell cast whose active phase started
// this tick (heals, wards) and the keen-refund bookkeeping for damaging casts.
export function applySelfSpellEffects(
  state: CombatantCombatState,
  actionId: number,
  sheet: CombatantSheet,
): CombatantCombatState {
  if (actionId < PLAYER_ACTION_SLOT_BASE || actionId === PLAYER_ACTION_AETHERSPARK) return state;
  const ability = playerAbility(sheet, actionId - PLAYER_ACTION_SLOT_BASE);
  if (ability.kind === "stance") {
    return Object.freeze({
      ...state,
      ironsetTicks: IRONSET_STANCE.durationTicks,
    });
  }
  if (ability.kind !== "spell") return state;
  let next = state;
  if (ability.healPerSecond > 0) {
    next = Object.freeze({
      ...next,
      healAccumulator: 0,
      healRemainingTicks: ability.healDurationTicks,
    });
  }
  if (ability.wardAmount > 0) {
    next = Object.freeze({
      ...next,
      wardAmount: ability.wardAmount,
      wardTicks: ability.wardDurationTicks,
    });
  }
  return next;
}

// Applies Exposed from an external rule (the elite/boss break-opening) — bypasses the
// stagger-immunity gate deliberately, since the opening is those kits' intended lane.
export function applyExposedOpening(state: CombatantCombatState): CombatantCombatState {
  return Object.freeze({
    ...state,
    conditions: Object.freeze({
      ...state.conditions,
      exposedTicks: COMBAT_CONDITION.exposed.durationTicks,
    }),
  });
}

export function applyKeenSpellRefund(
  state: CombatantCombatState,
  actionId: number,
  sheet: CombatantSheet,
): CombatantCombatState {
  if (actionId < PLAYER_ACTION_SLOT_BASE || actionId === PLAYER_ACTION_AETHERSPARK) return state;
  const ability = playerAbility(sheet, actionId - PLAYER_ACTION_SLOT_BASE);
  if (ability.kind !== "spell" || ability.aetherCost === 0) return state;
  const refund = Math.floor(ability.aetherCost / COMBAT_KEEN_SPELL_REFUND_DENOMINATOR);
  return Object.freeze({
    ...state,
    aether: Math.min(sheet.maxAether, state.aether + refund),
  });
}
