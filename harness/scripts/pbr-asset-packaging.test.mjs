import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { bc7TranscoderIdentity } from "../../engine/scripts/preencode-bc7.mjs";
import {
  BC7_MIP_CHAIN_FIXTURE,
  RAW_RGBA8_MIP_CHAIN_FIXTURES,
} from "../../engine/src/streaming/production-compressed-fixtures.generated.ts";
import { loadPbrAssetLibrary, resolvePbrAssetsForCell } from "./pbr-asset-packaging.mjs";

it("warns, without failing, when pre-encoded BC7 lags the pinned Babylon transcoder", async () => {
  const root = await mkdtemp(join(tmpdir(), "parallax-packaging-bc7-"));
  try {
    await mkdir(join(root, "assets/library/objects"), { recursive: true });
    const bytes = Buffer.from(BC7_MIP_CHAIN_FIXTURE.ktx2, "base64");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const file = `${sha256}.ktx2`;
    await writeFile(join(root, "assets/library/objects", file), bytes);
    const current = await bc7TranscoderIdentity();
    const load = async (bc7Transcoder) => {
      await writeFile(
        join(root, "assets/library/d1-paving.json"),
        JSON.stringify({
          schemaVersion: 1,
          mode: "periodic-surface-module",
          status: "QA-admitted-runtime-visual-acceptance-pending",
          encoders: { bc7Transcoder },
          parts: {},
          textures: {
            normal: {
              encoding: "bc7",
              colorSpace: "linear",
              width: BC7_MIP_CHAIN_FIXTURE.width,
              height: BC7_MIP_CHAIN_FIXTURE.height,
              mipLevels: BC7_MIP_CHAIN_FIXTURE.mipLevelCount,
            },
          },
          resources: [
            { role: "normal", file, path: `objects/${file}`, bytes: bytes.length, sha256 },
          ],
        }),
      );
      return loadPbrAssetLibrary(
        root,
        vi.fn(async (_bytes, _name, _extension, descriptor) => descriptor),
      );
    };
    await expect(load(current)).resolves.toMatchObject({
      resources: [
        { decode: { format: "bc7", mipLevelCount: BC7_MIP_CHAIN_FIXTURE.mipLevelCount } },
      ],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(warn).not.toHaveBeenCalled();
      await expect(load({ ...current, version: "0.0.0" })).resolves.toBeDefined();
      expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/0\.0\.0.*Repack/));
      await expect(load(undefined)).resolves.toBeDefined();
      expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/unrecorded/));
    } finally {
      warn.mockRestore();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("accepts only a human visual acceptance bound to the admitted candidate", async () => {
  const root = await mkdtemp(join(tmpdir(), "parallax-packaging-acceptance-"));
  try {
    await mkdir(join(root, "assets/library"), { recursive: true });
    const base = {
      schemaVersion: 1,
      mode: "periodic-surface-module",
      candidateSha256: "a".repeat(64),
      parts: {},
      textures: {},
      resources: [],
    };
    const acceptance = {
      candidateSha256: "a".repeat(64),
      acceptedAt: "2026-09-24",
      acceptedBy: "human",
      evidence: "installed captures",
    };
    const load = async (manifest) => {
      await writeFile(join(root, "assets/library/d1-paving.json"), JSON.stringify(manifest));
      return loadPbrAssetLibrary(root, vi.fn());
    };
    await expect(
      load({
        ...base,
        status: "QA-admitted-runtime-visual-accepted",
        runtimeVisualAcceptance: acceptance,
      }),
    ).resolves.toMatchObject({ resources: [] });
    await expect(
      load({
        ...base,
        status: "QA-admitted-runtime-visual-accepted",
        runtimeVisualAcceptance: { ...acceptance, candidateSha256: "b".repeat(64) },
      }),
    ).rejects.toThrow(/Acceptance candidate/);
    await expect(load({ ...base, status: "QA-admitted-runtime-visual-accepted" })).rejects.toThrow(
      /Acceptance candidate/,
    );
    await expect(
      load({
        ...base,
        status: "QA-admitted-runtime-visual-acceptance-pending",
        runtimeVisualAcceptance: acceptance,
      }),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("packages QA-admitted zstd RGBA8 maps as lossless GPU textures", async () => {
  const root = await mkdtemp(join(tmpdir(), "parallax-packaging-test-"));
  try {
    const library = join(root, "assets/library");
    await mkdir(join(library, "objects"), { recursive: true });
    const fixture = RAW_RGBA8_MIP_CHAIN_FIXTURES[1];
    const bytes = Buffer.from(fixture.ktx2, "base64");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const file = `${sha256}.ktx2`;
    await writeFile(join(library, "objects", file), bytes);
    const manifest = {
      schemaVersion: 1,
      mode: "periodic-surface-module",
      status: "QA-admitted-runtime-visual-acceptance-pending",
      parts: {},
      textures: {
        normal: {
          encoding: "rgba8-zstd",
          colorSpace: "linear",
          width: fixture.width,
          height: fixture.height,
          mipLevels: fixture.mipLevelCount,
        },
      },
      resources: [{ role: "normal", file, path: `objects/${file}`, bytes: bytes.length, sha256 }],
    };
    await writeFile(join(library, "d1-paving.json"), JSON.stringify(manifest));
    const writeResource = vi.fn(async (_bytes, _name, _extension, descriptor) => descriptor);
    const result = await loadPbrAssetLibrary(root, writeResource);
    expect(result.resources).toMatchObject([
      {
        decode: {
          format: "rgba8",
          colorSpace: "linear",
          width: 8,
          height: 4,
          mipLevelCount: 4,
          version: 2,
        },
      },
    ]);
    expect(writeResource).toHaveBeenCalledOnce();
    manifest.textures.normal.encoding = "unknown";
    await writeFile(join(library, "d1-paving.json"), JSON.stringify(manifest));
    await expect(loadPbrAssetLibrary(root, writeResource)).rejects.toThrow(/Unknown encoding/);
    expect(writeResource).toHaveBeenCalledOnce();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const cell = {
  bounds: { minimum: [0, 0, 0], maximum: [16, 40, 16] },
  collision: {
    heightfield: {
      origin: [0, 0, 0],
      sampleSpacingMeters: 16,
      columns: 2,
      rows: 2,
      heights: [10, 12, 12, 14],
    },
  },
};
const bounds = [
  [-2, -0.02, -2],
  [2, 0.02, 2],
];
const lods = (part) =>
  [0, 1, 2].map((lod) => ({
    vertexRole: `${part}-lod${lod}-vertices`,
    indexRole: `${part}-lod${lod}-indices`,
    bounds,
  }));
const material = (baseColor, normal, orm, textureAddressMode) => ({
  baseColor,
  normal,
  orm,
  textureAddressMode,
  baseColorFactor: [1, 1, 1],
  roughnessFactor: 1,
  metallicFactor: 0,
  normalScale: 1,
});
const library = {
  manifest: {
    assetId: "module",
    parts: {
      ground: { material: "ground", lods: lods("ground") },
      pebbles: { material: "pebbles", lods: lods("pebbles") },
      plants: { material: "plants", lods: lods("plants") },
    },
    materials: {
      ground: material("ground-basecolor", "ground-normal", "ground-orm", "repeat"),
      pebbles: material("ground-basecolor", "pebble-normal", "pebble-orm", "repeat"),
      plants: material("plant-basecolor", "plant-normal", "plant-orm", "clamp-to-edge"),
    },
  },
  byRole: { get: (role) => role },
};
const tile = (x, z, variantId) => ({
  id: `tile-${x}-${z}-${variantId}`,
  assetId: "module",
  variantId,
  center: [x, z],
  heightAnchor: [8, 8],
  heightOffset: 0.021,
  rotationYRadians: 0,
  lodDistancesMeters: [12, 32],
});

describe("periodic surface module packaging", () => {
  it("places every part of adjoining tiles on one anchored plane with shared resources", () => {
    const requests = [2, 6, 10, 14].flatMap((x) =>
      [2, 6].flatMap((z) => ["ground", "pebbles", "plants"].map((part) => tile(x, z, part))),
    );
    const result = resolvePbrAssetsForCell(cell, requests, library);
    expect(result.cell.pbrAssets).toHaveLength(24);
    expect(new Set(result.cell.pbrAssets.map((p) => p.position[1]))).toEqual(new Set([12.021]));
    const byPart = (part) => result.cell.pbrAssets.find((p) => p.id.endsWith(part));
    expect(byPart("ground").material).toMatchObject({
      baseColorResourceId: "ground-basecolor",
      textureAddressMode: "repeat",
    });
    expect(byPart("pebbles").material.baseColorResourceId).toBe("ground-basecolor");
    expect(byPart("plants").material.textureAddressMode).toBe("clamp-to-edge");
    // Normal + ORM per material (pebbles share the ground base colour) and nine index streams per part.
    expect(result.dependencies).toHaveLength(6 + 9);
  });

  it("rejects tiles crossing cell ownership, cross-cell anchors and unknown parts", () => {
    expect(() => resolvePbrAssetsForCell(cell, [tile(1, 8, "ground")], library)).toThrow(
      /ownership boundary/,
    );
    expect(() =>
      resolvePbrAssetsForCell(cell, [{ ...tile(8, 8, "ground"), heightAnchor: [17, 8] }], library),
    ).toThrow(/height anchor/);
    expect(() => resolvePbrAssetsForCell(cell, [tile(8, 8, "stones")], library)).toThrow(
      /Unknown module part/,
    );
    expect(resolvePbrAssetsForCell(cell, [tile(20, 8, "ground")], library).cell.pbrAssets).toBe(
      undefined,
    );
  });
  it("carries the ORM height range and the CSM caster flag (engine package 6)", () => {
    const heightLibrary = {
      ...library,
      manifest: {
        ...library.manifest,
        tileMetres: 4,
        materials: {
          ...library.manifest.materials,
          ground: { ...library.manifest.materials.ground, ormHeightRangeMetres: [-0.02, 0.012] },
        },
      },
    };
    const [ground, pebbles, plants] = resolvePbrAssetsForCell(
      cell,
      [
        { ...tile(6, 6, "ground"), castsCsmShadows: false },
        { ...tile(6, 6, "pebbles"), castsCsmShadows: false },
        tile(6, 6, "plants"),
      ],
      heightLibrary,
    ).cell.pbrAssets;
    expect(ground.material.ormHeight).toEqual({ rangeMeters: [-0.02, 0.012], tileMeters: 4 });
    expect(ground.castsCsmShadows).toBe(false);
    expect("ormHeight" in pebbles.material).toBe(false);
    expect(pebbles.castsCsmShadows).toBe(false);
    expect("castsCsmShadows" in plants).toBe(false);
  });
});

describe("terrain-conforming placements (D-204)", () => {
  // A 0.5 m detail field over [0, 12]² of the cell, rising 0.25 m toward its interior.
  const size = 25;
  const detailHeights = Array.from({ length: size * size }, (_, index) => {
    const x = (index % size) * 0.5;
    const z = Math.floor(index / size) * 0.5;
    return 10 + (x / 16) * 2 + (z / 16) * 2 + 0.25 * Math.sin((Math.PI * x) / 12);
  });
  const rolling = {
    ...cell,
    collision: {
      ...cell.collision,
      detail: {
        kind: "heightfield",
        origin: [0, 0, 0],
        sampleSpacingMeters: 0.5,
        columns: size,
        rows: size,
        heights: detailHeights,
      },
    },
  };
  const conforming = (x, z) => ({
    ...tile(x, z, "ground"),
    heightAnchor: [6, 6],
    conformToTerrain: true,
  });

  it("rests on the walkable ground at the anchor and records it as the drape reference", () => {
    const result = resolvePbrAssetsForCell(rolling, [conforming(2, 2), conforming(6, 6)], library);
    const reference = detailHeights[12 * size + 12];
    for (const placement of result.cell.pbrAssets) {
      expect(placement.terrainDrape).toEqual({ referenceHeightMeters: reference });
      expect(placement.position[1]).toBeCloseTo(reference + 0.021, 12);
    }
    // Rigid placements keep the anchored coarse plane and carry no drape.
    const rigid = resolvePbrAssetsForCell(rolling, [tile(6, 6, "ground")], library).cell
      .pbrAssets[0];
    expect(rigid.terrainDrape).toBeUndefined();
    expect(rigid.position[1]).toBeCloseTo(12.021, 12);
  });

  it("rejects a conforming module without a detail field or reaching past it", () => {
    expect(() => resolvePbrAssetsForCell(cell, [conforming(6, 6)], library)).toThrow(
      /terrain detail field at its anchor/,
    );
    expect(() => resolvePbrAssetsForCell(rolling, [conforming(11, 6)], library)).toThrow(
      /outside its cell's terrain detail field/,
    );
  });
});
