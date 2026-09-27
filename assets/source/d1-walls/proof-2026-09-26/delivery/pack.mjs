// K1 timber-framed wall delivery, stage 4: GPU-ready KTX2 maps (D-201/D-203).
// node pack.mjs <maps dir> <output dir> [--jobs N]
//
// Every map from maps.py is encoded as UASTC at LEVEL_SLOWER (the paving's intermediate), then
// shipped pre-encoded: base colours as BC1 (libktx's transcode, as the paving), normals and ORMs
// as BC7 through the engine's pinned Babylon transcoder (preencodeUastcAsBc7), so the decode
// worker only copies levels. Each map also writes its decoded RGBA8 levels for the Blender
// fresh-import check. UASTC encoding is single-threaded here, so maps are spread over --jobs
// child processes (default 8); pack.json aggregates their receipts. WALLS_PACK_REUSE=<pack dir>,
// <its maps dir> copies any map whose mip levels are byte-identical to that earlier run's.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  KTX_ENCODER_PIN,
  loadPinnedKtxEncoder,
} from "../../../../../engine/scripts/ktx-encoder-pin.mjs";
import {
  bc7TranscoderIdentity,
  preencodeUastcAsBc7,
} from "../../../../../engine/scripts/preencode-bc7.mjs";

const mapsDir = resolve(process.argv[2]);
const out = resolve(process.argv[3]);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const UASTC_LEVEL = process.env.WALLS_UASTC_LEVEL ?? "LEVEL_SLOWER";
const maps = JSON.parse(await readFile(join(mapsDir, "maps.json"), "utf8"));

if (process.env.WALLS_PACK_ROLES === undefined) {
  // Parent: split the maps by texel count over the children, then aggregate.
  const jobsArg = process.argv.indexOf("--jobs");
  const jobs = jobsArg > 0 ? Number(process.argv[jobsArg + 1]) : 8;
  await mkdir(out, { recursive: false });
  await Promise.all(["runtime", "decoded", "receipts"].map((d) => mkdir(join(out, d))));
  const texels = (m) => m.levels.reduce((s, l) => s + l.width * l.height, 0);
  const buckets = Array.from({ length: jobs }, () => ({ load: 0, roles: [] }));
  for (const m of [...maps.maps].sort((a, b) => texels(b) - texels(a))) {
    const b = buckets.reduce((x, y) => (y.load < x.load ? y : x));
    b.load += texels(m);
    b.roles.push(m.role);
  }
  const started = performance.now();
  await Promise.all(
    buckets
      .filter((b) => b.roles.length)
      .map(
        (b) =>
          new Promise((done, fail) => {
            const child = fork(process.argv[1], [mapsDir, out], {
              env: { ...process.env, WALLS_PACK_ROLES: b.roles.join(",") },
            });
            child.on("exit", (code) =>
              code === 0 ? done() : fail(new Error(`pack child ${code}`)),
            );
          }),
      ),
  );
  const textures = [];
  for (const m of maps.maps)
    textures.push(JSON.parse(await readFile(join(out, "receipts", `${m.role}.json`), "utf8")));
  const receipt = {
    stage: "pack",
    mapsSha256: hash(await readFile(join(mapsDir, "maps.json"))),
    encoders: { ktx: KTX_ENCODER_PIN, bc7Transcoder: await bc7TranscoderIdentity() },
    uastcLevel: UASTC_LEVEL,
    materials: maps.materials,
    textures,
    totals: {
      ktx2Bytes: textures.reduce((s, t) => s + t.ktx2.bytes, 0),
      gpuBytes: textures.reduce((s, t) => s + t.gpuBytes, 0),
    },
    wallSeconds: Math.round((performance.now() - started) / 1000),
  };
  await writeFile(join(out, "pack.json"), `${JSON.stringify(receipt, null, 1)}\n`, { flag: "wx" });
  console.log("PACK_DONE", textures.length, "maps", receipt.totals);
  process.exit(0);
}

// Child: encode the assigned maps.
const k = await loadPinnedKtxEncoder();
const roles = new Set(process.env.WALLS_PACK_ROLES.split(","));

function decodeBc1(blocks, width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  const bw = Math.ceil(width / 4);
  const c565 = (v) => [
    (((v >> 11) & 31) * 255) / 31,
    (((v >> 5) & 63) * 255) / 63,
    ((v & 31) * 255) / 31,
  ];
  for (let by = 0; by < Math.ceil(height / 4); by++)
    for (let bx = 0; bx < bw; bx++) {
      const o = (by * bw + bx) * 8;
      const a = blocks.readUInt16LE(o);
      const b = blocks.readUInt16LE(o + 2);
      const ca = c565(a);
      const cb = c565(b);
      const pal =
        a > b
          ? [ca, cb, ca.map((v, i) => (2 * v + cb[i]) / 3), ca.map((v, i) => (v + 2 * cb[i]) / 3)]
          : [ca, cb, ca.map((v, i) => (v + cb[i]) / 2), [0, 0, 0]];
      const bits = blocks.readUInt32LE(o + 4);
      for (let p = 0; p < 16; p++) {
        const x = bx * 4 + (p % 4);
        const y = by * 4 + Math.floor(p / 4);
        if (x >= width || y >= height) continue;
        const c = pal[(bits >> (2 * p)) & 3];
        const q = (y * width + x) * 4;
        rgba[q] = Math.round(c[0]);
        rgba[q + 1] = Math.round(c[1]);
        rgba[q + 2] = Math.round(c[2]);
        rgba[q + 3] = 255;
      }
    }
  return rgba;
}

const [reusePack, reuseMaps] = (process.env.WALLS_PACK_REUSE ?? "").split(",");
const previous = reuseMaps
  ? new Map(
      JSON.parse(await readFile(join(reuseMaps, "maps.json"), "utf8")).maps.map((m) => [
        m.role,
        m.levels.map((l) => l.sha256).join(),
      ]),
    )
  : new Map();

for (const map of maps.maps) {
  if (!roles.has(map.role)) continue;
  if (previous.get(map.role) === map.levels.map((l) => l.sha256).join()) {
    const entry = JSON.parse(
      await readFile(join(reusePack, "receipts", `${map.role}.json`), "utf8"),
    );
    await copyFile(join(reusePack, entry.ktx2.path), join(out, entry.ktx2.path));
    for (let level = 0; level < entry.decodedLevels; level++) {
      const f = `${map.role}-${String(level).padStart(2, "0")}.rgba`;
      await copyFile(join(reusePack, "decoded", f), join(out, "decoded", f));
    }
    assert.equal(hash(await readFile(join(out, entry.ktx2.path))), entry.ktx2.sha256);
    await writeFile(
      join(out, "receipts", `${map.role}.json`),
      `${JSON.stringify({ ...entry, reusedFrom: reusePack }, null, 1)}\n`,
    );
    console.log(map.role, "reused");
    continue;
  }
  const started = performance.now();
  const bc1 = map.slot === "basecolor";
  const { width, height } = map.levels[0];
  const info = new k.textureCreateInfo();
  info.vkFormat = map.srgb ? k.VkFormat.R8G8B8A8_SRGB : k.VkFormat.R8G8B8A8_UNORM;
  Object.assign(info, {
    baseWidth: width,
    baseHeight: height,
    baseDepth: 1,
    numDimensions: 2,
    numLevels: map.levels.length,
    numLayers: 1,
    numFaces: 1,
    isArray: false,
    generateMipmaps: false,
  });
  const texture = new k.texture(info, k.TextureCreateStorageEnum.ALLOC_STORAGE);
  const levels = [];
  for (const [level, image] of map.levels.entries()) {
    const rgba = await readFile(join(mapsDir, image.file));
    assert.equal(hash(rgba), image.sha256);
    assert.equal(rgba.length, image.width * image.height * 4);
    assert.equal(image.width, Math.max(1, width >> level));
    assert.equal(image.height, Math.max(1, height >> level));
    levels.push(rgba);
    texture.setImageFromMemory(level, 0, 0, rgba);
  }
  const basis = new k.basisParams();
  Object.assign(basis, {
    uastc: true,
    threadCount: 1,
    noSSE: true,
    uastcRDO: false,
    uastcRDONoMultithreading: true,
  });
  // The binding silently ignores a numeric uastcFlags; only the enum object sets the level.
  basis.uastcFlags = k.pack_uastc_flag_bits[UASTC_LEVEL];
  assert.equal(basis.uastcFlags, k.pack_uastc_flag_bits[UASTC_LEVEL].value, "UASTC level unset");
  assert.equal(texture.compressBasis(basis), k.ErrorCode.SUCCESS);
  const uastc = Buffer.from(texture.writeToMemory());
  let bytes;
  if (bc1) {
    assert.equal(texture.transcodeBasis(k.TranscodeTarget.BC1_RGB, 0), k.ErrorCode.SUCCESS);
    bytes = Buffer.from(texture.writeToMemory());
  } else bytes = (await preencodeUastcAsBc7(k, uastc, map.srgb)).ktx2;
  texture.delete();
  basis.delete();
  info.delete();
  await writeFile(join(out, "runtime", `${map.role}.ktx2`), bytes, { flag: "wx" });
  // Decoded RGBA8 of what ships, for the fresh import and error figures.
  const decoded = new k.texture(bytes);
  let err = 0;
  let maxErr = 0;
  let decodedLevels = 0;
  if (bc1)
    for (let level = 0; level < levels.length; level++) {
      const rgba = decodeBc1(
        Buffer.from(decoded.getImage(level, 0, 0)),
        Math.max(1, width >> level),
        Math.max(1, height >> level),
      );
      await writeFile(
        join(out, "decoded", `${map.role}-${String(level).padStart(2, "0")}.rgba`),
        rgba,
        {
          flag: "wx",
        },
      );
      decodedLevels++;
      if (level === 0)
        for (let i = 0; i < rgba.length; i++)
          if (i % 4 !== 3) {
            const d = Math.abs(rgba[i] - levels[0][i]);
            err += d;
            maxErr = Math.max(maxErr, d);
          }
    }
  decoded.delete();
  if (!bc1) {
    // BC7 levels through the same Babylon transcoder: its UASTC->RGBA path gives the decoded pixels.
    const u = new k.texture(uastc);
    assert.equal(u.transcodeBasis(k.TranscodeTarget.RGBA32, 0), k.ErrorCode.SUCCESS);
    for (let level = 0; level < levels.length; level++) {
      const rgba = Buffer.from(u.getImage(level, 0, 0));
      await writeFile(
        join(out, "decoded", `${map.role}-${String(level).padStart(2, "0")}.rgba`),
        rgba,
        {
          flag: "wx",
        },
      );
      decodedLevels++;
      if (level === 0)
        for (let i = 0; i < rgba.length; i++)
          if (i % 4 !== 3) {
            const d = Math.abs(rgba[i] - levels[0][i]);
            err += d;
            maxErr = Math.max(maxErr, d);
          }
    }
    u.delete();
  }
  const gpuBytes = levels.reduce(
    (s, _, level) =>
      s +
      Math.ceil(Math.max(1, width >> level) / 4) *
        Math.ceil(Math.max(1, height >> level) / 4) *
        (bc1 ? 8 : 16),
    0,
  );
  const entry = {
    role: map.role,
    material: map.material,
    slot: map.slot,
    srgb: map.srgb,
    width,
    height,
    levels: levels.length,
    decodedLevels,
    format: bc1 ? "bc1" : "bc7",
    ktx2: { path: `runtime/${map.role}.ktx2`, bytes: bytes.length, sha256: hash(bytes) },
    gpuBytes,
    level0MeanAbsError: err / (width * height * 3),
    level0MaxAbsError: maxErr,
    encodeMs: Math.round(performance.now() - started),
    note: map.note,
    ...(map.ormHeightRangeMetres ? { ormHeightRangeMetres: map.ormHeightRangeMetres } : {}),
  };
  await writeFile(
    join(out, "receipts", `${map.role}.json`),
    `${JSON.stringify(entry, null, 1)}\n`,
    {
      flag: "wx",
    },
  );
  console.log(
    map.role,
    width,
    height,
    entry.format,
    bytes.length,
    entry.level0MeanAbsError.toFixed(3),
    `${entry.encodeMs} ms`,
  );
}
