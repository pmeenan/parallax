// K1 timber-framed wall delivery, stage 2: runtime LOD geometry and meshopt streams.
// node geometry.mjs <extract dir> <output dir>
//
// Every mesh object from extract.py becomes three LODs in the engine's 32-byte
// position/normal/uv layout, in glTF Y-up metres (X = x - pivot, Y = z - pivot, Z = -y). A kit
// piece's pivot is the bottom centre of its plaster face (upper bays at their own 3.5 m base, the
// corner at the front facade's x = 12 bay line); house parts keep the house frame. Placements are
// written as column-major glTF-frame matrices, with mirrored ones flagged.
//
// The geometry carries a low-passed displacement (SMOOTH_MM by class): sharp small relief, such as
// plaster-loss steps and check walls, stays in the full normal map and the micro-shadow height,
// because simplification spanned those cliffs with long sloped slivers (candidate 1's screens).
// Displaced meshes are then simplified on the undisplaced base surface with the displacement
// vector as a weighted attribute, and every LOD's folded area is compared with the source's.
// Vertex normals stay the undisplaced base surface's; the full normal map carries the relief.
//
// The K2 roof's extract (d1-roof delivery) shares this stage: its extract.json carries per-piece
// pivots, and its tile meshes (tinted: a per-tile tint over a shared variant atlas) drop the faces
// its visibility pass found hidden, carry their tint in the UV's integer part (engine pbr-tint)
// and simplify on position with the clay errors. The roof-tile-body faces join the roof-tile
// material: their UVs already sample the visible face's border.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  MeshoptDecoder,
  MeshoptEncoder,
  MeshoptSimplifier,
} from "../../../../../engine/node_modules/meshoptimizer/index.js";

const src = resolve(process.argv[2]);
const out = resolve(process.argv[3]);
await mkdir(out, { recursive: false });
await mkdir(join(out, "runtime"));
await mkdir(join(out, "decoded"));
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const extract = JSON.parse(await readFile(join(src, "extract.json"), "utf8"));
const hash = (b) => createHash("sha256").update(b).digest("hex");

const SQUASH = Number(process.env.GEOMETRY_SQUASH ?? 0.02);
const METHOD = process.env.GEOMETRY_METHOD ?? "attribute";
// Weight of the displacement attribute; 16 matches plain positional simplification's triangle
// counts on the plaster and oak within about 2x, without its folds.
const DISPLACEMENT_WEIGHT = Number(process.env.GEOMETRY_DISPLACEMENT_WEIGHT ?? 16);
// Absolute LOD errors in millimetres by material class; GEOMETRY_ERRORS_<CLASS>=a,b,c overrides.
// The normal map carries all shading, so an error along the normal shows only at silhouettes.
// Oak LOD1 stays within 1.5 mm, below the 3 mm that the door and shutter straps stand proud.
const ERRORS = {
  oak: [1, 1.5, 5],
  stone: [1, 3, 8],
  plaster: [1, 3, 8],
  soil: [1.5, 4, 8],
};
// Roof tiles (undisplaced shells, simplified on position): GEOMETRY_ERRORS_CLAY=a,b,c overrides.
const TILE_DILATE = Number(process.env.GEOMETRY_TILE_DILATE ?? 1);
// The K2 roof's oak is seen from 3 m or more (eaves, verges, gable): coarser than the walls' oak.
// GEOMETRY_ERRORS_ROOF_OAK=a,b,c overrides.
const ROOF_OAK_ERRORS = (process.env.GEOMETRY_ERRORS_ROOF_OAK ?? "1.5,3,8").split(",").map(Number);
const CLAY_ERRORS = (process.env.GEOMETRY_ERRORS_CLAY ?? "0.5,2,6").split(",").map(Number);
// Gaussian-equivalent sigma of the geometry's displacement low-pass, millimetres (0 = none).
const SMOOTH_MM = { oak: 2, stone: 2, plaster: 6, soil: 3 };
for (const k of Object.keys(SMOOTH_MM)) {
  const env = process.env[`GEOMETRY_SMOOTH_${k.toUpperCase()}`];
  if (env !== undefined) SMOOTH_MM[k] = Number(env);
}
const SOURCE_SPACING_MM = 2.5;

/** Low-pass the displacement vectors (P - B) by Laplacian iterations over the welded vertex graph;
 * about (sigma / spacing)^2 / 0.33 iterations of lambda 0.5 give a Gaussian of that sigma. */
function smoothDisplacement(P, B, T, sigmaMm) {
  if (!(sigmaMm > 0)) return P;
  const n = P.length / 3;
  const ids = new Int32Array(n);
  const key = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${B[i * 3]},${B[i * 3 + 1]},${B[i * 3 + 2]}`;
    let id = key.get(k);
    if (id === undefined) {
      id = key.size;
      key.set(k, id);
    }
    ids[i] = id;
  }
  const m = key.size;
  const D = new Float64Array(m * 3);
  for (let i = 0; i < n; i++)
    for (let a = 0; a < 3; a++) D[ids[i] * 3 + a] = P[i * 3 + a] - B[i * 3 + a];
  const neighbours = Array.from({ length: m }, () => new Set());
  for (let t = 0; t < T.length; t += 3)
    for (const [x, y] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const a = ids[T[t + x]];
      const b = ids[T[t + y]];
      if (a !== b) {
        neighbours[a].add(b);
        neighbours[b].add(a);
      }
    }
  const adj = neighbours.map((set) => Int32Array.from(set));
  const iterations = Math.ceil((sigmaMm / SOURCE_SPACING_MM) ** 2 / 0.33);
  let cur = D;
  for (let it = 0; it < iterations; it++) {
    const next = new Float64Array(m * 3);
    for (let v = 0; v < m; v++) {
      const nb = adj[v];
      for (let a = 0; a < 3; a++) {
        let sum = 0;
        for (const w of nb) sum += cur[w * 3 + a];
        const mean = nb.length ? sum / nb.length : cur[v * 3 + a];
        next[v * 3 + a] = cur[v * 3 + a] + 0.5 * (mean - cur[v * 3 + a]);
      }
    }
    cur = next;
  }
  const out = new Float32Array(P.length);
  for (let i = 0; i < n; i++)
    for (let a = 0; a < 3; a++) out[i * 3 + a] = B[i * 3 + a] + cur[ids[i] * 3 + a];
  return out;
}
for (const k of Object.keys(ERRORS)) {
  const env = process.env[`GEOMETRY_ERRORS_${k.toUpperCase()}`];
  if (env) ERRORS[k] = env.split(",").map(Number);
}
// Foot plants are not displaced: triangle fractions per LOD, as the paving's plants. They share
// the paving's 1024 x 512 atlas layout (maps.py): regions [x, y, w, h] with y up, 2-texel gutter.
const PLANT_FRACTIONS = [1, 0.35, 0.1];
const PLANT_ATLAS = {
  size: [1024, 512],
  gutter: 2,
  regions: {
    leaf0: [0, 0, 512, 256],
    leaf1: [512, 0, 512, 256],
    leaf2: [0, 256, 512, 256],
    grass: [512, 256, 64, 256],
    stem: [576, 256, 64, 256],
  },
};

function plantAtlasUv(obj, UV, T, M) {
  const out = new Float32Array(UV.length);
  const [AW, AH] = PLANT_ATLAS.size;
  const g = PLANT_ATLAS.gutter;
  for (let t = 0; t < M.length; t++) {
    const region = PLANT_ATLAS.regions[obj.materials[M[t]]];
    assert(region, `unknown plant material ${obj.materials[M[t]]}`);
    const [x0, y0, w, h] = region;
    const stem = obj.materials[M[t]] === "stem";
    for (let c = 0; c < 3; c++) {
      const v = T[t * 3 + c];
      const u = stem ? 0.5 : UV[v * 2];
      const vv = stem ? 0.5 : UV[v * 2 + 1];
      out[v * 2] = (x0 + g + u * (w - 2 * g)) / AW;
      out[v * 2 + 1] = (y0 + g + vv * (h - 2 * g)) / AH;
    }
  }
  return out;
}

// Plaster maps carry a margin of neighbouring timber heights around the panel (maps.py), so the
// sun micro-shadow march finds the plates and posts that frame it; UVs move inside the margin.
const PLASTER_MARGIN_M = 0.1;
function plasterMarginUv(obj, UV) {
  const [x0, x1, z0, z1] = extract.layout.pieces[obj.piece].plaster;
  const w = x1 - x0;
  const h = z1 - z0;
  const out = new Float32Array(UV.length);
  for (let i = 0; i < UV.length; i += 2) {
    out[i] = (PLASTER_MARGIN_M + UV[i] * w) / (w + 2 * PLASTER_MARGIN_M);
    out[i + 1] = (PLASTER_MARGIN_M + UV[i + 1] * h) / (h + 2 * PLASTER_MARGIN_M);
  }
  return out;
}

// The source shaded iron with object-space noise and had no UVs; the runtime samples a periodic
// iron tile (maps.py) through box projection on each face's dominant axis.
const IRON_TILE_M = 0.1;
const GLASS_TILE_M = 0.2;
function ironBoxUv(P, N, tile = IRON_TILE_M) {
  const out = new Float32Array((P.length / 3) * 2);
  for (let i = 0; i < P.length / 3; i++) {
    const n = [Math.abs(N[i * 3]), Math.abs(N[i * 3 + 1]), Math.abs(N[i * 3 + 2])];
    const axis = n[0] >= n[1] && n[0] >= n[2] ? 0 : n[1] >= n[2] ? 1 : 2;
    const [a, b] = [
      [1, 2],
      [0, 2],
      [0, 1],
    ][axis];
    out[i * 2] = P[i * 3 + a] / tile;
    out[i * 2 + 1] = P[i * 3 + b] / tile;
  }
  return out;
}

// The runtime is opaque and back-face culled: plants get explicit reversed back faces.
function withBackFaces(P, N, UV, indices) {
  const n = P.length / 3;
  const P2 = new Float32Array(P.length * 2);
  const N2 = new Float32Array(N.length * 2);
  const UV2 = new Float32Array(UV.length * 2);
  P2.set(P);
  P2.set(P, P.length);
  N2.set(N);
  for (let i = 0; i < N.length; i++) N2[N.length + i] = -N[i];
  UV2.set(UV);
  UV2.set(UV, UV.length);
  const I = new Uint32Array(indices.length * 2);
  I.set(indices);
  for (let t = 0; t < indices.length; t += 3) {
    I[indices.length + t] = indices[t] + n;
    I[indices.length + t + 1] = indices[t + 2] + n;
    I[indices.length + t + 2] = indices[t + 1] + n;
  }
  return { P: P2, N: N2, UV: UV2, indices: I };
}

function materialClass(material) {
  if (material === "kit-oak" || material === "roof-oak") return "oak";
  if (material === "roof-tile") return "clay";
  if (material === "kit-stone") return "stone";
  if (material.startsWith("plaster-")) return "plaster";
  if (material === "soil") return "soil";
  return null;
}

async function npy(dir, name) {
  const b = await readFile(join(src, dir, `${name}.npy`));
  assert.equal(b.toString("latin1", 1, 6), "NUMPY");
  const v1 = b[6] === 1;
  const start = v1 ? 10 : 12;
  const off = start + (v1 ? b.readUInt16LE(8) : b.readUInt32LE(8));
  const header = b.toString("latin1", start, off);
  assert.match(header, /'fortran_order': False/);
  const descr = /'descr': '([^']+)'/.exec(header)[1];
  const Type = { "<f4": Float32Array, "<i4": Int32Array, "<u4": Uint32Array, "|u1": Uint8Array }[
    descr
  ];
  assert(Type, descr);
  const copy = b.buffer.slice(b.byteOffset + off, b.byteOffset + b.length);
  return new Type(copy);
}

function pivotOf(piece) {
  if (extract.pivots) return extract.pivots[piece] ?? [0, 0, 0];
  if (piece === null) return [0, 0, 0];
  if (piece === "corner") return [12, 0, 0];
  return [1, 0, piece.startsWith("u-") ? 3.5 : 0];
}

// Blender (x, y, z) -> glTF (x, z, -y), as a 4x4 row-major matrix, and its inverse.
const C = [
  [1, 0, 0, 0],
  [0, 0, 1, 0],
  [0, -1, 0, 0],
  [0, 0, 0, 1],
];
const CI = [
  [1, 0, 0, 0],
  [0, 0, -1, 0],
  [0, 1, 0, 0],
  [0, 0, 0, 1],
];
const mul = (a, b) =>
  a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
const translate = ([x, y, z]) => [
  [1, 0, 0, x],
  [0, 1, 0, y],
  [0, 0, 1, z],
  [0, 0, 0, 1],
];
const det3 = (m) =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const columnMajor = (m) => [0, 1, 2, 3].flatMap((c) => [0, 1, 2, 3].map((r) => m[r][c]));

function faceNormal(P, a, b, c) {
  const u = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
  const v = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

function interleave(P, N, UV, pivot) {
  const n = P.length / 3;
  const f = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3] - pivot[0];
    const y = P[i * 3 + 1] - pivot[1];
    const z = P[i * 3 + 2] - pivot[2];
    f[i * 8] = x;
    f[i * 8 + 1] = z;
    f[i * 8 + 2] = -y;
    f[i * 8 + 3] = N[i * 3];
    f[i * 8 + 4] = N[i * 3 + 2];
    f[i * 8 + 5] = -N[i * 3 + 1];
    f[i * 8 + 6] = UV[i * 2];
    f[i * 8 + 7] = 1 - UV[i * 2 + 1];
  }
  return f;
}

// Per-tile tint (linear RGB) = t (1 + b CAST): the K2 builder's tile_tint model. t and b are
// recovered exactly from R and B, quantised to TINT steps, and added to the runtime UV's integer
// parts (engine pbr-tint: floor(u) is t's step, floor(v) is b's).
const TINT = {
  brightness: [0.5, 0.9 / 127],
  cast: [-0.12, 0.32 / 127],
  castVector: [-0.3, 0.1, 0.35],
};
function tintSteps(C) {
  const n = C.length / 3;
  const steps = new Uint8Array(n * 2);
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const [r, g, b] = [C[i * 3], C[i * 3 + 1], C[i * 3 + 2]];
    const t = (0.35 * r + 0.3 * b) / 0.65;
    const w = (b / t - 1) / 0.35;
    const ts = Math.round((t - TINT.brightness[0]) / TINT.brightness[1]);
    const ws = Math.round((w - TINT.cast[0]) / TINT.cast[1]);
    assert(ts >= 0 && ts <= 127 && ws >= 0 && ws <= 127, `tint ${r} ${g} ${b} outside the steps`);
    steps[i * 2] = ts;
    steps[i * 2 + 1] = ws;
    const tq = TINT.brightness[0] + ts * TINT.brightness[1];
    const wq = TINT.cast[0] + ws * TINT.cast[1];
    for (const [k, c] of [r, g, b].entries())
      worst = Math.max(worst, Math.abs(tq * (1 + wq * TINT.castVector[k]) - c) / c);
  }
  return { steps, worstRelativeError: worst };
}

function withTint(vertices, steps) {
  const v = new Float32Array(vertices);
  for (let i = 0; i < v.length / 8; i++) {
    assert(v[i * 8 + 6] > 0 && v[i * 8 + 6] < 1 && v[i * 8 + 7] > 0 && v[i * 8 + 7] < 1);
    v[i * 8 + 6] += steps[i * 2];
    v[i * 8 + 7] += steps[i * 2 + 1];
  }
  return v;
}

function optimize(vertices, indices) {
  const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, true);
  const v = new Float32Array(unique * 8);
  for (let i = 0; i < remap.length; i++)
    if (remap[i] !== 0xffffffff) v.set(vertices.subarray(i * 8, i * 8 + 8), remap[i] * 8);
  return { vertices: v, indices };
}

function simplify(obj, cls, P, B, N, T, lod) {
  if (obj.object === "FootPlants") {
    const fraction = PLANT_FRACTIONS[lod] ?? 1;
    if (fraction === 1) return { indices: T.slice(), errorMm: 0 };
    const target = Math.floor((T.length * fraction) / 3) * 3;
    const [indices, error] = MeshoptSimplifier.simplify(T, P, 3, target, 1, ["ErrorAbsolute"]);
    return { indices, errorMm: error * 1000 };
  }
  if (obj.tinted) {
    if (lod === -1) return { indices: T.slice(), errorMm: 0 };
    const [indices, error] = MeshoptSimplifier.simplify(T, P, 3, 0, CLAY_ERRORS[lod] / 1000, [
      "ErrorAbsolute",
    ]);
    return { indices, errorMm: error * 1000 };
  }
  // A copy: reorderMesh remaps its index buffer in place, and every LOD reuses T.
  if (cls === null || !obj.displaced) return { indices: T.slice(), errorMm: 0 };
  if (lod === -1) return { indices: T, errorMm: 0, ...turnedFaces(P, N, T) };
  const errorMm = obj.materials[0] === "roof-oak" ? ROOF_OAK_ERRORS[lod] : ERRORS[cls][lod];
  let indices;
  let error;
  if (METHOD === "attribute") {
    // Collapse on the smooth undisplaced base, with the displacement vector as an attribute:
    // the error still bounds the displaced surface, but no collapse can fold the relief.
    const D = new Float32Array(P.length);
    for (let i = 0; i < P.length; i++) D[i] = P[i] - B[i];
    [indices, error] = MeshoptSimplifier.simplifyWithAttributes(
      T,
      B,
      3,
      D,
      3,
      [DISPLACEMENT_WEIGHT, DISPLACEMENT_WEIGHT, DISPLACEMENT_WEIGHT],
      null,
      0,
      errorMm / 1000,
      ["ErrorAbsolute"],
    );
    error *= 1000;
  } else {
    const S = new Float32Array(P.length);
    for (let i = 0; i < P.length; i++) S[i] = B[i] + SQUASH * (P[i] - B[i]);
    [indices, error] = MeshoptSimplifier.simplify(T, S, 3, 0, (errorMm / 1000) * SQUASH, [
      "ErrorAbsolute",
    ]);
    error = (error * 1000) / SQUASH;
  }
  return { indices, errorMm: error, ...turnedFaces(P, N, indices) };
}

// Faces turned against the base surface. The approved source already has micro-folds where
// inward displacement exceeds an arris's radius (Cycles shades both sides); a back-face-culled
// runtime shows them only as grazing-angle pinholes, so LODs must not add folded area.
function turnedFaces(P, N, indices) {
  let turned = 0;
  let turnedArea = 0;
  let area = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const f = faceNormal(P, a, b, c);
    const length = Math.hypot(...f);
    area += length / 2;
    if (length === 0) continue;
    const n = [0, 1, 2].map((k) => N[a * 3 + k] + N[b * 3 + k] + N[c * 3 + k]);
    if (f[0] * n[0] + f[1] * n[1] + f[2] * n[2] <= 0) {
      turned++;
      turnedArea += length / 2;
    }
  }
  return { turnedFaces: turned, turnedAreaFraction: area > 0 ? turnedArea / area : 0 };
}

async function saveRuntime(name, bytes) {
  await writeFile(join(out, "runtime", name), bytes, { flag: "wx" });
  return { path: `runtime/${name}`, bytes: bytes.length, sha256: hash(bytes) };
}

async function encode(name, lod, mesh) {
  const vbytes = Buffer.from(
    mesh.vertices.buffer,
    mesh.vertices.byteOffset,
    mesh.vertices.byteLength,
  );
  const ibytes = Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength);
  const count = mesh.vertices.length / 8;
  for (let i = 0; i < mesh.vertices.length; i++) assert(Number.isFinite(mesh.vertices[i]));
  const venc = Buffer.from(MeshoptEncoder.encodeGltfBuffer(vbytes, count, 32, "ATTRIBUTES", 0));
  const vdec = new Uint8Array(vbytes.length);
  MeshoptDecoder.decodeGltfBuffer(vdec, count, 32, venc, "ATTRIBUTES");
  assert(Buffer.from(vdec).equals(vbytes), "Meshopt vertex roundtrip differs");
  const ienc = Buffer.from(
    MeshoptEncoder.encodeGltfBuffer(ibytes, mesh.indices.length, 4, "TRIANGLES", 0),
  );
  const idec = new Uint32Array(mesh.indices.length);
  MeshoptDecoder.decodeGltfBuffer(
    new Uint8Array(idec.buffer),
    mesh.indices.length,
    4,
    ienc,
    "TRIANGLES",
  );
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const r = [0, 1, 2].find((o) => idec[i] === mesh.indices[i + o]);
    assert(
      r !== undefined &&
        idec[i + 1] === mesh.indices[i + ((r + 1) % 3)] &&
        idec[i + 2] === mesh.indices[i + ((r + 2) % 3)],
      "Meshopt triangle topology differs",
    );
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], mesh.vertices[i * 8 + a]);
      max[a] = Math.max(max[a], mesh.vertices[i * 8 + a]);
    }
  await writeFile(join(out, "decoded", `${name}-lod${lod}.vertices`), vdec, { flag: "wx" });
  await writeFile(join(out, "decoded", `${name}-lod${lod}.indices`), new Uint8Array(idec.buffer), {
    flag: "wx",
  });
  return {
    lod,
    vertices: count,
    triangles: mesh.indices.length / 3,
    rawBytes: vbytes.length + ibytes.length,
    bounds: [min, max],
    vertexStream: await saveRuntime(`${name}-lod${lod}.vertices.meshopt`, venc),
    indexStream: await saveRuntime(`${name}-lod${lod}.indices.meshopt`, ienc),
  };
}

const receipt = {
  stage: "geometry",
  source: extract.source,
  extractSha256: hash(await readFile(join(src, "extract.json"))),
  method: METHOD,
  displacementWeight: DISPLACEMENT_WEIGHT,
  displacementSmoothMm: SMOOTH_MM,
  plasterMarginMetres: PLASTER_MARGIN_M,
  squash: SQUASH,
  errorsMm: ERRORS,
  plantFractions: PLANT_FRACTIONS,
  ...(extract.objects.some((o) => o.tinted)
    ? { uvTint: TINT, clayErrorsMm: CLAY_ERRORS, roofOakErrorsMm: ROOF_OAK_ERRORS }
    : {}),
  layout: { vertex: "position-normal-uv-f32", stride: 32, index: "uint32" },
  meshes: [],
  placements: [],
};

// Mirrored placements (the right facade) get mirrored geometry: X negated and the winding
// reversed, so every instance keeps the engine's one front-face convention and no new pipeline
// variant is needed. Their matrices absorb the mirror (det > 0).
const MIRROR = [
  [-1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];
const mirroredPieces = new Set();
for (const p of extract.placements) {
  let G = mul(mul(mul(C, p.matrix), translate(pivotOf(p.piece))), CI);
  const mirrored = det3(G) < 0;
  if (mirrored) {
    G = mul(G, MIRROR);
    mirroredPieces.add(p.piece);
  }
  receipt.placements.push({
    name: p.name,
    piece: mirrored ? `${p.piece}~m` : p.piece,
    matrix: columnMajor(G).map((v) => Math.round(v * 1e9) / 1e9),
    mirrored,
  });
}

function mirrorMesh({ vertices, indices }) {
  const v = new Float32Array(vertices);
  for (let i = 0; i < v.length; i += 8) {
    v[i] = -v[i];
    v[i + 3] = -v[i + 3];
  }
  const I = new Uint32Array(indices.length);
  for (let t = 0; t < indices.length; t += 3) {
    I[t] = indices[t];
    I[t + 1] = indices[t + 2];
    I[t + 2] = indices[t + 1];
  }
  return { vertices: v, indices: I };
}

const only = process.env.GEOMETRY_ONLY?.split(",");
for (const obj of extract.objects) {
  if (only && !only.includes(obj.object)) continue;
  const t0 = performance.now();
  const B = await npy(obj.object, "B");
  const cls0 = materialClass(obj.object === "FootPlants" ? "plants" : obj.materials[0]);
  let P = obj.displaced
    ? smoothDisplacement(
        await npy(obj.object, "P"),
        B,
        await npy(obj.object, "T"),
        SMOOTH_MM[cls0] ?? 0,
      )
    : await npy(obj.object, "P");
  let N = await npy(obj.object, "N");
  let UV = await npy(obj.object, "UV");
  let T = await npy(obj.object, "T");
  const M = await npy(obj.object, "M");
  // One material per runtime mesh; the foot plants' five slots share one atlas material.
  const materials = [...new Set(M)].map((i) => obj.materials[i]);
  assert(
    obj.object === "FootPlants" || obj.tinted || materials.length === 1,
    `${obj.object} mixes materials`,
  );
  const material = obj.object === "FootPlants" ? "plants" : obj.tinted ? "roof-tile" : materials[0];
  let tint = null;
  let tileFarT = null;
  if (obj.tinted) {
    assert(
      materials.every((m) => m === "roof-tile" || m === "roof-tile-body"),
      obj.object,
    );
    const VIS = await npy(obj.object, "VIS");
    // LOD0 keeps TILE_DILATE rings of hidden triangles around the visible ones: a centroid ray test
    // misses faces seen only at grazing angles, such as a cover's underside just inside its mouth.
    // Farther LODs keep the visible set alone (the rings' open borders stop simplification).
    const posKey = (v) => `${P[v * 3]},${P[v * 3 + 1]},${P[v * 3 + 2]}`;
    const keep = Uint8Array.from(VIS);
    for (let ring = 0; ring < TILE_DILATE; ring++) {
      const near = new Set();
      for (let t = 0; t < keep.length; t++)
        if (keep[t]) for (let k = 0; k < 3; k++) near.add(posKey(T[t * 3 + k]));
      const grow = keep.slice();
      for (let t = 0; t < keep.length; t++)
        if (!keep[t] && [0, 1, 2].some((k) => near.has(posKey(T[t * 3 + k])))) grow[t] = 1;
      keep.set(grow);
    }
    // Rim (body) faces sampled a stretched strip of the visible face's border and streaked. Their
    // vertices are duplicated (once each, so every tile's rim band stays connected for the
    // simplifier) and each band takes one UV, the mean of its border: the tile's own clay, tinted.
    const body = obj.materials.indexOf("roof-tile-body");
    let C = await npy(obj.object, "C");
    const extra = { P: [], N: [], UV: [], C: [] };
    const dup = new Map();
    const kept = [];
    const keptFar = [];
    for (let t = 0; t < keep.length; t++) {
      if (!keep[t]) continue;
      for (let k = 0; k < 3; k++) {
        const v = T[t * 3 + k];
        if (M[t] !== body) {
          kept.push(v);
          if (VIS[t]) keptFar.push(v);
          continue;
        }
        if (!dup.has(v)) {
          dup.set(v, P.length / 3 + dup.size);
          extra.P.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
          extra.N.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
          extra.UV.push(UV[v * 2], UV[v * 2 + 1]);
          extra.C.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2]);
        }
        kept.push(dup.get(v));
        if (VIS[t]) keptFar.push(dup.get(v));
      }
    }
    // Rim bands: connected components of the duplicated vertices; each takes its mean UV.
    const base = P.length / 3;
    const lab = Int32Array.from({ length: dup.size }, (_, i) => i);
    const find = (i) => {
      while (lab[i] !== i) i = lab[i] = lab[lab[i]];
      return i;
    };
    for (let t = 0; t < kept.length; t += 3)
      if (kept[t] >= base)
        for (let k = 1; k < 3; k++) {
          const a = find(kept[t] - base);
          const b = find(kept[t + k] - base);
          if (a !== b) lab[Math.max(a, b)] = Math.min(a, b);
        }
    const sum = new Map();
    for (let i = 0; i < dup.size; i++) {
      const r = find(i);
      const e = sum.get(r) ?? [0, 0, 0];
      e[0] += extra.UV[i * 2];
      e[1] += extra.UV[i * 2 + 1];
      e[2] += 1;
      sum.set(r, e);
    }
    for (let i = 0; i < dup.size; i++) {
      const e = sum.get(find(i));
      extra.UV[i * 2] = e[0] / e[2];
      extra.UV[i * 2 + 1] = e[1] / e[2];
    }
    const cat = (a, b) => {
      const o = new Float32Array(a.length + b.length);
      o.set(a);
      o.set(b, a.length);
      return o;
    };
    P = cat(P, extra.P);
    N = cat(N, extra.N);
    UV = cat(UV, extra.UV);
    C = cat(C, extra.C);
    T = Uint32Array.from(kept);
    tileFarT = Uint32Array.from(keptFar);
    tint = tintSteps(C);
  }
  if (material === "plants") UV = plantAtlasUv(obj, UV, T, M);
  if (material.startsWith("plaster-") && extract.layout?.pieces?.[obj.piece])
    UV = plasterMarginUv(obj, UV);
  if (material === "kit-iron") UV = ironBoxUv(P, N);
  if (material === "kit-glass") UV = ironBoxUv(P, N, GLASS_TILE_M);
  // The K2 roof's bedding mortar was object-space procedural: box-mapped onto its 0.5 m tile.
  if (material === "roof-mortar") UV = ironBoxUv(P, N, 0.5);
  const cls = materialClass(material);
  const pivot = pivotOf(obj.piece);
  const lods = [];
  const mirroredLods = [];
  const source = simplify(obj, cls, P, B, N, T, -1);
  for (let lod = 0; lod < 3; lod++) {
    const s = simplify(obj, cls, P, B, N, tileFarT && lod > 0 ? tileFarT : T, lod);
    if (s.turnedAreaFraction !== undefined)
      assert(
        s.turnedAreaFraction <= Math.max(2 * source.turnedAreaFraction, 5e-4),
        `${obj.object} LOD${lod} folds ${s.turnedAreaFraction} of its area (source ${source.turnedAreaFraction})`,
      );
    const mesh =
      material === "plants"
        ? (({ P: P2, N: N2, UV: UV2, indices }) =>
            optimize(interleave(P2, N2, UV2, pivot), indices))(withBackFaces(P, N, UV, s.indices))
        : tint
          ? optimize(withTint(interleave(P, N, UV, pivot), tint.steps), s.indices)
          : optimize(interleave(P, N, UV, pivot), s.indices);
    const entry = await encode(obj.object, lod, mesh);
    if (mirroredPieces.has(obj.piece))
      mirroredLods.push({
        ...(await encode(`${obj.object}~m`, lod, mirrorMesh(mesh))),
        simplifierErrorMm: s.errorMm,
      });
    lods.push({
      ...entry,
      simplifierErrorMm: s.errorMm,
      ...(s.turnedFaces === undefined
        ? {}
        : { turnedFaces: s.turnedFaces, turnedAreaFraction: s.turnedAreaFraction }),
    });
  }
  if (cls === null || !obj.displaced)
    if (material !== "plants" && !obj.tinted)
      for (const l of lods)
        assert(
          l.vertexStream.sha256 === lods[0].vertexStream.sha256 &&
            l.indexStream.sha256 === lods[0].indexStream.sha256,
          `${obj.object}: an unsimplified mesh must ship identical LODs`,
        );
  receipt.meshes.push({
    object: obj.object,
    piece: obj.piece,
    material,
    materialClass: cls,
    pivot,
    sourceVertices: obj.vertices,
    sourceTriangles: obj.triangles,
    ...(tint
      ? { visibleTriangles: T.length / 3, tintWorstRelativeError: tint.worstRelativeError }
      : {}),
    ...(source.turnedFaces === undefined
      ? {}
      : {
          sourceTurnedFaces: source.turnedFaces,
          sourceTurnedAreaFraction: source.turnedAreaFraction,
        }),
    lods,
  });
  if (mirroredLods.length)
    receipt.meshes.push({
      object: `${obj.object}~m`,
      piece: `${obj.piece}~m`,
      material,
      materialClass: cls,
      pivot,
      mirrorOf: obj.object,
      lods: mirroredLods,
    });
  console.log(
    obj.object,
    material,
    lods
      .map(
        (l) =>
          `${l.triangles}t/${l.simplifierErrorMm.toFixed(2)}mm` +
          (l.turnedAreaFraction === undefined
            ? ""
            : `/fold${(l.turnedAreaFraction * 1e4).toFixed(1)}bp`),
      )
      .join(" "),
    source.turnedAreaFraction === undefined
      ? ""
      : `source fold ${(source.turnedAreaFraction * 1e4).toFixed(1)}bp`,
    `${((performance.now() - t0) / 1000).toFixed(1)}s`,
  );
}

receipt.housePlacement = { matrix: columnMajor(mul(mul(C, translate([0, 0, 0])), CI)) };
await writeFile(join(out, "geometry.json"), `${JSON.stringify(receipt, null, 1)}\n`, {
  flag: "wx",
});
console.log(
  "GEOMETRY_DONE",
  receipt.meshes.length,
  "meshes",
  receipt.placements.length,
  "placements",
);
