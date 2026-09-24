// Photoreal paving delivery, stage 3: runtime geometry, meshopt streams, KTX2 maps and GLBs.
// node pack.mjs <stage-2 maps dir> <output dir>
//
// Parts of the periodic 4 m module, each with three LODs, all in glTF Y-up metres centred
// on the tile (X = x - 2, Y = z, Z = 2 - y), 32-byte position/normal/uv vertices:
//   ground  border-locked meshopt decimation of the 16-bit height field; every vertex
//           normal is +Y, so the full-height normal map carries all shading
//   pebbles source pebbles >= the stage-2 threshold as simplified instanced shells
//           (true normals), coloured by the ground base colour through planar UVs
//   plants  source joint plants with atlas UVs and explicit back faces
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  MeshoptDecoder,
  MeshoptEncoder,
  MeshoptSimplifier,
} from "../../../../../engine/node_modules/meshoptimizer/index.js";
import {
  KTX_ENCODER_PIN,
  loadPinnedKtxEncoder,
} from "../../../../../engine/scripts/ktx-encoder-pin.mjs";

const mapsDir = resolve(process.argv[2]);
const out = resolve(process.argv[3]);
await mkdir(out, { recursive: false });
await mkdir(join(out, "runtime"));
await mkdir(join(out, "decoded"));
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
// UASTC encoder level (libktx pack_uastc_flag_bits) and the ground normal's at-rest format.
const UASTC_LEVEL = process.env.PAVING_UASTC_LEVEL ?? "LEVEL_SLOWER";
const GROUND_NORMAL_FORMAT = process.env.PAVING_GROUND_NORMAL ?? "uastc";
assert(["uastc", "rgba8"].includes(GROUND_NORMAL_FORMAT), "PAVING_GROUND_NORMAL is uastc or rgba8");
const TILE = 4;
const N = 4096;
const PX = TILE / N;
const LOD = {
  ground: [
    // PAVING_GROUND_LOD0_ERROR_MM: experiment override, recorded in pack.json.
    { grid: 1600, errorMm: Number(process.env.PAVING_GROUND_LOD0_ERROR_MM ?? 1) },
    { grid: 800, errorMm: 3 },
    { grid: 200, errorMm: 6 },
  ],
  // The engine requires three LODs per placement; LOD2 keeps the largest pebbles.
  pebbles: [
    { minimumMm: 9, triangles: 64 },
    { minimumMm: 13, triangles: 24 },
    { minimumMm: 16, triangles: 12 },
  ],
  plants: [{ keep: 1 }, { keep: 0.35 }, { keep: 0.1 }],
};
const hash = (b) => createHash("sha256").update(b).digest("hex");

async function npy(name) {
  const b = await readFile(join(mapsDir, "geometry", `${name}.npy`));
  assert.equal(b.toString("latin1", 1, 6), "NUMPY");
  const v1 = b[6] === 1;
  const start = v1 ? 10 : 12;
  const off = start + (v1 ? b.readUInt16LE(8) : b.readUInt32LE(8));
  const header = b.toString("latin1", start, off);
  assert.match(header, /'fortran_order': False/);
  const descr = /'descr': '([^']+)'/.exec(header)[1];
  const shape = /'shape': \(([^)]*)\)/
    .exec(header)[1]
    .split(",")
    .filter((s) => s.trim())
    .map(Number);
  const Type = { "<f4": Float32Array, "<i4": Int32Array, "|u1": Uint8Array }[descr];
  assert(Type, descr);
  return { data: new Type(b.buffer.slice(b.byteOffset + off, b.byteOffset + b.length)), shape };
}

// ------------------------------------------------------------------ periodic height sampler
const H = (await npy("H")).data;
function height(x, y) {
  // Texel-centre bilinear on the periodic field; x = 4 and x = 0 sample identically.
  const u = (((x % TILE) + TILE) % TILE) / PX - 0.5;
  const v = (((y % TILE) + TILE) % TILE) / PX - 0.5;
  let j0 = Math.floor(u);
  let i0 = Math.floor(v);
  const fu = u - j0;
  const fv = v - i0;
  j0 = (j0 + N) % N;
  i0 = (i0 + N) % N;
  const j1 = (j0 + 1) % N;
  const i1 = (i0 + 1) % N;
  return (
    H[i0 * N + j0] * (1 - fu) * (1 - fv) +
    H[i0 * N + j1] * fu * (1 - fv) +
    H[i1 * N + j0] * (1 - fu) * fv +
    H[i1 * N + j1] * fu * fv
  );
}

// Interleave source-space (x, y up=z) vertices into the 32-byte glTF runtime layout.
function interleave(sourcePositions, sourceNormals, uvs) {
  const n = sourcePositions.length / 3;
  const f = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = [
      sourcePositions[i * 3],
      sourcePositions[i * 3 + 1],
      sourcePositions[i * 3 + 2],
    ];
    const [nx, ny, nz] = [sourceNormals[i * 3], sourceNormals[i * 3 + 1], sourceNormals[i * 3 + 2]];
    f.set([x - 2, z, 2 - y, nx, nz, -ny], i * 8);
    f[i * 8 + 6] = uvs ? uvs[i * 2] : x / TILE;
    f[i * 8 + 7] = uvs ? uvs[i * 2 + 1] : 1 - y / TILE;
  }
  return f;
}

function optimize(vertices, indices) {
  const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, true);
  const v = new Float32Array(unique * 8);
  for (let i = 0; i < remap.length; i++)
    if (remap[i] !== 0xffffffff) v.set(vertices.subarray(i * 8, i * 8 + 8), remap[i] * 8);
  return { vertices: v, indices };
}

// ------------------------------------------------------------------ ground LODs
// meshoptimizer rejects only a single collapse that rotates a face past 90 degrees, so
// successive collapses can fold steep sidewall faces over (candidate 1: 1,142 downward
// faces). Simplifying a vertically squashed copy starts every face near +Z, so a fold is
// a rejected flip; the absolute error is squashed by the same factor to stay vertical.
const GROUND_Z_SCALE = 0.02;
function groundLod({ grid, errorMm }) {
  const n1 = grid + 1;
  const P = new Float32Array(n1 * n1 * 3);
  const Z = new Float32Array(n1 * n1);
  const lock = new Uint8Array(n1 * n1);
  for (let r = 0; r <= grid; r++)
    for (let c = 0; c <= grid; c++) {
      const k = r * n1 + c;
      const x = (c * TILE) / grid;
      const y = (r * TILE) / grid;
      Z[k] = height(x, y);
      P.set([x, y, Z[k] * GROUND_Z_SCALE], k * 3);
      if (r === 0 || c === 0 || r === grid || c === grid) lock[k] = 1;
    }
  const I = new Uint32Array(grid * grid * 6);
  let q = 0;
  for (let r = 0; r < grid; r++)
    for (let c = 0; c < grid; c++) {
      const a = r * n1 + c;
      I.set([a, a + 1, a + n1 + 1, a, a + n1 + 1, a + n1], q);
      q += 6;
    }
  const [simplified, resultError] = MeshoptSimplifier.simplifyWithAttributes(
    I,
    P,
    3,
    new Float32Array(n1 * n1),
    1,
    [0],
    lock,
    0,
    (errorMm / 1000) * GROUND_Z_SCALE,
    ["ErrorAbsolute"],
  );
  for (let k = 0; k < n1 * n1; k++) P[k * 3 + 2] = Z[k];
  let steepest = 1;
  for (let t = 0; t < simplified.length; t += 3) {
    const n = faceNormal(P, simplified[t], simplified[t + 1], simplified[t + 2]);
    steepest = Math.min(steepest, n[2] / Math.hypot(...n));
  }
  assert(steepest > 0, "Ground LOD folded a face downward");
  // Locked border vertices survive, so opposite edges keep identical vertex sets.
  const used = new Set(simplified);
  for (const axis of [0, 1]) {
    const low = [];
    const high = [];
    for (const k of used) {
      if (P[k * 3 + axis] === 0) low.push(P[k * 3 + 1 - axis]);
      if (P[k * 3 + axis] === TILE) high.push(P[k * 3 + 1 - axis]);
    }
    low.sort((a, b) => a - b);
    high.sort((a, b) => a - b);
    assert.deepEqual(low, high, "Opposite tile edges must keep identical vertices");
    assert.equal(low.length, n1);
  }
  const normals = new Float32Array(P.length);
  for (let i = 0; i < n1 * n1; i++) normals[i * 3 + 2] = 1;
  const { vertices, indices } = optimize(interleave(P, normals, null), simplified);
  return {
    vertices,
    indices,
    resultErrorMm: (resultError * 1000) / GROUND_Z_SCALE,
    grid,
    steepestFaceDegrees: (Math.acos(steepest) * 180) / Math.PI,
  };
}

// ------------------------------------------------------------------ pebble shells
const pebble = {
  position: (await npy("position")).data,
  rot: (await npy("rot")).data,
  scl: (await npy("scl")).data,
  variant: (await npy("variant")).data,
  smooth: (await npy("smooth")).data,
};
const variants = [];
for (let k = 0; k < 24; k++) {
  const id = String(k).padStart(2, "0");
  variants.push({ v: (await npy(`v${id}`)).data, f: (await npy(`f${id}`)).data });
}
function faceNormal(p, a, b, c) {
  const ux = p[b * 3] - p[a * 3];
  const uy = p[b * 3 + 1] - p[a * 3 + 1];
  const uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3];
  const vy = p[c * 3 + 1] - p[a * 3 + 1];
  const vz = p[c * 3 + 2] - p[a * 3 + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}
function shell(k, triangles) {
  const { v, f } = variants[k];
  const [idx] = MeshoptSimplifier.simplify(new Uint32Array(f), v, 3, triangles * 3, 0.2, []);
  const smooth = pebble.smooth[k] === 1;
  // Smooth variants share vertices; angular (flat-shaded) variants split per face.
  const pos = [];
  const nrm = [];
  const tri = [];
  if (smooth) {
    // The simplifier keeps original vertices: shade them with the full source's normals.
    const acc = new Float32Array(v.length);
    for (let t = 0; t < f.length; t += 3) {
      const n = faceNormal(v, f[t], f[t + 1], f[t + 2]);
      for (const i of f.subarray(t, t + 3)) for (let a = 0; a < 3; a++) acc[i * 3 + a] += n[a];
    }
    const map = new Map();
    for (const i of idx) {
      if (!map.has(i)) {
        map.set(i, pos.length / 3);
        const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]);
        pos.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
        nrm.push(acc[i * 3] / l, acc[i * 3 + 1] / l, acc[i * 3 + 2] / l);
      }
      tri.push(map.get(i));
    }
  } else {
    for (let t = 0; t < idx.length; t += 3) {
      const n = faceNormal(v, idx[t], idx[t + 1], idx[t + 2]);
      const l = Math.hypot(...n);
      for (const i of idx.subarray(t, t + 3)) {
        tri.push(pos.length / 3);
        pos.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
        nrm.push(n[0] / l, n[1] / l, n[2] / l);
      }
    }
  }
  return { pos, nrm, tri };
}
function pebbleLod(spec) {
  const shells = variants.map((_, k) => shell(k, spec.triangles));
  const pos = [];
  const nrm = [];
  const tri = [];
  let count = 0;
  for (let i = 0; i < pebble.variant.length; i++) {
    const s = [pebble.scl[i * 3], pebble.scl[i * 3 + 1], pebble.scl[i * 3 + 2]];
    if (s[0] < spec.minimumMm / 1000) continue;
    count++;
    const sh = shells[pebble.variant[i]];
    // Blender Instance on Points: T * R(Euler XYZ = Rz Ry Rx) * S.
    const [a, b, c] = [pebble.rot[i * 3], pebble.rot[i * 3 + 1], pebble.rot[i * 3 + 2]];
    const [ca, sa, cb, sb, cc, sc] = [
      Math.cos(a),
      Math.sin(a),
      Math.cos(b),
      Math.sin(b),
      Math.cos(c),
      Math.sin(c),
    ];
    const R = [
      [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa],
      [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa],
      [-sb, cb * sa, cb * ca],
    ];
    const base = pos.length / 3;
    for (let j = 0; j < sh.pos.length; j += 3) {
      const l = [sh.pos[j] * s[0], sh.pos[j + 1] * s[1], sh.pos[j + 2] * s[2]];
      const n = [sh.nrm[j] / s[0], sh.nrm[j + 1] / s[1], sh.nrm[j + 2] / s[2]];
      for (let r = 0; r < 3; r++)
        pos.push(pebble.position[i * 3 + r] + R[r][0] * l[0] + R[r][1] * l[1] + R[r][2] * l[2]);
      const w = R.map((row) => row[0] * n[0] + row[1] * n[1] + row[2] * n[2]);
      const wl = Math.hypot(...w);
      nrm.push(w[0] / wl, w[1] / wl, w[2] / wl);
    }
    for (const t of sh.tri) tri.push(base + t);
  }
  const P = new Float32Array(pos);
  const uv = new Float32Array((P.length / 3) * 2);
  for (let i = 0; i < P.length / 3; i++) {
    uv[i * 2] = P[i * 3] / TILE;
    uv[i * 2 + 1] = 1 - P[i * 3 + 1] / TILE;
  }
  return {
    ...optimize(interleave(P, new Float32Array(nrm), uv), new Uint32Array(tri)),
    instances: count,
  };
}

// ------------------------------------------------------------------ plants
const plantCo = (await npy("plant_co")).data;
const plantLoops = (await npy("plant_loops")).data;
const plantUv = (await npy("plant_uv")).data;
function plantsSingleSided() {
  const key = new Map();
  const pos = [];
  const uv = [];
  const tri = [];
  for (let q = 0; q < plantLoops.length / 4; q++) {
    const ids = [];
    for (let c = 0; c < 4; c++) {
      const vi = plantLoops[q * 4 + c];
      const u = plantUv[(q * 4 + c) * 2];
      const w = plantUv[(q * 4 + c) * 2 + 1];
      const k = `${vi}:${u}:${w}`;
      if (!key.has(k)) {
        key.set(k, pos.length / 3);
        pos.push(plantCo[vi * 3], plantCo[vi * 3 + 1], plantCo[vi * 3 + 2]);
        uv.push(u, w);
      }
      ids.push(key.get(k));
    }
    tri.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), tri: new Uint32Array(tri) };
}
function smoothNormals(pos, tri) {
  const acc = new Float32Array(pos.length);
  for (let t = 0; t < tri.length; t += 3) {
    const n = faceNormal(pos, tri[t], tri[t + 1], tri[t + 2]);
    for (const i of tri.subarray(t, t + 3)) for (let a = 0; a < 3; a++) acc[i * 3 + a] += n[a];
  }
  let fallback = 0;
  for (let i = 0; i < acc.length; i += 3) {
    const l = Math.hypot(acc[i], acc[i + 1], acc[i + 2]);
    if (l > 1e-20) {
      acc[i] /= l;
      acc[i + 1] /= l;
      acc[i + 2] /= l;
    } else {
      // Only zero-area triangles reach this vertex (collapsed leaf tips/bases): face up.
      acc.set([0, 0, 1], i);
      fallback++;
    }
  }
  plantNormalFallbacks.push(fallback);
  return acc;
}
const plantNormalFallbacks = [];
function plantLod(spec) {
  const base = plantsSingleSided();
  let tri = base.tri;
  if (spec.keep < 1) {
    const target = Math.floor((tri.length / 3) * spec.keep) * 3;
    [tri] = MeshoptSimplifier.simplifyWithAttributes(
      tri,
      base.pos,
      3,
      base.uv,
      2,
      [0.5, 0.5],
      null,
      target,
      0.02,
      [],
    );
  }
  const normals = smoothNormals(base.pos, tri);
  // The runtime pipeline is opaque and back-face culled: add reversed back faces.
  const nv = base.pos.length / 3;
  const pos = new Float32Array(nv * 6);
  pos.set(base.pos);
  pos.set(base.pos, nv * 3);
  const nrm = new Float32Array(nv * 6);
  nrm.set(normals);
  for (let i = 0; i < nv * 3; i++) nrm[nv * 3 + i] = -normals[i];
  const uv = new Float32Array(nv * 4);
  uv.set(base.uv);
  uv.set(base.uv, nv * 2);
  const both = new Uint32Array(tri.length * 2);
  both.set(tri);
  for (let t = 0; t < tri.length; t += 3)
    both.set([tri[t] + nv, tri[t + 2] + nv, tri[t + 1] + nv], tri.length + t);
  return optimize(interleave(pos, nrm, uv), both);
}

// ------------------------------------------------------------------ encode geometry
const receipt = {
  stage: "pack",
  encoders: { ktx: KTX_ENCODER_PIN, meshopt: "1.2.0" },
  lods: LOD,
  geometry: [],
  textures: [],
};
const glbMeshes = [[], [], []];
async function saveRuntime(name, bytes) {
  const file = `runtime/${name}`;
  await writeFile(join(out, file), bytes, { flag: "wx" });
  return { file, bytes: bytes.length, sha256: hash(bytes) };
}
async function encodeGeometry(part, lod, mesh) {
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
  const entry = {
    part,
    lod,
    vertices: count,
    triangles: mesh.indices.length / 3,
    rawBytes: vbytes.length + ibytes.length,
    bounds: [min, max],
    vertexStream: await saveRuntime(`${part}-lod${lod}.vertices.meshopt`, venc),
    indexStream: await saveRuntime(`${part}-lod${lod}.indices.meshopt`, ienc),
    ...(mesh.resultErrorMm === undefined
      ? {}
      : {
          simplifierErrorMm: mesh.resultErrorMm,
          grid: mesh.grid,
          steepestFaceDegrees: mesh.steepestFaceDegrees,
        }),
    ...(mesh.instances === undefined ? {} : { instances: mesh.instances }),
  };
  receipt.geometry.push(entry);
  glbMeshes[lod].push({ part, vbytes, ibytes, count, indexCount: mesh.indices.length, min, max });
  // Decoded streams for the Chrome inspection: exactly the bytes the runtime would upload.
  await writeFile(join(out, "decoded", `${part}-lod${lod}.vertices`), vdec, { flag: "wx" });
  await writeFile(join(out, "decoded", `${part}-lod${lod}.indices`), new Uint8Array(idec.buffer), {
    flag: "wx",
  });
  console.log(
    part,
    lod,
    entry.vertices,
    "vertices",
    entry.triangles,
    "triangles",
    venc.length + ienc.length,
    "B",
  );
}
for (let lod = 0; lod < 3; lod++) {
  await encodeGeometry("ground", lod, groundLod(LOD.ground[lod]));
  if (LOD.pebbles[lod]) await encodeGeometry("pebbles", lod, pebbleLod(LOD.pebbles[lod]));
  if (LOD.plants[lod]) await encodeGeometry("plants", lod, plantLod(LOD.plants[lod]));
}

// ------------------------------------------------------------------ KTX2 maps
const k = await loadPinnedKtxEncoder();
const maps = JSON.parse(await readFile(join(mapsDir, "maps.json"), "utf8"));
for (const map of maps.maps) {
  const width = map.levels[0].width;
  const heightPx = map.levels[0].height;
  const info = new k.textureCreateInfo();
  info.vkFormat = map.role.endsWith("basecolor")
    ? k.VkFormat.R8G8B8A8_SRGB
    : k.VkFormat.R8G8B8A8_UNORM;
  Object.assign(info, {
    baseWidth: width,
    baseHeight: heightPx,
    baseDepth: 1,
    numDimensions: 2,
    numLevels: map.levels.length,
    numLayers: 1,
    numFaces: 1,
    isArray: false,
    generateMipmaps: false,
  });
  const texture = new k.texture(info, k.TextureCreateStorageEnum.ALLOC_STORAGE);
  const basis = new k.basisParams();
  const levels = [];
  for (const [level, image] of map.levels.entries()) {
    const rgba = await readFile(join(mapsDir, image.file));
    assert.equal(hash(rgba), image.sha256);
    assert.equal(rgba.length, image.width * image.height * 4);
    levels.push(rgba);
    texture.setImageFromMemory(level, 0, 0, rgba);
  }
  // Maps are UASTC at rest and BC7 on the GPU. Candidates 1-4 ran at libktx's LEVEL_FASTEST,
  // because the binding silently ignores a numeric uastcFlags; only the enum object sets it.
  // At that level UASTC left 24% of ground-normal texels > 5 degrees off, so candidate 4 kept
  // the normal as plain RGBA8. PAVING_GROUND_NORMAL=rgba8 keeps that lossless form.
  const lossless = map.role === "ground-normal" && GROUND_NORMAL_FORMAT === "rgba8";
  Object.assign(basis, {
    uastc: true,
    threadCount: 8,
    noSSE: true,
    uastcRDO: false,
    uastcRDONoMultithreading: true,
  });
  basis.uastcFlags = k.pack_uastc_flag_bits[UASTC_LEVEL];
  assert.equal(basis.uastcFlags, k.pack_uastc_flag_bits[UASTC_LEVEL].value, "UASTC level unset");
  const started = performance.now();
  if (!lossless) assert.equal(texture.compressBasis(basis), k.ErrorCode.SUCCESS);
  const plain = Buffer.from(texture.writeToMemory());
  assert.equal(texture.deflateZstd(lossless ? 19 : 9), k.ErrorCode.SUCCESS);
  const supercompressed = Buffer.from(texture.writeToMemory());
  const encodeMs = performance.now() - started;
  const bytes = plain;
  const zstdBytes = supercompressed.length;
  texture.delete();
  basis.delete();
  info.delete();
  const saved = await saveRuntime(`${map.role}.ktx2`, bytes);
  const decoded = new k.texture(bytes);
  if (!lossless)
    assert.equal(decoded.transcodeBasis(k.TranscodeTarget.RGBA32, 0), k.ErrorCode.SUCCESS);
  let decodedBytes = 0;
  let err = 0;
  let maxErr = 0;
  const angles = { sum: 0, over5: 0, over10: 0, max: 0 };
  for (let level = 0; level < map.levels.length; level++) {
    const rgba = Buffer.from(decoded.getImage(level, 0, 0));
    assert.equal(rgba.length, levels[level].length);
    decodedBytes += rgba.length;
    await writeFile(
      join(out, "decoded", `${map.role}-${String(level).padStart(2, "0")}.rgba`),
      rgba,
      { flag: "wx" },
    );
    if (level === 0) {
      for (let i = 0; i < rgba.length; i++) {
        if (i % 4 === 3) continue;
        const d = Math.abs(rgba[i] - levels[0][i]);
        err += d;
        maxErr = Math.max(maxErr, d);
      }
      if (map.role.endsWith("-normal"))
        for (let i = 0; i < rgba.length; i += 4) {
          const a = normalAngleDeg(rgba, levels[0], i);
          angles.sum += a;
          angles.max = Math.max(angles.max, a);
          if (a > 5) angles.over5++;
          if (a > 10) angles.over10++;
        }
    }
  }
  decoded.delete();
  if (lossless) assert.equal(maxErr, 0, "Lossless normal must decode exactly");
  const entry = {
    role: map.role,
    width,
    height: heightPx,
    levels: map.levels.length,
    ktx2: saved,
    format: lossless ? "rgba8" : "uastc",
    uncompressedContainerBytes: plain.length,
    zstdBytes,
    rgba8DecodedBytes: decodedBytes,
    bc7LogicalBytes: Math.round(decodedBytes / 4),
    level0MeanAbsError: err / ((levels[0].length / 4) * 3),
    level0MaxAbsError: maxErr,
    ...(map.role.endsWith("-normal")
      ? {
          level0MeanAngleDeg: angles.sum / (levels[0].length / 4),
          level0MaxAngleDeg: angles.max,
          level0Over5DegPercent: (angles.over5 / (levels[0].length / 4)) * 100,
          level0Over10DegPercent: (angles.over10 / (levels[0].length / 4)) * 100,
        }
      : {}),
    uastcLevel: lossless ? null : UASTC_LEVEL,
    encodeMs: Math.round(encodeMs),
    note: map.note,
  };
  receipt.textures.push(entry);
  console.log(
    map.role,
    width,
    saved.bytes,
    "B uastc",
    zstdBytes,
    "B zstd",
    entry.level0MeanAbsError.toFixed(3),
    "mean err",
  );
}

// ------------------------------------------------------------------ standard GLBs (validator + fresh import)
const png = async (role) => readFile(join(mapsDir, `${role}.png`));
const images = {};
for (const role of [
  "ground-basecolor",
  "ground-normal",
  "ground-orm",
  "plant-basecolor",
  "plant-normal",
  "plant-orm",
  "pebble-normal",
  "pebble-orm",
])
  images[role] = await png(role);
for (let lod = 0; lod < 3; lod++) {
  const chunks = [];
  let cursor = 0;
  const append = (b) => {
    const offset = cursor;
    chunks.push(b, Buffer.alloc((4 - (b.length % 4)) % 4));
    cursor += b.length + ((4 - (b.length % 4)) % 4);
    return offset;
  };
  const gltf = {
    asset: { version: "2.0", generator: "Parallax photoreal paving delivery v1" },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
    samplers: [
      { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 },
      { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 },
    ],
    images: [],
    textures: [],
    materials: [],
  };
  const tex = {};
  for (const [role, bytes] of Object.entries(images)) {
    const offset = append(bytes);
    gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    gltf.images.push({
      name: role,
      mimeType: "image/png",
      bufferView: gltf.bufferViews.length - 1,
    });
    gltf.textures.push({
      sampler: role.startsWith("plant") ? 1 : 0,
      source: gltf.images.length - 1,
    });
    tex[role] = gltf.textures.length - 1;
  }
  const material = (name, base, normal, orm) => {
    gltf.materials.push({
      name,
      pbrMetallicRoughness: {
        baseColorTexture: { index: tex[base] },
        metallicRoughnessTexture: { index: tex[orm] },
        metallicFactor: 1,
        roughnessFactor: 1,
      },
      normalTexture: { index: tex[normal], scale: 1 },
    });
    return gltf.materials.length - 1;
  };
  const mats = {
    ground: material("PavingGround", "ground-basecolor", "ground-normal", "ground-orm"),
    pebbles: material("PavingPebbles", "ground-basecolor", "pebble-normal", "pebble-orm"),
    plants: material("PavingPlants", "plant-basecolor", "plant-normal", "plant-orm"),
  };
  for (const m of glbMeshes[lod]) {
    const vo = append(m.vbytes);
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: vo,
      byteLength: m.vbytes.length,
      byteStride: 32,
      target: 34962,
    });
    const vv = gltf.bufferViews.length - 1;
    const io = append(m.ibytes);
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: io,
      byteLength: m.ibytes.length,
      target: 34963,
    });
    const a = gltf.accessors.length;
    gltf.accessors.push(
      {
        bufferView: vv,
        byteOffset: 0,
        componentType: 5126,
        count: m.count,
        type: "VEC3",
        min: m.min,
        max: m.max,
      },
      { bufferView: vv, byteOffset: 12, componentType: 5126, count: m.count, type: "VEC3" },
      { bufferView: vv, byteOffset: 24, componentType: 5126, count: m.count, type: "VEC2" },
      { bufferView: vv + 1, componentType: 5125, count: m.indexCount, type: "SCALAR" },
    );
    gltf.meshes.push({
      name: `${m.part}-lod${lod}`,
      primitives: [
        {
          attributes: { POSITION: a, NORMAL: a + 1, TEXCOORD_0: a + 2 },
          indices: a + 3,
          material: mats[m.part],
          mode: 4,
        },
      ],
    });
    gltf.nodes.push({ name: `${m.part}-lod${lod}`, mesh: gltf.meshes.length - 1 });
    gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
  }
  gltf.buffers[0].byteLength = cursor;
  const json = Buffer.from(JSON.stringify(gltf));
  const pj = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + pj.length + bin.length, 8);
  header.writeUInt32LE(pj.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length);
  bh.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([header, pj, bh, bin]);
  await writeFile(join(out, `lod${lod}.glb`), glb, { flag: "wx" });
  receipt[`lod${lod}Glb`] = { bytes: glb.length, sha256: hash(glb) };
}
receipt.plantNormalFallbacks = plantNormalFallbacks;
receipt.inputs = { maps: hash(await readFile(join(mapsDir, "maps.json"))) };
await writeFile(join(out, "pack.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
console.log("PACK_DONE", out);

/** Angle in degrees between two 8-bit tangent-space normals at byte offset i. */
function normalAngleDeg(a, b, i) {
  const v = (x) => x / 127.5 - 1;
  const [ax, ay, az] = [v(a[i]), v(a[i + 1]), v(a[i + 2])];
  const [bx, by, bz] = [v(b[i]), v(b[i + 1]), v(b[i + 2])];
  const cos = (ax * bx + ay * by + az * bz) / Math.hypot(ax, ay, az) / Math.hypot(bx, by, bz);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}
