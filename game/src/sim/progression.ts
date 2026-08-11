import {
  type CombatAbilityId,
  type CombatantProfile,
  PLAYER_STARTING_PROFILE,
} from "../balance/combat";
import {
  cumulativeExperienceForLevel,
  levelForExperience,
  PROGRESSION_ABILITIES,
  PROGRESSION_ACTIVE_SLOT_COUNT,
  PROGRESSION_KNACK_SLOT_COUNT,
  PROGRESSION_LEVEL_CAP,
  type ProgressionAbilityId,
  type ProgressionAbilityKind,
  type ProgressionAttributeId,
  progressionAbilityIndex,
} from "../balance/progression";

export const PROGRESSION_STATE_BYTES = 96;
export const PROGRESSION_STARTING_LEVEL = 2;
const EMPTY_KNACK_SLOTS = Object.freeze(
  Array.from({ length: PROGRESSION_KNACK_SLOT_COUNT }, () => null),
) as readonly (ProgressionAbilityId | null)[];

export interface ProgressionState {
  readonly abilityLearnCount: number;
  readonly activeSlots: readonly (ProgressionAbilityId | null)[];
  readonly attunement: number;
  readonly attributeSpendCount: number;
  readonly experience: number;
  readonly experienceAwardCount: number;
  readonly finesse: number;
  readonly knackSlots: readonly (ProgressionAbilityId | null)[];
  readonly learnedAbilities: readonly ProgressionAbilityId[];
  readonly level: number;
  readonly levelsGained: number;
  readonly loadoutChangeCount: number;
  readonly might: number;
  readonly unspentAbilityPicks: number;
  readonly unspentAttributePoints: number;
  readonly vitality: number;
}

export interface ExperienceAwardResult {
  readonly levelsGained: number;
  readonly state: ProgressionState;
}

export function createInitialProgressionState(): ProgressionState {
  // The existing level-2 martial starter becomes the first legitimate level pick.
  // Aetherspark remains catalyst-granted and outside the 14-ability pool.
  return Object.freeze({
    abilityLearnCount: 1,
    activeSlots: Object.freeze([
      "piercing-lunge",
      null,
      null,
      null,
    ] as const satisfies readonly (ProgressionAbilityId | null)[]),
    attunement: PLAYER_STARTING_PROFILE.attunement,
    attributeSpendCount: 1,
    experience: cumulativeExperienceForLevel(PROGRESSION_STARTING_LEVEL),
    experienceAwardCount: 0,
    finesse: PLAYER_STARTING_PROFILE.finesse,
    knackSlots: EMPTY_KNACK_SLOTS,
    learnedAbilities: Object.freeze(["piercing-lunge"] as const),
    level: PROGRESSION_STARTING_LEVEL,
    levelsGained: PROGRESSION_STARTING_LEVEL - 1,
    loadoutChangeCount: 0,
    might: PLAYER_STARTING_PROFILE.might,
    unspentAbilityPicks: 0,
    unspentAttributePoints: 0,
    vitality: PLAYER_STARTING_PROFILE.vitality,
  });
}

export function awardExperience(state: ProgressionState, amount: number): ExperienceAwardResult {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Progression XP award must be a positive safe integer");
  }
  const capExperience = cumulativeExperienceForLevel(PROGRESSION_LEVEL_CAP);
  const experience = Math.min(capExperience, state.experience + amount);
  const level = levelForExperience(experience);
  const levelsGained = level - state.level;
  return Object.freeze({
    levelsGained,
    state: Object.freeze({
      ...state,
      experience,
      experienceAwardCount: state.experienceAwardCount + 1,
      level,
      levelsGained: state.levelsGained + levelsGained,
      unspentAbilityPicks: state.unspentAbilityPicks + levelsGained,
      unspentAttributePoints: state.unspentAttributePoints + levelsGained,
    }),
  });
}

export function spendAttributePoint(
  state: ProgressionState,
  attribute: ProgressionAttributeId,
): ProgressionState {
  if (state.unspentAttributePoints === 0 || state[attribute] >= 10) return state;
  return Object.freeze({
    ...state,
    [attribute]: state[attribute] + 1,
    attributeSpendCount: state.attributeSpendCount + 1,
    unspentAttributePoints: state.unspentAttributePoints - 1,
  });
}

export function learnAbility(
  state: ProgressionState,
  abilityId: ProgressionAbilityId,
): ProgressionState {
  if (state.unspentAbilityPicks === 0 || state.learnedAbilities.includes(abilityId)) return state;
  progressionAbilityIndex(abilityId);
  return Object.freeze({
    ...state,
    abilityLearnCount: state.abilityLearnCount + 1,
    learnedAbilities: Object.freeze([...state.learnedAbilities, abilityId]),
    unspentAbilityPicks: state.unspentAbilityPicks - 1,
  });
}

export function equipAbility(
  state: ProgressionState,
  kind: Exclude<ProgressionAbilityKind, "passive">,
  slot: number,
  abilityId: ProgressionAbilityId | null,
): ProgressionState {
  const slots = kind === "active" ? state.activeSlots : state.knackSlots;
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= slots.length) return state;
  if (abilityId !== null) {
    const definition = PROGRESSION_ABILITIES[progressionAbilityIndex(abilityId)];
    if (definition?.kind !== kind || !state.learnedAbilities.includes(abilityId)) return state;
  }
  const nextSlots = slots.map((candidate, index) => (index === slot ? abilityId : candidate));
  if (abilityId !== null) {
    for (let index = 0; index < nextSlots.length; index += 1) {
      if (index !== slot && nextSlots[index] === abilityId) nextSlots[index] = null;
    }
  }
  if (nextSlots.every((candidate, index) => candidate === slots[index])) return state;
  return Object.freeze({
    ...state,
    ...(kind === "active"
      ? { activeSlots: Object.freeze(nextSlots) }
      : { knackSlots: Object.freeze(nextSlots) }),
    loadoutChangeCount: state.loadoutChangeCount + 1,
  });
}

export function progressionCombatProfile(state: ProgressionState): CombatantProfile {
  const active = state.activeSlots.map((ability): CombatAbilityId | null => {
    if (ability === null) return null;
    const definition = PROGRESSION_ABILITIES[progressionAbilityIndex(ability)];
    if (definition?.kind !== "active") throw new Error("Progression active loadout is invalid");
    return ability as CombatAbilityId;
  });
  const learned = new Set(state.learnedAbilities);
  const equippedKnacks = new Set(state.knackSlots);
  return Object.freeze({
    ...PLAYER_STARTING_PROFILE,
    answeringStrike: learned.has("answering-strike"),
    attunement: state.attunement,
    finesse: state.finesse,
    level: state.level,
    loadout: Object.freeze(active),
    might: state.might,
    quietTread: equippedKnacks.has("quiet-tread"),
    vitality: state.vitality,
    wellspring: equippedKnacks.has("wellspring"),
  });
}

export function serializeProgressionState(
  view: DataView,
  offset: number,
  state: ProgressionState,
): void {
  assertProgressionState(state);
  view.setUint32(offset, state.level, true);
  view.setUint32(offset + 4, state.experience, true);
  view.setUint32(offset + 8, state.unspentAttributePoints, true);
  view.setUint32(offset + 12, state.unspentAbilityPicks, true);
  view.setUint32(offset + 16, state.might, true);
  view.setUint32(offset + 20, state.finesse, true);
  view.setUint32(offset + 24, state.vitality, true);
  view.setUint32(offset + 28, state.attunement, true);
  let learnedMask = 0;
  for (const ability of state.learnedAbilities)
    learnedMask |= 1 << progressionAbilityIndex(ability);
  view.setUint32(offset + 32, learnedMask, true);
  for (const [index, ability] of state.activeSlots.entries()) {
    view.setInt32(
      offset + 36 + index * 4,
      ability === null ? -1 : progressionAbilityIndex(ability),
      true,
    );
  }
  for (const [index, ability] of state.knackSlots.entries()) {
    view.setInt32(
      offset + 52 + index * 4,
      ability === null ? -1 : progressionAbilityIndex(ability),
      true,
    );
  }
  view.setUint32(offset + 60, state.experienceAwardCount, true);
  view.setUint32(offset + 64, state.levelsGained, true);
  view.setUint32(offset + 68, state.attributeSpendCount, true);
  view.setUint32(offset + 72, state.abilityLearnCount, true);
  view.setUint32(offset + 76, state.loadoutChangeCount, true);
}

export function deserializeProgressionState(view: DataView, offset: number): ProgressionState {
  for (let reserved = 80; reserved < PROGRESSION_STATE_BYTES; reserved += 4) {
    if (view.getUint32(offset + reserved, true) !== 0) {
      throw new Error("Game progression state has noncanonical reserved bytes");
    }
  }
  const learnedMask = view.getUint32(offset + 32, true);
  const knownMask = (1 << PROGRESSION_ABILITIES.length) - 1;
  if ((learnedMask & ~knownMask) !== 0) {
    throw new Error("Game progression state has unknown learned abilities");
  }
  const learnedAbilities = Object.freeze(
    PROGRESSION_ABILITIES.filter((_, index) => (learnedMask & (1 << index)) !== 0).map(
      ({ id }) => id,
    ),
  );
  const readSlots = (start: number, count: number): readonly (ProgressionAbilityId | null)[] =>
    Object.freeze(
      Array.from({ length: count }, (_, index) => {
        const abilityIndex = view.getInt32(offset + start + index * 4, true);
        if (abilityIndex === -1) return null;
        const ability = PROGRESSION_ABILITIES[abilityIndex];
        if (ability === undefined)
          throw new Error("Game progression loadout has an unknown ability");
        return ability.id;
      }),
    );
  const state = Object.freeze({
    abilityLearnCount: view.getUint32(offset + 72, true),
    activeSlots: readSlots(36, PROGRESSION_ACTIVE_SLOT_COUNT),
    attunement: view.getUint32(offset + 28, true),
    attributeSpendCount: view.getUint32(offset + 68, true),
    experience: view.getUint32(offset + 4, true),
    experienceAwardCount: view.getUint32(offset + 60, true),
    finesse: view.getUint32(offset + 20, true),
    knackSlots: readSlots(52, PROGRESSION_KNACK_SLOT_COUNT),
    learnedAbilities,
    level: view.getUint32(offset, true),
    levelsGained: view.getUint32(offset + 64, true),
    loadoutChangeCount: view.getUint32(offset + 76, true),
    might: view.getUint32(offset + 16, true),
    unspentAbilityPicks: view.getUint32(offset + 12, true),
    unspentAttributePoints: view.getUint32(offset + 8, true),
    vitality: view.getUint32(offset + 24, true),
  });
  assertProgressionState(state);
  return state;
}

export function assertProgressionState(state: ProgressionState): void {
  const learned = new Set(state.learnedAbilities);
  const spentAttributePoints = state.attributeSpendCount;
  const earnedPoints = state.level - 1;
  if (
    state.level !== levelForExperience(state.experience) ||
    state.experience > cumulativeExperienceForLevel(PROGRESSION_LEVEL_CAP) ||
    state.level < 1 ||
    state.level > PROGRESSION_LEVEL_CAP ||
    state.unspentAttributePoints + spentAttributePoints !== earnedPoints ||
    state.unspentAbilityPicks + state.abilityLearnCount !== earnedPoints ||
    state.abilityLearnCount !== state.learnedAbilities.length ||
    state.levelsGained !== state.level - 1 ||
    learned.size !== state.learnedAbilities.length ||
    !state.learnedAbilities.every((ability) => progressionAbilityIndex(ability) >= 0) ||
    state.activeSlots.length !== PROGRESSION_ACTIVE_SLOT_COUNT ||
    state.knackSlots.length !== PROGRESSION_KNACK_SLOT_COUNT ||
    !validEquippedSlots(state.activeSlots, "active", learned) ||
    !validEquippedSlots(state.knackSlots, "knack", learned) ||
    ![state.might, state.finesse, state.vitality, state.attunement].every(
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 10,
    ) ||
    ![
      state.experienceAwardCount,
      state.levelsGained,
      state.loadoutChangeCount,
      state.unspentAbilityPicks,
      state.unspentAttributePoints,
    ].every((value) => Number.isSafeInteger(value) && value >= 0)
  ) {
    throw new Error("Game progression state is invalid");
  }
}

function validEquippedSlots(
  slots: readonly (ProgressionAbilityId | null)[],
  kind: "active" | "knack",
  learned: ReadonlySet<ProgressionAbilityId>,
): boolean {
  const equipped = slots.filter((ability): ability is ProgressionAbilityId => ability !== null);
  return (
    new Set(equipped).size === equipped.length &&
    equipped.every((ability) => {
      const definition = PROGRESSION_ABILITIES[progressionAbilityIndex(ability)];
      return definition?.kind === kind && learned.has(ability);
    })
  );
}
