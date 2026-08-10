// Sim-worker combat system: binds the pure combat core to world space — monster
// entities, soft-lock hit detection, player intent, respawn, and the canonical binary
// state block appended to the M3 save payload. Deterministic: fixed iteration order,
// named seeded RNG streams (`combat` live, `loot` reserved), no wall clock.
import {
  COMBAT_ABILITIES,
  type CombatantProfile,
  type CombatSpellDefinition,
  MONSTER_KITS,
  PLAYER_STARTING_PROFILE,
} from "../balance/combat";
import {
  applyExposedOpening,
  applyKeenSpellRefund,
  applySelfSpellEffects,
  COMBAT_ACTION_ACTIVE,
  COMBAT_ACTION_DODGE,
  COMBAT_ACTION_DOWNED,
  COMBAT_ACTION_IDLE,
  COMBAT_ACTION_STAGGERED,
  COMBAT_ACTION_WINDUP,
  type CombatantCombatState,
  type CombatantSheet,
  createCombatantState,
  deriveMonsterSheet,
  derivePlayerSheet,
  monsterAttackSpec,
  PLAYER_ACTION_AETHERSPARK,
  PLAYER_ACTION_DODGE,
  PLAYER_ACTION_HEAVY,
  PLAYER_ACTION_LIGHT,
  PLAYER_ACTION_SLOT_BASE,
  playerAbility,
  playerActionTiming,
  playerAttackSpec,
  resolveAttack,
  startMonsterAttack,
  startPlayerAction,
  tickCombatant,
} from "./combat-core";

export const MONSTER_ENTITY_ID_START = 2_000;
export const MAXIMUM_ALIVE_MONSTERS = 12;
export const PLAYER_MELEE_REACH_METERS = 2.2;
export const PLAYER_MELEE_ARC_MINIMUM_DOT = 0.5;
export const PLAYER_RESPAWN_TICKS = 90;
export const MONSTER_CORPSE_TICKS = 300;
export const PACK_AGGRO_RADIUS_METERS = 16;
export const COMBAT_PROXIMITY_METERS = 30;
export const ACTION_QUEUE_TICKS = 30;

// Input bit vocabulary shared with the player input command.
export const COMBAT_PRESSED_LIGHT = 1;
export const COMBAT_PRESSED_HEAVY = 2;
export const COMBAT_PRESSED_DODGE = 4;
export const COMBAT_PRESSED_SLOT_1 = 8;
export const COMBAT_PRESSED_SLOT_2 = 16;
export const COMBAT_PRESSED_SLOT_3 = 32;
export const COMBAT_PRESSED_SLOT_4 = 64;
export const COMBAT_PRESSED_AETHERSPARK = 128;
// Greybox dev affordance: spawns a sparring monster ahead of the player. Authored
// world spawns arrive with the creature-AI item; this stays for greybox testing.
export const COMBAT_PRESSED_DEBUG_SPAWN = 256;
export const COMBAT_PRESSED_MASK = 511;

export interface MonsterEntry {
  readonly aggro: boolean;
  readonly attackCooldownTicks: number;
  readonly attackCursor: number;
  readonly breakDamage: number;
  readonly breakWindowTicks: number;
  readonly combat: CombatantCombatState;
  readonly corpseTicks: number;
  readonly entityId: number;
  readonly kitIndex: number;
  readonly position: readonly [number, number, number];
  readonly yawRadians: number;
}

export interface M3CombatCounters {
  readonly checksResolved: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly deflections: number;
  readonly hitsLanded: number;
  readonly keens: number;
  readonly monstersDefeated: number;
  readonly playerDefeats: number;
  readonly staggers: number;
}

export interface M3CombatState {
  readonly blockHeld: boolean;
  readonly combatRngState: number;
  readonly counters: M3CombatCounters;
  readonly lootRngState: number;
  readonly monsters: readonly MonsterEntry[];
  readonly player: CombatantCombatState;
  readonly playerDownTicks: number;
  readonly queuedActionId: number;
  readonly queuedTicks: number;
  readonly spawnCounter: number;
}

export interface CombatWorldView {
  readonly groundHeight: (x: number, z: number) => number;
  readonly maximumX: number;
  readonly maximumZ: number;
  readonly minimumX: number;
  readonly minimumZ: number;
  readonly obstacles: readonly Readonly<{
    readonly center: readonly [number, number, number];
    readonly size: readonly [number, number, number];
  }>[];
}

export interface CombatEventRecord {
  readonly kind: string;
  readonly values: readonly [number, number, number, number];
}

export interface CombatStepResult {
  readonly events: readonly CombatEventRecord[];
  readonly playerPosition: readonly [number, number, number];
  readonly respawnPlayer: boolean;
  readonly state: M3CombatState;
}

export const PLAYER_COMBAT_PROFILE: CombatantProfile = PLAYER_STARTING_PROFILE;
export const PLAYER_COMBAT_SHEET: CombatantSheet = derivePlayerSheet(PLAYER_COMBAT_PROFILE);

interface MutableMonster {
  aggro: boolean;
  attackCooldownTicks: number;
  attackCursor: number;
  breakDamage: number;
  breakWindowTicks: number;
  combat: CombatantCombatState;
  corpseTicks: number;
  entityId: number;
  kitIndex: number;
  position: readonly [number, number, number];
  yawRadians: number;
}
const MONSTER_SHEETS: readonly CombatantSheet[] = Object.freeze(
  MONSTER_KITS.map((_, index) => deriveMonsterSheet(index)),
);
const MONSTER_RADIUS_METERS = 0.6;
const MONSTER_HALF_HEIGHT_METERS = 0.9;

const EVENT_KIND_BY_CORE = Object.freeze({
  avoided: "combat.avoided",
  blocked: "combat.blocked",
  "condition-applied": "combat.condition",
  "condition-consumed": "combat.condition",
  deflected: "combat.deflected",
  downed: "combat.defeated",
  hit: "combat.hit",
  resisted: "combat.resisted",
  staggered: "combat.staggered",
  "ward-absorbed": "combat.ward",
});

const CONDITION_CODES = Object.freeze({
  burning: 1,
  chilled: 2,
  envenomed: 3,
  exposed: 4,
  staggered: 5,
});
const CHANNEL_CODES = Object.freeze({ aether: 4, ember: 1, frost: 2, physical: 0, venom: 3 });

export function createInitialM3CombatState(seed: number): M3CombatState {
  return Object.freeze({
    blockHeld: false,
    combatRngState: (seed ^ 0x6d2b_79f5) >>> 0 || 0x6d2b_79f5,
    counters: Object.freeze({
      checksResolved: 0,
      damageDealt: 0,
      damageTaken: 0,
      deflections: 0,
      hitsLanded: 0,
      keens: 0,
      monstersDefeated: 0,
      playerDefeats: 0,
      staggers: 0,
    }),
    lootRngState: (seed ^ 0x1656_67b1) >>> 0 || 0x1656_67b1,
    monsters: Object.freeze([]),
    player: createCombatantState(PLAYER_COMBAT_SHEET),
    playerDownTicks: 0,
    queuedActionId: -1,
    queuedTicks: 0,
    spawnCounter: 0,
  });
}

export function applyCombatInput(
  state: M3CombatState,
  pressedBits: number,
  blockHeld: boolean,
): M3CombatState {
  const pressedAction = firstPressedAction(pressedBits);
  if (pressedAction === -1 && blockHeld === state.blockHeld) return state;
  return Object.freeze({
    ...state,
    blockHeld,
    queuedActionId: pressedAction === -1 ? state.queuedActionId : pressedAction,
    queuedTicks: pressedAction === -1 ? state.queuedTicks : ACTION_QUEUE_TICKS,
  });
}

function firstPressedAction(pressedBits: number): number {
  if ((pressedBits & COMBAT_PRESSED_LIGHT) !== 0) return PLAYER_ACTION_LIGHT;
  if ((pressedBits & COMBAT_PRESSED_HEAVY) !== 0) return PLAYER_ACTION_HEAVY;
  if ((pressedBits & COMBAT_PRESSED_DODGE) !== 0) return PLAYER_ACTION_DODGE;
  if ((pressedBits & COMBAT_PRESSED_SLOT_1) !== 0) return PLAYER_ACTION_SLOT_BASE;
  if ((pressedBits & COMBAT_PRESSED_SLOT_2) !== 0) return PLAYER_ACTION_SLOT_BASE + 1;
  if ((pressedBits & COMBAT_PRESSED_SLOT_3) !== 0) return PLAYER_ACTION_SLOT_BASE + 2;
  if ((pressedBits & COMBAT_PRESSED_SLOT_4) !== 0) return PLAYER_ACTION_SLOT_BASE + 3;
  if ((pressedBits & COMBAT_PRESSED_AETHERSPARK) !== 0) return PLAYER_ACTION_AETHERSPARK;
  return -1;
}

export function spawnMonster(
  state: M3CombatState,
  kitIndex: number,
  x: number,
  z: number,
  world: CombatWorldView,
): Readonly<{ entityId: number; state: M3CombatState }> | null {
  const kit = MONSTER_KITS[kitIndex];
  const sheet = MONSTER_SHEETS[kitIndex];
  if (kit === undefined || sheet === undefined) return null;
  const alive = state.monsters.filter((entry) => entry.combat.actionKind !== COMBAT_ACTION_DOWNED);
  if (alive.length >= MAXIMUM_ALIVE_MONSTERS) return null;
  // The serialized roster is a fixed block: when retained corpses would overflow it,
  // release the oldest corpse to make room for the replacement.
  let roster = state.monsters;
  if (roster.length >= MAXIMUM_MONSTER_ENTRIES) {
    const corpseIndex = roster.findIndex(
      (entry) => entry.combat.actionKind === COMBAT_ACTION_DOWNED,
    );
    if (corpseIndex < 0) return null;
    roster = Object.freeze(roster.filter((_, index) => index !== corpseIndex));
  }
  const clampedX = Math.fround(Math.max(world.minimumX + 1, Math.min(world.maximumX - 1, x)));
  const clampedZ = Math.fround(Math.max(world.minimumZ + 1, Math.min(world.maximumZ - 1, z)));
  const entityId = MONSTER_ENTITY_ID_START + state.spawnCounter;
  const entry: MonsterEntry = Object.freeze({
    aggro: false,
    attackCooldownTicks: 0,
    attackCursor: 0,
    breakDamage: 0,
    breakWindowTicks: 0,
    combat: createCombatantState(sheet),
    corpseTicks: 0,
    entityId,
    kitIndex,
    position: Object.freeze([
      clampedX,
      Math.fround(world.groundHeight(clampedX, clampedZ) + MONSTER_HALF_HEIGHT_METERS),
      clampedZ,
    ]) as readonly [number, number, number],
    yawRadians: 0,
  });
  return Object.freeze({
    entityId,
    state: Object.freeze({
      ...state,
      monsters: Object.freeze([...roster, entry]),
      spawnCounter: state.spawnCounter + 1,
    }),
  });
}

// The per-tick movement profile the character controller applies to player input:
// committed actions root the player, dodging dashes, blocking walks.
export function playerMovementProfile(
  state: M3CombatState,
): Readonly<{ denominator: number; numerator: number }> {
  const kind = state.player.actionKind;
  if (
    kind === COMBAT_ACTION_WINDUP ||
    kind === COMBAT_ACTION_ACTIVE ||
    kind === COMBAT_ACTION_STAGGERED ||
    kind === COMBAT_ACTION_DOWNED
  ) {
    return Object.freeze({ denominator: 1, numerator: 0 });
  }
  if (kind === COMBAT_ACTION_DODGE) return Object.freeze({ denominator: 1, numerator: 2 });
  if (state.player.blockHeldTicks > 0) return Object.freeze({ denominator: 2, numerator: 1 });
  return Object.freeze({ denominator: 1, numerator: 1 });
}

export function stepM3Combat(
  state: M3CombatState,
  world: CombatWorldView,
  playerPosition: readonly [number, number, number],
  playerYawRadians: number,
  tickSeconds: number,
): CombatStepResult {
  const events: CombatEventRecord[] = [];
  let combatRngState = state.combatRngState;
  const counters = { ...state.counters };
  let player = state.player;
  let playerDownTicks = state.playerDownTicks;
  let queuedActionId = state.queuedActionId;
  let queuedTicks = state.queuedTicks;
  let respawnPlayer = false;
  let position = playerPosition;
  const monsters: MutableMonster[] = state.monsters.map((entry) => ({ ...entry }));
  const inCombat = monsters.some(
    (entry) =>
      entry.aggro &&
      entry.combat.actionKind !== COMBAT_ACTION_DOWNED &&
      horizontalDistance(entry.position, position) <= COMBAT_PROXIMITY_METERS,
  );

  // Player: queued action attempts, then the tick advance and contact resolution.
  if (player.actionKind !== COMBAT_ACTION_DOWNED) {
    if (queuedActionId !== -1) {
      const attempt = startPlayerAction(player, PLAYER_COMBAT_SHEET, queuedActionId);
      if (attempt.started) {
        player = attempt.state;
        const timing = playerActionTiming(PLAYER_COMBAT_SHEET, queuedActionId);
        events.push(record("combat.attack-started", 1, queuedActionId, timing.windupTicks, 0));
        queuedActionId = -1;
        queuedTicks = 0;
      } else {
        queuedTicks -= 1;
        if (queuedTicks <= 0) {
          queuedActionId = -1;
          queuedTicks = 0;
        }
      }
    }
    const timing =
      player.actionKind === COMBAT_ACTION_WINDUP || player.actionKind === COMBAT_ACTION_ACTIVE
        ? playerActionTiming(PLAYER_COMBAT_SHEET, player.actionId)
        : null;
    const ticked = tickCombatant(player, PLAYER_COMBAT_SHEET, timing, {
      blockHeld: state.blockHeld,
      inCombat,
    });
    player = ticked.state;
    if (ticked.downed) {
      counters.playerDefeats += 1;
      events.push(record("combat.defeated", 1, 0, 0, 0));
    }
    if (ticked.activeStartedActionId !== -1) {
      const resolved = resolvePlayerContact(
        player,
        ticked.activeStartedActionId,
        monsters,
        position,
        playerYawRadians,
        world,
        combatRngState,
        counters,
        events,
      );
      player = resolved.player;
      combatRngState = resolved.rngState;
      position = resolved.playerPosition;
    }
  } else {
    playerDownTicks += 1;
    if (playerDownTicks >= PLAYER_RESPAWN_TICKS) {
      player = createCombatantState(PLAYER_COMBAT_SHEET);
      playerDownTicks = 0;
      respawnPlayer = true;
      events.push(record("combat.respawned", 1, 0, 0, 0));
      for (const entry of monsters) entry.aggro = false;
    }
  }

  // Monsters: fixed array order.
  for (const entry of monsters) {
    const sheet = MONSTER_SHEETS[entry.kitIndex];
    const kit = MONSTER_KITS[entry.kitIndex];
    if (sheet === undefined || kit === undefined) continue;
    if (entry.combat.actionKind === COMBAT_ACTION_DOWNED) {
      entry.corpseTicks += 1;
      continue;
    }
    if (entry.breakWindowTicks > 0) {
      entry.breakWindowTicks -= 1;
      if (entry.breakWindowTicks === 0) entry.breakDamage = 0;
    }
    if (entry.attackCooldownTicks > 0) entry.attackCooldownTicks -= 1;
    const attack = kit.attacks[entry.combat.actionId];
    const timing =
      entry.combat.actionKind === COMBAT_ACTION_WINDUP ||
      entry.combat.actionKind === COMBAT_ACTION_ACTIVE
        ? (attack?.timing ?? null)
        : null;
    const ticked = tickCombatant(entry.combat, sheet, timing, {
      blockHeld: false,
      inCombat: entry.aggro,
    });
    entry.combat = ticked.state;
    if (ticked.downed) {
      counters.monstersDefeated += 1;
      events.push(record("combat.defeated", entry.entityId, 1, 0, 0));
      continue;
    }
    if (ticked.activeStartedActionId !== -1 && player.actionKind !== COMBAT_ACTION_DOWNED) {
      const contactAttack = kit.attacks[ticked.activeStartedActionId];
      if (contactAttack !== undefined) {
        const range =
          contactAttack.rangeMeters > 0 ? contactAttack.rangeMeters : kit.reachMeters + 0.6;
        if (horizontalDistance(entry.position, position) <= range) {
          const spec = monsterAttackSpec(sheet, ticked.activeStartedActionId);
          const resolution = resolveAttack(
            combatRngState,
            Object.freeze({
              sheet,
              spellPotencyOverride: contactAttack.spellPotency,
              state: entry.combat,
            }),
            Object.freeze({ sheet: PLAYER_COMBAT_SHEET, state: player }),
            spec,
          );
          combatRngState = resolution.rngState;
          entry.combat = resolution.attacker;
          player = resolution.defender;
          accumulateEvents(
            counters,
            resolution.events,
            entry.entityId,
            1,
            spec.channel,
            events,
            false,
          );
          // A dodged break-opening attack (the slam) exposes the attacker.
          if (
            resolution.outcome === "avoided" &&
            kit.breakOpening !== null &&
            ticked.activeStartedActionId === kit.breakOpening.onAvoidedAttackIndex
          ) {
            entry.combat = applyExposedOpening(entry.combat);
            entry.breakDamage = 0;
            entry.breakWindowTicks = 0;
            events.push(record("combat.condition", entry.entityId, CONDITION_CODES.exposed, 1, 0));
          }
        }
      }
    }
    if (player.actionKind === COMBAT_ACTION_DOWNED) continue;
    // Minimal combat-dummy behavior: aggroed monsters face, approach, and swing on a
    // fixed rotation. Perception, flee, and pack tactics are the creature-AI item.
    if (!entry.aggro || entry.combat.actionKind !== COMBAT_ACTION_IDLE) continue;
    const distance = horizontalDistance(entry.position, position);
    const deltaX = position[0] - entry.position[0];
    const deltaZ = position[2] - entry.position[2];
    entry.yawRadians = Math.fround(Math.atan2(deltaX, deltaZ));
    const nextAttackIndex = chooseMonsterAttack(
      kit,
      entry.attackCursor,
      distance,
      entry.attackCooldownTicks,
    );
    if (nextAttackIndex !== -1) {
      const started = startMonsterAttack(entry.combat, sheet, nextAttackIndex);
      if (started.started) {
        entry.combat = started.state;
        entry.attackCursor = (entry.attackCursor + 1) % kit.attacks.length;
        const startedAttack = kit.attacks[nextAttackIndex];
        if (startedAttack !== undefined && startedAttack.cooldownTicks > 0) {
          entry.attackCooldownTicks = startedAttack.cooldownTicks;
        }
        const chosen = kit.attacks[nextAttackIndex];
        events.push(
          record(
            "combat.attack-started",
            entry.entityId,
            nextAttackIndex,
            chosen?.timing.windupTicks ?? 0,
            0,
          ),
        );
      }
    } else if (distance > kit.reachMeters) {
      const step = Math.min(
        kit.moveMetersPerSecond * tickSeconds,
        distance - kit.reachMeters + 0.1,
      );
      const nextX = Math.fround(entry.position[0] + (deltaX / distance) * step);
      const nextZ = Math.fround(entry.position[2] + (deltaZ / distance) * step);
      if (!overlapsAnyObstacle(nextX, nextZ, world)) {
        const clampedX = Math.max(world.minimumX + 1, Math.min(world.maximumX - 1, nextX));
        const clampedZ = Math.max(world.minimumZ + 1, Math.min(world.maximumZ - 1, nextZ));
        entry.position = Object.freeze([
          Math.fround(clampedX),
          Math.fround(world.groundHeight(clampedX, clampedZ) + MONSTER_HALF_HEIGHT_METERS),
          Math.fround(clampedZ),
        ]) as readonly [number, number, number];
      }
    }
  }

  // Remove long-settled corpses while preserving order.
  const retained = monsters.filter(
    (entry) =>
      entry.combat.actionKind !== COMBAT_ACTION_DOWNED || entry.corpseTicks < MONSTER_CORPSE_TICKS,
  );

  return Object.freeze({
    events: Object.freeze(events),
    playerPosition: position,
    respawnPlayer,
    state: Object.freeze({
      ...state,
      combatRngState,
      counters: Object.freeze(counters),
      monsters: Object.freeze(retained.map((entry) => Object.freeze({ ...entry }))),
      player,
      playerDownTicks,
      queuedActionId,
      queuedTicks,
    }),
  });
}

function chooseMonsterAttack(
  kit: (typeof MONSTER_KITS)[number],
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

interface PlayerContactResult {
  readonly player: CombatantCombatState;
  readonly playerPosition: readonly [number, number, number];
  readonly rngState: number;
}

function resolvePlayerContact(
  playerState: CombatantCombatState,
  actionId: number,
  monsters: MutableMonster[],
  playerPosition: readonly [number, number, number],
  playerYawRadians: number,
  world: CombatWorldView,
  rngState: number,
  counters: { -readonly [Key in keyof M3CombatCounters]: number },
  events: CombatEventRecord[],
): PlayerContactResult {
  let player = playerState;
  let nextRngState = rngState;
  let position = playerPosition;
  if (actionId === PLAYER_ACTION_DODGE) {
    return Object.freeze({ player, playerPosition: position, rngState: nextRngState });
  }
  player = applySelfSpellEffects(player, actionId, PLAYER_COMBAT_SHEET);
  const spec = playerAttackSpec(PLAYER_COMBAT_SHEET, actionId);
  if (spec === null) {
    return Object.freeze({ player, playerPosition: position, rngState: nextRngState });
  }
  const ability =
    actionId >= PLAYER_ACTION_SLOT_BASE && actionId !== PLAYER_ACTION_AETHERSPARK
      ? playerAbility(PLAYER_COMBAT_SHEET, actionId - PLAYER_ACTION_SLOT_BASE)
      : null;
  const lungeMeters = ability !== null && ability.kind === "martial" ? ability.lungeMeters : 0;
  const arcAll = ability !== null && ability.kind === "martial" && ability.arcAllTargets;
  const isSpell = spec.checkType === "spell";
  const aetherspark = COMBAT_ABILITIES.aetherspark;
  const spellDefinition: CombatSpellDefinition | null =
    actionId === PLAYER_ACTION_AETHERSPARK
      ? aetherspark.kind === "spell"
        ? aetherspark
        : null
      : ability !== null && ability.kind === "spell"
        ? ability
        : null;
  const range = isSpell
    ? (spellDefinition?.rangeMeters ?? PLAYER_MELEE_REACH_METERS)
    : PLAYER_MELEE_REACH_METERS + lungeMeters;
  const facingX = Math.sin(playerYawRadians);
  const facingZ = Math.cos(playerYawRadians);
  const alive = monsters.filter((entry) => entry.combat.actionKind !== COMBAT_ACTION_DOWNED);
  const candidates = alive
    .map((entry) => {
      const deltaX = entry.position[0] - position[0];
      const deltaZ = entry.position[2] - position[2];
      const distance = Math.hypot(deltaX, deltaZ);
      const dot = distance > 0 ? (deltaX * facingX + deltaZ * facingZ) / distance : 1;
      return { distance, dot, entry };
    })
    .filter(({ distance, dot }) => {
      if (distance > range + MONSTER_RADIUS_METERS) return false;
      if (isSpell) return dot >= 0;
      return dot >= PLAYER_MELEE_ARC_MINIMUM_DOT;
    })
    .toSorted((left, right) =>
      left.distance !== right.distance
        ? left.distance - right.distance
        : left.entry.entityId - right.entry.entityId,
    );
  if (candidates.length === 0) {
    return Object.freeze({ player, playerPosition: position, rngState: nextRngState });
  }
  const nearest = candidates[0];
  if (nearest === undefined) {
    return Object.freeze({ player, playerPosition: position, rngState: nextRngState });
  }
  // A lunge closes toward the first target before contact.
  if (lungeMeters > 0 && nearest.distance > PLAYER_MELEE_REACH_METERS) {
    const advance = Math.min(lungeMeters, nearest.distance - 1.2);
    const stepX = ((nearest.entry.position[0] - position[0]) / nearest.distance) * advance;
    const stepZ = ((nearest.entry.position[2] - position[2]) / nearest.distance) * advance;
    const nextX = Math.fround(
      Math.max(world.minimumX + 1, Math.min(world.maximumX - 1, position[0] + stepX)),
    );
    const nextZ = Math.fround(
      Math.max(world.minimumZ + 1, Math.min(world.maximumZ - 1, position[2] + stepZ)),
    );
    if (!overlapsAnyObstacle(nextX, nextZ, world)) {
      position = Object.freeze([
        nextX,
        Math.fround(world.groundHeight(nextX, nextZ) + 0.9),
        nextZ,
      ]) as readonly [number, number, number];
    }
  }
  let targets = arcAll ? candidates : [nearest];
  if (isSpell && spellDefinition !== null && spellDefinition.radiusMeters > 0) {
    const center =
      spellDefinition.rangeMeters <= spellDefinition.radiusMeters
        ? position
        : nearest.entry.position;
    targets = candidates.filter(
      ({ entry }) => horizontalDistance(entry.position, center) <= spellDefinition.radiusMeters,
    );
    if (targets.length === 0) targets = [nearest];
  }
  for (const target of targets) {
    const sheet = MONSTER_SHEETS[target.entry.kitIndex];
    if (sheet === undefined) continue;
    const resolution = resolveAttack(
      nextRngState,
      Object.freeze({ sheet: PLAYER_COMBAT_SHEET, spellPotencyOverride: null, state: player }),
      Object.freeze({ sheet, state: target.entry.combat }),
      spec,
    );
    nextRngState = resolution.rngState;
    player = resolution.attacker;
    target.entry.combat = resolution.defender;
    const wasKeen = resolution.outcome === "keen";
    if (wasKeen && isSpell) {
      player = applyKeenSpellRefund(player, actionId, PLAYER_COMBAT_SHEET);
    }
    accumulateEvents(
      counters,
      resolution.events,
      1,
      target.entry.entityId,
      spec.channel,
      events,
      true,
    );
    const kitDefinition = MONSTER_KITS[target.entry.kitIndex];
    if (kitDefinition !== undefined && kitDefinition.breakOpening !== null) {
      const hitEvent = resolution.events.find((event) => event.kind === "hit") as
        | { amount?: number }
        | undefined;
      const dealt = hitEvent?.amount ?? 0;
      if (dealt > 0 && target.entry.combat.actionKind !== COMBAT_ACTION_DOWNED) {
        if (target.entry.breakWindowTicks === 0) {
          target.entry.breakWindowTicks = kitDefinition.breakOpening.windowTicks;
        }
        target.entry.breakDamage += dealt;
        if (
          target.entry.breakDamage >= kitDefinition.breakOpening.damageThreshold &&
          target.entry.combat.conditions.exposedTicks === 0
        ) {
          target.entry.combat = applyExposedOpening(target.entry.combat);
          target.entry.breakDamage = 0;
          target.entry.breakWindowTicks = 0;
          events.push(
            record("combat.condition", target.entry.entityId, CONDITION_CODES.exposed, 1, 0),
          );
        }
      }
    }
    if (resolution.outcome !== "avoided") {
      aggroPack(monsters, target.entry.kitIndex, target.entry.position);
      target.entry.aggro = true;
    }
  }
  return Object.freeze({ player, playerPosition: position, rngState: nextRngState });
}

function aggroPack(
  monsters: MutableMonster[],
  kitIndex: number,
  origin: readonly [number, number, number],
): void {
  for (const entry of monsters) {
    if (entry.kitIndex !== kitIndex || entry.combat.actionKind === COMBAT_ACTION_DOWNED) continue;
    if (horizontalDistance(entry.position, origin) <= PACK_AGGRO_RADIUS_METERS) {
      entry.aggro = true;
    }
  }
}

function accumulateEvents(
  counters: { -readonly [Key in keyof M3CombatCounters]: number },
  coreEvents: readonly Readonly<{ readonly kind: string }>[],
  attackerId: number,
  targetId: number,
  channel: keyof typeof CHANNEL_CODES,
  events: CombatEventRecord[],
  playerIsAttacker: boolean,
): void {
  counters.checksResolved += 1;
  for (const coreEvent of coreEvents) {
    const mapped = EVENT_KIND_BY_CORE[coreEvent.kind as keyof typeof EVENT_KIND_BY_CORE];
    if (mapped === undefined) continue;
    const eventValues = coreEventValues(coreEvent, attackerId, targetId, channel);
    events.push(record(mapped, eventValues[0], eventValues[1], eventValues[2], eventValues[3]));
    if (coreEvent.kind === "hit") {
      counters.hitsLanded += 1;
      const amount = (coreEvent as { amount?: number }).amount ?? 0;
      if (playerIsAttacker) {
        counters.damageDealt += amount;
      } else {
        counters.damageTaken += amount;
      }
      if ((coreEvent as { keen?: boolean }).keen === true) counters.keens += 1;
    }
    if (coreEvent.kind === "deflected" || coreEvent.kind === "resisted") {
      counters.deflections += 1;
    }
    if (coreEvent.kind === "staggered") counters.staggers += 1;
    if (coreEvent.kind === "downed") {
      if (playerIsAttacker) {
        counters.monstersDefeated += 1;
      } else {
        counters.playerDefeats += 1;
      }
    }
  }
}

function coreEventValues(
  coreEvent: Readonly<{ readonly kind: string }>,
  attackerId: number,
  targetId: number,
  channel: keyof typeof CHANNEL_CODES,
): readonly [number, number, number, number] {
  const detail = coreEvent as {
    amount?: number;
    applied?: string;
    caught?: boolean;
    condition?: string;
    consumed?: string;
    keen?: boolean;
    kind: string;
  };
  switch (detail.kind) {
    case "hit":
      return [
        attackerId,
        targetId,
        detail.amount ?? 0,
        CHANNEL_CODES[channel] * 2 + (detail.keen === true ? 1 : 0),
      ];
    case "blocked":
      return [attackerId, targetId, detail.amount ?? 0, detail.caught === true ? 1 : 0];
    case "condition-applied":
      return [
        targetId,
        CONDITION_CODES[(detail.condition ?? "burning") as keyof typeof CONDITION_CODES] ?? 0,
        1,
        0,
      ];
    case "condition-consumed":
      return [
        targetId,
        CONDITION_CODES[(detail.consumed ?? "burning") as keyof typeof CONDITION_CODES] ?? 0,
        0,
        CONDITION_CODES[(detail.applied ?? "burning") as keyof typeof CONDITION_CODES] ?? 0,
      ];
    case "downed":
      return [targetId, attackerId, 0, 0];
    default:
      return [attackerId, targetId, 0, 0];
  }
}

function record(kind: string, a: number, b: number, c: number, d: number): CombatEventRecord {
  return Object.freeze({
    kind,
    values: Object.freeze([a, b, c, d]) as readonly [number, number, number, number],
  });
}

function horizontalDistance(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return Math.hypot(left[0] - right[0], left[2] - right[2]);
}

function overlapsAnyObstacle(x: number, z: number, world: CombatWorldView): boolean {
  for (const obstacle of world.obstacles) {
    if (
      x > obstacle.center[0] - obstacle.size[0] / 2 - MONSTER_RADIUS_METERS &&
      x < obstacle.center[0] + obstacle.size[0] / 2 + MONSTER_RADIUS_METERS &&
      z > obstacle.center[2] - obstacle.size[2] / 2 - MONSTER_RADIUS_METERS &&
      z < obstacle.center[2] + obstacle.size[2] / 2 + MONSTER_RADIUS_METERS
    ) {
      return true;
    }
  }
  return false;
}

// --- Binary state block -------------------------------------------------------------

export const COMBAT_HEADER_BYTES = 96;
export const COMBATANT_STATE_BYTES = 96;
export const MONSTER_ENTRY_BYTES = 144;
export const MAXIMUM_MONSTER_ENTRIES = 16;
export const COMBAT_STATE_BYTES =
  COMBAT_HEADER_BYTES + COMBATANT_STATE_BYTES + MAXIMUM_MONSTER_ENTRIES * MONSTER_ENTRY_BYTES;

export function serializeCombatState(view: DataView, offset: number, state: M3CombatState): void {
  view.setUint32(offset, state.combatRngState, true);
  view.setUint32(offset + 4, state.lootRngState, true);
  view.setUint32(offset + 8, Number(state.blockHeld), true);
  view.setUint32(offset + 12, state.playerDownTicks, true);
  view.setUint32(offset + 16, state.spawnCounter, true);
  view.setUint32(offset + 20, state.monsters.length, true);
  view.setInt32(offset + 24, state.queuedActionId, true);
  view.setUint32(offset + 28, state.queuedTicks, true);
  view.setFloat64(offset + 32, state.counters.damageDealt, true);
  view.setFloat64(offset + 40, state.counters.damageTaken, true);
  view.setUint32(offset + 48, state.counters.checksResolved, true);
  view.setUint32(offset + 52, state.counters.deflections, true);
  view.setUint32(offset + 56, state.counters.hitsLanded, true);
  view.setUint32(offset + 60, state.counters.keens, true);
  view.setUint32(offset + 64, state.counters.monstersDefeated, true);
  view.setUint32(offset + 68, state.counters.playerDefeats, true);
  view.setUint32(offset + 72, state.counters.staggers, true);
  serializeCombatant(view, offset + COMBAT_HEADER_BYTES, state.player);
  for (const [index, entry] of state.monsters.entries()) {
    const base = offset + COMBAT_HEADER_BYTES + COMBATANT_STATE_BYTES + index * MONSTER_ENTRY_BYTES;
    view.setUint32(base, entry.entityId, true);
    view.setUint32(base + 4, entry.kitIndex, true);
    view.setUint32(base + 8, Number(entry.aggro), true);
    view.setUint32(base + 12, entry.attackCursor, true);
    view.setUint32(base + 16, entry.corpseTicks, true);
    view.setFloat32(base + 20, entry.position[0], true);
    view.setFloat32(base + 24, entry.position[1], true);
    view.setFloat32(base + 28, entry.position[2], true);
    view.setFloat32(base + 32, entry.yawRadians, true);
    view.setUint32(base + 36, entry.breakDamage, true);
    view.setUint32(base + 40, entry.breakWindowTicks, true);
    serializeCombatant(view, base + 44, entry.combat);
    view.setUint32(base + 140, entry.attackCooldownTicks, true);
  }
}

export function deserializeCombatState(view: DataView, offset: number): M3CombatState {
  const monsterCount = view.getUint32(offset + 20, true);
  if (monsterCount > MAXIMUM_MONSTER_ENTRIES) {
    throw new Error("Game simulation combat state has too many monsters");
  }
  const blockHeldValue = view.getUint32(offset + 8, true);
  if (blockHeldValue > 1) {
    throw new Error("Game simulation combat state has a noncanonical block flag");
  }
  const monsters = Object.freeze(
    Array.from({ length: monsterCount }, (_, index) => {
      const base =
        offset + COMBAT_HEADER_BYTES + COMBATANT_STATE_BYTES + index * MONSTER_ENTRY_BYTES;
      const aggroValue = view.getUint32(base + 8, true);
      if (aggroValue > 1) {
        throw new Error("Game simulation combat state has a noncanonical aggro flag");
      }
      return Object.freeze({
        aggro: aggroValue === 1,
        attackCooldownTicks: view.getUint32(base + 140, true),
        attackCursor: view.getUint32(base + 12, true),
        breakDamage: view.getUint32(base + 36, true),
        breakWindowTicks: view.getUint32(base + 40, true),
        combat: deserializeCombatant(view, base + 44),
        corpseTicks: view.getUint32(base + 16, true),
        entityId: view.getUint32(base, true),
        kitIndex: view.getUint32(base + 4, true),
        position: Object.freeze([
          view.getFloat32(base + 20, true),
          view.getFloat32(base + 24, true),
          view.getFloat32(base + 28, true),
        ]) as readonly [number, number, number],
        yawRadians: view.getFloat32(base + 32, true),
      });
    }),
  );
  return Object.freeze({
    blockHeld: blockHeldValue === 1,
    combatRngState: view.getUint32(offset, true),
    counters: Object.freeze({
      checksResolved: view.getUint32(offset + 48, true),
      damageDealt: view.getFloat64(offset + 32, true),
      damageTaken: view.getFloat64(offset + 40, true),
      deflections: view.getUint32(offset + 52, true),
      hitsLanded: view.getUint32(offset + 56, true),
      keens: view.getUint32(offset + 60, true),
      monstersDefeated: view.getUint32(offset + 64, true),
      playerDefeats: view.getUint32(offset + 68, true),
      staggers: view.getUint32(offset + 72, true),
    }),
    lootRngState: view.getUint32(offset + 4, true),
    monsters,
    player: deserializeCombatant(view, offset + COMBAT_HEADER_BYTES),
    playerDownTicks: view.getUint32(offset + 12, true),
    queuedActionId: view.getInt32(offset + 24, true),
    queuedTicks: view.getUint32(offset + 28, true),
    spawnCounter: view.getUint32(offset + 16, true),
  });
}

function serializeCombatant(view: DataView, offset: number, state: CombatantCombatState): void {
  view.setInt32(offset, state.actionId, true);
  view.setUint32(offset + 4, state.actionKind, true);
  view.setUint32(offset + 8, state.actionTicksRemaining, true);
  view.setInt32(offset + 12, state.aether, true);
  view.setUint32(offset + 16, state.aetherAccumulator, true);
  view.setUint32(offset + 20, state.answeringTicks, true);
  view.setUint32(offset + 24, state.blockHeldTicks, true);
  view.setUint32(offset + 28, state.blockLockoutTicks, true);
  view.setUint32(offset + 32, state.burningAccumulator, true);
  view.setUint32(offset + 36, state.conditions.burningTicks, true);
  view.setUint32(offset + 40, state.conditions.chilledTicks, true);
  view.setUint32(offset + 44, state.conditions.envenomedTicks, true);
  view.setUint32(offset + 48, state.conditions.exposedTicks, true);
  view.setUint32(offset + 52, state.envenomedAccumulator, true);
  view.setUint32(offset + 56, state.healAccumulator, true);
  view.setUint32(offset + 60, state.healRemainingTicks, true);
  view.setInt32(offset + 64, state.health, true);
  view.setUint32(offset + 68, state.nimbleTicks, true);
  view.setInt32(offset + 72, state.stamina, true);
  view.setUint32(offset + 76, state.staminaAccumulator, true);
  view.setUint32(offset + 80, state.staminaDelayTicks, true);
  view.setUint32(offset + 84, state.wardAmount, true);
  view.setUint32(offset + 88, state.wardTicks, true);
}

function deserializeCombatant(view: DataView, offset: number): CombatantCombatState {
  return Object.freeze({
    actionId: view.getInt32(offset, true),
    actionKind: view.getUint32(offset + 4, true),
    actionTicksRemaining: view.getUint32(offset + 8, true),
    aether: view.getInt32(offset + 12, true),
    aetherAccumulator: view.getUint32(offset + 16, true),
    answeringTicks: view.getUint32(offset + 20, true),
    blockHeldTicks: view.getUint32(offset + 24, true),
    blockLockoutTicks: view.getUint32(offset + 28, true),
    burningAccumulator: view.getUint32(offset + 32, true),
    conditions: Object.freeze({
      burningTicks: view.getUint32(offset + 36, true),
      chilledTicks: view.getUint32(offset + 40, true),
      envenomedTicks: view.getUint32(offset + 44, true),
      exposedTicks: view.getUint32(offset + 48, true),
    }),
    envenomedAccumulator: view.getUint32(offset + 52, true),
    healAccumulator: view.getUint32(offset + 56, true),
    healRemainingTicks: view.getUint32(offset + 60, true),
    health: view.getInt32(offset + 64, true),
    nimbleTicks: view.getUint32(offset + 68, true),
    stamina: view.getInt32(offset + 72, true),
    staminaAccumulator: view.getUint32(offset + 76, true),
    staminaDelayTicks: view.getUint32(offset + 80, true),
    wardAmount: view.getUint32(offset + 84, true),
    wardTicks: view.getUint32(offset + 88, true),
  });
}

export function assertCombatState(state: M3CombatState): void {
  const validCombatant = (combatant: CombatantCombatState, sheet: CombatantSheet): boolean =>
    Number.isSafeInteger(combatant.health) &&
    combatant.health >= 0 &&
    combatant.health <= sheet.maxHealth &&
    Number.isSafeInteger(combatant.stamina) &&
    combatant.stamina >= 0 &&
    combatant.stamina <= sheet.maxStamina &&
    Number.isSafeInteger(combatant.aether) &&
    combatant.aether >= 0 &&
    combatant.aether <= sheet.maxAether &&
    combatant.actionKind >= COMBAT_ACTION_IDLE &&
    combatant.actionKind <= COMBAT_ACTION_DOWNED &&
    (combatant.actionKind !== COMBAT_ACTION_DOWNED || combatant.health === 0);
  if (!validCombatant(state.player, PLAYER_COMBAT_SHEET)) {
    throw new Error("Game simulation combat state contains invalid player values");
  }
  const seen = new Set<number>();
  for (const entry of state.monsters) {
    const sheet = MONSTER_SHEETS[entry.kitIndex];
    if (
      sheet === undefined ||
      entry.entityId < MONSTER_ENTITY_ID_START ||
      entry.entityId >= MONSTER_ENTITY_ID_START + state.spawnCounter ||
      seen.has(entry.entityId) ||
      !entry.position.every((value) => Number.isFinite(value)) ||
      !Number.isFinite(entry.yawRadians) ||
      entry.attackCursor >= Math.max(1, sheet.monsterAttacks.length) ||
      !validCombatant(entry.combat, sheet)
    ) {
      throw new Error("Game simulation combat state contains invalid monster values");
    }
    seen.add(entry.entityId);
  }
}

export function combatTelemetryCounters(state: M3CombatState): Readonly<Record<string, number>> {
  return Object.freeze({
    combatChecksResolved: state.counters.checksResolved,
    combatDamageDealt: state.counters.damageDealt,
    combatDamageTaken: state.counters.damageTaken,
    combatDeflections: state.counters.deflections,
    combatHitsLanded: state.counters.hitsLanded,
    combatKeens: state.counters.keens,
    combatMonstersAlive: state.monsters.filter(
      (entry) => entry.combat.actionKind !== COMBAT_ACTION_DOWNED,
    ).length,
    combatMonstersDefeated: state.counters.monstersDefeated,
    combatPlayerAether: state.player.aether,
    combatPlayerDefeats: state.counters.playerDefeats,
    combatPlayerHealth: state.player.health,
    combatPlayerStamina: state.player.stamina,
    combatStaggers: state.counters.staggers,
  });
}
