import {
  type ArcRotateCamera,
  addToScene,
  createBoxData,
  createMeshFromData,
  createStandardMaterial,
  type EngineContext,
  type Mesh,
  type SceneContext,
  setMeshVisible,
  updateMeshPositions,
} from "@babylonjs/lite";
import {
  HYBRID_UI_HEAVY_PRIMITIVE_CAPACITY,
  HYBRID_UI_WORLD_ANCHOR_CAPACITY,
  type HybridUiAction,
  type HybridUiHeavyPrimitive,
  type HybridUiPresentation,
  type HybridUiTone,
  type HybridUiWorkerInput,
  type HybridUiWorkerTelemetrySnapshot,
  hybridUiHeavyScreenGeometryEqual,
  idleHybridUiWorkerTelemetry,
} from "../ui/hybrid-ui-contract";
import { topmostHybridUiPrimitiveAt } from "../ui/hybrid-ui-hit-test";

interface GeometryPool {
  readonly basePositions: Float32Array;
  readonly capacity: number;
  readonly mesh: Mesh;
  readonly positions: Float32Array;
  readonly verticesPerBox: number;
}

export interface HybridUiRenderer {
  readonly meshes: readonly Mesh[];
  apply(presentation: HybridUiPresentation): void;
  handleInput(input: HybridUiWorkerInput): HybridUiAction | null;
  snapshot(): HybridUiWorkerTelemetrySnapshot;
  updateCamera(): void;
}

const TONES = Object.freeze(["neutral", "accent", "danger", "disabled"] as const);
const TONE_COLORS: Readonly<Record<HybridUiTone, readonly [number, number, number]>> =
  Object.freeze({
    accent: Object.freeze([0.18, 0.72, 0.94] as const),
    danger: Object.freeze([0.9, 0.18, 0.2] as const),
    disabled: Object.freeze([0.16, 0.2, 0.24] as const),
    neutral: Object.freeze([0.055, 0.12, 0.2] as const),
  });
const SCREEN_DISTANCE_METERS = 0.6;
const SCREEN_COVERAGE = 1;
const SCREEN_LAYER_STEP_METERS = 0.000001;
const SCREEN_PRIMITIVE_DEPTH_METERS = 0.000001;
const NO_HEAVY_PRIMITIVES: readonly HybridUiHeavyPrimitive[] = Object.freeze([]);

export function createHybridUiRenderer(
  engine: EngineContext,
  scene: SceneContext,
  camera: ArcRotateCamera,
): HybridUiRenderer {
  const anchorPools = createTonePools(
    engine,
    scene,
    "hybrid-ui-world-anchor",
    HYBRID_UI_WORLD_ANCHOR_CAPACITY,
  );
  const screenPools = createTonePools(
    engine,
    scene,
    "hybrid-ui-heavy-screen",
    HYBRID_UI_HEAVY_PRIMITIVE_CAPACITY,
  );
  const meshes = Object.freeze([
    ...TONES.map((tone) => anchorPools[tone].mesh),
    ...TONES.map((tone) => screenPools[tone].mesh),
  ]);
  let presentation: HybridUiPresentation | null = null;
  let focusedActionId: string | null = null;
  let lastInputSequence = -1;
  let telemetry = idleHybridUiWorkerTelemetry();

  const updateScreenGeometry = (): void => {
    const screen = presentation?.heavyScreen;
    const startedAt = performance.now();
    for (const tone of TONES) {
      writeScreenPrimitives(
        engine,
        screenPools[tone],
        screen?.visible === true ? screen.primitives : NO_HEAVY_PRIMITIVES,
        tone,
        focusedActionId,
      );
    }
    telemetry = Object.freeze({
      ...telemetry,
      presentationUpdateDurationHighWaterMs: Math.max(
        telemetry.presentationUpdateDurationHighWaterMs,
        performance.now() - startedAt,
      ),
    });
  };

  return Object.freeze({
    apply(next: HybridUiPresentation): void {
      const startedAt = performance.now();
      if (presentation !== null && next.revision <= presentation.revision) return;
      const previous = presentation;
      const screenChanged =
        previous === null ||
        !hybridUiHeavyScreenGeometryEqual(previous.heavyScreen, next.heavyScreen);
      presentation = next;
      if (screenChanged) focusedActionId = next.heavyScreen?.focusActionId ?? null;
      if (previous === null || !worldAnchorsEqual(previous.worldAnchors, next.worldAnchors)) {
        for (const tone of TONES) {
          writeWorldAnchors(engine, anchorPools[tone], next.worldAnchors, tone);
        }
      }
      if (screenChanged) {
        updateScreenGeometry();
      }
      telemetry = Object.freeze({
        ...telemetry,
        heavyPrimitiveCount:
          next.heavyScreen?.visible === true ? next.heavyScreen.primitives.length : 0,
        presentationCount: telemetry.presentationCount + 1,
        presentationRevision: next.revision,
        presentationUpdateDurationHighWaterMs: Math.max(
          telemetry.presentationUpdateDurationHighWaterMs,
          performance.now() - startedAt,
        ),
        worldAnchorCount: countVisibleWorldAnchors(next.worldAnchors),
      });
    },
    handleInput(input: HybridUiWorkerInput): HybridUiAction | null {
      if (input.sequence <= lastInputSequence) {
        throw new Error("Hybrid UI worker input sequence is not strictly increasing");
      }
      lastInputSequence = input.sequence;
      let actionId: string | null = null;
      let hitTestDurationMs = 0;
      const screen = presentation?.heavyScreen;
      if (screen?.visible === true) {
        if (input.kind === "pointer-activate") {
          const hitTestStartedAt = performance.now();
          const primitive = topmostHybridUiPrimitiveAt(screen.primitives, input.x, input.y);
          if (primitive !== null && !primitive.disabled && primitive.actionId !== null) {
            focusedActionId = primitive.actionId;
            actionId = primitive.actionId;
          }
          hitTestDurationMs = performance.now() - hitTestStartedAt;
          if (actionId !== null) {
            updateScreenGeometry();
          }
        } else if (input.kind === "semantic-activate") {
          const semantic = screen.semanticActions.find(
            (candidate) => candidate.actionId === input.actionId && !candidate.disabled,
          );
          const primitive = screen.primitives.find(
            (candidate) => candidate.actionId === input.actionId && !candidate.disabled,
          );
          if (semantic !== undefined && primitive !== undefined) {
            focusedActionId = input.actionId;
            actionId = input.actionId;
            updateScreenGeometry();
          }
        } else if (input.kind === "cancel") {
          actionId = screen.cancelActionId;
        } else if (input.kind === "activate") {
          const primitive = screen.primitives.find(
            (candidate) => candidate.actionId === focusedActionId && !candidate.disabled,
          );
          actionId = primitive?.actionId ?? null;
        } else {
          focusedActionId = nextFocusActionId(
            screen.primitives,
            focusedActionId,
            input.kind === "focus-next" ? 1 : -1,
          );
          updateScreenGeometry();
        }
      }
      const action =
        actionId === null || presentation === null
          ? null
          : Object.freeze({
              actionId,
              inputSequence: input.sequence,
              payload: null,
              presentationRevision: presentation.revision,
              source: "heavy-screen-worker" as const,
            });
      telemetry = Object.freeze({
        ...telemetry,
        actionCount: telemetry.actionCount + (action === null ? 0 : 1),
        hitTestDurationHighWaterMs: Math.max(
          telemetry.hitTestDurationHighWaterMs,
          hitTestDurationMs,
        ),
        inputCount: telemetry.inputCount + 1,
      });
      return action;
    },
    meshes,
    snapshot(): HybridUiWorkerTelemetrySnapshot {
      return telemetry;
    },
    updateCamera(): void {
      if (presentation?.heavyScreen?.visible !== true) return;
      positionScreenPools(screenPools, camera, engine.canvas.width / engine.canvas.height);
    },
  });
}

function createTonePools(
  engine: EngineContext,
  scene: SceneContext,
  prefix: string,
  capacity: number,
): Record<HybridUiTone, GeometryPool> {
  return Object.fromEntries(
    TONES.map((tone) => {
      const pool = createGeometryPool(engine, `${prefix}-${tone}`, capacity);
      const material = createStandardMaterial();
      const color = TONE_COLORS[tone];
      material.diffuseColor = [color[0], color[1], color[2]];
      material.specularColor = [0, 0, 0];
      pool.mesh.material = material;
      pool.mesh.pickable = false;
      setMeshVisible(pool.mesh, false);
      addToScene(scene, pool.mesh);
      return [tone, pool];
    }),
  ) as Record<HybridUiTone, GeometryPool>;
}

function createGeometryPool(engine: EngineContext, name: string, capacity: number): GeometryPool {
  const box = createBoxData(1);
  const positions = new Float32Array(box.positions.length * capacity);
  const normals = new Float32Array(box.normals.length * capacity);
  const uvs = new Float32Array(box.uvs.length * capacity);
  const indices = new Uint32Array(box.indices.length * capacity);
  for (let slot = 0; slot < capacity; slot += 1) {
    normals.set(box.normals, slot * box.normals.length);
    uvs.set(box.uvs, slot * box.uvs.length);
    const vertexOffset = slot * box.vertexCount;
    const indexOffset = slot * box.indices.length;
    for (let index = 0; index < box.indices.length; index += 1) {
      indices[indexOffset + index] = (box.indices[index] ?? 0) + vertexOffset;
    }
  }
  const mesh = createMeshFromData(engine, name, positions, normals, indices, uvs);
  return Object.freeze({
    basePositions: box.positions,
    capacity,
    mesh,
    positions,
    verticesPerBox: box.vertexCount,
  });
}

function writeWorldAnchors(
  engine: EngineContext,
  pool: GeometryPool,
  anchors: HybridUiPresentation["worldAnchors"],
  tone: HybridUiTone,
): void {
  pool.positions.fill(0);
  let count = 0;
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let minimumZ = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  let maximumZ = Number.NEGATIVE_INFINITY;
  for (const anchor of anchors) {
    if (!anchor.visible || anchor.tone !== tone) continue;
    writeBox(
      pool,
      count,
      anchor.position[0],
      anchor.position[1],
      anchor.position[2],
      anchor.sizeMeters[0],
      anchor.sizeMeters[1],
      0.08,
    );
    count += 1;
    minimumX = Math.min(minimumX, anchor.position[0] - anchor.sizeMeters[0] / 2);
    minimumY = Math.min(minimumY, anchor.position[1] - anchor.sizeMeters[1] / 2);
    minimumZ = Math.min(minimumZ, anchor.position[2] - 0.04);
    maximumX = Math.max(maximumX, anchor.position[0] + anchor.sizeMeters[0] / 2);
    maximumY = Math.max(maximumY, anchor.position[1] + anchor.sizeMeters[1] / 2);
    maximumZ = Math.max(maximumZ, anchor.position[2] + 0.04);
  }
  pool.mesh.position.set(0, 0, 0);
  pool.mesh.rotation.set(0, 0, 0);
  pool.mesh.scaling.set(1, 1, 1);
  setMeshVisible(pool.mesh, count > 0);
  if (count > 0) {
    pool.mesh.boundMin = [minimumX, minimumY, minimumZ];
    pool.mesh.boundMax = [maximumX, maximumY, maximumZ];
  }
  updateMeshPositions(engine, pool.mesh, pool.positions);
}

function writeScreenPrimitives(
  engine: EngineContext,
  pool: GeometryPool,
  primitives: readonly HybridUiHeavyPrimitive[],
  tone: HybridUiTone,
  focusedActionId: string | null,
): void {
  pool.positions.fill(0);
  let count = 0;
  for (const primitive of primitives) {
    if (effectiveTone(primitive, focusedActionId) !== tone) continue;
    const frontZ =
      -0.002 - primitive.layer * SCREEN_LAYER_STEP_METERS - SCREEN_PRIMITIVE_DEPTH_METERS / 2;
    const projectionScale = (SCREEN_DISTANCE_METERS + frontZ) / SCREEN_DISTANCE_METERS;
    writeBox(
      pool,
      count,
      (primitive.rect.x + primitive.rect.width / 2 - 0.5) * projectionScale,
      (0.5 - primitive.rect.y - primitive.rect.height / 2) * projectionScale,
      frontZ + SCREEN_PRIMITIVE_DEPTH_METERS / 2,
      primitive.rect.width * projectionScale,
      primitive.rect.height * projectionScale,
      SCREEN_PRIMITIVE_DEPTH_METERS,
    );
    count += 1;
  }
  setMeshVisible(pool.mesh, count > 0);
  pool.mesh.boundMin = [-0.51, -0.51, -0.01];
  pool.mesh.boundMax = [0.51, 0.51, 0.01];
  updateMeshPositions(engine, pool.mesh, pool.positions);
}

function writeBox(
  pool: GeometryPool,
  slot: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
): void {
  if (slot >= pool.capacity) throw new Error("Hybrid UI geometry pool capacity exceeded");
  const outputOffset = slot * pool.verticesPerBox * 3;
  for (let vertex = 0; vertex < pool.verticesPerBox; vertex += 1) {
    const sourceOffset = vertex * 3;
    pool.positions[outputOffset + sourceOffset] =
      centerX + (pool.basePositions[sourceOffset] ?? 0) * sizeX;
    pool.positions[outputOffset + sourceOffset + 1] =
      centerY + (pool.basePositions[sourceOffset + 1] ?? 0) * sizeY;
    pool.positions[outputOffset + sourceOffset + 2] =
      centerZ + (pool.basePositions[sourceOffset + 2] ?? 0) * sizeZ;
  }
}

function positionScreenPools(
  pools: Record<HybridUiTone, GeometryPool>,
  camera: ArcRotateCamera,
  aspect: number,
): void {
  const cameraWorld = camera.worldMatrix;
  const cameraX = cameraWorld[12] ?? 0;
  const cameraY = cameraWorld[13] ?? 0;
  const cameraZ = cameraWorld[14] ?? 0;
  const offsetX = camera.target.x - cameraX;
  const offsetY = camera.target.y - cameraY;
  const offsetZ = camera.target.z - cameraZ;
  const length = Math.hypot(offsetX, offsetY, offsetZ);
  const forwardX = length === 0 ? 0 : offsetX / length;
  const forwardY = length === 0 ? 0 : offsetY / length;
  const forwardZ = length === 0 ? 1 : offsetZ / length;
  const centerX = cameraX + forwardX * SCREEN_DISTANCE_METERS;
  const centerY = cameraY + forwardY * SCREEN_DISTANCE_METERS;
  const centerZ = cameraZ + forwardZ * SCREEN_DISTANCE_METERS;
  const screenHeight = 2 * SCREEN_DISTANCE_METERS * Math.tan(camera.fov / 2) * SCREEN_COVERAGE;
  const pitch = -Math.asin(Math.max(-1, Math.min(1, forwardY)));
  const yaw = Math.atan2(forwardX, forwardZ);
  for (const tone of TONES) {
    const pool = pools[tone];
    pool.mesh.position.set(centerX, centerY, centerZ);
    pool.mesh.rotation.set(pitch, yaw, 0);
    pool.mesh.scaling.set(screenHeight * aspect, screenHeight, 1);
  }
}

function effectiveTone(
  primitive: HybridUiHeavyPrimitive,
  focusedActionId: string | null,
): HybridUiTone {
  if (primitive.disabled) return "disabled";
  return primitive.actionId !== null && primitive.actionId === focusedActionId
    ? "accent"
    : primitive.tone;
}

function nextFocusActionId(
  primitives: readonly HybridUiHeavyPrimitive[],
  current: string | null,
  direction: 1 | -1,
): string | null {
  let first: string | null = null;
  let last: string | null = null;
  let returnNext = current === null && direction === 1;
  for (const primitive of primitives) {
    if (primitive.actionId === null || primitive.disabled) continue;
    first ??= primitive.actionId;
    if (returnNext) return primitive.actionId;
    if (direction === 1 && primitive.actionId === current) returnNext = true;
    if (direction === -1 && primitive.actionId === current)
      return last ?? lastEnabledAction(primitives);
    last = primitive.actionId;
  }
  if (current === null && direction === -1) return last;
  return direction === 1 ? first : last;
}

function lastEnabledAction(primitives: readonly HybridUiHeavyPrimitive[]): string | null {
  for (let index = primitives.length - 1; index >= 0; index -= 1) {
    const primitive = primitives[index];
    if (primitive !== undefined && primitive.actionId !== null && !primitive.disabled) {
      return primitive.actionId;
    }
  }
  return null;
}

function countVisibleWorldAnchors(anchors: HybridUiPresentation["worldAnchors"]): number {
  let count = 0;
  for (const anchor of anchors) {
    if (anchor.visible) count += 1;
  }
  return count;
}

function worldAnchorsEqual(
  left: HybridUiPresentation["worldAnchors"],
  right: HybridUiPresentation["worldAnchors"],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((anchor, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      anchor.id === other.id &&
      anchor.tone === other.tone &&
      anchor.visible === other.visible &&
      anchor.position.every((value, component) => value === other.position[component]) &&
      anchor.sizeMeters.every((value, component) => value === other.sizeMeters[component])
    );
  });
}
