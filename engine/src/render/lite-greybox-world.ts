import {
  addToScene,
  captureScreenshot,
  createArcRotateCamera,
  createBoxData,
  createEngine,
  createHemisphericLight,
  createMeshFromData,
  createSceneContext,
  createStandardMaterial,
  disposeMeshGpu,
  type Mesh,
  registerScene,
  removeFromScene,
  renderFrame,
  setEngineSize,
} from "@babylonjs/lite";
import type {
  FlythroughScenarioSample,
  FlythroughWeatherState,
} from "../flythrough/flythrough-contract";
import { flythroughCameraPose } from "../flythrough/flythrough-contract";
import type {
  GreyboxCell,
  GreyboxHeightfieldGridPayload,
  GreyboxMaterial,
  GreyboxPrimitive,
  GreyboxSceneConfig,
} from "../world/world-contract";
import { selectGreyboxCellLod, validateGreyboxDistrict } from "../world/world-contract";
import type {
  FlythroughCheckpointRenderEvidence,
  GreyboxWorkerRenderTelemetry,
} from "./render-protocol";

export interface GeometryBatch {
  readonly indices: Uint32Array;
  readonly normals: Float32Array;
  readonly positions: Float32Array;
  readonly triangleCount: number;
  readonly uvs: Float32Array;
}

export interface HeightfieldBatchEntry {
  readonly cell: GreyboxCell;
  readonly representation: GreyboxHeightfieldGridPayload;
}

const WEATHER_INTENSITY = Object.freeze({
  clear: 1,
  overcast: 0.62,
  storm: 0.38,
} as const);

const WEATHER_CLEAR_COLOR = Object.freeze({
  clear: Object.freeze([0.32, 0.64, 0.92] as const),
  overcast: Object.freeze([0.2, 0.28, 0.38] as const),
  storm: Object.freeze([0.055, 0.075, 0.11] as const),
} as const);

export function createGeometryBatch(primitives: readonly GreyboxPrimitive[]): GeometryBatch {
  const box = createBoxData(1);
  const vertexCount = box.vertexCount * primitives.length;
  const indexCount = box.indexCount * primitives.length;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);

  for (const [primitiveIndex, primitive] of primitives.entries()) {
    const vertexOffset = primitiveIndex * box.vertexCount;
    const positionOffset = vertexOffset * 3;
    const uvOffset = vertexOffset * 2;
    const sine = Math.sin(primitive.rotationYRadians);
    const cosine = Math.cos(primitive.rotationYRadians);
    for (let vertex = 0; vertex < box.vertexCount; vertex += 1) {
      const sourcePosition = vertex * 3;
      const localX = (box.positions[sourcePosition] ?? 0) * primitive.size[0];
      const localY = (box.positions[sourcePosition + 1] ?? 0) * primitive.size[1];
      const localZ = (box.positions[sourcePosition + 2] ?? 0) * primitive.size[2];
      positions[positionOffset + sourcePosition] =
        primitive.center[0] + localX * cosine - localZ * sine;
      positions[positionOffset + sourcePosition + 1] = primitive.center[1] + localY;
      positions[positionOffset + sourcePosition + 2] =
        primitive.center[2] + localX * sine + localZ * cosine;

      const normalX = box.normals[sourcePosition] ?? 0;
      const normalY = box.normals[sourcePosition + 1] ?? 0;
      const normalZ = box.normals[sourcePosition + 2] ?? 0;
      normals[positionOffset + sourcePosition] = normalX * cosine - normalZ * sine;
      normals[positionOffset + sourcePosition + 1] = normalY;
      normals[positionOffset + sourcePosition + 2] = normalX * sine + normalZ * cosine;

      const sourceUv = vertex * 2;
      uvs[uvOffset + sourceUv] = box.uvs[sourceUv] ?? 0;
      uvs[uvOffset + sourceUv + 1] = box.uvs[sourceUv + 1] ?? 0;
    }
    const indexOffset = primitiveIndex * box.indexCount;
    for (let index = 0; index < box.indexCount; index += 1) {
      indices[indexOffset + index] = (box.indices[index] ?? 0) + vertexOffset;
    }
  }

  return Object.freeze({
    indices,
    normals,
    positions,
    triangleCount: indexCount / 3,
    uvs,
  });
}

export function createHeightfieldGeometryBatch(
  entries: readonly HeightfieldBatchEntry[],
): GeometryBatch {
  let vertexCount = 0;
  let indexCount = 0;
  const worldHeights = new Map<string, number>();
  const entriesByCoordinate = new Map(
    entries.map((entry) => [`${entry.cell.coordinate[0]},${entry.cell.coordinate[1]}`, entry]),
  );
  const needsSkirt = (entry: HeightfieldBatchEntry, offset: readonly [number, number]): boolean => {
    const neighbor = entriesByCoordinate.get(
      `${entry.cell.coordinate[0] + offset[0]},${entry.cell.coordinate[1] + offset[1]}`,
    );
    return (
      neighbor === undefined ||
      neighbor.representation.sampleStride !== entry.representation.sampleStride
    );
  };
  for (const entry of entries) {
    const { cell, representation } = entry;
    const heightfield = cell.collision.heightfield;
    const columns = (heightfield.columns - 1) / representation.sampleStride + 1;
    const rows = (heightfield.rows - 1) / representation.sampleStride + 1;
    const skirtSampleCount =
      (needsSkirt(entry, [0, -1]) ? columns : 0) +
      (needsSkirt(entry, [0, 1]) ? columns : 0) +
      (needsSkirt(entry, [-1, 0]) ? rows : 0) +
      (needsSkirt(entry, [1, 0]) ? rows : 0);
    const skirtCount =
      Number(needsSkirt(entry, [0, -1])) +
      Number(needsSkirt(entry, [0, 1])) +
      Number(needsSkirt(entry, [-1, 0])) +
      Number(needsSkirt(entry, [1, 0]));
    vertexCount += columns * rows + skirtSampleCount * 2;
    indexCount += (columns - 1) * (rows - 1) * 6 + (skirtSampleCount - skirtCount) * 6;
    for (let row = 0; row < heightfield.rows; row += 1) {
      for (let column = 0; column < heightfield.columns; column += 1) {
        const x = heightfield.origin[0] + column * heightfield.sampleSpacingMeters;
        const z = heightfield.origin[2] + row * heightfield.sampleSpacingMeters;
        const key = `${x},${z}`;
        const height = heightfield.heights[row * heightfield.columns + column] ?? 0;
        const existing = worldHeights.get(key);
        if (existing !== undefined && existing !== height) {
          throw new Error(`Greybox heightfield seam mismatch at ${key}`);
        }
        worldHeights.set(key, height);
      }
    }
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);
  let vertexBase = 0;
  let indexBase = 0;
  for (const entry of entries) {
    const { cell, representation } = entry;
    const heightfield = cell.collision.heightfield;
    const stride = representation.sampleStride;
    const sampledColumns = (heightfield.columns - 1) / stride + 1;
    const sampledRows = (heightfield.rows - 1) / stride + 1;
    const heightAt = (column: number, row: number): number =>
      heightfield.heights[row * heightfield.columns + column] ?? 0;
    const surfaceVertexBase = vertexBase;
    for (let sampledRow = 0; sampledRow < sampledRows; sampledRow += 1) {
      const row = sampledRow * stride;
      for (let sampledColumn = 0; sampledColumn < sampledColumns; sampledColumn += 1) {
        const column = sampledColumn * stride;
        const vertex = vertexBase + sampledRow * sampledColumns + sampledColumn;
        const position = vertex * 3;
        const worldX = heightfield.origin[0] + column * heightfield.sampleSpacingMeters;
        const worldZ = heightfield.origin[2] + row * heightfield.sampleSpacingMeters;
        positions[position] = worldX;
        positions[position + 1] = heightAt(column, row);
        positions[position + 2] = worldZ;

        const spacing = heightfield.sampleSpacingMeters;
        const centerHeight = heightAt(column, row);
        const westHeight = worldHeights.get(`${worldX - spacing},${worldZ}`);
        const eastHeight = worldHeights.get(`${worldX + spacing},${worldZ}`);
        const southHeight = worldHeights.get(`${worldX},${worldZ - spacing}`);
        const northHeight = worldHeights.get(`${worldX},${worldZ + spacing}`);
        const slopeX =
          ((eastHeight ?? centerHeight) - (westHeight ?? centerHeight)) /
          (spacing * (eastHeight === undefined || westHeight === undefined ? 1 : 2));
        const slopeZ =
          ((northHeight ?? centerHeight) - (southHeight ?? centerHeight)) /
          (spacing * (northHeight === undefined || southHeight === undefined ? 1 : 2));
        const inverseLength = 1 / Math.hypot(slopeX, 1, slopeZ);
        normals[position] = -slopeX * inverseLength;
        normals[position + 1] = inverseLength;
        normals[position + 2] = -slopeZ * inverseLength;
        const uv = vertex * 2;
        uvs[uv] = sampledColumn / (sampledColumns - 1);
        uvs[uv + 1] = sampledRow / (sampledRows - 1);
      }
    }
    for (let row = 0; row + 1 < sampledRows; row += 1) {
      for (let column = 0; column + 1 < sampledColumns; column += 1) {
        const southwest = vertexBase + row * sampledColumns + column;
        const southeast = southwest + 1;
        const northwest = southwest + sampledColumns;
        const northeast = northwest + 1;
        indices[indexBase] = southwest;
        indices[indexBase + 1] = southeast;
        indices[indexBase + 2] = northwest;
        indices[indexBase + 3] = southeast;
        indices[indexBase + 4] = northeast;
        indices[indexBase + 5] = northwest;
        indexBase += 6;
      }
    }
    vertexBase = surfaceVertexBase + sampledColumns * sampledRows;
    const addSkirt = (
      samples: readonly (readonly [number, number])[],
      normal: readonly [number, number, number],
      reverseWinding: boolean,
    ): void => {
      const skirtBase = vertexBase;
      for (const [sampleIndex, [column, row]] of samples.entries()) {
        const worldX = heightfield.origin[0] + column * heightfield.sampleSpacingMeters;
        const worldZ = heightfield.origin[2] + row * heightfield.sampleSpacingMeters;
        for (const [verticalIndex, y] of [
          heightAt(column, row),
          cell.bounds.minimum[1],
        ].entries()) {
          const vertex = skirtBase + sampleIndex * 2 + verticalIndex;
          const position = vertex * 3;
          positions[position] = worldX;
          positions[position + 1] = y;
          positions[position + 2] = worldZ;
          normals[position] = normal[0];
          normals[position + 1] = normal[1];
          normals[position + 2] = normal[2];
          const uv = vertex * 2;
          uvs[uv] = sampleIndex / Math.max(1, samples.length - 1);
          uvs[uv + 1] = verticalIndex;
        }
      }
      for (let segment = 0; segment + 1 < samples.length; segment += 1) {
        const top0 = skirtBase + segment * 2;
        const bottom0 = top0 + 1;
        const top1 = top0 + 2;
        const bottom1 = top1 + 1;
        const triangles = reverseWinding
          ? [bottom0, top1, top0, bottom0, bottom1, top1]
          : [top0, top1, bottom0, top1, bottom1, bottom0];
        for (const vertex of triangles) {
          indices[indexBase] = vertex;
          indexBase += 1;
        }
      }
      vertexBase += samples.length * 2;
    };
    const sampledColumnsList = Array.from({ length: sampledColumns }, (_, index) => index * stride);
    const sampledRowsList = Array.from({ length: sampledRows }, (_, index) => index * stride);
    if (needsSkirt(entry, [0, -1])) {
      addSkirt(
        sampledColumnsList.map((column) => [column, 0] as const),
        [0, 0, -1],
        true,
      );
    }
    if (needsSkirt(entry, [0, 1])) {
      addSkirt(
        sampledColumnsList.map((column) => [column, heightfield.rows - 1] as const),
        [0, 0, 1],
        false,
      );
    }
    if (needsSkirt(entry, [-1, 0])) {
      addSkirt(
        sampledRowsList.map((row) => [0, row] as const),
        [-1, 0, 0],
        false,
      );
    }
    if (needsSkirt(entry, [1, 0])) {
      addSkirt(
        sampledRowsList.map((row) => [heightfield.columns - 1, row] as const),
        [1, 0, 0],
        true,
      );
    }
  }

  return Object.freeze({
    indices,
    normals,
    positions,
    triangleCount: indexCount / 3,
    uvs,
  });
}

function requireMaterial(
  materials: ReadonlyMap<string, GreyboxMaterial>,
  materialId: string,
): GreyboxMaterial {
  const material = materials.get(materialId);
  if (material === undefined) throw new Error(`Greybox material ${materialId} is missing`);
  return material;
}

export async function createLiteGreyboxWorld(
  canvas: OffscreenCanvas,
  width: number,
  height: number,
  config: GreyboxSceneConfig,
) {
  const materializationStartedAt = performance.now();
  const validation = validateGreyboxDistrict(config.world);
  const engine = await createEngine(canvas, { msaaSamples: 4 });
  setEngineSize(engine, width, height);
  const scene = createSceneContext(engine);
  scene.clearColor = {
    a: config.clearColor[3],
    b: config.clearColor[2],
    g: config.clearColor[1],
    r: config.clearColor[0],
  };

  const camera = createArcRotateCamera(
    config.camera.alpha,
    config.camera.beta,
    config.camera.radius,
    {
      x: config.camera.target[0],
      y: config.camera.target[1],
      z: config.camera.target[2],
    },
  );
  camera.nearPlane = config.camera.minZ;
  camera.farPlane = Math.max(10_000, config.camera.radius * 3);
  scene.camera = camera;

  const light = createHemisphericLight([0.25, 1, 0.15], 1);
  addToScene(scene, light);

  const materials = new Map(config.world.materials.map((material) => [material.id, material]));
  const primitivesByMaterial = new Map<string, GreyboxPrimitive[]>();
  const heightfieldsByMaterial = new Map<string, HeightfieldBatchEntry[]>();
  const selectedLodCellCounts: [number, number, number] = [0, 0, 0];
  let renderedFeaturePrimitiveCount = 0;
  let renderedTerrainPatchCount = 0;
  for (const cell of config.world.cells) {
    const selected = selectGreyboxCellLod(cell, config.lodObservers, {
      hysteresisMeters: config.world.lodHysteresisMeters,
    });
    if (selected.lod === null) continue;
    selectedLodCellCounts[selected.lod.tier] += 1;
    for (const representation of selected.lod.representations) {
      switch (representation.kind) {
        case "triangle-boxes":
          for (const primitive of representation.primitives) {
            const primitives = primitivesByMaterial.get(primitive.materialId) ?? [];
            primitives.push(primitive);
            primitivesByMaterial.set(primitive.materialId, primitives);
            renderedFeaturePrimitiveCount += 1;
          }
          break;
        case "heightfield-grid": {
          const heightfields = heightfieldsByMaterial.get(representation.materialId) ?? [];
          heightfields.push(Object.freeze({ cell, representation }));
          heightfieldsByMaterial.set(representation.materialId, heightfields);
          renderedTerrainPatchCount += 1;
          break;
        }
        case "gaussian-splats":
        case "meshlets":
          throw new Error(
            `Greybox preview cannot materialize ${representation.kind} representation ${representation.artifactId}`,
          );
      }
    }
  }

  let renderedTriangleCount = 0;
  const previewMeshes: Mesh[] = [];
  for (const materialDefinition of config.world.materials) {
    const primitives = primitivesByMaterial.get(materialDefinition.id) ?? [];
    const definition = requireMaterial(materials, materialDefinition.id);
    const addGeometry = (geometry: GeometryBatch, suffix: string): void => {
      const mesh = createMeshFromData(
        engine,
        `greybox-${materialDefinition.id}-${suffix}`,
        geometry.positions,
        geometry.normals,
        geometry.indices,
        geometry.uvs,
      );
      const material = createStandardMaterial();
      material.diffuseColor = [definition.color[0], definition.color[1], definition.color[2]];
      mesh.material = material;
      addToScene(scene, mesh);
      previewMeshes.push(mesh);
      renderedTriangleCount += geometry.triangleCount;
    };
    if (primitives.length > 0) addGeometry(createGeometryBatch(primitives), "boxes");
    const heightfields = heightfieldsByMaterial.get(materialDefinition.id) ?? [];
    if (heightfields.length > 0) {
      addGeometry(createHeightfieldGeometryBatch(heightfields), "heightfields");
    }
  }
  await registerScene(scene);

  const telemetry: GreyboxWorkerRenderTelemetry = Object.freeze({
    cellCount: validation.cellCount,
    clearColor: config.clearColor,
    colliderCount: validation.colliderCount,
    districtId: config.world.id,
    dynamicLighting: true,
    heightSampleCount: validation.heightSampleCount,
    materialCount: config.world.materials.length,
    materializationMs: performance.now() - materializationStartedAt,
    renderedFeaturePrimitiveCount,
    renderedTerrainPatchCount,
    renderedTriangleCount,
    selectedLodCellCounts: Object.freeze(selectedLodCellCounts),
    worldBoundsMeters: Object.freeze({
      maximum: config.world.bounds.maximum,
      minimum: config.world.bounds.minimum,
    }),
  });

  return {
    animationStartedAt: null as number | null,
    camera,
    config,
    engine,
    light,
    materials,
    previousTimestamp: null as number | null,
    presentationOwner: "preview" as "preview" | "streamed-residency",
    previewMeshes: Object.freeze(previewMeshes),
    scene,
    streamingCells: new Map<string, Readonly<{ gpuBytes: number; meshes: readonly Mesh[] }>>(),
    flythroughSample: null as FlythroughScenarioSample | null,
    telemetry,
  };
}

export type LiteGreyboxWorld = Awaited<ReturnType<typeof createLiteGreyboxWorld>>;

export interface GreyboxLightingSample {
  readonly intensity: number;
  readonly phase: number;
}

function geometryGpuBytes(geometry: GeometryBatch): number {
  return (
    geometry.positions.byteLength +
    geometry.normals.byteLength +
    geometry.indices.byteLength +
    geometry.uvs.byteLength
  );
}

export function uploadStreamingGreyboxCell(
  renderer: LiteGreyboxWorld,
  cell: GreyboxCell,
): Readonly<{ gpuBytes: number }> {
  if (renderer.streamingCells.has(cell.id)) {
    throw new Error(`Streaming cell ${cell.id} is already resident`);
  }
  const lod = cell.lods[0];
  const primitivesByMaterial = new Map<string, GreyboxPrimitive[]>();
  const heightfieldsByMaterial = new Map<string, HeightfieldBatchEntry[]>();
  for (const representation of lod.representations) {
    if (representation.kind === "triangle-boxes") {
      for (const primitive of representation.primitives) {
        const primitives = primitivesByMaterial.get(primitive.materialId) ?? [];
        primitives.push(primitive);
        primitivesByMaterial.set(primitive.materialId, primitives);
      }
    } else if (representation.kind === "heightfield-grid") {
      const heightfields = heightfieldsByMaterial.get(representation.materialId) ?? [];
      heightfields.push(Object.freeze({ cell, representation }));
      heightfieldsByMaterial.set(representation.materialId, heightfields);
    } else {
      throw new Error(`Streaming greybox cannot upload ${representation.kind}`);
    }
  }
  const meshes: Mesh[] = [];
  const addedMeshes = new Set<Mesh>();
  let gpuBytes = 0;
  const addGeometry = (materialId: string, geometry: GeometryBatch, suffix: string): void => {
    const definition = requireMaterial(renderer.materials, materialId);
    const mesh = createMeshFromData(
      renderer.engine,
      `streaming-${cell.id}-${materialId}-${suffix}`,
      geometry.positions,
      geometry.normals,
      geometry.indices,
      geometry.uvs,
    );
    meshes.push(mesh);
    const material = createStandardMaterial();
    material.diffuseColor = [definition.color[0], definition.color[1], definition.color[2]];
    mesh.material = material;
    mesh.visible = renderer.presentationOwner === "streamed-residency";
    addToScene(renderer.scene, mesh);
    addedMeshes.add(mesh);
    gpuBytes += geometryGpuBytes(geometry);
  };
  try {
    const referencedMaterialIds = new Set([
      ...primitivesByMaterial.keys(),
      ...heightfieldsByMaterial.keys(),
    ]);
    for (const materialId of referencedMaterialIds) {
      requireMaterial(renderer.materials, materialId);
      const primitives = primitivesByMaterial.get(materialId);
      if (primitives !== undefined && primitives.length > 0) {
        addGeometry(materialId, createGeometryBatch(primitives), "boxes");
      }
      const heightfields = heightfieldsByMaterial.get(materialId);
      if (heightfields !== undefined && heightfields.length > 0) {
        addGeometry(materialId, createHeightfieldGeometryBatch(heightfields), "heightfield");
      }
    }
    renderer.streamingCells.set(
      cell.id,
      Object.freeze({ gpuBytes, meshes: Object.freeze(meshes) }),
    );
    return Object.freeze({ gpuBytes });
  } catch (error: unknown) {
    for (const mesh of meshes.reverse()) {
      if (addedMeshes.has(mesh)) {
        removeFromScene(renderer.scene, mesh);
      } else {
        disposeMeshGpu(mesh);
      }
    }
    throw error;
  }
}

export function applyFlythroughSample(
  renderer: LiteGreyboxWorld,
  sample: FlythroughScenarioSample,
  camera: Readonly<{ beta: number; heightMeters: number; radiusMeters: number }>,
): void {
  if (renderer.presentationOwner === "preview") {
    renderer.presentationOwner = "streamed-residency";
    for (const mesh of renderer.previewMeshes) mesh.visible = false;
    for (const resident of renderer.streamingCells.values()) {
      for (const mesh of resident.meshes) mesh.visible = true;
    }
  }
  renderer.flythroughSample = sample;
  const pose = flythroughCameraPose(sample, camera);
  renderer.camera.target.x = pose.target[0];
  renderer.camera.target.y = pose.target[1];
  renderer.camera.target.z = pose.target[2];
  renderer.camera.alpha = sample.headingRadians + Math.PI;
  renderer.camera.beta = camera.beta;
  renderer.camera.radius = camera.radiusMeters;
}

export function captureFlythroughCheckpoint(
  renderer: LiteGreyboxWorld,
  checkpointId: string,
): Promise<FlythroughCheckpointRenderEvidence> {
  const sample = renderer.flythroughSample;
  if (renderer.presentationOwner !== "streamed-residency" || sample === null) {
    throw new Error("Flythrough checkpoint requires streamed-residency presentation");
  }
  // Babylon Lite registers this request synchronously and services it from the next
  // renderFrame. Keep registration before the returned evidence promise does any async
  // processing; the render-worker queue relies on that exact order.
  return finishFlythroughCheckpointCapture(
    renderer,
    checkpointId,
    sample,
    captureScreenshot(renderer.engine),
  );
}

async function finishFlythroughCheckpointCapture(
  renderer: LiteGreyboxWorld,
  checkpointId: string,
  sample: FlythroughScenarioSample,
  capture: ReturnType<typeof captureScreenshot>,
): Promise<FlythroughCheckpointRenderEvidence> {
  const captured = await capture;
  const clearColorRgb = currentClearColorRgb(renderer);
  const clearColorDistanceThreshold = Math.max(
    2,
    Math.min(24, Math.hypot(...clearColorRgb) * 0.15),
  );
  let visiblePixelCount = 0;
  const pixelCount = captured.width * captured.height;
  for (let offset = 0; offset < captured.data.length; offset += 4) {
    const distance = Math.hypot(
      (captured.data[offset] ?? 0) - clearColorRgb[0],
      (captured.data[offset + 1] ?? 0) - clearColorRgb[1],
      (captured.data[offset + 2] ?? 0) - clearColorRgb[2],
    );
    if (distance > clearColorDistanceThreshold) visiblePixelCount += 1;
  }
  const digestInput = new Uint8Array(captured.data.byteLength);
  digestInput.set(captured.data);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  return Object.freeze({
    cameraPosition: flythroughCameraPose(sample, {
      beta: renderer.camera.beta,
      heightMeters: renderer.camera.target.y - sample.observer[1],
      radiusMeters: renderer.camera.radius,
    }).position,
    cameraTarget: Object.freeze([
      renderer.camera.target.x,
      renderer.camera.target.y,
      renderer.camera.target.z,
    ]) as readonly [number, number, number],
    checkpointId,
    clearColorDistanceThreshold,
    clearColorRgb,
    elapsedMs: sample.elapsedMs,
    environment: Object.freeze({ ...sample.environment }),
    environmentPhaseId: sample.environment.id,
    height: captured.height,
    previewVisibleMeshCount: renderer.previewMeshes.filter((mesh) => mesh.visible).length,
    rgbaSha256: [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join(""),
    sampledPixelCount: pixelCount,
    streamedVisibleMeshCount: visibleStreamingMeshCount(renderer),
    visiblePixelCount,
    visiblePixelRatio: visiblePixelCount / pixelCount,
    width: captured.width,
  });
}

export function evictStreamingGreyboxCell(renderer: LiteGreyboxWorld, cellId: string): number {
  const resident = renderer.streamingCells.get(cellId);
  if (resident === undefined) throw new Error(`Streaming cell ${cellId} is not resident`);
  for (const mesh of resident.meshes) {
    removeFromScene(renderer.scene, mesh);
  }
  renderer.streamingCells.delete(cellId);
  return resident.gpuBytes;
}

export function renderLiteGreyboxWorld(
  renderer: LiteGreyboxWorld,
  timestamp: number,
): GreyboxLightingSample {
  renderer.animationStartedAt ??= timestamp;
  const animationSeconds = (timestamp - renderer.animationStartedAt) / 1_000;
  const phase =
    renderer.flythroughSample?.environment.timeOfDayPhase ??
    (renderer.config.lighting.initialPhase +
      animationSeconds / renderer.config.lighting.cycleSeconds) %
      1;
  const weather =
    renderer.flythroughSample?.environment.weather ?? renderer.config.lighting.weather;
  const sunAngle = phase * Math.PI * 2;
  const elevation = Math.sin(sunAngle);
  renderer.light.direction.set(Math.cos(sunAngle), Math.max(0.12, elevation), Math.sin(sunAngle));
  renderer.light.intensity = WEATHER_INTENSITY[weather] * (0.12 + Math.max(0, elevation) * 0.88);
  const clearColor = environmentClearColor(weather, phase);
  renderer.scene.clearColor.r = clearColor[0];
  renderer.scene.clearColor.g = clearColor[1];
  renderer.scene.clearColor.b = clearColor[2];

  renderFrame(
    renderer.engine,
    renderer.previousTimestamp === null ? 0 : timestamp - renderer.previousTimestamp,
  );
  renderer.previousTimestamp = timestamp;
  return Object.freeze({ intensity: renderer.light.intensity, phase });
}

export function visibleStreamingMeshCount(renderer: LiteGreyboxWorld): number {
  let count = 0;
  for (const resident of renderer.streamingCells.values()) {
    count += resident.meshes.filter((mesh) => mesh.visible).length;
  }
  return count;
}

function currentClearColorRgb(renderer: LiteGreyboxWorld): readonly [number, number, number] {
  return Object.freeze([
    Math.round(renderer.scene.clearColor.r * 255),
    Math.round(renderer.scene.clearColor.g * 255),
    Math.round(renderer.scene.clearColor.b * 255),
  ]);
}

function environmentClearColor(
  weather: FlythroughWeatherState,
  phase: number,
): readonly [number, number, number] {
  const elevation = Math.sin(phase * Math.PI * 2);
  const daylight = 0.18 + Math.max(0, elevation) * 0.82;
  const base = WEATHER_CLEAR_COLOR[weather];
  return Object.freeze([base[0] * daylight, base[1] * daylight, base[2] * daylight]);
}

export function resizeLiteGreyboxWorld(
  renderer: LiteGreyboxWorld,
  width: number,
  height: number,
): void {
  setEngineSize(renderer.engine, width, height);
}
