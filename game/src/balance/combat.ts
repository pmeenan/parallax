// Ruleset v2 combat tunables (D-142/D-165). game-design.md holds the formulas, shapes,
// and target bands; the values here are the authoritative tunables and move freely
// within the headless-balancer bands. All rules math is integer-only (design
// implication #8): per-second rates accrue through per-tick integer accumulators at
// SIXTIETHS_PER_SECOND, and multipliers are numerator/denominator pairs applied with
// floor division.

export const COMBAT_RULES_VERSION = 2;
export const SIM_TICKS_PER_SECOND = 60;
export const COMBAT_EQUIPMENT_DEFAULTS = Object.freeze({
  staminaCostNumerator: 4,
  weaponRangeMeters: 2.2,
});

export type DamageChannel = "aether" | "ember" | "frost" | "physical" | "venom";
export type CombatFolk = "human" | "skarn" | "wickfolk";
export type MonsterClass = "boss" | "chaff" | "common" | "elite";

export const COMBAT_CHECK = Object.freeze({
  // R is uniform in [rollMinimum, rollMinimum + rollSpan - 1] = [-8, +8].
  keenDenominator: 2,
  keenNumerator: 3,
  keenScoreThreshold: 8,
  rollMinimum: -8,
  rollSpan: 17,
});

export const COMBAT_POOLS = Object.freeze({
  aetherBase: 20,
  aetherPerAttunement: 10,
  aetherRegenCombatPerSecond: 2,
  aetherRegenRestPerSecond: 12,
  healthBase: 50,
  healthPerVitality: 10,
  staminaBase: 70,
  staminaPerVitality: 10,
  staminaRegenBlockingPerSecond: 10,
  staminaRegenDelayTicks: 30,
  staminaRegenPerSecond: 35,
});

export const COMBAT_BLOCK = Object.freeze({
  blockedDamageDenominator: 4,
  blockedDamageNumerator: 1,
  breakLockoutTicks: 30,
  caughtWindowTicks: 12,
  guardBonus: 6,
  staminaCostDenominator: 4,
  staminaDrainDenominator: 2,
});

export const COMBAT_DODGE = Object.freeze({
  avoidanceEndTick: 16,
  avoidanceStartTick: 5,
  staminaCost: 20,
  totalTicks: 24,
});

export interface CombatActionTiming {
  readonly activeTicks: number;
  readonly recoveryTicks: number;
  readonly windupTicks: number;
}

export const COMBAT_PLAYER_ATTACKS = Object.freeze({
  heavy: Object.freeze({
    activeTicks: 8,
    rawDenominator: 2,
    rawNumerator: 3,
    recoveryTicks: 26,
    staminaCost: 25,
    windupTicks: 34,
  }),
  light: Object.freeze({
    activeTicks: 6,
    rawDenominator: 1,
    rawNumerator: 1,
    recoveryTicks: 14,
    staminaCost: 0,
    windupTicks: 18,
  }),
});

export const COMBAT_CONDITION = Object.freeze({
  burning: Object.freeze({ channel: "ember" as const, damagePerSecond: 4, durationTicks: 300 }),
  chilled: Object.freeze({
    durationTicks: 360,
    recoveryDenominator: 2,
    recoveryNumerator: 3,
    staminaRegenDenominator: 2,
    staminaRegenNumerator: 1,
  }),
  envenomed: Object.freeze({ damagePerSecond: 2, durationTicks: 600 }),
  exposed: Object.freeze({ durationTicks: 240, guardPenalty: 6 }),
  staggered: Object.freeze({ lockoutTicks: 30 }),
});

// Exactly two condition interactions exist in the slice (the thermal-shock pair);
// adding one is a design change, not a content add.
export const COMBAT_CONDITION_INTERACTIONS = Object.freeze({
  emberOnChilled: Object.freeze({ applies: "staggered" as const, consumes: "chilled" as const }),
  frostOnBurning: Object.freeze({ applies: "exposed" as const, consumes: "burning" as const }),
});

export type CombatAbilityId =
  | "aetherpulse"
  | "aetherspark"
  | "cleaving-arc"
  | "emberlash"
  | "frostbind"
  | "ironset-stance"
  | "mendweave"
  | "piercing-lunge"
  | "steady-loose"
  | "wardlight";

export interface CombatSpellDefinition {
  readonly aetherCost: number;
  readonly appliesCondition: "chilled" | null;
  readonly appliesConditionOnKeen: "burning" | null;
  readonly baseDamage: number;
  readonly channel: DamageChannel;
  readonly healPerSecond: number;
  readonly healDurationTicks: number;
  readonly kind: "spell";
  readonly radiusMeters: number;
  readonly rangeMeters: number;
  readonly staggersNonElite: boolean;
  readonly timing: CombatActionTiming;
  readonly wardAmount: number;
  readonly wardDurationTicks: number;
}

export interface CombatMartialDefinition {
  readonly arcAllTargets: boolean;
  readonly ignoresHalfSoak: boolean;
  readonly kind: "martial";
  readonly lungeMeters: number;
  readonly rawDenominator: number;
  readonly rawNumerator: number;
  readonly staminaCost: number;
  readonly timing: CombatActionTiming;
}

export interface CombatStanceDefinition {
  readonly kind: "stance";
  readonly staminaCost: number;
  readonly timing: CombatActionTiming;
}

export type CombatAbilityDefinition =
  | CombatMartialDefinition
  | CombatSpellDefinition
  | CombatStanceDefinition;

const BOLT_TIMING = Object.freeze({ activeTicks: 2, recoveryTicks: 18, windupTicks: 24 });
const RITE_TIMING = Object.freeze({ activeTicks: 2, recoveryTicks: 20, windupTicks: 30 });

function spell(overrides: Partial<CombatSpellDefinition>): CombatSpellDefinition {
  return Object.freeze({
    aetherCost: 0,
    appliesCondition: null,
    appliesConditionOnKeen: null,
    baseDamage: 0,
    channel: "aether",
    healDurationTicks: 0,
    healPerSecond: 0,
    kind: "spell",
    radiusMeters: 0,
    rangeMeters: 18,
    staggersNonElite: false,
    timing: BOLT_TIMING,
    wardAmount: 0,
    wardDurationTicks: 0,
    ...overrides,
  });
}

export const COMBAT_ABILITIES: Readonly<Record<CombatAbilityId, CombatAbilityDefinition>> =
  Object.freeze({
    aetherpulse: spell({
      aetherCost: 18,
      baseDamage: 6,
      radiusMeters: 3,
      rangeMeters: 3,
      staggersNonElite: true,
    }),
    aetherspark: spell({ baseDamage: 4 }),
    "cleaving-arc": Object.freeze({
      arcAllTargets: true,
      ignoresHalfSoak: false,
      kind: "martial" as const,
      lungeMeters: 0,
      rawDenominator: 4,
      rawNumerator: 3,
      staminaCost: 35,
      timing: Object.freeze({ activeTicks: 8, recoveryTicks: 26, windupTicks: 34 }),
    }),
    emberlash: spell({
      aetherCost: 12,
      appliesConditionOnKeen: "burning",
      baseDamage: 10,
      channel: "ember",
    }),
    frostbind: spell({
      aetherCost: 15,
      appliesCondition: "chilled",
      baseDamage: 8,
      channel: "frost",
      radiusMeters: 3,
      rangeMeters: 12,
    }),
    "ironset-stance": Object.freeze({
      kind: "stance" as const,
      staminaCost: 20,
      timing: Object.freeze({ activeTicks: 1, recoveryTicks: 0, windupTicks: 1 }),
    }),
    mendweave: spell({
      aetherCost: 25,
      healDurationTicks: 360,
      healPerSecond: 5,
      timing: RITE_TIMING,
    }),
    "piercing-lunge": Object.freeze({
      arcAllTargets: false,
      ignoresHalfSoak: true,
      kind: "martial" as const,
      lungeMeters: 4,
      rawDenominator: 1,
      rawNumerator: 1,
      staminaCost: 25,
      timing: Object.freeze({ activeTicks: 6, recoveryTicks: 18, windupTicks: 22 }),
    }),
    "steady-loose": Object.freeze({
      arcAllTargets: false,
      ignoresHalfSoak: false,
      kind: "martial" as const,
      lungeMeters: 0,
      rawDenominator: 2,
      rawNumerator: 3,
      staminaCost: 15,
      timing: Object.freeze({ activeTicks: 2, recoveryTicks: 16, windupTicks: 45 }),
    }),
    wardlight: spell({
      aetherCost: 20,
      timing: RITE_TIMING,
      wardAmount: 25,
      wardDurationTicks: 1200,
    }),
  });

export const COMBAT_KEEN_SPELL_REFUND_DENOMINATOR = 2;
export const IRONSET_STANCE = Object.freeze({
  durationTicks: 240,
  guardBonus: 4,
  movementDenominator: 2,
  movementNumerator: 1,
  staminaDrainPerSecond: 5,
});

export interface MonsterAttackDefinition {
  readonly appliesConditionOnKeen: "envenomed" | null;
  readonly channel: DamageChannel;
  // Minimum ticks between uses; 0 = every rotation. Keeps ranged punctuation attacks
  // (the boss lance) from becoming a spam lane at distance.
  readonly cooldownTicks: number;
  readonly fast: boolean;
  readonly id: string;
  // 0 means the kit's melee reach; positive values are ranged attacks.
  readonly rangeMeters: number;
  readonly raw: number;
  readonly spellPotency: number | null;
  readonly staggers: boolean;
  readonly timing: CombatActionTiming;
}

export interface MonsterBreakOpening {
  readonly damageThreshold: number;
  // Attack index whose avoided (dodged) contact opens the guard; -1 for none.
  readonly onAvoidedAttackIndex: number;
  readonly windowTicks: number;
}

export interface MonsterKitDefinition {
  readonly accuracy: number;
  readonly atLevel: number;
  readonly attacks: readonly MonsterAttackDefinition[];
  // Stagger-immune kits still have an intended opening: bursting the threshold within
  // the window (or dodging the flagged attack) applies Exposed.
  readonly breakOpening: MonsterBreakOpening | null;
  readonly guard: number;
  readonly healthMax: number;
  readonly id: string;
  readonly monsterClass: MonsterClass;
  readonly moveMetersPerSecond: number;
  readonly reachMeters: number;
  readonly resist: number;
  readonly soakElemental: number;
  readonly soakPhysical: number;
  readonly staminaMax: number;
  readonly staggerImmune: boolean;
  readonly xp: number;
}

function monsterAttack(
  id: string,
  raw: number,
  windupTicks: number,
  activeTicks: number,
  recoveryTicks: number,
  overrides?: Partial<MonsterAttackDefinition>,
): MonsterAttackDefinition {
  return Object.freeze({
    appliesConditionOnKeen: null,
    channel: "physical",
    cooldownTicks: 0,
    fast: false,
    id,
    rangeMeters: 0,
    raw,
    spellPotency: null,
    staggers: false,
    timing: Object.freeze({ activeTicks, recoveryTicks, windupTicks }),
    ...overrides,
  });
}

// Bestiary kits (game-design.md table). Ratings are authored flat; attack raw is the
// final pre-soak value. Attacks tagged fast use the 24-tick wind-up floor; every other
// wind-up is at least 30 ticks.
export const MONSTER_KITS: readonly MonsterKitDefinition[] = Object.freeze([
  Object.freeze({
    accuracy: 3,
    atLevel: 2,
    attacks: Object.freeze([monsterAttack("bite", 6, 24, 4, 16, { fast: true })]),
    breakOpening: null,
    guard: 2,
    healthMax: 24,
    id: "burrow-gnawer",
    monsterClass: "chaff" as const,
    moveMetersPerSecond: 4.2,
    reachMeters: 1.2,
    resist: 3,
    soakElemental: 0,
    soakPhysical: 0,
    staminaMax: 0,
    staggerImmune: false,
    xp: 5,
  }),
  Object.freeze({
    accuracy: 4,
    atLevel: 5,
    attacks: Object.freeze([
      monsterAttack("lunge", 12, 30, 6, 24),
      monsterAttack("pounce", 16, 40, 6, 30),
    ]),
    breakOpening: null,
    guard: 3,
    healthMax: 70,
    id: "greymaw",
    monsterClass: "common" as const,
    moveMetersPerSecond: 5,
    reachMeters: 1.6,
    resist: 6,
    soakElemental: 0,
    soakPhysical: 1,
    staminaMax: 0,
    staggerImmune: false,
    xp: 15,
  }),
  Object.freeze({
    accuracy: 5,
    atLevel: 5,
    attacks: Object.freeze([monsterAttack("sword", 12, 30, 6, 20)]),
    breakOpening: null,
    guard: 3,
    healthMax: 90,
    id: "wayland-brigand",
    monsterClass: "common" as const,
    moveMetersPerSecond: 4,
    reachMeters: 1.8,
    resist: 6,
    soakElemental: 1,
    soakPhysical: 2,
    staminaMax: 70,
    staggerImmune: false,
    xp: 20,
  }),
  Object.freeze({
    accuracy: 5,
    atLevel: 8,
    attacks: Object.freeze([
      monsterAttack("venom-bite", 4, 24, 4, 12, {
        appliesConditionOnKeen: "envenomed",
        channel: "venom",
        fast: true,
      }),
    ]),
    breakOpening: null,
    guard: 4,
    healthMax: 40,
    id: "skitterling",
    monsterClass: "chaff" as const,
    moveMetersPerSecond: 4.6,
    reachMeters: 1.1,
    resist: 8,
    soakElemental: 1,
    soakPhysical: 0,
    staminaMax: 0,
    staggerImmune: false,
    xp: 4,
  }),
  Object.freeze({
    accuracy: 6,
    atLevel: 8,
    attacks: Object.freeze([
      monsterAttack("maul", 20, 44, 8, 60),
      monsterAttack("slam", 26, 54, 10, 70, { staggers: true }),
    ]),
    breakOpening: Object.freeze({
      damageThreshold: 40,
      onAvoidedAttackIndex: 1,
      windowTicks: 120,
    }),
    guard: 8,
    healthMax: 800,
    id: "hollow-warden",
    monsterClass: "elite" as const,
    moveMetersPerSecond: 2.8,
    reachMeters: 2.2,
    resist: 7,
    soakElemental: 4,
    soakPhysical: 6,
    staminaMax: 0,
    staggerImmune: true,
    xp: 60,
  }),
  Object.freeze({
    accuracy: 7,
    atLevel: 10,
    attacks: Object.freeze([
      monsterAttack("maul", 18, 44, 8, 70),
      monsterAttack("slam", 22, 54, 10, 80, { staggers: true }),
      monsterAttack("aether-lance", 14, 60, 2, 70, {
        channel: "aether",
        cooldownTicks: 300,
        rangeMeters: 12,
        spellPotency: 7,
      }),
    ]),
    breakOpening: Object.freeze({
      damageThreshold: 40,
      onAvoidedAttackIndex: 1,
      windowTicks: 120,
    }),
    guard: 7,
    healthMax: 3000,
    id: "warden-below",
    monsterClass: "boss" as const,
    moveMetersPerSecond: 3.2,
    reachMeters: 2.4,
    resist: 9,
    soakElemental: 6,
    soakPhysical: 6,
    staminaMax: 0,
    staggerImmune: true,
    xp: 400,
  }),
]);

export function monsterKitIndex(id: string): number {
  const index = MONSTER_KITS.findIndex((kit) => kit.id === id);
  if (index < 0) throw new Error(`Unknown monster kit ${id}`);
  return index;
}

export interface CombatGearProfile {
  readonly armorGuard: number;
  readonly armorSoakElemental: number;
  readonly armorSoakPhysical: number;
  readonly blockStaminaCostNumerator: number;
  readonly catalystOmniResonance: boolean;
  readonly catalystPotency: number;
  readonly catalystResonance: DamageChannel | null;
  readonly healthRegenOutOfCombat: number;
  readonly maxHealthBonus: number;
  readonly maxStaminaBonus: number;
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

export interface CombatAttributeProfile {
  readonly attunement: number;
  readonly finesse: number;
  readonly might: number;
  readonly vitality: number;
}

export interface CombatantProfile extends CombatAttributeProfile, CombatGearProfile {
  // Conditional affixes (Exceptional+ gear): single active copy each.
  readonly affixAccuracy: number;
  readonly affixBracing: boolean;
  readonly affixDamage: number;
  readonly affixNimble: boolean;
  readonly affixPotency: number;
  readonly answeringStrike: boolean;
  readonly folk: CombatFolk;
  readonly level: number;
  readonly loadout: readonly (CombatAbilityId | null)[];
  readonly quietTread: boolean;
  readonly wellspring: boolean;
}

const PROFILE_DEFAULTS = Object.freeze({
  affixAccuracy: 0,
  affixBracing: false,
  affixDamage: 0,
  affixNimble: false,
  affixPotency: 0,
  answeringStrike: false,
  blockStaminaCostNumerator: COMBAT_EQUIPMENT_DEFAULTS.staminaCostNumerator,
  catalystOmniResonance: false,
  catalystPotency: 0,
  catalystResonance: null,
  healthRegenOutOfCombat: 0,
  maxHealthBonus: 0,
  maxStaminaBonus: 0,
  quietTread: false,
  staminaRegenBonus: 0,
  weaponEmberDamage: 0,
  weaponFrostDamage: 0,
  weaponKeenCondition: null,
  weaponRangeMeters: COMBAT_EQUIPMENT_DEFAULTS.weaponRangeMeters,
  weaponRecoveryTicksBonus: 0,
  weaponStaminaCostNumerator: COMBAT_EQUIPMENT_DEFAULTS.staminaCostNumerator,
  weaponVenomDamage: 0,
  wellspring: false,
});

// The starter gear/attribute reference: level-2 human with an Ashwood focus so
// aetherwork is reachable from the first fight. The simulation's progression state
// now owns the learned abilities and four-slot runtime loadout.
export const PLAYER_STARTING_PROFILE: CombatantProfile = Object.freeze({
  ...PROFILE_DEFAULTS,
  armorGuard: 2,
  armorSoakElemental: 0,
  armorSoakPhysical: 2,
  attunement: 3,
  catalystPotency: 1,
  finesse: 4,
  folk: "human" as const,
  level: 2,
  loadout: Object.freeze(["emberlash", "piercing-lunge"] as const),
  might: 5,
  vitality: 4,
  weaponAccuracy: 1,
  weaponBase: 10,
});

export const NIMBLE_AFFIX = Object.freeze({ accuracyBonus: 2, durationTicks: 120 });
export const BRACING_AFFIX = Object.freeze({ staminaRestore: 10 });
export const ANSWERING_STRIKE_WINDOW_TICKS = 60;

export type ReferenceLoadoutId = "caster" | "hybrid" | "martial";

export const REFERENCE_LOADOUT_LEVELS: readonly number[] = Object.freeze([2, 5, 8, 10]);

// Reference builds for the headless balancer: one per archetype identity, at each
// sweep level with level-appropriate gear. Catalyst potency tiers: Ashwood +1,
// Glazed +2, Resonant +3 (tuned down from the doc's +2/+4/+6 so potency tracks
// weapon-accuracy growth and at-level spell checks stay inside the baseline band).
export const REFERENCE_LOADOUTS: Readonly<Record<ReferenceLoadoutId, readonly CombatantProfile[]>> =
  Object.freeze({
    caster: Object.freeze([
      Object.freeze({
        ...PROFILE_DEFAULTS,
        armorGuard: 1,
        armorSoakElemental: 0,
        armorSoakPhysical: 1,
        attunement: 6,
        catalystPotency: 1,
        finesse: 4,
        folk: "wickfolk" as const,
        level: 2,
        loadout: Object.freeze(["emberlash", "frostbind"] as const),
        might: 2,
        vitality: 4,
        weaponAccuracy: 1,
        weaponBase: 10,
      }),
      Object.freeze({
        ...PROFILE_DEFAULTS,
        armorGuard: 1,
        armorSoakElemental: 0,
        armorSoakPhysical: 0,
        attunement: 9,
        catalystPotency: 2,
        finesse: 5,
        folk: "wickfolk" as const,
        level: 5,
        loadout: Object.freeze(["emberlash", "frostbind", "mendweave"] as const),
        might: 2,
        vitality: 3,
        weaponAccuracy: 1,
        weaponBase: 10,
      }),
      Object.freeze({
        ...PROFILE_DEFAULTS,
        armorGuard: 2,
        armorSoakElemental: 0,
        armorSoakPhysical: 1,
        attunement: 10,
        catalystPotency: 3,
        finesse: 6,
        folk: "wickfolk" as const,
        level: 8,
        loadout: Object.freeze(["emberlash", "frostbind", "aetherpulse", "mendweave"] as const),
        might: 2,
        vitality: 4,
        weaponAccuracy: 1,
        weaponBase: 10,
      }),
      Object.freeze({
        ...PROFILE_DEFAULTS,
        affixPotency: 1,
        armorGuard: 2,
        armorSoakElemental: 1,
        armorSoakPhysical: 1,
        attunement: 10,
        catalystPotency: 3,
        finesse: 7,
        folk: "wickfolk" as const,
        level: 10,
        loadout: Object.freeze(["emberlash", "frostbind", "mendweave", "wardlight"] as const),
        might: 2,
        vitality: 5,
        weaponAccuracy: 1,
        weaponBase: 10,
      }),
    ]),
    hybrid: Object.freeze([
      Object.freeze({
        ...PROFILE_DEFAULTS,
        armorGuard: 2,
        armorSoakElemental: 0,
        armorSoakPhysical: 2,
        attunement: 3,
        catalystPotency: 1,
        finesse: 5,
        folk: "human" as const,
        level: 2,
        loadout: Object.freeze(["piercing-lunge"] as const),
        might: 4,
        vitality: 4,
        weaponAccuracy: 1,
        weaponBase: 10,
      }),
      Object.freeze({
        ...PROFILE_DEFAULTS,
        affixPotency: 1,
        armorGuard: 2,
        armorSoakElemental: 0,
        armorSoakPhysical: 2,
        attunement: 6,
        catalystPotency: 2,
        finesse: 5,
        folk: "human" as const,
        level: 5,
        loadout: Object.freeze(["piercing-lunge", "emberlash"] as const),
        might: 4,
        vitality: 4,
        weaponAccuracy: 1,
        weaponBase: 12,
      }),
      Object.freeze({
        ...PROFILE_DEFAULTS,
        affixPotency: 1,
        answeringStrike: true,
        armorGuard: 3,
        armorSoakElemental: 1,
        armorSoakPhysical: 2,
        attunement: 7,
        catalystPotency: 3,
        finesse: 6,
        folk: "human" as const,
        level: 8,
        loadout: Object.freeze(["piercing-lunge", "emberlash", "frostbind"] as const),
        might: 5,
        vitality: 4,
        weaponAccuracy: 2,
        weaponBase: 12,
      }),
      Object.freeze({
        ...PROFILE_DEFAULTS,
        affixDamage: 2,
        affixPotency: 1,
        answeringStrike: true,
        armorGuard: 3,
        armorSoakElemental: 1,
        armorSoakPhysical: 3,
        attunement: 7,
        catalystPotency: 3,
        finesse: 7,
        folk: "human" as const,
        level: 10,
        loadout: Object.freeze(["piercing-lunge", "emberlash", "frostbind", "mendweave"] as const),
        might: 5,
        vitality: 6,
        weaponAccuracy: 2,
        weaponBase: 14,
      }),
    ]),
    martial: Object.freeze([
      Object.freeze({
        ...PROFILE_DEFAULTS,
        armorGuard: 2,
        armorSoakElemental: 0,
        armorSoakPhysical: 2,
        attunement: 3,
        finesse: 4,
        folk: "human" as const,
        level: 2,
        loadout: Object.freeze(["piercing-lunge"] as const),
        might: 5,
        vitality: 4,
        weaponAccuracy: 1,
        weaponBase: 10,
      }),
      Object.freeze({
        ...PROFILE_DEFAULTS,
        armorGuard: 3,
        armorSoakElemental: 0,
        armorSoakPhysical: 2,
        attunement: 3,
        finesse: 5,
        folk: "human" as const,
        level: 5,
        loadout: Object.freeze(["piercing-lunge", "cleaving-arc"] as const),
        might: 6,
        vitality: 5,
        weaponAccuracy: 1,
        weaponBase: 12,
      }),
      Object.freeze({
        ...PROFILE_DEFAULTS,
        answeringStrike: true,
        armorGuard: 3,
        armorSoakElemental: 1,
        armorSoakPhysical: 3,
        attunement: 3,
        finesse: 6,
        folk: "human" as const,
        level: 8,
        loadout: Object.freeze(["piercing-lunge", "cleaving-arc"] as const),
        might: 7,
        vitality: 6,
        weaponAccuracy: 2,
        weaponBase: 14,
      }),
      Object.freeze({
        ...PROFILE_DEFAULTS,
        affixDamage: 2,
        answeringStrike: true,
        armorGuard: 4,
        armorSoakElemental: 1,
        armorSoakPhysical: 3,
        attunement: 3,
        finesse: 7,
        folk: "human" as const,
        level: 10,
        loadout: Object.freeze(["piercing-lunge", "cleaving-arc"] as const),
        might: 8,
        vitality: 6,
        weaponAccuracy: 2,
        weaponBase: 14,
      }),
    ]),
  });

// Balancer assertion bands (game-design.md "Balance validation"). Hit-chance bands are
// expressed in exact seventeenths of the roll span; a chance is in band when
// minimumSeventeenths <= successfulRolls <= maximumSeventeenths.
export const COMBAT_BALANCE_BANDS = Object.freeze({
  bossDurationSeconds: Object.freeze({ maximum: 420, minimum: 180 }),
  bossWinRatePermille: Object.freeze({ maximum: 800, minimum: 400 }),
  chaffTtkHits: Object.freeze({ maximum: 3, minimum: 2 }),
  commonTtkHits: Object.freeze({ maximum: 8, minimum: 4 }),
  eliteDurationSeconds: Object.freeze({ maximum: 90, minimum: 30 }),
  monsterBaselineHitPermille: Object.freeze({ maximum: 650, minimum: 450 }),
  playerBaselineHitPermille: Object.freeze({ maximum: 850, minimum: 700 }),
  survivabilityHits: Object.freeze({
    caster: Object.freeze({ maximum: 7, minimum: 4 }),
    hybrid: Object.freeze({ maximum: 9, minimum: 5 }),
    martial: Object.freeze({ maximum: 10, minimum: 6 }),
  }),
  winRateVsCommonsPermilleMinimum: 950,
});
