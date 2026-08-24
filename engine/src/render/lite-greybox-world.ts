import {
  addToScene,
  captureScreenshot,
  createArcRotateCamera,
  createBoxData,
  createCapsule,
  createEngine,
  createHemisphericLight,
  createMeshFromData,
  createSceneContext,
  createStandardMaterial,
  createTexture2DFromPixels,
  disposeMeshGpu,
  type HemisphericLight,
  type Mesh,
  registerScene,
  releaseTexture,
  removeFromScene,
  renderFrame,
  type SceneContext,
  setEngineSize,
  type Texture2D,
} from "@babylonjs/lite";
import type { FlythroughScenarioSample } from "../flythrough/flythrough-contract";
import { flythroughCameraPose } from "../flythrough/flythrough-contract";
import type {
  RenderStreamingDependency,
  StreamingResourceCacheTelemetry,
} from "../streaming/streaming-protocol";
import { createStreamingResourceCache } from "../streaming/streaming-resource-cache";
import { streamingResourceCacheKey } from "../streaming/streaming-resource-key";
import type {
  GreyboxCell,
  GreyboxHeightfieldGridPayload,
  GreyboxMaterial,
  GreyboxPrimitive,
  GreyboxSceneConfig,
} from "../world/world-contract";
import {
  parseGreyboxMaterials,
  selectGreyboxCellLod,
  validateGreyboxDistrict,
  validateGreyboxLightingConfig,
} from "../world/world-contract";
import {
  type EnvironmentLightingSample,
  quantizeAnimatedEnvironmentLightingPhase,
  sampleEnvironmentLighting,
} from "./environment-lighting";
import { createHybridUiRenderer } from "./hybrid-ui-renderer";
import { observeStandardOpaquePsoRegistration } from "./pso-warmup-babylon-observer";
import {
  PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID,
  PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST,
} from "./pso-warmup-contract";
import type { PsoWarmupRegistry } from "./pso-warmup-registry";
import type {
  FlythroughCheckpointRenderEvidence,
  GreyboxWorkerRenderTelemetry,
} from "./render-protocol";
import { RENDER_GAMEPLAY_CROWD_CAPACITY } from "./render-protocol";

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

interface StreamingDependencyGpuValue {
  attributes: ArrayBuffer | null;
  readonly format: "ktx2" | "meshopt";
  readonly gpuBytes: number;
  readonly mesh: Mesh | null;
  readonly texture: Texture2D | null;
  readonly vertexCount: number;
}

function applyEnvironmentLighting(
  light: HemisphericLight,
  scene: SceneContext,
  lighting: EnvironmentLightingSample,
): void {
  light.direction.set(
    lighting.hemisphericUpDirection[0],
    lighting.hemisphericUpDirection[1],
    lighting.hemisphericUpDirection[2],
  );
  light.intensity = lighting.perceivedIntensity;
  light.diffuseColor[0] = lighting.skyColor[0];
  light.diffuseColor[1] = lighting.skyColor[1];
  light.diffuseColor[2] = lighting.skyColor[2];
  light.groundColor[0] = lighting.groundColor[0];
  light.groundColor[1] = lighting.groundColor[1];
  light.groundColor[2] = lighting.groundColor[2];
  scene.clearColor.r = lighting.clearColor[0];
  scene.clearColor.g = lighting.clearColor[1];
  scene.clearColor.b = lighting.clearColor[2];
}

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
  psoWarmup: PsoWarmupRegistry,
) {
  const materializationStartedAt = performance.now();
  validateGreyboxLightingConfig(config.lighting);
  const validation = validateGreyboxDistrict(config.world);
  const engine = await createEngine(canvas, { format: "bgra8unorm", msaaSamples: 4 });
  const psoObservation = observeStandardOpaquePsoRegistration(engine);
  try {
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

    const lighting = sampleEnvironmentLighting(
      quantizeAnimatedEnvironmentLightingPhase(config.lighting.initialPhase),
      config.lighting.weather,
    );
    const light = createHemisphericLight();
    applyEnvironmentLighting(light, scene, lighting);
    addToScene(scene, light);

    const playerMesh = createCapsule(engine, {
      height: 1.8,
      radius: 0.55,
      tessellation: 12,
    });
    playerMesh.name = "gameplay-player";
    const playerMaterial = createStandardMaterial();
    playerMaterial.diffuseColor = [0.92, 0.58, 0.16];
    playerMesh.material = playerMaterial;
    addToScene(scene, playerMesh);
    const crowdMaterial = createStandardMaterial();
    crowdMaterial.diffuseColor = [0.2, 0.72, 0.44];
    const crowdMeshes = Object.freeze(
      Array.from({ length: RENDER_GAMEPLAY_CROWD_CAPACITY }, (_, index) => {
        const mesh = createCapsule(engine, { height: 1.72, radius: 0.42, tessellation: 8 });
        mesh.name = `gameplay-crowd-${index}`;
        mesh.material = crowdMaterial;
        mesh.visible = false;
        addToScene(scene, mesh);
        return mesh;
      }),
    );
    const markerMeshes = config.world.markers
      .filter((marker) => marker.kind === "transition")
      .map((marker) => {
        const mesh = createCapsule(engine, { height: 3, radius: 0.35, tessellation: 8 });
        mesh.name = `interaction-${marker.id}`;
        const material = createStandardMaterial();
        material.diffuseColor = [0.25, 0.86, 0.95];
        mesh.material = material;
        mesh.position.set(marker.position[0], marker.position[1] + 1.5, marker.position[2]);
        addToScene(scene, mesh);
        return mesh;
      });

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
    const hybridUi = createHybridUiRenderer(engine, scene, camera);
    await psoWarmup.requestObserved(PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID, () =>
      psoObservation.register(
        [...previewMeshes, playerMesh, ...crowdMeshes, ...markerMeshes, ...hybridUi.meshes],
        () => registerScene(scene),
      ),
    );
    // A second authoritative request proves that the registry deduplicates a repeated
    // state without asking Babylon/Dawn to create the pipeline family again.
    await psoWarmup.request(
      PSO_WARMUP_STANDARD_OPAQUE_ENTRY_ID,
      PSO_WARMUP_STANDARD_OPAQUE_STATE_DIGEST,
      () => {
        throw new Error("PSO warmup registry invoked a compile callback for a cache hit");
      },
    );
    await psoWarmup.finish();

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
      crowdMeshes,
      engine,
      light,
      materials,
      previousTimestamp: null as number | null,
      presentationOwner: "preview" as "preview" | "streamed-residency",
      previewMeshes: Object.freeze(previewMeshes),
      psoWarmup,
      scene,
      streamingCells: new Map<
        string,
        Readonly<{
          dependencyUploadBytes: number;
          dependencyKeys: readonly string[];
          gpuBytes: number;
          meshes: readonly Mesh[];
        }>
      >(),
      streamingDependencyCache: createStreamingResourceCache<StreamingDependencyGpuValue>(),
      streamingDependencyGpuBytes: 0,
      flythroughSample: null as FlythroughScenarioSample | null,
      hybridUi,
      lighting,
      playerMesh,
      telemetry,
    };
  } catch (error: unknown) {
    try {
      psoObservation.dispose();
    } catch (cleanupError: unknown) {
      const cleanupFailures =
        cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError];
      throw new AggregateError(
        [error, ...cleanupFailures],
        "Greybox world creation and PSO observer restoration failed",
        { cause: error },
      );
    }
    throw error;
  }
}

export type LiteGreyboxWorld = Awaited<ReturnType<typeof createLiteGreyboxWorld>>;

export function installStreamingGreyboxMaterials(
  renderer: LiteGreyboxWorld,
  materials: readonly GreyboxMaterial[],
): readonly string[] {
  const parsed = parseGreyboxMaterials(materials);
  for (const material of parsed) {
    const existing = renderer.materials.get(material.id);
    if (existing?.color.some((component, index) => component !== material.color[index])) {
      throw new Error(`Greybox material ${material.id} conflicts across districts`);
    }
    renderer.materials.set(material.id, material);
  }
  return Object.freeze(parsed.map(({ id }) => id));
}

export function retainStreamingGreyboxMaterials(
  renderer: LiteGreyboxWorld,
  retainedMaterialIds: ReadonlySet<string>,
): void {
  for (const materialId of renderer.materials.keys()) {
    if (!retainedMaterialIds.has(materialId)) renderer.materials.delete(materialId);
  }
}

export function applyGameplayPresentation(
  renderer: LiteGreyboxWorld,
  presentation: Readonly<{
    readonly cameraPitchRadians: number;
    readonly crowdEntities: readonly Readonly<{
      readonly id: number;
      readonly position: readonly [number, number, number];
      readonly yawRadians: number;
    }>[];
    readonly playerPosition: readonly [number, number, number];
    readonly playerYawRadians: number;
  }>,
): void {
  renderer.playerMesh.visible = true;
  renderer.playerMesh.position.set(...presentation.playerPosition);
  renderer.playerMesh.rotation.y = presentation.playerYawRadians;
  for (const [index, mesh] of renderer.crowdMeshes.entries()) {
    const entity = presentation.crowdEntities[index];
    mesh.visible = entity !== undefined;
    if (entity === undefined) continue;
    mesh.position.set(...entity.position);
    mesh.rotation.y = entity.yawRadians;
  }
  renderer.camera.target.x = presentation.playerPosition[0];
  renderer.camera.target.y = presentation.playerPosition[1] + 0.55;
  renderer.camera.target.z = presentation.playerPosition[2];
  renderer.camera.alpha = gameplayCameraAlpha(presentation.playerYawRadians);
  renderer.camera.beta = gameplayCameraBeta(presentation.cameraPitchRadians);
  renderer.camera.radius = 9;
  renderer.camera.nearPlane = 0.1;
}

export function gameplayCameraAlpha(playerYawRadians: number): number {
  // ArcRotate's horizontal offset is (cos(alpha), sin(alpha)) in X/Z. Simulation yaw
  // zero faces +Z and positive yaw turns toward +X, so the camera uses its exact
  // opposite vector.
  return -playerYawRadians - Math.PI / 2;
}

export function gameplayCameraBeta(cameraPitchRadians: number): number {
  // Keep the neutral view just above the horizon. A steeper downward default makes
  // the 4 km terrain sheet cover the whole viewport and hides the sky/clear color.
  return Math.max(0.35, Math.min(Math.PI - 0.35, Math.PI / 2 - 0.08 + cameraPitchRadians));
}

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
  dependencies: readonly RenderStreamingDependency[] = Object.freeze([]),
): Readonly<{
  cellGpuBytes: number;
  dependencyGpuCache: StreamingResourceCacheTelemetry;
  dependencyUploadBytes: number;
  dependencyUploadCount: number;
  dependencyUploadMs: number;
  gpuBytes: number;
}> {
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
  let dependencyUploadBytes = 0;
  let dependencyUploadCount = 0;
  const dependencyKeys: string[] = [];
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
    const dependencyUploadStartedAt = dependencies.length === 0 ? null : performance.now();
    const dependencyIds = new Set<string>();
    for (const dependency of dependencies) {
      if (dependencyIds.has(dependency.resourceId)) {
        throw new Error(`Streaming cell ${cell.id} repeats dependency ${dependency.resourceId}`);
      }
      dependencyIds.add(dependency.resourceId);
      if (dependency.cacheKey !== streamingResourceCacheKey(dependency.descriptor)) {
        throw new Error(`Streaming dependency ${dependency.resourceId} cache key is invalid`);
      }
      const acquired = renderer.streamingDependencyCache.acquire(dependency.descriptor);
      dependencyKeys.push(acquired.key);
      if (!acquired.miss) {
        if (acquired.value === null || acquired.value.format !== dependency.format) {
          throw new Error(`Streaming dependency ${dependency.resourceId} cache state is invalid`);
        }
        continue;
      }
      if ("kind" in dependency && dependency.kind === "cached-dependency-reference") {
        throw new Error(`Streaming dependency ${dependency.resourceId} cache miss lacks payload`);
      }
      if (dependency.format === "ktx2") {
        const rgba = new Uint8Array(dependency.rgba);
        if (rgba.byteLength !== dependency.width * dependency.height * 4) {
          throw new Error(`Streaming KTX2 dependency ${dependency.resourceId} is invalid`);
        }
        const texture = createTexture2DFromPixels(
          renderer.engine,
          rgba,
          dependency.width,
          dependency.height,
          {
            magFilter: "linear",
            minFilter: "linear",
            srgb: true,
          },
        );
        let cacheOwnsTexture = false;
        try {
          renderer.streamingDependencyCache.setOwnedBytes(acquired.key, 0, rgba.byteLength);
          renderer.streamingDependencyCache.fulfill(acquired.key, {
            attributes: null,
            format: "ktx2",
            gpuBytes: rgba.byteLength,
            mesh: null,
            texture,
            vertexCount: 0,
          });
          cacheOwnsTexture = true;
        } catch (error: unknown) {
          if (!cacheOwnsTexture) releaseTexture(texture);
          throw error;
        }
        renderer.streamingDependencyGpuBytes += rgba.byteLength;
        dependencyUploadBytes += rgba.byteLength;
        dependencyUploadCount += 1;
      } else if (dependency.kind === "vertex-attributes") {
        const attributes = new Float32Array(dependency.attributes);
        if (
          attributes.length !== dependency.vertexCount * 8 ||
          attributes.some((value) => !Number.isFinite(value))
        ) {
          throw new Error(
            `Streaming meshopt vertex dependency ${dependency.resourceId} is invalid`,
          );
        }
        renderer.streamingDependencyCache.fulfill(acquired.key, {
          attributes: dependency.attributes,
          format: "meshopt",
          gpuBytes: 0,
          mesh: null,
          texture: null,
          vertexCount: dependency.vertexCount,
        });
      } else if (dependency.kind === "indices") {
        const vertexResourceId = dependency.descriptor.dependencies[1];
        const vertexDependency = dependencies.find(
          (candidate) =>
            candidate.resourceId === vertexResourceId &&
            candidate.format === "meshopt" &&
            candidate.kind === "vertex-attributes",
        );
        if (vertexDependency === undefined) {
          throw new Error(
            `Streaming meshopt index ${dependency.resourceId} lacks its vertex payload`,
          );
        }
        const vertexKey = streamingResourceCacheKey(vertexDependency.descriptor);
        const vertexCached = renderer.streamingDependencyCache.require(vertexKey);
        const vertexValue = vertexCached.value;
        if (vertexValue?.attributes === null || vertexValue === null) {
          throw new Error(`Streaming meshopt vertex ${vertexResourceId} is unavailable`);
        }
        const interleaved = new Float32Array(vertexValue.attributes);
        const positions = new Float32Array(vertexValue.vertexCount * 3);
        const normals = new Float32Array(vertexValue.vertexCount * 3);
        const uvs = new Float32Array(vertexValue.vertexCount * 2);
        for (let vertex = 0; vertex < vertexValue.vertexCount; vertex += 1) {
          positions.set(interleaved.subarray(vertex * 8, vertex * 8 + 3), vertex * 3);
          normals.set(interleaved.subarray(vertex * 8 + 3, vertex * 8 + 6), vertex * 3);
          uvs.set(interleaved.subarray(vertex * 8 + 6, vertex * 8 + 8), vertex * 2);
        }
        const indices = new Uint32Array(dependency.indices);
        if (
          indices.length !== dependency.indexCount ||
          indices.length % 3 !== 0 ||
          indices.some((value) => value >= vertexValue.vertexCount)
        ) {
          throw new Error(`Streaming meshopt index dependency ${dependency.resourceId} is invalid`);
        }
        const definition = requireMaterial(
          renderer.materials,
          renderer.config.world.materials[0]?.id ?? "",
        );
        const mesh = createMeshFromData(
          renderer.engine,
          `streaming-dependency-${dependency.resourceId}`,
          positions,
          normals,
          indices,
          uvs,
        );
        const attributeGpuBytes = interleaved.byteLength;
        const indexGpuBytes = indices.byteLength;
        let cacheOwnsMesh = false;
        let sceneOwnsMesh = false;
        try {
          const material = createStandardMaterial();
          material.diffuseColor = [definition.color[0], definition.color[1], definition.color[2]];
          mesh.material = material;
          mesh.visible = renderer.presentationOwner === "streamed-residency";
          // Babylon may register the mesh before addToScene reports a failure. From this
          // boundary onward cleanup must attempt scene removal, not local-only disposal.
          sceneOwnsMesh = true;
          addToScene(renderer.scene, mesh);
          renderer.streamingDependencyCache.setOwnedBytes(vertexKey, 0, attributeGpuBytes);
          renderer.streamingDependencyCache.setOwnedBytes(acquired.key, 0, indexGpuBytes);
          renderer.streamingDependencyCache.fulfill(acquired.key, {
            attributes: null,
            format: "meshopt",
            gpuBytes: attributeGpuBytes + indexGpuBytes,
            mesh,
            texture: null,
            vertexCount: 0,
          });
          cacheOwnsMesh = true;
          vertexValue.attributes = null;
        } catch (error: unknown) {
          if (!cacheOwnsMesh) {
            try {
              if (sceneOwnsMesh) removeFromScene(renderer.scene, mesh);
              else disposeMeshGpu(mesh);
            } catch (cleanupError: unknown) {
              throw new AggregateError(
                [error, cleanupError],
                `Streaming mesh index dependency ${dependency.resourceId} allocation and cleanup failed`,
                error instanceof Error ? { cause: error } : undefined,
              );
            }
          }
          throw error;
        }
        renderer.streamingDependencyGpuBytes += attributeGpuBytes + indexGpuBytes;
        dependencyUploadBytes += attributeGpuBytes + indexGpuBytes;
        dependencyUploadCount += 2;
      } else {
        const positions = new Float32Array(dependency.positions);
        if (
          dependency.vertexCount !== 3 ||
          positions.length !== dependency.vertexCount * 3 ||
          positions.some((value) => !Number.isFinite(value))
        ) {
          throw new Error(`Streaming meshopt dependency ${dependency.resourceId} is invalid`);
        }
        const geometry: GeometryBatch = Object.freeze({
          indices: new Uint32Array([0, 1, 2]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          positions,
          triangleCount: 1,
          uvs: new Float32Array([0, 0, 1, 0, 0.5, 1]),
        });
        const definition = requireMaterial(
          renderer.materials,
          renderer.config.world.materials[0]?.id ?? "",
        );
        const mesh = createMeshFromData(
          renderer.engine,
          `streaming-dependency-${dependency.resourceId}`,
          geometry.positions,
          geometry.normals,
          geometry.indices,
          geometry.uvs,
        );
        const meshGpuBytes = geometryGpuBytes(geometry);
        let cacheOwnsMesh = false;
        let sceneOwnsMesh = false;
        try {
          const material = createStandardMaterial();
          material.diffuseColor = [definition.color[0], definition.color[1], definition.color[2]];
          mesh.material = material;
          mesh.visible = renderer.presentationOwner === "streamed-residency";
          // Babylon may register the mesh before addToScene reports a failure. From this
          // boundary onward cleanup must attempt scene removal, not local-only disposal.
          sceneOwnsMesh = true;
          addToScene(renderer.scene, mesh);
          renderer.streamingDependencyCache.setOwnedBytes(acquired.key, 0, meshGpuBytes);
          renderer.streamingDependencyCache.fulfill(acquired.key, {
            attributes: null,
            format: "meshopt",
            gpuBytes: meshGpuBytes,
            mesh,
            texture: null,
            vertexCount: 0,
          });
          cacheOwnsMesh = true;
        } catch (error: unknown) {
          if (!cacheOwnsMesh) {
            try {
              if (sceneOwnsMesh) removeFromScene(renderer.scene, mesh);
              else disposeMeshGpu(mesh);
            } catch (cleanupError: unknown) {
              throw new AggregateError(
                [error, cleanupError],
                `Streaming mesh dependency ${dependency.resourceId} allocation and cleanup failed`,
                error instanceof Error ? { cause: error } : undefined,
              );
            }
          }
          throw error;
        }
        renderer.streamingDependencyGpuBytes += meshGpuBytes;
        dependencyUploadBytes += meshGpuBytes;
        dependencyUploadCount += 1;
      }
    }
    const dependencyUploadMs =
      dependencyUploadStartedAt === null ? 0 : performance.now() - dependencyUploadStartedAt;
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
    const dependencyGpuCache = dependencyGpuCacheSnapshot(renderer);
    renderer.streamingCells.set(
      cell.id,
      Object.freeze({
        dependencyUploadBytes,
        dependencyKeys: Object.freeze(dependencyKeys),
        gpuBytes,
        meshes: Object.freeze(meshes),
      }),
    );
    return Object.freeze({
      cellGpuBytes: gpuBytes,
      dependencyGpuCache,
      dependencyUploadBytes,
      dependencyUploadCount,
      dependencyUploadMs,
      gpuBytes: gpuBytes + dependencyUploadBytes,
    });
  } catch (error: unknown) {
    for (const mesh of meshes.reverse()) {
      if (addedMeshes.has(mesh)) {
        removeFromScene(renderer.scene, mesh);
      } else {
        disposeMeshGpu(mesh);
      }
    }
    releaseStreamingDependencyKeys(renderer, dependencyKeys);
    throw error;
  }
}

export function applyFlythroughSample(
  renderer: LiteGreyboxWorld,
  sample: FlythroughScenarioSample,
  camera: Readonly<{ beta: number; heightMeters: number; radiusMeters: number }>,
): void {
  renderer.playerMesh.visible = false;
  for (const mesh of renderer.crowdMeshes) mesh.visible = false;
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

export function clearFlythroughPresentation(renderer: LiteGreyboxWorld): void {
  renderer.flythroughSample = null;
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

export function evictStreamingGreyboxCell(
  renderer: LiteGreyboxWorld,
  cellId: string,
): Readonly<{
  dependencyGpuCache: StreamingResourceCacheTelemetry;
  freedCellGpuBytes: number;
  freedGpuBytes: number;
}> {
  const resident = renderer.streamingCells.get(cellId);
  if (resident === undefined) throw new Error(`Streaming cell ${cellId} is not resident`);
  renderer.streamingCells.delete(cellId);
  const cleanupFailures: unknown[] = [];
  for (const mesh of resident.meshes) {
    try {
      removeFromScene(renderer.scene, mesh);
    } catch (error: unknown) {
      cleanupFailures.push(error);
    }
  }
  let dependencyFreedBytes = 0;
  try {
    dependencyFreedBytes = releaseStreamingDependencyKeys(renderer, resident.dependencyKeys);
  } catch (error: unknown) {
    cleanupFailures.push(error);
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      `Streaming cell ${cellId} eviction cleanup failed`,
      cleanupFailures[0] instanceof Error ? { cause: cleanupFailures[0] } : undefined,
    );
  }
  return Object.freeze({
    dependencyGpuCache: dependencyGpuCacheSnapshot(renderer),
    freedCellGpuBytes: resident.gpuBytes,
    freedGpuBytes: resident.gpuBytes + dependencyFreedBytes,
  });
}

function releaseStreamingDependencyKeys(
  renderer: LiteGreyboxWorld,
  keys: readonly string[],
): number {
  let freedBytes = 0;
  const cleanupFailures: unknown[] = [];
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const key = keys[index];
    if (key === undefined) continue;
    let released: ReturnType<typeof renderer.streamingDependencyCache.release>;
    try {
      released = renderer.streamingDependencyCache.release(key);
    } catch (error: unknown) {
      cleanupFailures.push(error);
      continue;
    }
    if (!released.final || released.value === null) continue;
    if (released.value.mesh !== null) {
      try {
        removeFromScene(renderer.scene, released.value.mesh);
      } catch (error: unknown) {
        cleanupFailures.push(error);
      }
    }
    if (released.value.texture !== null) {
      try {
        releaseTexture(released.value.texture);
      } catch (error: unknown) {
        cleanupFailures.push(error);
      }
    }
    renderer.streamingDependencyGpuBytes -= released.value.gpuBytes;
    freedBytes += released.value.gpuBytes;
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, "Streaming dependency cleanup failed");
  }
  return freedBytes;
}

function dependencyGpuCacheSnapshot(renderer: LiteGreyboxWorld): StreamingResourceCacheTelemetry {
  const snapshot = renderer.streamingDependencyCache.snapshot();
  if (
    snapshot.liveDecodedBytes !== renderer.streamingDependencyGpuBytes ||
    snapshot.liveEncodedBytes !== 0
  ) {
    throw new Error("Streaming dependency GPU cache accounting is invalid");
  }
  return snapshot;
}

export function renderLiteGreyboxWorld(
  renderer: LiteGreyboxWorld,
  timestamp: number,
): GreyboxLightingSample {
  renderer.hybridUi.updateCamera();
  renderer.animationStartedAt ??= timestamp;
  const animationSeconds = (timestamp - renderer.animationStartedAt) / 1_000;
  const phase =
    renderer.flythroughSample?.environment.timeOfDayPhase ??
    (renderer.config.lighting.initialPhase +
      animationSeconds / renderer.config.lighting.cycleSeconds) %
      1;
  const weather =
    renderer.flythroughSample?.environment.weather ?? renderer.config.lighting.weather;
  const lightingPhase =
    renderer.flythroughSample === null ? quantizeAnimatedEnvironmentLightingPhase(phase) : phase;
  if (lightingPhase !== renderer.lighting.phase || weather !== renderer.lighting.weather) {
    const lighting = sampleEnvironmentLighting(lightingPhase, weather);
    renderer.lighting = lighting;
    applyEnvironmentLighting(renderer.light, renderer.scene, lighting);
  }

  renderFrame(
    renderer.engine,
    renderer.previousTimestamp === null ? 0 : timestamp - renderer.previousTimestamp,
  );
  renderer.previousTimestamp = timestamp;
  return Object.freeze({
    intensity: renderer.lighting.perceivedIntensity,
    phase: renderer.lighting.phase,
  });
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

export function resizeLiteGreyboxWorld(
  renderer: LiteGreyboxWorld,
  width: number,
  height: number,
): void {
  setEngineSize(renderer.engine, width, height);
}
