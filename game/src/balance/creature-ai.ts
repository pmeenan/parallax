// Creature-AI tunables for the slice bestiary. The simulation interprets these
// records generically; world content chooses kits and packs in creature-spawns.ts.
// Timings are fixed 60 Hz simulation ticks and all ratios use integer numerators /
// denominators so behavior decisions remain replay-stable.

export const CREATURE_AI_RULES_VERSION = 2;

export type CreatureTactic = "boss" | "defender" | "flanker" | "sentinel" | "swarm";

export interface CreatureAiProfile {
  readonly attackFacingMinimumDot: number;
  readonly circleRadiusMeters: number;
  readonly decisionIntervalTicks: number;
  readonly fleePackBelow: number;
  readonly leashRadiusMeters: number;
  readonly loseInterestRadiusMeters: number;
  readonly maxConcurrentAttackers: number;
  readonly perceptionRadiusMeters: number;
  readonly preferredRangeMeters: number;
  readonly tactic: CreatureTactic;
  readonly turnRadiansPerSecond: number;
  readonly yieldHealthDenominator: number;
  readonly yieldHealthNumerator: number;
}

const profile = (value: CreatureAiProfile): CreatureAiProfile => Object.freeze(value);

export const CREATURE_AI_BY_KIT = Object.freeze({
  "burrow-gnawer": profile({
    attackFacingMinimumDot: 0.65,
    circleRadiusMeters: 0,
    decisionIntervalTicks: 10,
    fleePackBelow: 2,
    leashRadiusMeters: 34,
    loseInterestRadiusMeters: 26,
    maxConcurrentAttackers: 2,
    perceptionRadiusMeters: 14,
    preferredRangeMeters: 1.1,
    tactic: "swarm",
    turnRadiansPerSecond: 7,
    yieldHealthDenominator: 1,
    yieldHealthNumerator: 0,
  }),
  greymaw: profile({
    attackFacingMinimumDot: 0.8,
    circleRadiusMeters: 3.8,
    decisionIntervalTicks: 8,
    fleePackBelow: 0,
    leashRadiusMeters: 48,
    loseInterestRadiusMeters: 34,
    maxConcurrentAttackers: 1,
    perceptionRadiusMeters: 24,
    preferredRangeMeters: 1.5,
    tactic: "flanker",
    turnRadiansPerSecond: 4,
    yieldHealthDenominator: 1,
    yieldHealthNumerator: 0,
  }),
  "hollow-warden": profile({
    attackFacingMinimumDot: 0.9,
    circleRadiusMeters: 0,
    decisionIntervalTicks: 12,
    fleePackBelow: 0,
    leashRadiusMeters: 42,
    loseInterestRadiusMeters: 32,
    maxConcurrentAttackers: 1,
    perceptionRadiusMeters: 22,
    preferredRangeMeters: 2.1,
    tactic: "sentinel",
    turnRadiansPerSecond: 2.2,
    yieldHealthDenominator: 1,
    yieldHealthNumerator: 0,
  }),
  skitterling: profile({
    attackFacingMinimumDot: 0.65,
    circleRadiusMeters: 0,
    decisionIntervalTicks: 8,
    fleePackBelow: 0,
    leashRadiusMeters: 38,
    loseInterestRadiusMeters: 28,
    maxConcurrentAttackers: 2,
    perceptionRadiusMeters: 16,
    preferredRangeMeters: 1,
    tactic: "swarm",
    turnRadiansPerSecond: 8,
    yieldHealthDenominator: 1,
    yieldHealthNumerator: 0,
  }),
  "warden-below": profile({
    attackFacingMinimumDot: 0.92,
    circleRadiusMeters: 0,
    decisionIntervalTicks: 10,
    fleePackBelow: 0,
    leashRadiusMeters: 56,
    loseInterestRadiusMeters: 44,
    maxConcurrentAttackers: 2,
    perceptionRadiusMeters: 28,
    preferredRangeMeters: 2.3,
    tactic: "boss",
    turnRadiansPerSecond: 1.6,
    yieldHealthDenominator: 1,
    yieldHealthNumerator: 0,
  }),
  "wayland-brigand": profile({
    attackFacingMinimumDot: 0.85,
    circleRadiusMeters: 0,
    decisionIntervalTicks: 10,
    fleePackBelow: 0,
    leashRadiusMeters: 44,
    loseInterestRadiusMeters: 32,
    maxConcurrentAttackers: 1,
    perceptionRadiusMeters: 18,
    preferredRangeMeters: 1.7,
    tactic: "defender",
    turnRadiansPerSecond: 5,
    yieldHealthDenominator: 4,
    yieldHealthNumerator: 1,
  }),
} satisfies Readonly<Record<string, CreatureAiProfile>>);

export const CREATURE_AI_MOVEMENT = Object.freeze({
  arrivalMeters: 0.35,
  avoidanceRadiusMeters: 1.5,
  avoidanceWeight: 0.8,
  fallbackSteeringRadians: Object.freeze([Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]),
  returnArrivalMeters: 0.75,
});

// Stable authored-rank slots: the first pair takes opposite sides; ranks 2 and 3
// fill the perpendicular axis without reassigning survivors when a packmate falls.
export const CREATURE_AI_FLANK_ANGLES_RADIANS = Object.freeze([
  0,
  Math.PI,
  Math.PI / 2,
  -Math.PI / 2,
]);

export const CREATURE_AI_RESPAWN_AGGRO_GRACE_TICKS = 300;

export const CREATURE_AI_DEFENDER = Object.freeze({
  blockResponseDistanceMeters: 3.2,
  dodgeResponseDistanceMeters: 2.5,
  dodgeSequenceModulo: 3,
});

export const CREATURE_AI_BOSS = Object.freeze({
  enrageHealthDenominator: 3,
  enrageHealthNumerator: 1,
  enrageRecoveryDenominator: 4,
  enrageRecoveryNumerator: 3,
  summonCount: 4,
  summonHealthDenominator: 3,
  summonHealthNumerator: 2,
  summonRadiusMeters: 4,
  ventInnerRadiusMeters: 8,
  ventOuterRadiusMeters: 12,
  ventPulseTicks: 120,
  ventWarningTicks: 60,
});
