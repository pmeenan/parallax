// Ruleset-v2 progression tunables (D-165). Stable array order is part of the
// save/command vocabulary; append new identities rather than reordering them.

export const PROGRESSION_RULES_VERSION = 1;
export const PROGRESSION_LEVEL_CAP = 10;
export const PROGRESSION_ACTIVE_SLOT_COUNT = 4;
export const PROGRESSION_KNACK_SLOT_COUNT = 2;
export const PROGRESSION_RESHAPE_MARK_COST = 25;
export const WELLSPRING_STAMINA_REGEN_PER_SECOND = 10;
export const QUIET_TREAD_PERCEPTION = Object.freeze({
  denominator: 4,
  numerator: 3,
});

export type ProgressionAttributeId = "attunement" | "finesse" | "might" | "vitality";
export type ProgressionAbilityKind = "active" | "knack" | "passive";
export type ProgressionAbilityId =
  | "cleaving-arc"
  | "answering-strike"
  | "piercing-lunge"
  | "ironset-stance"
  | "steady-loose"
  | "emberlash"
  | "frostbind"
  | "aetherpulse"
  | "mendweave"
  | "wardlight"
  | "foragers-eye"
  | "wellspring"
  | "quiet-tread"
  | "tinkers-thrift";

export interface ProgressionAbilityDefinition {
  readonly id: ProgressionAbilityId;
  readonly kind: ProgressionAbilityKind;
}

export const PROGRESSION_ATTRIBUTES: readonly ProgressionAttributeId[] = Object.freeze([
  "might",
  "finesse",
  "vitality",
  "attunement",
]);

export const PROGRESSION_ABILITIES: readonly ProgressionAbilityDefinition[] = Object.freeze([
  Object.freeze({ id: "cleaving-arc", kind: "active" as const }),
  Object.freeze({ id: "answering-strike", kind: "passive" as const }),
  Object.freeze({ id: "piercing-lunge", kind: "active" as const }),
  Object.freeze({ id: "ironset-stance", kind: "active" as const }),
  Object.freeze({ id: "steady-loose", kind: "active" as const }),
  Object.freeze({ id: "emberlash", kind: "active" as const }),
  Object.freeze({ id: "frostbind", kind: "active" as const }),
  Object.freeze({ id: "aetherpulse", kind: "active" as const }),
  Object.freeze({ id: "mendweave", kind: "active" as const }),
  Object.freeze({ id: "wardlight", kind: "active" as const }),
  Object.freeze({ id: "foragers-eye", kind: "knack" as const }),
  Object.freeze({ id: "wellspring", kind: "knack" as const }),
  Object.freeze({ id: "quiet-tread", kind: "knack" as const }),
  Object.freeze({ id: "tinkers-thrift", kind: "knack" as const }),
]);

// D-165's scripted-completion pacing ledger. Combat is the authored slice encounter
// roster; quest and landmark totals use the v2 starting awards. The balancer asserts
// that this ordinary (not exhaustive-grind) route lands inside the level 9-10 band.
export const SCRIPTED_SLICE_XP_LEDGER = Object.freeze({
  combat: 1_638,
  discovery: 375,
  mainArc: 1_025,
  sideQuests: 925,
});

export function experienceCostForNextLevel(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1 || level >= PROGRESSION_LEVEL_CAP) return 0;
  return 100 * level;
}

export function cumulativeExperienceForLevel(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1 || level > PROGRESSION_LEVEL_CAP) {
    throw new Error(`Progression level ${level} is invalid`);
  }
  return (100 * level * (level - 1)) / 2;
}

export function levelForExperience(experience: number): number {
  if (!Number.isSafeInteger(experience) || experience < 0) {
    throw new Error("Progression experience is invalid");
  }
  let level = 1;
  while (level < PROGRESSION_LEVEL_CAP && experience >= cumulativeExperienceForLevel(level + 1)) {
    level += 1;
  }
  return level;
}

export function progressionAbilityIndex(id: ProgressionAbilityId): number {
  const index = PROGRESSION_ABILITIES.findIndex((ability) => ability.id === id);
  if (index < 0) throw new Error(`Unknown progression ability ${id}`);
  return index;
}
