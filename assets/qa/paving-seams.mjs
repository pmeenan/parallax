import assert from "node:assert/strict";

export const PAVING_SEAM_POSITION_TOLERANCE = 0.00001;
export const PAVING_SEAM_NORMAL_DEGREES = 1;

/** Compare actual boundary polylines, including breakpoints omitted by another LOD. */
export function validatePeriodicPavingSeams(meshes) {
  assert.equal(meshes.length, 3, "Periodic paving requires three LOD meshes");
  const profiles = meshes.map(({ attributes, indices }) => {
    assert.equal(attributes.length % 12, 0);
    for (let i = 0; i < attributes.length; i += 12) {
      assert(
        Math.abs(attributes[i + 6] - (attributes[i] + 1) / 2) <= PAVING_SEAM_POSITION_TOLERANCE,
        "Periodic paving U must remain planar",
      );
      assert(
        Math.abs(attributes[i + 7] - (attributes[i + 2] + 1) / 2) <= PAVING_SEAM_POSITION_TOLERANCE,
        "Periodic paving V must remain planar",
      );
    }
    return [
      edgeProfile(attributes, indices, 0, -1),
      edgeProfile(attributes, indices, 0, 1),
      edgeProfile(attributes, indices, 2, -1),
      edgeProfile(attributes, indices, 2, 1),
    ];
  });
  let maxHeightDeltaMetres = 0;
  let maxNormalDeltaDegrees = 0;
  let comparisons = 0;
  for (let first = 0; first < 3; first++)
    for (let second = 0; second < 3; second++) {
      for (const axis of [0, 2]) {
        const a = profiles[first][axis],
          b = profiles[second][axis + 1];
        const points = [...new Set([...a, ...b].map((sample) => sample.t))].sort((x, y) => x - y);
        for (const t of points) {
          const left = interpolate(a, t),
            right = interpolate(b, t);
          const height = Math.abs(left.height - right.height);
          const angle = normalAngle(left.normal, right.normal);
          assert(
            height <= PAVING_SEAM_POSITION_TOLERANCE,
            `Periodic height seam LOD${first}/LOD${second} axis${axis} at ${t}: ${height}m`,
          );
          assert(
            angle <= PAVING_SEAM_NORMAL_DEGREES,
            `Periodic normal seam LOD${first}/LOD${second} axis${axis} at ${t}: ${angle}deg`,
          );
          maxHeightDeltaMetres = Math.max(maxHeightDeltaMetres, height);
          maxNormalDeltaDegrees = Math.max(maxNormalDeltaDegrees, angle);
          comparisons++;
        }
      }
    }
  return {
    positionToleranceMetres: PAVING_SEAM_POSITION_TOLERANCE,
    normalToleranceDegrees: PAVING_SEAM_NORMAL_DEGREES,
    maxHeightDeltaMetres,
    maxNormalDeltaDegrees,
    comparisons,
    boundarySampleCounts: profiles.map((lod) => lod.map((edge) => edge.length)),
  };
}

function edgeProfile(attributes, indices, axis, side) {
  const samples = new Map();
  const vertexSamples = new Map();
  for (let i = 0; i < attributes.length / 12; i++) {
    const p = i * 12;
    if (Math.abs(attributes[p + axis] - side) > PAVING_SEAM_POSITION_TOLERANCE) continue;
    const sample = {
      t: (attributes[p + (axis === 0 ? 2 : 0)] + 1) / 2,
      height: attributes[p + 1],
      normal: Array.from(attributes.slice(p + 3, p + 6)),
    };
    const duplicate = samples.get(sample.t);
    if (duplicate) {
      assert(
        Math.abs(duplicate.height - sample.height) <= PAVING_SEAM_POSITION_TOLERANCE,
        "Duplicate boundary heights differ",
      );
      assert(
        normalAngle(duplicate.normal, sample.normal) <= PAVING_SEAM_NORMAL_DEGREES,
        "Duplicate boundary normals differ",
      );
    }
    samples.set(sample.t, sample);
    vertexSamples.set(i, sample);
  }
  const sorted = [...samples.values()].sort((a, b) => a.t - b.t);
  assert(
    sorted.length >= 2 &&
      Math.abs(sorted[0].t) <= PAVING_SEAM_POSITION_TOLERANCE &&
      Math.abs(sorted.at(-1).t - 1) <= PAVING_SEAM_POSITION_TOLERANCE,
    "Periodic boundary does not cover both corners",
  );
  const segments = [];
  for (let i = 0; i < indices.length; i += 3)
    for (let j = 0; j < 3; j++) {
      const a = vertexSamples.get(indices[i + j]),
        b = vertexSamples.get(indices[i + ((j + 1) % 3)]);
      if (a && b && a.t !== b.t) segments.push([Math.min(a.t, b.t), Math.max(a.t, b.t)]);
    }
  for (let i = 1; i < sorted.length; i++) {
    const mid = (sorted[i - 1].t + sorted[i].t) / 2;
    assert(
      segments.some(([a, b]) => a < mid && b > mid),
      "Periodic boundary has a disconnected interval",
    );
  }
  return sorted;
}

function interpolate(profile, t) {
  const right = profile.findIndex((sample) => sample.t >= t);
  if (right < 0) return profile.at(-1);
  if (right === 0) return profile[0];
  const a = profile[right - 1],
    b = profile[right];
  const fraction = (t - a.t) / (b.t - a.t);
  return {
    height: a.height + (b.height - a.height) * fraction,
    normal: a.normal.map((v, i) => v + (b.normal[i] - v) * fraction),
  };
}
function normalAngle(a, b) {
  const length = Math.hypot(...a) * Math.hypot(...b);
  assert(length > 0 && Number.isFinite(length), "Boundary normal is invalid");
  return (
    (Math.acos(Math.min(1, Math.max(-1, a.reduce((sum, v, i) => sum + v * b[i], 0) / length))) *
      180) /
    Math.PI
  );
}

/** Pixel centers straddle the seam: adjacent differences, never equality of edge pixels. */
export function periodicTextureGradientDiagnostics(rgba, width, height, role) {
  assert.equal(rgba.length, width * height * 4);
  const pixel = (x, y) =>
    Array.from(rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 3), (v) => {
      const normalized = v / 255;
      return role === "baseColor"
        ? normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4
        : role === "normal"
          ? normalized * 2 - 1
          : normalized;
    });
  const difference = (a, b) =>
    role === "normal" ? normalAngle(a, b) : Math.hypot(...a.map((v, i) => v - b[i]));
  const seamX = [],
    seamY = [],
    interiorX = [],
    interiorY = [];
  for (let y = 0; y < height; y++) seamX.push(difference(pixel(width - 1, y), pixel(0, y)));
  for (let x = 0; x < width; x++) seamY.push(difference(pixel(x, height - 1), pixel(x, 0)));
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / 65536)));
  for (let y = 0; y < height - 1; y += step)
    for (let x = 0; x < width - 1; x += step) {
      const p = pixel(x, y);
      interiorX.push(difference(p, pixel(x + 1, y)));
      interiorY.push(difference(p, pixel(x, y + 1)));
    }
  const stats = (values) => {
    values.sort((a, b) => a - b);
    return {
      count: values.length,
      mean: values.reduce((sum, v) => sum + v, 0) / values.length,
      p95: values[Math.floor((values.length - 1) * 0.95)],
      max: values.at(-1),
    };
  };
  return {
    role,
    width,
    height,
    units: role === "normal" ? "degrees" : "normalized-rgb-distance",
    status: "diagnostic-not-artistic-acceptance",
    seamX: stats(seamX),
    seamY: stats(seamY),
    interiorX: stats(interiorX),
    interiorY: stats(interiorY),
  };
}
