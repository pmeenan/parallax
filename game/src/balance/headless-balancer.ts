// The headless balancer (D-165): deterministic Node-side sweep of reference loadouts
// × levels × bestiary kits over seeded duels, plus closed-form band checks. This is
// the balance instrument game-design.md's "Balance validation" section defines — the
// fast inner loop that runs in the ordinary unit gate. The arena is a deliberate 1-D
// range model (distance between the duelists); rules resolution is the real combat
// core, so hit chances, TTK, resources, conditions, and openings are all live.
import {
  applyExposedOpening,
  applyKeenSpellRefund,
  applySelfSpellEffects,
  COMBAT_ACTION_ACTIVE,
  COMBAT_ACTION_DOWNED,
  COMBAT_ACTION_IDLE,
  COMBAT_ACTION_RECOVERY,
  COMBAT_ACTION_WINDUP,
  type CombatantCombatState,
  type CombatantSheet,
  createCombatantState,
  deriveMonsterSheet,
  derivePlayerSheet,
  exactSuccessSeventeenths,
  monsterAttackSpec,
  nextRandomU32,
  PLAYER_ACTION_AETHERSPARK,
  PLAYER_ACTION_DODGE,
  PLAYER_ACTION_HEAVY,
  PLAYER_ACTION_LIGHT,
  PLAYER_ACTION_SLOT_BASE,
  playerActionTiming,
  playerAttackSpec,
  resolveAttack,
  startMonsterAttack,
  startPlayerAction,
  tickCombatant,
} from "../sim/combat-core";
import {
  COMBAT_ABILITIES,
  COMBAT_BALANCE_BANDS,
  type CombatAbilityId,
  type CombatantProfile,
  MONSTER_KITS,
  type MonsterKitDefinition,
  REFERENCE_LOADOUT_LEVELS,
  REFERENCE_LOADOUTS,
  type ReferenceLoadoutId,
  SIM_TICKS_PER_SECOND,
} from "./combat";
import { levelForExperience, SCRIPTED_SLICE_XP_LEDGER } from "./progression";

export const BALANCER_SEEDS_PER_MATCHUP = 32;
export const BALANCER_TIMEOUT_TICKS = 600 * SIM_TICKS_PER_SECOND;
const PLAYER_MOVE_METERS_PER_SECOND = 7.5;
const PLAYER_MELEE_REACH = 2.2;
const STARTING_DISTANCE_METERS = 14;
const MINIMUM_DISTANCE_METERS = 1;
const CASTER_PREFERRED_RANGE = 8;
// Deterministic imperfect-play model: longer telegraphs are defended more reliably —
// the ruleset's own claim that wind-ups are readable. Blocks are raised late enough
// to land inside the caught-block window.
const SHORT_TELEGRAPH_PATTERN = Object.freeze(["dodge", "block", "none"] as const);
const LONG_TELEGRAPH_PATTERN = Object.freeze([
  "dodge",
  "block",
  "dodge",
  "block",
  "dodge",
  "none",
] as const);
const LONG_TELEGRAPH_WINDUP_TICKS = 40;
const DODGE_REACTION_TICKS = 14;
const BLOCK_REACTION_TICKS = 10;

type RotationEntry = CombatAbilityId | "heavy" | "light";

const ROTATIONS: Readonly<Record<ReferenceLoadoutId, readonly RotationEntry[]>> = Object.freeze({
  caster: Object.freeze(["frostbind", "emberlash", "emberlash"] as const),
  hybrid: Object.freeze(["light", "frostbind", "emberlash", "light", "heavy"] as const),
  martial: Object.freeze(["light", "light", "heavy"] as const),
});

const PRIMARY_ATTACK: Readonly<Record<ReferenceLoadoutId, RotationEntry>> = Object.freeze({
  caster: "emberlash",
  hybrid: "light",
  martial: "light",
});

export interface DuelOutcome {
  readonly durationTicks: number;
  readonly monsterBaselineAttempts: number;
  readonly monsterBaselineSuccesses: number;
  readonly playerActionUse: Readonly<Record<string, number>>;
  readonly playerBaselineAttempts: number;
  readonly playerBaselineSuccesses: number;
  readonly playerDamageByAction: Readonly<Record<string, number>>;
  readonly playerExposedHits: number;
  readonly playerInteractionsTriggered: number;
  readonly playerResourceStarvedTicks: number;
  readonly winner: "monster" | "player" | "timeout";
}

export interface MatchupReport {
  readonly atLevel: "at" | "over" | "under";
  readonly kitId: string;
  readonly level: number;
  readonly loadoutId: ReferenceLoadoutId;
  readonly meanDurationSeconds: number;
  readonly meanWinDurationSeconds: number;
  readonly monsterRealizedBaselinePermille: number;
  readonly playerRealizedBaselinePermille: number;
  readonly proxies: Readonly<{
    readonly actionUse: Readonly<Record<string, number>>;
    readonly damageByAction: Readonly<Record<string, number>>;
    readonly exposedHits: number;
    readonly interactionsTriggered: number;
    readonly resourceStarvedPermille: number;
  }>;
  readonly winRatePermille: number;
}

export interface BalanceReport {
  readonly matchups: readonly MatchupReport[];
  readonly seedsPerMatchup: number;
  readonly violations: readonly string[];
  readonly xpPacing: Readonly<{
    readonly completionExperience: number;
    readonly completionLevel: number;
  }>;
}

interface DuelistState {
  combat: CombatantCombatState;
  readonly sheet: CombatantSheet;
}

function rotationActionId(entry: RotationEntry, profile: CombatantProfile): number | null {
  if (entry === "light") return PLAYER_ACTION_LIGHT;
  if (entry === "heavy") return PLAYER_ACTION_HEAVY;
  const slot = profile.loadout.indexOf(entry);
  return slot < 0 ? null : PLAYER_ACTION_SLOT_BASE + slot;
}

function actionLabel(actionId: number, profile: CombatantProfile): string {
  if (actionId === PLAYER_ACTION_LIGHT) return "light";
  if (actionId === PLAYER_ACTION_HEAVY) return "heavy";
  if (actionId === PLAYER_ACTION_DODGE) return "dodge";
  if (actionId === PLAYER_ACTION_AETHERSPARK) return "aetherspark";
  return profile.loadout[actionId - PLAYER_ACTION_SLOT_BASE] ?? `slot-${actionId}`;
}

export function runDuel(
  profile: CombatantProfile,
  loadoutId: ReferenceLoadoutId,
  kitIndex: number,
  seed: number,
): DuelOutcome {
  const kit = MONSTER_KITS[kitIndex];
  if (kit === undefined) throw new Error(`Unknown balancer kit index ${kitIndex}`);
  const playerSheet = derivePlayerSheet(profile);
  const monsterSheet = deriveMonsterSheet(kitIndex);
  const player: DuelistState = { combat: createCombatantState(playerSheet), sheet: playerSheet };
  const monster: DuelistState = { combat: createCombatantState(monsterSheet), sheet: monsterSheet };
  const rotation = ROTATIONS[loadoutId]
    .map((entry) => rotationActionId(entry, profile))
    .filter((actionId): actionId is number => actionId !== null);
  if (rotation.length === 0) rotation.push(PLAYER_ACTION_LIGHT);
  let rngState = seed >>> 0 || 0x2545_f491;
  let distance = STARTING_DISTANCE_METERS;
  let rotationIndex = 0;
  let telegraphCount = 0;
  let monsterCursor = 0;
  let monsterAttackCooldown = 0;
  let breakDamage = 0;
  let breakWindowTicks = 0;
  let playerBaselineAttempts = 0;
  let playerBaselineSuccesses = 0;
  let monsterBaselineAttempts = 0;
  let monsterBaselineSuccesses = 0;
  let playerExposedHits = 0;
  let playerInteractionsTriggered = 0;
  let playerResourceStarvedTicks = 0;
  const playerActionUse: Record<string, number> = {};
  const playerDamageByAction: Record<string, number> = {};
  let tick = 0;
  const desiredRange = loadoutId === "caster" ? CASTER_PREFERRED_RANGE : PLAYER_MELEE_REACH - 0.4;
  // Players fight deliberately only when the kit actually threatens them; weak chaff
  // gets traded into freely.
  const maximumKitRaw = Math.max(...kit.attacks.map((attack) => attack.raw));
  const deliberate = maximumKitRaw * 8 > playerSheet.maxHealth;

  while (tick < BALANCER_TIMEOUT_TICKS) {
    tick += 1;

    // --- Player decision ------------------------------------------------------------
    const monsterWindingUp = monster.combat.actionKind === COMBAT_ACTION_WINDUP;
    const incomingWindup = kit.attacks[monster.combat.actionId]?.timing.windupTicks ?? 0;
    const pattern =
      incomingWindup >= LONG_TELEGRAPH_WINDUP_TICKS
        ? LONG_TELEGRAPH_PATTERN
        : SHORT_TELEGRAPH_PATTERN;
    let defense: "block" | "dodge" | "none" = pattern[telegraphCount % pattern.length] ?? "none";
    // Spell-type attacks cannot be blocked; a player who knows the kit dodges instead.
    if (
      defense === "block" &&
      monsterWindingUp &&
      (kit.attacks[monster.combat.actionId]?.spellPotency ?? null) !== null
    ) {
      defense = "dodge";
    }
    const reactionWindow =
      monsterWindingUp &&
      monster.combat.actionTicksRemaining <=
        (defense === "block" ? BLOCK_REACTION_TICKS : DODGE_REACTION_TICKS);
    let blockHeld = false;
    if (reactionWindow && defense === "block") blockHeld = true;
    // Keep the block held through the incoming active phase once raised.
    if (
      defense === "block" &&
      player.combat.blockHeldTicks > 0 &&
      (monsterWindingUp || monster.combat.actionKind === COMBAT_ACTION_ACTIVE)
    ) {
      blockHeld = true;
    }
    if (player.combat.actionKind === COMBAT_ACTION_IDLE && !blockHeld) {
      if (reactionWindow && defense === "dodge") {
        const dodge = startPlayerAction(player.combat, player.sheet, PLAYER_ACTION_DODGE);
        if (dodge.started) {
          player.combat = dodge.state;
          playerActionUse.dodge = (playerActionUse.dodge ?? 0) + 1;
        }
      } else {
        let desired = rotation[rotationIndex % rotation.length] ?? PLAYER_ACTION_LIGHT;
        // Sustain first: heal when hurt, ward up when the pool allows.
        const mendweaveSlot = profile.loadout.indexOf("mendweave");
        const wardlightSlot = profile.loadout.indexOf("wardlight");
        if (
          mendweaveSlot >= 0 &&
          player.combat.health * 5 < player.sheet.maxHealth * 4 &&
          player.combat.healRemainingTicks === 0 &&
          player.combat.aether >= 25
        ) {
          desired = PLAYER_ACTION_SLOT_BASE + mendweaveSlot;
        } else if (
          wardlightSlot >= 0 &&
          player.combat.wardAmount === 0 &&
          player.combat.aether >= 45
        ) {
          desired = PLAYER_ACTION_SLOT_BASE + wardlightSlot;
        }
        const fallbackAction =
          player.sheet.hasCatalyst && loadoutId === "caster"
            ? PLAYER_ACTION_AETHERSPARK
            : PLAYER_ACTION_LIGHT;
        // Reserve the heal budget: rotation spells never burn the last 25 aether when
        // the build carries Mendweave.
        if (
          mendweaveSlot >= 0 &&
          desired >= PLAYER_ACTION_SLOT_BASE &&
          desired !== PLAYER_ACTION_SLOT_BASE + mendweaveSlot &&
          desired !== PLAYER_ACTION_AETHERSPARK
        ) {
          const desiredAbilityId = profile.loadout[desired - PLAYER_ACTION_SLOT_BASE];
          const desiredAbility =
            desiredAbilityId == null ? undefined : COMBAT_ABILITIES[desiredAbilityId];
          if (
            desiredAbility !== undefined &&
            desiredAbility.kind === "spell" &&
            player.combat.aether < desiredAbility.aetherCost + 25
          ) {
            desired = fallbackAction;
          }
        }
        // Deliberate play: fit the full commitment (through recovery) into the window
        // before the next possible contact — attack in openings, defend telegraphs.
        const minimumWindup = Math.min(...kit.attacks.map((attack) => attack.timing.windupTicks));
        const timeUntilContact =
          monster.combat.actionKind === COMBAT_ACTION_WINDUP
            ? monster.combat.actionTicksRemaining
            : monster.combat.actionKind === COMBAT_ACTION_ACTIVE
              ? 0
              : monster.combat.actionKind === COMBAT_ACTION_IDLE
                ? minimumWindup
                : monster.combat.actionTicksRemaining + minimumWindup;
        const fits = (actionId: number): boolean => {
          if (!deliberate) return true;
          const timing = playerActionTiming(player.sheet, actionId);
          return (
            timing.windupTicks + timing.activeTicks + timing.recoveryTicks + 4 <= timeUntilContact
          );
        };
        // Window fallback: if the preferred action cannot finish before the next
        // contact, jab with the quick option instead of standing idle.
        let windowChoice = desired;
        if (!fits(windowChoice)) windowChoice = fallbackAction;
        if (!fits(windowChoice)) {
          playerActionUse.wait = (playerActionUse.wait ?? 0) + 1;
        } else {
          const windowSpec = playerAttackSpec(player.sheet, windowChoice);
          // Self-casts (heals, wards) need no target range.
          const inRange =
            windowSpec === null
              ? true
              : windowSpec.checkType === "spell"
                ? distance <= 12
                : distance <= PLAYER_MELEE_REACH + lungeReach(windowChoice, profile);
          if (inRange) {
            let chosen = windowChoice;
            let attempt = startPlayerAction(player.combat, player.sheet, chosen);
            if (!attempt.started && chosen !== fallbackAction) {
              // Affordability fallback: melee builds jab, catalyst builds spark.
              chosen = fallbackAction;
              attempt = startPlayerAction(player.combat, player.sheet, chosen);
              if (attempt.started) playerResourceStarvedTicks += 1;
            }
            if (attempt.started) {
              player.combat = attempt.state;
              rotationIndex += 1;
              const label = actionLabel(chosen, profile);
              playerActionUse[label] = (playerActionUse[label] ?? 0) + 1;
            } else {
              playerResourceStarvedTicks += 1;
            }
          }
        }
      }
    }

    // --- Player tick and contact ----------------------------------------------------
    const playerTiming =
      player.combat.actionKind === COMBAT_ACTION_WINDUP ||
      player.combat.actionKind === COMBAT_ACTION_ACTIVE
        ? playerActionTiming(player.sheet, player.combat.actionId)
        : null;
    const playerTicked = tickCombatant(player.combat, player.sheet, playerTiming, {
      blockHeld,
      inCombat: true,
    });
    player.combat = playerTicked.state;
    if (playerTicked.downed) break;
    if (playerTicked.activeStartedActionId !== -1) {
      const actionId = playerTicked.activeStartedActionId;
      player.combat = applySelfSpellEffects(player.combat, actionId, player.sheet);
      const spec = playerAttackSpec(player.sheet, actionId);
      if (spec !== null) {
        if (lungeReach(actionId, profile) > 0 && distance > PLAYER_MELEE_REACH) {
          distance = Math.max(MINIMUM_DISTANCE_METERS, Math.min(distance, 1.5));
        }
        const inRange =
          spec.checkType === "spell" ? distance <= 12 : distance <= PLAYER_MELEE_REACH + 0.6;
        if (inRange && monster.combat.actionKind !== COMBAT_ACTION_DOWNED) {
          const wasExposed = monster.combat.conditions.exposedTicks > 0;
          const resolution = resolveAttack(
            rngState,
            Object.freeze({
              sheet: player.sheet,
              spellPotencyOverride: null,
              state: player.combat,
            }),
            Object.freeze({ sheet: monster.sheet, state: monster.combat }),
            spec,
          );
          rngState = resolution.rngState;
          player.combat = resolution.attacker;
          monster.combat = resolution.defender;
          if (resolution.baselineCheck) {
            playerBaselineAttempts += 1;
            if (resolution.outcome === "hit" || resolution.outcome === "keen") {
              playerBaselineSuccesses += 1;
            }
          }
          const hitEvent = resolution.events.find((event) => event.kind === "hit") as
            | { amount?: number }
            | undefined;
          const dealt = hitEvent?.amount ?? 0;
          if (dealt > 0) {
            const label = actionLabel(actionId, profile);
            playerDamageByAction[label] = (playerDamageByAction[label] ?? 0) + dealt;
            if (wasExposed) playerExposedHits += 1;
            if (kit.breakOpening !== null && monster.combat.actionKind !== COMBAT_ACTION_DOWNED) {
              if (breakWindowTicks === 0) breakWindowTicks = kit.breakOpening.windowTicks;
              breakDamage += dealt;
              if (
                breakDamage >= kit.breakOpening.damageThreshold &&
                monster.combat.conditions.exposedTicks === 0
              ) {
                monster.combat = applyExposedOpening(monster.combat);
                breakDamage = 0;
                breakWindowTicks = 0;
              }
            }
          }
          playerInteractionsTriggered += resolution.events.filter(
            (event) => event.kind === "condition-consumed",
          ).length;
          if (resolution.outcome === "keen" && spec.checkType === "spell") {
            player.combat = applyKeenSpellRefund(player.combat, actionId, player.sheet);
          }
          if (monster.combat.actionKind === COMBAT_ACTION_DOWNED) break;
        }
      }
    }

    // --- Monster decision, tick, and contact ----------------------------------------
    if (breakWindowTicks > 0) {
      breakWindowTicks -= 1;
      if (breakWindowTicks === 0) breakDamage = 0;
    }
    if (monsterAttackCooldown > 0) monsterAttackCooldown -= 1;
    if (monster.combat.actionKind === COMBAT_ACTION_IDLE) {
      const attackIndex = chooseAttack(kit, monsterCursor, distance, monsterAttackCooldown);
      if (attackIndex !== -1) {
        const started = startMonsterAttack(monster.combat, monster.sheet, attackIndex);
        if (started.started) {
          monster.combat = started.state;
          monsterCursor = (monsterCursor + 1) % kit.attacks.length;
          telegraphCount += 1;
          const chosen = kit.attacks[attackIndex];
          if (chosen !== undefined && chosen.cooldownTicks > 0) {
            monsterAttackCooldown = chosen.cooldownTicks;
          }
        }
      }
    }
    const monsterAttack = kit.attacks[monster.combat.actionId];
    const monsterTiming =
      monster.combat.actionKind === COMBAT_ACTION_WINDUP ||
      monster.combat.actionKind === COMBAT_ACTION_ACTIVE
        ? (monsterAttack?.timing ?? null)
        : null;
    const monsterTicked = tickCombatant(monster.combat, monster.sheet, monsterTiming, {
      blockHeld: false,
      inCombat: true,
    });
    monster.combat = monsterTicked.state;
    if (monsterTicked.downed) break;
    if (monsterTicked.activeStartedActionId !== -1) {
      const contact = kit.attacks[monsterTicked.activeStartedActionId];
      if (contact !== undefined) {
        const range = contact.rangeMeters > 0 ? contact.rangeMeters : kit.reachMeters + 0.6;
        if (distance <= range && player.combat.actionKind !== COMBAT_ACTION_DOWNED) {
          const spec = monsterAttackSpec(monster.sheet, monsterTicked.activeStartedActionId);
          const resolution = resolveAttack(
            rngState,
            Object.freeze({
              sheet: monster.sheet,
              spellPotencyOverride: contact.spellPotency,
              state: monster.combat,
            }),
            Object.freeze({ sheet: player.sheet, state: player.combat }),
            spec,
          );
          rngState = resolution.rngState;
          monster.combat = resolution.attacker;
          player.combat = resolution.defender;
          if (resolution.baselineCheck) {
            monsterBaselineAttempts += 1;
            if (resolution.outcome === "hit" || resolution.outcome === "keen") {
              monsterBaselineSuccesses += 1;
            }
          }
          if (
            resolution.outcome === "avoided" &&
            kit.breakOpening !== null &&
            monsterTicked.activeStartedActionId === kit.breakOpening.onAvoidedAttackIndex
          ) {
            monster.combat = applyExposedOpening(monster.combat);
            breakDamage = 0;
            breakWindowTicks = 0;
          }
          if (player.combat.actionKind === COMBAT_ACTION_DOWNED) break;
        }
      }
    }

    // --- Movement (1-D range model) -------------------------------------------------
    const playerMoves =
      player.combat.actionKind === COMBAT_ACTION_IDLE ||
      player.combat.actionKind === COMBAT_ACTION_RECOVERY;
    if (playerMoves && distance > desiredRange && !blockHeld) {
      distance -= PLAYER_MOVE_METERS_PER_SECOND / SIM_TICKS_PER_SECOND;
    }
    if (monster.combat.actionKind === COMBAT_ACTION_IDLE && distance > kit.reachMeters) {
      distance -= kit.moveMetersPerSecond / SIM_TICKS_PER_SECOND;
    }
    distance = Math.max(MINIMUM_DISTANCE_METERS, distance);
  }

  const winner =
    monster.combat.actionKind === COMBAT_ACTION_DOWNED
      ? ("player" as const)
      : player.combat.actionKind === COMBAT_ACTION_DOWNED
        ? ("monster" as const)
        : ("timeout" as const);
  return Object.freeze({
    durationTicks: tick,
    monsterBaselineAttempts,
    monsterBaselineSuccesses,
    playerActionUse: Object.freeze(playerActionUse),
    playerBaselineAttempts,
    playerBaselineSuccesses,
    playerDamageByAction: Object.freeze(playerDamageByAction),
    playerExposedHits,
    playerInteractionsTriggered,
    playerResourceStarvedTicks,
    winner,
  });
}

function lungeReach(actionId: number, profile: CombatantProfile): number {
  if (actionId < PLAYER_ACTION_SLOT_BASE || actionId === PLAYER_ACTION_AETHERSPARK) return 0;
  return profile.loadout[actionId - PLAYER_ACTION_SLOT_BASE] === "piercing-lunge" ? 4 : 0;
}

function chooseAttack(
  kit: MonsterKitDefinition,
  cursor: number,
  distance: number,
  cooldownTicks: number,
): number {
  for (let offset = 0; offset < kit.attacks.length; offset += 1) {
    const index = (cursor + offset) % kit.attacks.length;
    const attack = kit.attacks[index];
    if (attack === undefined) continue;
    if (attack.cooldownTicks > 0 && cooldownTicks > 0) continue;
    const range = attack.rangeMeters > 0 ? attack.rangeMeters : kit.reachMeters;
    if (distance <= range) return index;
  }
  return -1;
}

export function runHeadlessBalanceSweep(
  seedsPerMatchup: number = BALANCER_SEEDS_PER_MATCHUP,
): BalanceReport {
  const matchups: MatchupReport[] = [];
  const loadoutIds = Object.keys(REFERENCE_LOADOUTS).toSorted() as ReferenceLoadoutId[];
  for (const [loadoutIndex, loadoutId] of loadoutIds.entries()) {
    const profiles = REFERENCE_LOADOUTS[loadoutId];
    for (const [levelIndex, level] of REFERENCE_LOADOUT_LEVELS.entries()) {
      const profile = profiles[levelIndex];
      if (profile === undefined || profile.level !== level) {
        throw new Error(`Reference loadout ${loadoutId} is missing level ${level}`);
      }
      for (const [kitIndex, kit] of MONSTER_KITS.entries()) {
        if (kit.monsterClass === "boss" && level !== 10) continue;
        const outcomes: DuelOutcome[] = [];
        let seedState =
          (0x5eed_ba1a ^
            ((loadoutIndex + 1) * 0x9e37_79b9) ^
            ((levelIndex + 1) * 0x85eb_ca6b) ^
            ((kitIndex + 1) * 0xc2b2_ae35)) >>>
          0;
        for (let seedIndex = 0; seedIndex < seedsPerMatchup; seedIndex += 1) {
          seedState = nextRandomU32(seedState);
          outcomes.push(runDuel(profile, loadoutId, kitIndex, seedState));
        }
        matchups.push(buildMatchupReport(loadoutId, level, kit, outcomes));
      }
    }
  }
  const completionExperience = Object.values(SCRIPTED_SLICE_XP_LEDGER).reduce(
    (sum, amount) => sum + amount,
    0,
  );
  const completionLevel = levelForExperience(completionExperience);
  const violations = assertBalanceBands(matchups);
  if (completionLevel < 9 || completionLevel > 10) {
    violations.push(
      `scripted slice XP pacing: level ${completionLevel} at ${completionExperience} XP`,
    );
  }
  return Object.freeze({
    matchups: Object.freeze(matchups),
    seedsPerMatchup,
    violations: Object.freeze(violations),
    xpPacing: Object.freeze({ completionExperience, completionLevel }),
  });
}

function buildMatchupReport(
  loadoutId: ReferenceLoadoutId,
  level: number,
  kit: MonsterKitDefinition,
  outcomes: readonly DuelOutcome[],
): MatchupReport {
  const wins = outcomes.filter((outcome) => outcome.winner === "player");
  const totalTicks = outcomes.reduce((sum, outcome) => sum + outcome.durationTicks, 0);
  const winTicks = wins.reduce((sum, outcome) => sum + outcome.durationTicks, 0);
  const playerAttempts = outcomes.reduce((sum, o) => sum + o.playerBaselineAttempts, 0);
  const playerSuccesses = outcomes.reduce((sum, o) => sum + o.playerBaselineSuccesses, 0);
  const monsterAttempts = outcomes.reduce((sum, o) => sum + o.monsterBaselineAttempts, 0);
  const monsterSuccesses = outcomes.reduce((sum, o) => sum + o.monsterBaselineSuccesses, 0);
  const starved = outcomes.reduce((sum, o) => sum + o.playerResourceStarvedTicks, 0);
  const actionUse: Record<string, number> = {};
  const damageByAction: Record<string, number> = {};
  for (const outcome of outcomes) {
    for (const [label, count] of Object.entries(outcome.playerActionUse)) {
      actionUse[label] = (actionUse[label] ?? 0) + count;
    }
    for (const [label, amount] of Object.entries(outcome.playerDamageByAction)) {
      damageByAction[label] = (damageByAction[label] ?? 0) + amount;
    }
  }
  return Object.freeze({
    atLevel: level === kit.atLevel ? "at" : level > kit.atLevel ? "over" : "under",
    kitId: kit.id,
    level,
    loadoutId,
    meanDurationSeconds: totalTicks / outcomes.length / SIM_TICKS_PER_SECOND,
    meanWinDurationSeconds: wins.length === 0 ? 0 : winTicks / wins.length / SIM_TICKS_PER_SECOND,
    monsterRealizedBaselinePermille:
      monsterAttempts === 0 ? 0 : Math.round((monsterSuccesses * 1000) / monsterAttempts),
    playerRealizedBaselinePermille:
      playerAttempts === 0 ? 0 : Math.round((playerSuccesses * 1000) / playerAttempts),
    proxies: Object.freeze({
      actionUse: Object.freeze(actionUse),
      damageByAction: Object.freeze(damageByAction),
      exposedHits: outcomes.reduce((sum, o) => sum + o.playerExposedHits, 0),
      interactionsTriggered: outcomes.reduce((sum, o) => sum + o.playerInteractionsTriggered, 0),
      resourceStarvedPermille: totalTicks === 0 ? 0 : Math.round((starved * 1000) / totalTicks),
    }),
    winRatePermille: Math.round((wins.length * 1000) / outcomes.length),
  });
}

function permilleFromSeventeenths(successes: number): number {
  return Math.round((successes * 1000) / 17);
}

// Closed-form and simulated band assertions. Returns human-readable violations; the
// unit gate expects none.
export function assertBalanceBands(matchups: readonly MatchupReport[]): string[] {
  const violations: string[] = [];
  const bands = COMBAT_BALANCE_BANDS;
  const loadoutIds = Object.keys(REFERENCE_LOADOUTS).toSorted() as ReferenceLoadoutId[];

  // Closed-form lane checks at each archetype's at-level matchup.
  for (const loadoutId of loadoutIds) {
    for (const [levelIndex, level] of REFERENCE_LOADOUT_LEVELS.entries()) {
      const profile = REFERENCE_LOADOUTS[loadoutId][levelIndex];
      if (profile === undefined) continue;
      const sheet = derivePlayerSheet(profile);
      for (const kit of MONSTER_KITS) {
        if (kit.atLevel !== level) continue;
        const assertable = kit.monsterClass === "chaff" || kit.monsterClass === "common";
        if (!assertable) continue;
        // Player lanes: every rotation entry the policy uses.
        for (const entry of ROTATIONS[loadoutId]) {
          const actionId = rotationActionId(entry, profile);
          if (actionId === null) continue;
          const spec = playerAttackSpec(sheet, actionId);
          if (spec === null) continue;
          const rating = spec.checkType === "weapon" ? sheet.accuracy : sheet.potency;
          const defend = spec.checkType === "weapon" ? kit.guard : kit.resist;
          const permille = permilleFromSeventeenths(exactSuccessSeventeenths(rating, defend));
          if (
            permille < bands.playerBaselineHitPermille.minimum ||
            permille > bands.playerBaselineHitPermille.maximum
          ) {
            violations.push(
              `player lane ${loadoutId} L${level} ${String(entry)} vs ${kit.id}: ${permille}‰`,
            );
          }
        }
        // Monster lanes.
        for (const attack of kit.attacks) {
          const rating = attack.spellPotency ?? kit.accuracy;
          const defend = attack.spellPotency === null ? sheet.guard : sheet.resist;
          const permille = permilleFromSeventeenths(exactSuccessSeventeenths(rating, defend));
          if (
            permille < bands.monsterBaselineHitPermille.minimum ||
            permille > bands.monsterBaselineHitPermille.maximum
          ) {
            violations.push(
              `monster lane ${kit.id} ${attack.id} vs ${loadoutId} L${level}: ${permille}‰`,
            );
          }
        }
        // Closed-form TTK with the loadout's primary attack.
        const primaryActionId = rotationActionId(PRIMARY_ATTACK[loadoutId], profile);
        const primarySpec =
          primaryActionId === null ? null : playerAttackSpec(sheet, primaryActionId);
        if (primarySpec !== null) {
          const soak = primarySpec.channel === "physical" ? kit.soakPhysical : kit.soakElemental;
          const dealt = Math.max(1, primarySpec.raw - soak);
          const hits = Math.ceil(kit.healthMax / dealt);
          const band = kit.monsterClass === "chaff" ? bands.chaffTtkHits : bands.commonTtkHits;
          if (hits < band.minimum || hits > band.maximum) {
            violations.push(`ttk ${loadoutId} L${level} vs ${kit.id}: ${hits} hits`);
          }
        }
        // Survivability envelope vs the kit's primary (first) attack — commons only.
        if (kit.monsterClass === "common") {
          const kitPrimary = kit.attacks[0];
          if (kitPrimary !== undefined) {
            const soak =
              kitPrimary.channel === "physical"
                ? profile.armorSoakPhysical
                : profile.armorSoakElemental;
            const dealt = Math.max(1, kitPrimary.raw - soak);
            const maxHealth = sheet.maxHealth;
            const hits = Math.ceil(maxHealth / dealt);
            const envelope = bands.survivabilityHits[loadoutId];
            if (hits < envelope.minimum || hits > envelope.maximum) {
              violations.push(`survivability ${loadoutId} L${level} vs ${kit.id}: ${hits} hits`);
            }
          }
        }
      }
    }
  }

  // Simulated bands.
  const bossReports = matchups.filter((matchup) => matchup.kitId === "warden-below");
  for (const matchup of matchups) {
    const kit = MONSTER_KITS.find((candidate) => candidate.id === matchup.kitId);
    if (kit === undefined) continue;
    const assertableClass = kit.monsterClass === "chaff" || kit.monsterClass === "common";
    if (assertableClass && (matchup.atLevel === "at" || matchup.atLevel === "over")) {
      if (matchup.winRatePermille < bands.winRateVsCommonsPermilleMinimum) {
        violations.push(
          `win rate ${matchup.loadoutId} L${matchup.level} vs ${matchup.kitId}: ${matchup.winRatePermille}‰`,
        );
      }
    }
    if (kit.monsterClass === "elite" && matchup.atLevel === "at") {
      if (
        matchup.meanWinDurationSeconds < bands.eliteDurationSeconds.minimum ||
        matchup.meanWinDurationSeconds > bands.eliteDurationSeconds.maximum
      ) {
        violations.push(
          `elite duration ${matchup.loadoutId} L${matchup.level} vs ${matchup.kitId}: ${matchup.meanWinDurationSeconds.toFixed(1)} s`,
        );
      }
    }
  }
  if (bossReports.length > 0) {
    const pooledWins = bossReports.reduce((sum, report) => sum + report.winRatePermille, 0);
    const pooledWinRate = Math.round(pooledWins / bossReports.length);
    if (
      pooledWinRate < bands.bossWinRatePermille.minimum ||
      pooledWinRate > bands.bossWinRatePermille.maximum
    ) {
      violations.push(`boss win rate pooled across builds: ${pooledWinRate}‰`);
    }
    const winning = bossReports.filter((report) => report.meanWinDurationSeconds > 0);
    const meanWinDuration =
      winning.length === 0
        ? 0
        : winning.reduce((sum, report) => sum + report.meanWinDurationSeconds, 0) / winning.length;
    if (
      meanWinDuration < bands.bossDurationSeconds.minimum ||
      meanWinDuration > bands.bossDurationSeconds.maximum
    ) {
      violations.push(`boss mean win duration: ${meanWinDuration.toFixed(1)} s`);
    }
  }
  return violations;
}
