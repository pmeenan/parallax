import type {
  GreyboxAabbCollider,
  SimulationWorldCell,
  SimulationWorldDefinition,
} from "@parallax/engine";

export interface NavigationMeshConfig {
  readonly agentRadiusMeters: number;
  readonly maximumGroundStepMeters: number;
  readonly sampleSpacingMeters: number;
}

export interface NavigationMeshTelemetry {
  readonly edgeCount: number;
  readonly gridBytes: number;
  readonly nodeCount: number;
  readonly tileCount: number;
}

export interface NavigationPath {
  readonly expandedNodeCount: number;
  readonly nodes: readonly (readonly [number, number, number])[];
}

export interface DeterministicNavigationMesh {
  readonly telemetry: NavigationMeshTelemetry;
  canTraverseSegment(
    start: readonly [number, number, number],
    target: readonly [number, number, number],
  ): boolean;
  findPath(
    start: readonly [number, number, number],
    target: readonly [number, number, number],
  ): NavigationPath;
  groundHeight(x: number, z: number): number;
  isWalkablePosition(x: number, z: number): boolean;
}

interface NavigationGrid {
  readonly agentRadiusMeters: number;
  readonly bounds: SimulationWorldDefinition["bounds"];
  readonly cellSizeMeters: number;
  readonly cellsByCoordinate: ReadonlyMap<string, SimulationWorldCell>;
  readonly columns: number;
  readonly heights: Float32Array;
  readonly maximumGroundStepMeters: number;
  readonly rows: number;
  readonly spacing: number;
  readonly walkable: Uint8Array;
}

interface HeapEntry {
  readonly f: number;
  readonly g: number;
  readonly index: number;
}

export function buildDeterministicNavigationMesh(
  world: SimulationWorldDefinition,
  config: NavigationMeshConfig,
): DeterministicNavigationMesh {
  assertNavigationConfig(config);
  const extentX = world.bounds.maximum[0] - world.bounds.minimum[0];
  const extentZ = world.bounds.maximum[2] - world.bounds.minimum[2];
  const columns = extentX / config.sampleSpacingMeters + 1;
  const rows = extentZ / config.sampleSpacingMeters + 1;
  if (!Number.isInteger(columns) || !Number.isInteger(rows)) {
    throw new Error("Navigation sample spacing must divide the district bounds");
  }
  const cellsByCoordinate = new Map(
    world.cells.map((cell) => [`${cell.coordinate[0]},${cell.coordinate[1]}`, cell]),
  );
  const grid: NavigationGrid = Object.freeze({
    agentRadiusMeters: config.agentRadiusMeters,
    bounds: world.bounds,
    cellSizeMeters: world.cellSizeMeters,
    cellsByCoordinate,
    columns,
    heights: new Float32Array(columns * rows),
    maximumGroundStepMeters: config.maximumGroundStepMeters,
    rows,
    spacing: config.sampleSpacingMeters,
    walkable: new Uint8Array(columns * rows),
  });
  let nodeCount = 0;
  for (let row = 0; row < rows; row += 1) {
    const z = world.bounds.minimum[2] + row * grid.spacing;
    for (let column = 0; column < columns; column += 1) {
      const x = world.bounds.minimum[0] + column * grid.spacing;
      const index = row * columns + column;
      grid.heights[index] = groundHeight(grid, x, z);
      if (!navigationPointBlocked(world, cellsByCoordinate, x, z, config.agentRadiusMeters)) {
        grid.walkable[index] = 1;
        nodeCount += 1;
      }
    }
  }
  let edgeCount = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (column + 1 < columns && canTraverse(grid, index, index + 1)) edgeCount += 1;
      if (row + 1 < rows && canTraverse(grid, index, index + columns)) edgeCount += 1;
    }
  }
  const telemetry = Object.freeze({
    edgeCount,
    gridBytes: grid.heights.byteLength + grid.walkable.byteLength,
    nodeCount,
    tileCount: world.cells.length,
  });
  return Object.freeze({
    canTraverseSegment(
      start: readonly [number, number, number],
      target: readonly [number, number, number],
    ): boolean {
      assertFinitePosition(start, "Navigation segment start");
      assertFinitePosition(target, "Navigation segment target");
      return (
        !navigationPointBlocked(
          world,
          cellsByCoordinate,
          start[0],
          start[2],
          config.agentRadiusMeters,
        ) &&
        !navigationPointBlocked(
          world,
          cellsByCoordinate,
          target[0],
          target[2],
          config.agentRadiusMeters,
        ) &&
        Math.abs(
          groundHeight(grid, start[0], start[2]) - groundHeight(grid, target[0], target[2]),
        ) <= config.maximumGroundStepMeters &&
        !navigationSegmentBlocked(grid, start[0], start[2], target[0], target[2])
      );
    },
    findPath(
      start: readonly [number, number, number],
      target: readonly [number, number, number],
    ): NavigationPath {
      return findGridPath(grid, start, target);
    },
    groundHeight(x: number, z: number): number {
      return groundHeight(grid, x, z);
    },
    isWalkablePosition(x: number, z: number): boolean {
      if (
        x < world.bounds.minimum[0] + config.agentRadiusMeters ||
        x > world.bounds.maximum[0] - config.agentRadiusMeters ||
        z < world.bounds.minimum[2] + config.agentRadiusMeters ||
        z > world.bounds.maximum[2] - config.agentRadiusMeters
      ) {
        return false;
      }
      return !navigationPointBlocked(world, cellsByCoordinate, x, z, config.agentRadiusMeters);
    },
    telemetry,
  });
}

function assertNavigationConfig(config: NavigationMeshConfig): void {
  if (
    !Number.isFinite(config.agentRadiusMeters) ||
    config.agentRadiusMeters <= 0 ||
    !Number.isFinite(config.maximumGroundStepMeters) ||
    config.maximumGroundStepMeters <= 0 ||
    !Number.isFinite(config.sampleSpacingMeters) ||
    config.sampleSpacingMeters <= 0
  ) {
    throw new Error("Navigation mesh configuration is invalid");
  }
}

function navigationPointBlocked(
  world: SimulationWorldDefinition,
  cellsByCoordinate: ReadonlyMap<string, SimulationWorldCell>,
  x: number,
  z: number,
  radius: number,
): boolean {
  if (
    x < world.bounds.minimum[0] + radius ||
    x > world.bounds.maximum[0] - radius ||
    z < world.bounds.minimum[2] + radius ||
    z > world.bounds.maximum[2] - radius
  ) {
    return true;
  }
  const cellX = clamp(
    Math.floor((x - world.bounds.minimum[0]) / world.cellSizeMeters),
    0,
    Math.round((world.bounds.maximum[0] - world.bounds.minimum[0]) / world.cellSizeMeters) - 1,
  );
  const cellZ = clamp(
    Math.floor((z - world.bounds.minimum[2]) / world.cellSizeMeters),
    0,
    Math.round((world.bounds.maximum[2] - world.bounds.minimum[2]) / world.cellSizeMeters) - 1,
  );
  for (let neighborZ = cellZ - 1; neighborZ <= cellZ + 1; neighborZ += 1) {
    for (let neighborX = cellX - 1; neighborX <= cellX + 1; neighborX += 1) {
      const cell = cellsByCoordinate.get(`${neighborX},${neighborZ}`);
      if (
        cell?.collision.obstacles.some((obstacle) => overlapsExpandedAabb(x, z, obstacle, radius))
      ) {
        return true;
      }
    }
  }
  return false;
}

function findGridPath(
  grid: NavigationGrid,
  start: readonly [number, number, number],
  target: readonly [number, number, number],
): NavigationPath {
  assertFinitePosition(start, "Navigation path start");
  assertFinitePosition(target, "Navigation path target");
  const startIndex = nearestWalkableIndex(grid, start[0], start[2]);
  const targetIndex = nearestWalkableIndex(grid, target[0], target[2]);
  if (startIndex === targetIndex) {
    return Object.freeze({
      expandedNodeCount: 1,
      nodes: Object.freeze([nodePosition(grid, startIndex)]),
    });
  }
  const size = grid.walkable.length;
  const gScores = new Float64Array(size);
  gScores.fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(size);
  cameFrom.fill(-1);
  const closed = new Uint8Array(size);
  const heap: HeapEntry[] = [];
  gScores[startIndex] = 0;
  heapPush(heap, {
    f: manhattanDistance(grid, startIndex, targetIndex),
    g: 0,
    index: startIndex,
  });
  let expandedNodeCount = 0;
  while (heap.length > 0) {
    const current = heapPop(heap);
    if (closed[current.index] !== 0 || current.g !== gScores[current.index]) continue;
    closed[current.index] = 1;
    expandedNodeCount += 1;
    if (current.index === targetIndex) {
      const indexes = [current.index];
      let cursor = current.index;
      while (cursor !== startIndex) {
        cursor = cameFrom[cursor] ?? -1;
        if (cursor < 0) throw new Error("Navigation path predecessor chain is invalid");
        indexes.push(cursor);
      }
      indexes.reverse();
      return Object.freeze({
        expandedNodeCount,
        nodes: Object.freeze(indexes.map((index) => nodePosition(grid, index))),
      });
    }
    for (const neighbor of neighborIndexes(grid, current.index)) {
      if (closed[neighbor] !== 0 || !canTraverse(grid, current.index, neighbor)) continue;
      const nextG = current.g + 1;
      if (nextG >= (gScores[neighbor] ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom[neighbor] = current.index;
      gScores[neighbor] = nextG;
      heapPush(heap, {
        f: nextG + manhattanDistance(grid, neighbor, targetIndex),
        g: nextG,
        index: neighbor,
      });
    }
  }
  throw new Error("Authored NPC schedule stops are disconnected on the navigation mesh");
}

function nearestWalkableIndex(grid: NavigationGrid, x: number, z: number): number {
  const originColumn = clamp(
    Math.round((x - grid.bounds.minimum[0]) / grid.spacing),
    0,
    grid.columns - 1,
  );
  const originRow = clamp(
    Math.round((z - grid.bounds.minimum[2]) / grid.spacing),
    0,
    grid.rows - 1,
  );
  const maximumRadius = Math.max(grid.columns, grid.rows);
  for (let radius = 0; radius < maximumRadius; radius += 1) {
    let bestIndex = -1;
    let bestDistanceSquared = Number.POSITIVE_INFINITY;
    for (let row = originRow - radius; row <= originRow + radius; row += 1) {
      if (row < 0 || row >= grid.rows) continue;
      for (let column = originColumn - radius; column <= originColumn + radius; column += 1) {
        if (column < 0 || column >= grid.columns) continue;
        if (
          radius > 0 &&
          Math.abs(column - originColumn) !== radius &&
          Math.abs(row - originRow) !== radius
        ) {
          continue;
        }
        const index = row * grid.columns + column;
        if (grid.walkable[index] === 0) continue;
        const position = nodePosition(grid, index);
        const distanceSquared = (position[0] - x) ** 2 + (position[2] - z) ** 2;
        if (
          distanceSquared < bestDistanceSquared ||
          (distanceSquared === bestDistanceSquared && index < bestIndex)
        ) {
          bestDistanceSquared = distanceSquared;
          bestIndex = index;
        }
      }
    }
    if (bestIndex >= 0) return bestIndex;
  }
  throw new Error("Navigation mesh contains no walkable node near an authored schedule stop");
}

function neighborIndexes(grid: NavigationGrid, index: number): readonly number[] {
  const row = Math.floor(index / grid.columns);
  const column = index % grid.columns;
  const neighbors: number[] = [];
  if (row > 0) neighbors.push(index - grid.columns);
  if (column > 0) neighbors.push(index - 1);
  if (column + 1 < grid.columns) neighbors.push(index + 1);
  if (row + 1 < grid.rows) neighbors.push(index + grid.columns);
  return neighbors;
}

function canTraverse(grid: NavigationGrid, from: number, to: number): boolean {
  const fromRow = Math.floor(from / grid.columns);
  const toRow = Math.floor(to / grid.columns);
  const fromX = grid.bounds.minimum[0] + (from % grid.columns) * grid.spacing;
  const fromZ = grid.bounds.minimum[2] + fromRow * grid.spacing;
  const toX = grid.bounds.minimum[0] + (to % grid.columns) * grid.spacing;
  const toZ = grid.bounds.minimum[2] + toRow * grid.spacing;
  return (
    grid.walkable[from] !== 0 &&
    grid.walkable[to] !== 0 &&
    Math.abs((grid.heights[from] ?? 0) - (grid.heights[to] ?? 0)) <= grid.maximumGroundStepMeters &&
    !navigationSegmentBlocked(grid, fromX, fromZ, toX, toZ)
  );
}

function navigationSegmentBlocked(
  grid: NavigationGrid,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): boolean {
  const minimumCellX = Math.floor(
    (Math.min(fromX, toX) - grid.agentRadiusMeters - grid.bounds.minimum[0]) / grid.cellSizeMeters,
  );
  const maximumCellX = Math.floor(
    (Math.max(fromX, toX) + grid.agentRadiusMeters - grid.bounds.minimum[0]) / grid.cellSizeMeters,
  );
  const minimumCellZ = Math.floor(
    (Math.min(fromZ, toZ) - grid.agentRadiusMeters - grid.bounds.minimum[2]) / grid.cellSizeMeters,
  );
  const maximumCellZ = Math.floor(
    (Math.max(fromZ, toZ) + grid.agentRadiusMeters - grid.bounds.minimum[2]) / grid.cellSizeMeters,
  );
  for (let cellZ = minimumCellZ - 1; cellZ <= maximumCellZ + 1; cellZ += 1) {
    for (let cellX = minimumCellX - 1; cellX <= maximumCellX + 1; cellX += 1) {
      const cell = grid.cellsByCoordinate.get(`${cellX},${cellZ}`);
      if (
        cell?.collision.obstacles.some((obstacle) =>
          segmentOverlapsExpandedAabb(fromX, fromZ, toX, toZ, obstacle, grid.agentRadiusMeters),
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function segmentOverlapsExpandedAabb(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  obstacle: GreyboxAabbCollider,
  radius: number,
): boolean {
  const obstacleMinimumX = obstacle.center[0] - obstacle.size[0] / 2 - radius;
  const obstacleMaximumX = obstacle.center[0] + obstacle.size[0] / 2 + radius;
  const obstacleMinimumZ = obstacle.center[2] - obstacle.size[2] / 2 - radius;
  const obstacleMaximumZ = obstacle.center[2] + obstacle.size[2] / 2 + radius;
  let entry = 0;
  let exit = 1;
  const deltaX = toX - fromX;
  if (deltaX === 0) {
    if (fromX <= obstacleMinimumX || fromX >= obstacleMaximumX) return false;
  } else {
    const first = (obstacleMinimumX - fromX) / deltaX;
    const second = (obstacleMaximumX - fromX) / deltaX;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (entry >= exit) return false;
  }
  const deltaZ = toZ - fromZ;
  if (deltaZ === 0) {
    if (fromZ <= obstacleMinimumZ || fromZ >= obstacleMaximumZ) return false;
  } else {
    const first = (obstacleMinimumZ - fromZ) / deltaZ;
    const second = (obstacleMaximumZ - fromZ) / deltaZ;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
  }
  return entry < exit;
}

function manhattanDistance(grid: NavigationGrid, from: number, to: number): number {
  const fromRow = Math.floor(from / grid.columns);
  const toRow = Math.floor(to / grid.columns);
  return Math.abs((from % grid.columns) - (to % grid.columns)) + Math.abs(fromRow - toRow);
}

function nodePosition(grid: NavigationGrid, index: number): readonly [number, number, number] {
  const row = Math.floor(index / grid.columns);
  const column = index % grid.columns;
  return Object.freeze([
    Math.fround(grid.bounds.minimum[0] + column * grid.spacing),
    grid.heights[index] ?? 0,
    Math.fround(grid.bounds.minimum[2] + row * grid.spacing),
  ] as const);
}

function groundHeight(grid: NavigationGrid, x: number, z: number): number {
  const bounds = grid.bounds;
  const cellsX = Math.round((bounds.maximum[0] - bounds.minimum[0]) / grid.cellSizeMeters);
  const cellsZ = Math.round((bounds.maximum[2] - bounds.minimum[2]) / grid.cellSizeMeters);
  const cellX = clamp(Math.floor((x - bounds.minimum[0]) / grid.cellSizeMeters), 0, cellsX - 1);
  const cellZ = clamp(Math.floor((z - bounds.minimum[2]) / grid.cellSizeMeters), 0, cellsZ - 1);
  const cell = grid.cellsByCoordinate.get(`${cellX},${cellZ}`);
  if (cell === undefined) throw new Error("Navigation mesh could not resolve terrain cell");
  const field = cell.collision.heightfield;
  const column = clamp((x - field.origin[0]) / field.sampleSpacingMeters, 0, field.columns - 1);
  const row = clamp((z - field.origin[2]) / field.sampleSpacingMeters, 0, field.rows - 1);
  const column0 = Math.floor(column);
  const row0 = Math.floor(row);
  const column1 = Math.min(field.columns - 1, column0 + 1);
  const row1 = Math.min(field.rows - 1, row0 + 1);
  const sample = (sampleColumn: number, sampleRow: number): number =>
    field.heights[sampleRow * field.columns + sampleColumn] ?? 0;
  const south = lerp(sample(column0, row0), sample(column1, row0), column - column0);
  const north = lerp(sample(column0, row1), sample(column1, row1), column - column0);
  return Math.fround(lerp(south, north, row - row0));
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

function heapPush(heap: HeapEntry[], entry: HeapEntry): void {
  heap.push(entry);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    const parentEntry = heap[parent];
    if (parentEntry === undefined || compareHeap(parentEntry, entry) <= 0) break;
    heap[index] = parentEntry;
    index = parent;
  }
  heap[index] = entry;
}

function heapPop(heap: HeapEntry[]): HeapEntry {
  const first = heap[0];
  const last = heap.pop();
  if (first === undefined || last === undefined) throw new Error("Navigation heap is empty");
  if (heap.length === 0) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const leftEntry = heap[left];
    if (leftEntry === undefined) throw new Error("Navigation heap lost its left child");
    const rightEntry = heap[right];
    const child = rightEntry !== undefined && compareHeap(rightEntry, leftEntry) < 0 ? right : left;
    const childEntry = heap[child];
    if (childEntry === undefined) throw new Error("Navigation heap lost its selected child");
    if (compareHeap(last, childEntry) <= 0) break;
    heap[index] = childEntry;
    index = child;
  }
  heap[index] = last;
  return first;
}

function compareHeap(left: HeapEntry, right: HeapEntry): number {
  return left.f - right.f || left.g - right.g || left.index - right.index;
}

function assertFinitePosition(position: readonly number[], label: string): void {
  if (position.length !== 3 || position.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} is invalid`);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}
