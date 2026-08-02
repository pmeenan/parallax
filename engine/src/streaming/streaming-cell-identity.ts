export interface StreamingCellArtifactIdentity {
  readonly artifactScope: string;
  readonly cellId: string;
  readonly coordinate: readonly [number, number];
  readonly coordinateToken: string;
  readonly resourceId: string;
  readonly sha256: string;
  readonly source: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const CELL_SOURCE = /^immutable\/([a-z0-9-]+)-cell-([0-9]{2,})-([0-9]{2,})-([a-f0-9]{64})\.json$/;

export function canonicalStreamingCellId(
  districtId: string,
  coordinate: readonly [number, number],
): string {
  validateCoordinate(coordinate);
  if (typeof districtId !== "string" || districtId.trim() === "") {
    throw new Error("Streaming cell district ID must not be empty");
  }
  return `${streamingDistrictArtifactScope(districtId)}-cell-${coordinateToken(coordinate)}`;
}

export function canonicalStreamingCellArtifactIdentity(
  districtId: string,
  coordinate: readonly [number, number],
  sha256: string,
): StreamingCellArtifactIdentity {
  if (!SHA256.test(sha256)) throw new Error("Streaming cell artifact requires a SHA-256");
  const artifactScope = streamingDistrictArtifactScope(districtId);
  const token = coordinateToken(coordinate);
  return Object.freeze({
    artifactScope,
    cellId: canonicalStreamingCellId(districtId, coordinate),
    coordinate: Object.freeze([...coordinate]) as readonly [number, number],
    coordinateToken: token,
    resourceId: `game-specific-world-cell-${artifactScope}-${token}`,
    sha256,
    source: `immutable/${artifactScope}-cell-${token}-${sha256}.json`,
  });
}

export function canonicalStreamingDistrictIndexResourceId(districtId: string): string {
  return `game-specific-district-index-${streamingDistrictArtifactScope(districtId)}`;
}

export function parseStreamingCellArtifactSource(source: string): StreamingCellArtifactIdentity {
  const match = source.match(CELL_SOURCE);
  const xToken = match?.[2];
  const zToken = match?.[3];
  const sha256 = match?.[4];
  if (
    match?.[1] === undefined ||
    xToken === undefined ||
    zToken === undefined ||
    sha256 === undefined
  ) {
    throw new Error(`Streaming cell artifact source is invalid: ${source}`);
  }
  const coordinate = [Number(xToken), Number(zToken)] as const;
  const identity = canonicalStreamingCellArtifactIdentity(match[1], coordinate, sha256);
  if (identity.source !== source) {
    throw new Error(`Streaming cell artifact source is not canonical: ${source}`);
  }
  return identity;
}

export function streamingDistrictArtifactScope(districtId: string): string {
  const scope = districtId
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  if (scope === "") throw new Error(`Streaming district ID has no artifact scope: ${districtId}`);
  return scope;
}

function coordinateToken(coordinate: readonly [number, number]): string {
  validateCoordinate(coordinate);
  return coordinate.map((value) => String(value).padStart(2, "0")).join("-");
}

function validateCoordinate(
  coordinate: readonly [number, number],
): asserts coordinate is readonly [number, number] {
  if (
    !Array.isArray(coordinate) ||
    coordinate.length !== 2 ||
    coordinate.some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error("Streaming cell coordinate must contain two non-negative safe integers");
  }
}
