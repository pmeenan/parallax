import type {
  GameSimulationAdapter,
  GameSimulationContext,
  GreyboxAabbCollider,
  SimulationCommand,
  SimulationGameStateQuery,
  SimulationPresentationEntity,
  SimulationStepResult,
  SimulationWorldDefinition,
} from "@parallax/engine";
import { CHARACTER_CONTROLLER_BALANCE } from "../balance/character-controller";
import { NPC_CROWD_BALANCE } from "../balance/npc-crowd";
import { isConversationalNpcEntityId, NPC_ENTITY_ID_START } from "../npc/identity";
import { executeM3NpcKnowledgeQuery } from "../npc/knowledge";
import { M3_NPC_KNOWLEDGE_PROFILES } from "../npc/knowledge-data";
import {
  buildDeterministicNavigationMesh,
  type DeterministicNavigationMesh,
} from "./deterministic-navigation";
import { buildNpcScheduleSet, type NpcScheduleSet } from "./npc-schedules";

export const GAME_SIMULATION_STATE_SCHEMA_VERSION = 4;
export const PLAYER_ENTITY_ID = 1;
export { NPC_ENTITY_ID_START } from "../npc/identity";

interface NpcAgentState {
  readonly dwellTicks: number;
  readonly entityId: number;
  readonly pathCursor: number;
  readonly position: readonly [number, number, number];
  readonly routeIndex: number;
  readonly targetStopIndex: number;
  readonly yawRadians: number;
}

interface M3SimulationState {
  readonly collisionResolutionCount: number;
  readonly inputForward: number;
  readonly inputRight: number;
  readonly interactionActivationCount: number;
  readonly interactionAttemptCount: number;
  readonly interactionRequested: boolean;
  readonly lastInteractionMarkerIndex: number;
  readonly movementDistanceMeters: number;
  readonly npcAgents: readonly NpcAgentState[];
  readonly npcAvoidanceAdjustmentCount: number;
  readonly npcMovementDistanceMeters: number;
  readonly npcMovingAgentCount: number;
  readonly npcScheduleTransitionCount: number;
  readonly playerPosition: readonly [number, number, number];
  readonly playerYawRadians: number;
  readonly rngState: number;
  readonly schemaVersion: typeof GAME_SIMULATION_STATE_SCHEMA_VERSION;
}

interface ControllerWorld {
  readonly district: SimulationWorldDefinition;
  readonly obstacles: readonly GreyboxAabbCollider[];
  readonly transitionMarkerIndexes: readonly number[];
}

interface CrowdStep {
  readonly agents: readonly NpcAgentState[];
  readonly avoidanceAdjustmentCount: number;
  readonly movementDistanceMeters: number;
  readonly movingAgentCount: number;
  readonly scheduleTransitionCount: number;
}

type InteractionTarget =
  | Readonly<{ readonly kind: "npc"; readonly value: number }>
  | Readonly<{ readonly kind: "transition"; readonly value: number }>;

const EMPTY_EVENTS = Object.freeze([]);
const INPUT_COMMAND_KIND = "player.input-axes@2";
const INPUT_PAYLOAD_BYTES = 16;
const INPUT_INTERACT_PRESSED = 1;
const STATE_HEADER_BYTES = 96;
const NPC_STATE_BYTES = 32;
const STATE_BYTES = STATE_HEADER_BYTES + NPC_CROWD_BALANCE.agentCount * NPC_STATE_BYTES;

export function createGameSimulationAdapter(
  context: GameSimulationContext,
): GameSimulationAdapter<M3SimulationState> {
  if (!Number.isSafeInteger(context.timestepHz) || context.timestepHz <= 0) {
    throw new Error("Game simulation timestep is invalid");
  }
  const world = createControllerWorld(context.world);
  const navigation = buildDeterministicNavigationMesh(context.world, {
    agentRadiusMeters: NPC_CROWD_BALANCE.agentRadiusMeters,
    maximumGroundStepMeters: NPC_CROWD_BALANCE.maximumGroundStepMeters,
    sampleSpacingMeters: NPC_CROWD_BALANCE.navigationSampleSpacingMeters,
  });
  const schedules = buildNpcScheduleSet(context.world, navigation);
  const tickSeconds = 1 / context.timestepHz;
  return Object.freeze({
    applyCommand(
      state: M3SimulationState,
      command: SimulationCommand,
    ): SimulationStepResult<M3SimulationState> {
      if (command.kind !== INPUT_COMMAND_KIND) {
        throw new Error(`Unsupported game simulation command ${command.kind}`);
      }
      if (command.payload.byteLength !== INPUT_PAYLOAD_BYTES) {
        throw new Error("Player input command payload is invalid");
      }
      const view = new DataView(
        command.payload.buffer,
        command.payload.byteOffset,
        command.payload.byteLength,
      );
      const inputForward = view.getFloat32(0, true);
      const inputRight = view.getFloat32(4, true);
      const playerYawRadians = view.getFloat32(8, true);
      const flags = view.getUint32(12, true);
      assertInputState(inputForward, inputRight, playerYawRadians, flags);
      const interactionPressed = (flags & INPUT_INTERACT_PRESSED) !== 0;
      return Object.freeze({
        events: Object.freeze([
          Object.freeze({ kind: "input.command-applied", payload: command.payload.slice() }),
        ]),
        state: Object.freeze({
          ...state,
          inputForward,
          inputRight,
          interactionAttemptCount: state.interactionAttemptCount + Number(interactionPressed),
          interactionRequested: state.interactionRequested || interactionPressed,
          playerYawRadians,
        }),
      });
    },
    createInitialState(seed: number): M3SimulationState {
      const spawnX = 0;
      const spawnZ = 0;
      return Object.freeze({
        collisionResolutionCount: 0,
        inputForward: 0,
        inputRight: 0,
        interactionActivationCount: 0,
        interactionAttemptCount: 0,
        interactionRequested: false,
        lastInteractionMarkerIndex: -1,
        movementDistanceMeters: 0,
        npcAgents: createInitialNpcAgents(navigation, schedules),
        npcAvoidanceAdjustmentCount: 0,
        npcMovementDistanceMeters: 0,
        npcMovingAgentCount: 0,
        npcScheduleTransitionCount: 0,
        playerPosition: Object.freeze([
          spawnX,
          navigation.groundHeight(spawnX, spawnZ) + CHARACTER_CONTROLLER_BALANCE.halfHeightMeters,
          spawnZ,
        ]) as readonly [number, number, number],
        playerYawRadians: 0,
        rngState: seed >>> 0,
        schemaVersion: GAME_SIMULATION_STATE_SCHEMA_VERSION,
      });
    },
    deserializeState(bytes: Uint8Array): M3SimulationState {
      if (bytes.byteLength !== STATE_BYTES) throw new Error("Game simulation state is truncated");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (view.getUint32(0, true) !== GAME_SIMULATION_STATE_SCHEMA_VERSION) {
        throw new Error("Game simulation state schema is incompatible");
      }
      const interactionRequestedValue = view.getUint32(56, true);
      if (interactionRequestedValue !== 0 && interactionRequestedValue !== 1) {
        throw new Error("Game simulation state contains a noncanonical interaction flag");
      }
      if (view.getUint32(64, true) !== NPC_CROWD_BALANCE.agentCount) {
        throw new Error("Game simulation state has an incompatible NPC crowd size");
      }
      const npcAgents = Object.freeze(
        Array.from({ length: NPC_CROWD_BALANCE.agentCount }, (_, index) => {
          const offset = STATE_HEADER_BYTES + index * NPC_STATE_BYTES;
          if (view.getUint32(offset + 28, true) !== 0) {
            throw new Error("Game simulation NPC state contains noncanonical reserved bytes");
          }
          return Object.freeze({
            dwellTicks: view.getUint16(offset + 10, true),
            entityId: view.getUint32(offset, true),
            pathCursor: view.getUint16(offset + 8, true),
            position: Object.freeze([
              view.getFloat32(offset + 12, true),
              view.getFloat32(offset + 16, true),
              view.getFloat32(offset + 20, true),
            ]) as readonly [number, number, number],
            routeIndex: view.getUint16(offset + 4, true),
            targetStopIndex: view.getUint16(offset + 6, true),
            yawRadians: view.getFloat32(offset + 24, true),
          });
        }),
      );
      const state = Object.freeze({
        collisionResolutionCount: view.getUint32(44, true),
        inputForward: view.getFloat32(8, true),
        inputRight: view.getFloat32(12, true),
        interactionActivationCount: view.getUint32(52, true),
        interactionAttemptCount: view.getUint32(48, true),
        interactionRequested: interactionRequestedValue === 1,
        lastInteractionMarkerIndex: view.getInt32(60, true),
        movementDistanceMeters: view.getFloat64(32, true),
        npcAgents,
        npcAvoidanceAdjustmentCount: view.getFloat64(68, true),
        npcMovementDistanceMeters: view.getFloat64(80, true),
        npcMovingAgentCount: view.getUint32(76, true),
        npcScheduleTransitionCount: view.getFloat64(88, true),
        playerPosition: Object.freeze([
          view.getFloat32(20, true),
          view.getFloat32(24, true),
          view.getFloat32(28, true),
        ]) as readonly [number, number, number],
        playerYawRadians: view.getFloat32(16, true),
        rngState: view.getUint32(4, true),
        schemaVersion: GAME_SIMULATION_STATE_SCHEMA_VERSION,
      });
      assertState(state, world.district.markers.length, navigation, schedules);
      return state;
    },
    presentationSnapshot(state: M3SimulationState): readonly SimulationPresentationEntity[] {
      return Object.freeze([
        Object.freeze({
          id: PLAYER_ENTITY_ID,
          position: state.playerPosition,
          yawRadians: state.playerYawRadians,
        }),
        ...state.npcAgents.map((agent) =>
          Object.freeze({
            id: agent.entityId,
            position: agent.position,
            yawRadians: agent.yawRadians,
          }),
        ),
      ]);
    },
    queryState(state: M3SimulationState, query: SimulationGameStateQuery): Uint8Array {
      assertState(state, world.district.markers.length, navigation, schedules);
      return executeM3NpcKnowledgeQuery(
        query,
        context.world.id,
        M3_NPC_KNOWLEDGE_PROFILES.map((profile) => {
          const agent = state.npcAgents.find(
            ({ entityId }: NpcAgentState) => entityId === profile.entityId,
          );
          if (agent === undefined) {
            throw new Error(`NPC knowledge agent ${profile.npcId} is absent from simulation state`);
          }
          const route = schedules.routes[agent.routeIndex];
          if (route === undefined) throw new Error("NPC knowledge agent route is invalid");
          return Object.freeze({
            npcId: profile.npcId,
            pathCursor: agent.pathCursor,
            position: agent.position,
            routeId: route.id,
            targetStopIndex: agent.targetStopIndex,
          });
        }),
      );
    },
    serializeState(state: M3SimulationState): Uint8Array {
      assertState(state, world.district.markers.length, navigation, schedules);
      const bytes = new Uint8Array(STATE_BYTES);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, state.schemaVersion, true);
      view.setUint32(4, state.rngState, true);
      view.setFloat32(8, state.inputForward, true);
      view.setFloat32(12, state.inputRight, true);
      view.setFloat32(16, state.playerYawRadians, true);
      view.setFloat32(20, state.playerPosition[0], true);
      view.setFloat32(24, state.playerPosition[1], true);
      view.setFloat32(28, state.playerPosition[2], true);
      view.setFloat64(32, state.movementDistanceMeters, true);
      view.setUint32(44, state.collisionResolutionCount, true);
      view.setUint32(48, state.interactionAttemptCount, true);
      view.setUint32(52, state.interactionActivationCount, true);
      view.setUint32(56, Number(state.interactionRequested), true);
      view.setInt32(60, state.lastInteractionMarkerIndex, true);
      view.setUint32(64, state.npcAgents.length, true);
      view.setFloat64(68, state.npcAvoidanceAdjustmentCount, true);
      view.setUint32(76, state.npcMovingAgentCount, true);
      view.setFloat64(80, state.npcMovementDistanceMeters, true);
      view.setFloat64(88, state.npcScheduleTransitionCount, true);
      for (const [index, agent] of state.npcAgents.entries()) {
        const offset = STATE_HEADER_BYTES + index * NPC_STATE_BYTES;
        view.setUint32(offset, agent.entityId, true);
        view.setUint16(offset + 4, agent.routeIndex, true);
        view.setUint16(offset + 6, agent.targetStopIndex, true);
        view.setUint16(offset + 8, agent.pathCursor, true);
        view.setUint16(offset + 10, agent.dwellTicks, true);
        view.setFloat32(offset + 12, agent.position[0], true);
        view.setFloat32(offset + 16, agent.position[1], true);
        view.setFloat32(offset + 20, agent.position[2], true);
        view.setFloat32(offset + 24, agent.yawRadians, true);
      }
      return bytes;
    },
    step(state: M3SimulationState, _tick: number): SimulationStepResult<M3SimulationState> {
      const movement = movePlayer(world, navigation, state, tickSeconds);
      const crowd = stepNpcCrowd(navigation, schedules, state, movement.position, tickSeconds);
      const interaction = state.interactionRequested
        ? nearestInteraction(world, crowd.agents, movement.position)
        : null;
      const activated = interaction !== null;
      const next = Object.freeze({
        ...state,
        collisionResolutionCount: state.collisionResolutionCount + movement.collisionCount,
        interactionActivationCount: state.interactionActivationCount + Number(activated),
        interactionRequested: false,
        lastInteractionMarkerIndex:
          interaction?.kind === "transition" ? interaction.value : state.lastInteractionMarkerIndex,
        movementDistanceMeters: Math.fround(state.movementDistanceMeters + movement.distanceMeters),
        npcAgents: crowd.agents,
        npcAvoidanceAdjustmentCount:
          state.npcAvoidanceAdjustmentCount + crowd.avoidanceAdjustmentCount,
        npcMovementDistanceMeters: Math.fround(
          state.npcMovementDistanceMeters + crowd.movementDistanceMeters,
        ),
        npcMovingAgentCount: crowd.movingAgentCount,
        npcScheduleTransitionCount:
          state.npcScheduleTransitionCount + crowd.scheduleTransitionCount,
        playerPosition: movement.position,
      });
      return Object.freeze({
        events: interactionEvents(interaction),
        state: next,
      });
    },
    telemetryCounters(state: M3SimulationState): Readonly<Record<string, number>> {
      return Object.freeze({
        collisionResolutionCount: state.collisionResolutionCount,
        interactionActivationCount: state.interactionActivationCount,
        interactionAttemptCount: state.interactionAttemptCount,
        movementDistanceMeters: state.movementDistanceMeters,
        navigationEdgeCount: navigation.telemetry.edgeCount,
        navigationExpandedNodeCount: schedules.expandedNodeCount,
        navigationGridBytes: navigation.telemetry.gridBytes,
        navigationNodeCount: navigation.telemetry.nodeCount,
        navigationPathNodeCount: schedules.pathNodeCount,
        navigationPathQueryCount: schedules.pathQueryCount,
        navigationTileCount: navigation.telemetry.tileCount,
        npcAgentCount: state.npcAgents.length,
        npcAvoidanceAdjustmentCount: state.npcAvoidanceAdjustmentCount,
        npcMovementDistanceMeters: state.npcMovementDistanceMeters,
        npcMovingAgentCount: state.npcMovingAgentCount,
        npcScheduleTransitionCount: state.npcScheduleTransitionCount,
      });
    },
  });
}

function createInitialNpcAgents(
  navigation: DeterministicNavigationMesh,
  schedules: NpcScheduleSet,
): readonly NpcAgentState[] {
  return Object.freeze(
    Array.from({ length: NPC_CROWD_BALANCE.agentCount }, (_, index) => {
      const routeIndex = index % schedules.routes.length;
      const route = schedules.routes[routeIndex];
      if (route === undefined) throw new Error("NPC schedule route assignment failed");
      const routeAgentIndex = Math.floor(index / schedules.routes.length);
      const targetStopIndex = routeAgentIndex % route.stops.length;
      const segment = route.segments[targetStopIndex];
      if (segment === undefined || segment.nodes.length === 0) {
        throw new Error("NPC schedule segment is empty");
      }
      if (segment.nodes.length < 2) throw new Error("NPC schedule segment cannot phase agents");
      const laneSlot = Math.floor(routeAgentIndex / route.stops.length);
      const segmentLengthMeters = segment.nodes.slice(1).reduce((length, node, nodeIndex) => {
        const previous = segment.nodes[nodeIndex];
        if (previous === undefined) throw new Error("NPC schedule segment lost a node");
        return length + Math.hypot(node[0] - previous[0], node[2] - previous[2]);
      }, 0);
      const minimumSpawnClearanceMeters = NPC_CROWD_BALANCE.agentRadiusMeters * 2 + 0.05;
      const closeAvoidancePhase = 0.08 + minimumSpawnClearanceMeters / segmentLengthMeters;
      if (closeAvoidancePhase >= 0.32) {
        throw new Error("NPC schedule segment is too short for a collision-free crowd phase");
      }
      const phase = [0.08, closeAvoidancePhase, 0.32, 0.55, 0.78, 0.98][laneSlot];
      if (phase === undefined) throw new Error("NPC schedule phase assignment failed");
      const edgeProgress = phase * (segment.nodes.length - 1);
      const fromIndex = Math.min(segment.nodes.length - 2, Math.floor(edgeProgress));
      const pathCursor = fromIndex + 1;
      const from = segment.nodes[fromIndex];
      const to = segment.nodes[pathCursor];
      if (from === undefined || to === undefined)
        throw new Error("NPC schedule spawn edge is missing");
      const alpha = edgeProgress - fromIndex;
      const x = Math.fround(from[0] + (to[0] - from[0]) * alpha);
      const z = Math.fround(from[2] + (to[2] - from[2]) * alpha);
      const y = navigation.groundHeight(x, z);
      return Object.freeze({
        dwellTicks: 0,
        entityId: NPC_ENTITY_ID_START + index,
        pathCursor,
        position: npcCenterPosition([x, y, z]),
        routeIndex,
        targetStopIndex,
        yawRadians: 0,
      });
    }),
  );
}

function stepNpcCrowd(
  navigation: DeterministicNavigationMesh,
  schedules: NpcScheduleSet,
  state: M3SimulationState,
  playerPosition: readonly [number, number, number],
  tickSeconds: number,
): CrowdStep {
  let avoidanceAdjustmentCount = 0;
  let movementDistanceMeters = 0;
  let movingAgentCount = 0;
  let scheduleTransitionCount = 0;
  const agents = state.npcAgents.map((agent): NpcAgentState => {
    const route = schedules.routes[agent.routeIndex];
    if (route === undefined) throw new Error("NPC route disappeared during simulation");
    if (agent.dwellTicks > 0) return Object.freeze({ ...agent, dwellTicks: agent.dwellTicks - 1 });
    const segment = route.segments[agent.targetStopIndex];
    if (segment === undefined) throw new Error("NPC route segment disappeared during simulation");
    if (agent.pathCursor >= segment.nodes.length) {
      const targetStopIndex = (agent.targetStopIndex + 1) % route.stops.length;
      const nextSegment = route.segments[targetStopIndex];
      if (nextSegment === undefined || nextSegment.nodes.length === 0) {
        throw new Error("NPC route transition has no navigation path");
      }
      scheduleTransitionCount += 1;
      return Object.freeze({
        ...agent,
        dwellTicks: NPC_CROWD_BALANCE.scheduleDwellTicks,
        pathCursor: Math.min(1, nextSegment.nodes.length),
        targetStopIndex,
      });
    }
    const target = segment.nodes[agent.pathCursor];
    if (target === undefined) throw new Error("NPC path cursor is invalid");
    const deltaX = target[0] - agent.position[0];
    const deltaZ = target[2] - agent.position[2];
    const distance = Math.hypot(deltaX, deltaZ);
    const maximumStep = NPC_CROWD_BALANCE.movementMetersPerSecond * tickSeconds;
    if (distance <= NPC_CROWD_BALANCE.waypointArrivalMeters) {
      if (distance === 0) {
        return Object.freeze({ ...agent, pathCursor: agent.pathCursor + 1 });
      }
      const step = Math.min(maximumStep, distance);
      const reachedWaypoint = step >= distance;
      const x = reachedWaypoint
        ? target[0]
        : Math.fround(agent.position[0] + (deltaX / distance) * step);
      const z = reachedWaypoint
        ? target[2]
        : Math.fround(agent.position[2] + (deltaZ / distance) * step);
      const moved = Math.hypot(x - agent.position[0], z - agent.position[2]);
      movementDistanceMeters += moved;
      movingAgentCount += 1;
      return Object.freeze({
        ...agent,
        pathCursor: reachedWaypoint ? agent.pathCursor + 1 : agent.pathCursor,
        position: Object.freeze([
          x,
          Math.fround(navigation.groundHeight(x, z) + NPC_CROWD_BALANCE.agentHeightMeters / 2),
          z,
        ]) as readonly [number, number, number],
        yawRadians: Math.fround(Math.atan2(deltaX, deltaZ)),
      });
    }
    const separation = npcSeparation(agent, state.npcAgents, playerPosition);
    avoidanceAdjustmentCount += Number(separation.neighborCount > 0);
    const desiredX = deltaX / distance;
    const desiredZ = deltaZ / distance;
    let directionX = desiredX + separation.x * NPC_CROWD_BALANCE.avoidanceWeight;
    let directionZ = desiredZ + separation.z * NPC_CROWD_BALANCE.avoidanceWeight;
    const directionLength = Math.hypot(directionX, directionZ);
    if (directionLength > 0) {
      directionX /= directionLength;
      directionZ /= directionLength;
    }
    const step = Math.min(maximumStep, distance);
    let x = Math.fround(agent.position[0] + directionX * step);
    let z = Math.fround(agent.position[2] + directionZ * step);
    if (!npcMovementCandidateIsValid(navigation, agent.position, target, x, z)) {
      x = Math.fround(agent.position[0] + desiredX * step);
      z = Math.fround(agent.position[2] + desiredZ * step);
      if (!npcMovementCandidateIsValid(navigation, agent.position, target, x, z)) return agent;
    }
    const moved = Math.hypot(x - agent.position[0], z - agent.position[2]);
    if (moved <= 0) return agent;
    movementDistanceMeters += moved;
    movingAgentCount += 1;
    return Object.freeze({
      ...agent,
      position: Object.freeze([
        x,
        Math.fround(navigation.groundHeight(x, z) + NPC_CROWD_BALANCE.agentHeightMeters / 2),
        z,
      ]) as readonly [number, number, number],
      yawRadians: Math.fround(Math.atan2(x - agent.position[0], z - agent.position[2])),
    });
  });
  return Object.freeze({
    agents: Object.freeze(agents),
    avoidanceAdjustmentCount,
    movementDistanceMeters: Math.fround(movementDistanceMeters),
    movingAgentCount,
    scheduleTransitionCount,
  });
}

function npcMovementCandidateIsValid(
  navigation: DeterministicNavigationMesh,
  from: readonly [number, number, number],
  target: readonly [number, number, number],
  x: number,
  z: number,
): boolean {
  const candidate = Object.freeze([x, navigation.groundHeight(x, z), z] as const);
  return (
    navigation.canTraverseSegment(from, candidate) &&
    navigation.canTraverseSegment(candidate, target)
  );
}

function npcSeparation(
  agent: NpcAgentState,
  agents: readonly NpcAgentState[],
  playerPosition: readonly [number, number, number],
): Readonly<{ readonly neighborCount: number; readonly x: number; readonly z: number }> {
  let x = 0;
  let z = 0;
  let neighborCount = 0;
  const accumulate = (otherId: number, otherX: number, otherZ: number): void => {
    let deltaX = agent.position[0] - otherX;
    let deltaZ = agent.position[2] - otherZ;
    let distance = Math.hypot(deltaX, deltaZ);
    if (distance >= NPC_CROWD_BALANCE.avoidanceRadiusMeters) return;
    if (distance < 0.000_001) {
      const pairId = Math.min(agent.entityId, otherId);
      const angle = (pairId % 8) * (Math.PI / 4);
      const sign = agent.entityId < otherId ? -1 : 1;
      deltaX = Math.cos(angle) * sign;
      deltaZ = Math.sin(angle) * sign;
      distance = 1;
    }
    const weight =
      (NPC_CROWD_BALANCE.avoidanceRadiusMeters - distance) /
      NPC_CROWD_BALANCE.avoidanceRadiusMeters;
    x += (deltaX / distance) * weight;
    z += (deltaZ / distance) * weight;
    neighborCount += 1;
  };
  for (const other of agents) {
    if (other.entityId !== agent.entityId)
      accumulate(other.entityId, other.position[0], other.position[2]);
  }
  accumulate(PLAYER_ENTITY_ID, playerPosition[0], playerPosition[2]);
  if (neighborCount > 0) {
    x /= neighborCount;
    z /= neighborCount;
  }
  return Object.freeze({ neighborCount, x, z });
}

function npcCenterPosition(
  node: readonly [number, number, number],
): readonly [number, number, number] {
  return Object.freeze([
    node[0],
    Math.fround(node[1] + NPC_CROWD_BALANCE.agentHeightMeters / 2),
    node[2],
  ] as const);
}

function createControllerWorld(district: SimulationWorldDefinition): ControllerWorld {
  const obstacles = district.cells
    .flatMap((cell) => cell.collision.obstacles)
    .toSorted((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const transitionMarkerIndexes = district.markers.flatMap((marker, index) =>
    marker.kind === "transition" ? [index] : [],
  );
  return Object.freeze({
    district,
    obstacles: Object.freeze(obstacles),
    transitionMarkerIndexes: Object.freeze(transitionMarkerIndexes),
  });
}

function movePlayer(
  world: ControllerWorld,
  navigation: DeterministicNavigationMesh,
  state: M3SimulationState,
  tickSeconds: number,
): Readonly<{
  readonly collisionCount: number;
  readonly distanceMeters: number;
  readonly position: readonly [number, number, number];
}> {
  const inputLength = Math.hypot(state.inputForward, state.inputRight);
  const scale = inputLength > 1 ? 1 / inputLength : 1;
  const forward = state.inputForward * scale;
  const right = state.inputRight * scale;
  const sine = Math.sin(state.playerYawRadians);
  const cosine = Math.cos(state.playerYawRadians);
  const distance = CHARACTER_CONTROLLER_BALANCE.movementMetersPerSecond * tickSeconds;
  const deltaX = (sine * forward + cosine * right) * distance;
  const deltaZ = (cosine * forward - sine * right) * distance;
  const oldX = state.playerPosition[0];
  const oldZ = state.playerPosition[2];
  const radius = CHARACTER_CONTROLLER_BALANCE.collisionRadiusMeters;
  const bounds = world.district.bounds;
  let x = Math.fround(clamp(oldX + deltaX, bounds.minimum[0] + radius, bounds.maximum[0] - radius));
  let collisionCount = 0;
  if (deltaX !== 0) {
    for (const obstacle of world.obstacles) {
      if (!overlapsExpandedAabb(x, oldZ, obstacle, radius)) continue;
      x = Math.fround(
        deltaX > 0
          ? obstacle.center[0] - obstacle.size[0] / 2 - radius
          : obstacle.center[0] + obstacle.size[0] / 2 + radius,
      );
      collisionCount += 1;
    }
  }
  let z = Math.fround(clamp(oldZ + deltaZ, bounds.minimum[2] + radius, bounds.maximum[2] - radius));
  if (deltaZ !== 0) {
    for (const obstacle of world.obstacles) {
      if (!overlapsExpandedAabb(x, z, obstacle, radius)) continue;
      z = Math.fround(
        deltaZ > 0
          ? obstacle.center[2] - obstacle.size[2] / 2 - radius
          : obstacle.center[2] + obstacle.size[2] / 2 + radius,
      );
      collisionCount += 1;
    }
  }
  const moved = Math.hypot(x - oldX, z - oldZ);
  return Object.freeze({
    collisionCount,
    distanceMeters: Math.fround(moved),
    position: Object.freeze([
      x,
      Math.fround(navigation.groundHeight(x, z) + CHARACTER_CONTROLLER_BALANCE.halfHeightMeters),
      z,
    ]) as readonly [number, number, number],
  });
}

function nearestInteraction(
  world: ControllerWorld,
  agents: readonly NpcAgentState[],
  position: readonly [number, number, number],
): InteractionTarget | null {
  let nearest: InteractionTarget | null = null;
  let nearestDistanceSquared = CHARACTER_CONTROLLER_BALANCE.interactionRangeMeters ** 2;
  for (const index of world.transitionMarkerIndexes) {
    const marker = world.district.markers[index];
    if (marker === undefined) continue;
    const distanceSquared =
      (marker.position[0] - position[0]) ** 2 + (marker.position[2] - position[2]) ** 2;
    if (distanceSquared <= nearestDistanceSquared) {
      nearest = Object.freeze({ kind: "transition", value: index });
      nearestDistanceSquared = distanceSquared;
    }
  }
  for (const agent of agents) {
    if (!isConversationalNpcEntityId(agent.entityId)) continue;
    const distanceSquared =
      (agent.position[0] - position[0]) ** 2 + (agent.position[2] - position[2]) ** 2;
    // Transition markers win exact ties, while an NPC exactly on the range boundary
    // remains interactable when there is no marker at that distance.
    if (
      distanceSquared < nearestDistanceSquared ||
      (nearest === null && distanceSquared === nearestDistanceSquared)
    ) {
      nearest = Object.freeze({ kind: "npc", value: agent.entityId });
      nearestDistanceSquared = distanceSquared;
    }
  }
  return nearest;
}

function overlapsExpandedAabb(
  x: number,
  z: number,
  obstacle: GreyboxAabbCollider,
  radius: number,
): boolean {
  return (
    x > obstacle.center[0] - obstacle.size[0] / 2 - radius &&
    x < obstacle.center[0] + obstacle.size[0] / 2 + radius &&
    z > obstacle.center[2] - obstacle.size[2] / 2 - radius &&
    z < obstacle.center[2] + obstacle.size[2] / 2 + radius
  );
}

function assertState(
  state: M3SimulationState,
  markerCount: number,
  navigation: DeterministicNavigationMesh,
  schedules: NpcScheduleSet,
): void {
  if (
    state.schemaVersion !== GAME_SIMULATION_STATE_SCHEMA_VERSION ||
    state.playerPosition.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(state.movementDistanceMeters) ||
    state.movementDistanceMeters < 0 ||
    !Number.isSafeInteger(state.collisionResolutionCount) ||
    !Number.isSafeInteger(state.interactionAttemptCount) ||
    !Number.isSafeInteger(state.interactionActivationCount) ||
    !Number.isSafeInteger(state.npcAvoidanceAdjustmentCount) ||
    !Number.isSafeInteger(state.npcMovingAgentCount) ||
    state.npcMovingAgentCount > state.npcAgents.length ||
    !Number.isSafeInteger(state.npcScheduleTransitionCount) ||
    !Number.isFinite(state.npcMovementDistanceMeters) ||
    state.npcMovementDistanceMeters < 0 ||
    state.npcAgents.length !== NPC_CROWD_BALANCE.agentCount ||
    (state.lastInteractionMarkerIndex !== -1 &&
      (state.lastInteractionMarkerIndex < 0 || state.lastInteractionMarkerIndex >= markerCount))
  ) {
    throw new Error("Game simulation state contains invalid controller or crowd values");
  }
  assertInputState(state.inputForward, state.inputRight, state.playerYawRadians, 0);
  for (const [index, agent] of state.npcAgents.entries()) {
    const route = schedules.routes[agent.routeIndex];
    const segment = route?.segments[agent.targetStopIndex];
    if (
      agent.entityId !== NPC_ENTITY_ID_START + index ||
      route === undefined ||
      segment === undefined ||
      !Number.isSafeInteger(agent.pathCursor) ||
      agent.pathCursor < 0 ||
      agent.pathCursor > segment.nodes.length ||
      !Number.isSafeInteger(agent.dwellTicks) ||
      agent.dwellTicks < 0 ||
      agent.dwellTicks > NPC_CROWD_BALANCE.scheduleDwellTicks ||
      !Number.isFinite(agent.yawRadians) ||
      agent.position.some((value) => !Number.isFinite(value)) ||
      !navigation.isWalkablePosition(agent.position[0], agent.position[2]) ||
      Math.abs(
        agent.position[1] -
          Math.fround(
            navigation.groundHeight(agent.position[0], agent.position[2]) +
              NPC_CROWD_BALANCE.agentHeightMeters / 2,
          ),
      ) > 0.000_1 ||
      !npcPoseMatchesPath(agent, segment, navigation)
    ) {
      throw new Error("Game simulation state contains invalid NPC values");
    }
  }
}

function npcPoseMatchesPath(
  agent: NpcAgentState,
  segment: NpcScheduleSet["routes"][number]["segments"][number],
  navigation: DeterministicNavigationMesh,
): boolean {
  if (agent.pathCursor === 0) return false;
  if (agent.pathCursor >= segment.nodes.length) {
    const finalNode = segment.nodes.at(-1);
    return (
      finalNode !== undefined &&
      Math.hypot(finalNode[0] - agent.position[0], finalNode[2] - agent.position[2]) <=
        NPC_CROWD_BALANCE.waypointArrivalMeters + 0.000_1
    );
  }
  const target = segment.nodes[agent.pathCursor];
  return target !== undefined && navigation.canTraverseSegment(agent.position, target);
}

function assertInputState(
  inputForward: number,
  inputRight: number,
  yawRadians: number,
  flags: number,
): void {
  if (
    !Number.isFinite(inputForward) ||
    !Number.isFinite(inputRight) ||
    !Number.isFinite(yawRadians) ||
    Math.abs(inputForward) > 1 ||
    Math.abs(inputRight) > 1 ||
    !Number.isSafeInteger(flags) ||
    flags < 0 ||
    (flags & ~INPUT_INTERACT_PRESSED) !== 0
  ) {
    throw new Error("Player input state values are invalid");
  }
}

export function createPlayerInputCommand(
  sequence: number,
  targetTick: number,
  input: Readonly<{
    readonly forward: number;
    readonly interactPressed?: boolean;
    readonly right: number;
    readonly yawRadians: number;
  }>,
): SimulationCommand {
  const payload = new Uint8Array(INPUT_PAYLOAD_BYTES);
  const view = new DataView(payload.buffer);
  view.setFloat32(0, input.forward, true);
  view.setFloat32(4, input.right, true);
  view.setFloat32(8, input.yawRadians, true);
  view.setUint32(12, input.interactPressed === true ? INPUT_INTERACT_PRESSED : 0, true);
  return Object.freeze({ kind: INPUT_COMMAND_KIND, payload, sequence, targetTick });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function markerIndexPayload(markerIndex: number): Uint8Array {
  const payload = new Uint8Array(Uint32Array.BYTES_PER_ELEMENT);
  new DataView(payload.buffer).setUint32(0, markerIndex, true);
  return payload;
}

function interactionEvents(target: InteractionTarget | null) {
  if (target === null) return EMPTY_EVENTS;
  return Object.freeze([
    Object.freeze({
      kind: target.kind === "npc" ? "npc.interaction-activated" : "interaction.activated",
      payload: markerIndexPayload(target.value),
    }),
  ]);
}
