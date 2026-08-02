import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  BENCHMARK_BUILD_MANIFEST_SCHEMA_VERSION,
  canonicalStreamingCellArtifactIdentity,
  canonicalStreamingDistrictIndexResourceId,
  parseStreamingCellArtifactSource,
  STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
} from "@parallax/engine";
import { afterEach, describe, expect, it } from "vitest";
import { BUILD_MANIFEST_SCHEMA_VERSION, readAndValidateBuildManifest } from "./build-manifest.js";
import { resolveExpectedPsoWarmupTraceIdentity } from "./pso-warmup-trace.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function writeFixture(
  districtIndexSchemaVersion = STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
  districtId = "test-district",
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "parallax-manifest-"));
  cleanup.push(root);
  const index = "<!doctype html><title>Parallax</title>";
  const serviceWorker = "export const serviceWorker = true;";
  const workerBodies = new Map([
    ["decode", "export const worker = 'decode';"],
    ["installer", "export const worker = 'installer';"],
    ["render", "export const worker = 'render';"],
    ["streaming", "export const worker = 'streaming';"],
    ["wasm-thread", "export const worker = 'wasm-thread';"],
  ]);
  const moduleBodies = new Map([
    ["app", "export const app = true;"],
    ["engine", "export const engine = true;"],
    ["game", "export const game = true;"],
  ]);
  const wasmBody = Buffer.from("synthetic threaded Wasm fixture");
  const district = fixtureDistrictArtifacts(districtId, districtIndexSchemaVersion);
  const psoIdentity = resolveExpectedPsoWarmupTraceIdentity();
  const psoBody = `${JSON.stringify(
    {
      buildCompatibilityDigest: psoIdentity.buildCompatibilityDigest,
      entries: [psoIdentity.entry],
      renderer: psoIdentity.renderer,
      schemaVersion: psoIdentity.schemaVersion,
    },
    null,
    2,
  )}\n`;
  const psoPath = `immutable/pso-warmup-trace-${psoIdentity.sha256}.json`;
  const workerPaths = new Map(
    [...workerBodies].map(([role, body]) => {
      const digest = createHash("sha256").update(body).digest("hex");
      return [role, `immutable/${role}-worker-${digest}.js`];
    }),
  );
  const modulePaths = new Map(
    [...moduleBodies].map(([role, body]) => {
      const digest = createHash("sha256").update(body).digest("hex");
      return [role, `immutable/${role}-${digest}.js`];
    }),
  );
  const wasmDigest = createHash("sha256").update(wasmBody).digest("hex");
  const wasmPath = `immutable/wasm-thread-spike-${wasmDigest}.wasm`;
  await mkdir(join(root, "immutable"));
  await writeFile(join(root, "index.html"), index);
  await writeFile(join(root, "service-worker.js"), serviceWorker);
  for (const [role, body] of workerBodies) {
    await writeFile(join(root, workerPaths.get(role) ?? "missing-worker"), body);
  }
  for (const [role, body] of moduleBodies) {
    await writeFile(join(root, modulePaths.get(role) ?? "missing-module"), body);
  }
  await writeFile(join(root, wasmPath), wasmBody);
  await writeFile(join(root, district.cellPath), district.cellBody);
  await writeFile(join(root, district.indexPath), district.indexBody);
  await writeFile(join(root, psoPath), psoBody);
  const baseArtifacts = [
    {
      bytes: Buffer.byteLength(psoBody),
      path: psoPath,
      sha256: psoIdentity.sha256,
    },
    {
      bytes: Buffer.byteLength(district.cellBody),
      path: district.cellPath,
      sha256: district.cellDigest,
    },
    {
      bytes: Buffer.byteLength(district.indexBody),
      path: district.indexPath,
      sha256: district.indexDigest,
    },
    ...[...workerBodies].map(([role, body]) => ({
      bytes: Buffer.byteLength(body),
      path: workerPaths.get(role) ?? "missing-worker",
      sha256: createHash("sha256").update(body).digest("hex"),
    })),
    ...[...moduleBodies].map(([role, body]) => ({
      bytes: Buffer.byteLength(body),
      path: modulePaths.get(role) ?? "missing-module",
      sha256: createHash("sha256").update(body).digest("hex"),
    })),
    {
      bytes: wasmBody.byteLength,
      path: wasmPath,
      sha256: wasmDigest,
    },
    {
      bytes: Buffer.byteLength(index),
      path: "index.html",
      sha256: createHash("sha256").update(index).digest("hex"),
    },
    {
      bytes: Buffer.byteLength(serviceWorker),
      path: "service-worker.js",
      sha256: createHash("sha256").update(serviceWorker).digest("hex"),
    },
  ];
  const installArtifact = await writeFixtureInstallManifest(root, baseArtifacts, {
    districtId,
    districtPath: district.indexPath,
    workerPaths,
  });
  await writeFile(
    join(root, "build-manifest.json"),
    JSON.stringify({
      artifacts: [...baseArtifacts, installArtifact],
      gameContentEntrypoints: [
        {
          districtId,
          path: district.indexPath,
          schemaVersion: STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
          scope: "game-specific",
          targetType: "district",
        },
      ],
      installManifestEntrypoint: { path: "install-manifest.json", schemaVersion: 1 },
      offlineShell: {
        generationSchemaVersion: 1,
        saveSchemaVersion: 1,
        serviceWorkerPath: "service-worker.js",
      },
      schemaVersion: 15,
      workerEntrypoints: [
        { path: workerPaths.get("decode"), role: "decode", targetType: "worker" },
        { path: workerPaths.get("installer"), role: "installer", targetType: "worker" },
        { path: workerPaths.get("render"), role: "render", targetType: "worker" },
        { path: workerPaths.get("streaming"), role: "streaming", targetType: "worker" },
        { path: workerPaths.get("wasm-thread"), role: "wasm-thread", targetType: "worker" },
      ],
    }),
  );
  return root;
}

async function writeFixtureInstallManifest(
  root: string,
  artifacts: readonly { bytes: number; path: string; sha256: string }[],
  context: {
    readonly districtId: string;
    readonly districtPath: string;
    readonly workerPaths: ReadonlyMap<string, string>;
  },
): Promise<{ bytes: number; path: string; sha256: string }> {
  const resources = artifacts.map((artifact) => {
    if (artifact.path === "index.html") {
      return {
        ...artifact,
        id: "app-shell-document-index",
        kind: "document",
        scope: "app-shell",
        source: artifact.path,
        target: "shell",
      };
    }
    if (artifact.path === "service-worker.js") {
      return {
        ...artifact,
        id: "common-worker-service",
        kind: "worker",
        scope: "common",
        source: artifact.path,
        target: "shell",
      };
    }
    const module = artifact.path.match(/^immutable\/(app|engine|game)-[a-f0-9]{64}\.js$/u);
    if (module?.[1] !== undefined) {
      const role = module[1];
      return {
        ...artifact,
        id:
          role === "app"
            ? "app-shell-module-app"
            : role === "engine"
              ? "common-module-engine"
              : "game-specific-module-game",
        kind: "module",
        scope: role === "app" ? "app-shell" : role === "engine" ? "common" : "game-specific",
        source: artifact.path,
        target: "shell",
      };
    }
    const wasm = artifact.path.match(/^immutable\/([a-z0-9-]+)-[a-f0-9]{64}\.wasm$/u);
    if (wasm?.[1] !== undefined) {
      return {
        ...artifact,
        id: `common-wasm-${wasm[1]}`,
        kind: "wasm",
        scope: "common",
        source: artifact.path,
        target: "shell",
      };
    }
    if (artifact.path === context.districtPath) {
      return {
        ...artifact,
        id: canonicalStreamingDistrictIndexResourceId(context.districtId),
        kind: "district-index",
        scope: "game-specific",
        source: artifact.path,
        target: "opfs",
      };
    }
    if (/^immutable\/pso-warmup-trace-[a-f0-9]{64}\.json$/.test(artifact.path)) {
      return {
        ...artifact,
        id: "game-specific-pso-warmup-trace",
        kind: "asset-pack",
        scope: "game-specific",
        source: artifact.path,
        target: "opfs",
      };
    }
    if (/^immutable\/[a-z0-9-]+-cell-/.test(artifact.path)) {
      const identity = parseStreamingCellArtifactSource(artifact.path);
      return {
        ...artifact,
        id: identity.resourceId,
        kind: "world-cell",
        scope: "game-specific",
        source: artifact.path,
        target: "opfs",
      };
    }
    const role = [...context.workerPaths].find(([, path]) => path === artifact.path)?.[0];
    if (role === undefined) throw new Error(`Unknown fixture artifact ${artifact.path}`);
    return {
      ...artifact,
      id: `common-worker-${role}`,
      kind: "worker",
      scope: "common",
      source: artifact.path,
      target: "shell",
    };
  });
  for (const artifact of APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS) {
    resources.push({
      bytes: artifact.bytes,
      id: `common-model-${artifact.path.toLowerCase()}`,
      kind: "model",
      path: artifact.path,
      scope: "common",
      sha256: artifact.sha256,
      source: `immutable/model-${artifact.sha256}.gguf`,
      target: "opfs",
    });
  }
  const bytes = Buffer.from(
    `${JSON.stringify({
      gameId: "parallax",
      resources: resources
        .map(({ path: _path, ...resource }) => resource)
        .sort((left, right) => left.id.localeCompare(right.id)),
      schemaVersion: 1,
    })}\n`,
  );
  await writeFile(join(root, "install-manifest.json"), bytes);
  return {
    bytes: bytes.byteLength,
    path: "install-manifest.json",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function addFixtureInstallResource(
  root: string,
  artifacts: Array<{ bytes: number; path: string; sha256: string }>,
  resource: Record<string, unknown>,
): Promise<void> {
  const installPath = join(root, "install-manifest.json");
  const install = JSON.parse(await readFile(installPath, "utf8")) as {
    resources: Record<string, unknown>[];
  };
  install.resources.push(resource);
  install.resources.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const bytes = Buffer.from(`${JSON.stringify(install)}\n`);
  await writeFile(installPath, bytes);
  const artifact = artifacts.find((candidate) => candidate.path === "install-manifest.json");
  if (artifact === undefined) throw new Error("Fixture omitted install-manifest artifact");
  artifact.bytes = bytes.byteLength;
  artifact.sha256 = createHash("sha256").update(bytes).digest("hex");
}

async function forgeContentAddressedFixturePath(
  root: string,
  category:
    | "app"
    | "decode"
    | "engine"
    | "game"
    | "installer"
    | "render"
    | "streaming"
    | "wasm"
    | "wasm-thread",
): Promise<void> {
  const manifestPath = join(root, "build-manifest.json");
  const installPath = join(root, "install-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    artifacts: Array<{ bytes: number; path: string; sha256: string }>;
    workerEntrypoints: Array<{ path: string; role: string; targetType: string }>;
  };
  const workerPath = manifest.workerEntrypoints.find(({ role }) => role === category)?.path;
  const artifact = manifest.artifacts.find(({ path }) =>
    workerPath !== undefined
      ? path === workerPath
      : category === "wasm"
        ? path.endsWith(".wasm")
        : path.startsWith(`immutable/${category}-`) && path.endsWith(".js"),
  );
  if (artifact === undefined) throw new Error(`Fixture omitted ${category} artifact`);
  const forgedDigest = artifact.sha256 === "f".repeat(64) ? "0".repeat(64) : "f".repeat(64);
  const forgedPath = artifact.path.replace(/[a-f0-9]{64}(?=\.(?:js|wasm)$)/u, forgedDigest);
  const originalPath = artifact.path;
  artifact.path = forgedPath;
  for (const worker of manifest.workerEntrypoints) {
    if (worker.path === originalPath) worker.path = forgedPath;
  }
  const install = JSON.parse(await readFile(installPath, "utf8")) as {
    resources: Array<{ source: string }>;
  };
  const resource = install.resources.find(({ source }) => source === originalPath);
  if (resource === undefined) throw new Error(`Fixture omitted ${category} install resource`);
  resource.source = forgedPath;
  await rename(join(root, originalPath), join(root, forgedPath));
  const installBytes = Buffer.from(`${JSON.stringify(install)}\n`);
  await writeFile(installPath, installBytes);
  const installArtifact = manifest.artifacts.find(({ path }) => path === "install-manifest.json");
  if (installArtifact === undefined) throw new Error("Fixture omitted install-manifest artifact");
  installArtifact.bytes = installBytes.byteLength;
  installArtifact.sha256 = createHash("sha256").update(installBytes).digest("hex");
  await writeFile(manifestPath, JSON.stringify(manifest));
}

function fixtureDistrictArtifacts(
  districtId: string,
  schemaVersion = STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
) {
  const textureSha256 = "1".repeat(64);
  const vertexSha256 = "2".repeat(64);
  const indexSha256 = "3".repeat(64);
  const resources = [
    {
      bytes: 1,
      decode: { colorSpace: "srgb", format: "rgba8", height: 1, version: 1, width: 1 },
      dependencies: [],
      format: "ktx2",
      path: `immutable/streaming-texture-${textureSha256}.ktx2`,
      resourceId: "a-texture",
      sha256: textureSha256,
    },
    {
      bytes: 1,
      decode: {
        count: 3,
        layout: "position-normal-uv-f32",
        mode: "ATTRIBUTES",
        stride: 32,
        version: 1,
      },
      dependencies: ["a-texture"],
      format: "meshopt",
      path: `immutable/streaming-vertices-${vertexSha256}.meshopt`,
      resourceId: "b-vertices",
      sha256: vertexSha256,
    },
    {
      bytes: 1,
      decode: {
        count: 3,
        indexFormat: "uint32",
        mode: "TRIANGLES",
        stride: 4,
        version: 1,
        vertexCount: 3,
      },
      dependencies: ["a-texture", "b-vertices"],
      format: "meshopt",
      path: `immutable/streaming-indices-${indexSha256}.meshopt`,
      resourceId: "c-indices",
      sha256: indexSha256,
    },
  ];
  const cellBody = `${JSON.stringify({ districtId, schemaVersion: 1 })}\n`;
  const cellDigest = createHash("sha256").update(cellBody).digest("hex");
  const cellIdentity = canonicalStreamingCellArtifactIdentity(districtId, [0, 0], cellDigest);
  const cellPath = cellIdentity.source;
  const indexBody = `${JSON.stringify({
    bounds: { maximum: [256, 100, 256], minimum: [0, -10, 0] },
    cellSizeMeters: 256,
    cells: [
      {
        bytes: Buffer.byteLength(cellBody),
        cellId: cellIdentity.cellId,
        coordinate: [0, 0],
        ...(schemaVersion === STREAMING_DISTRICT_INDEX_SCHEMA_VERSION
          ? { dependencies: ["c-indices"] }
          : {}),
        path: cellPath,
        sha256: cellDigest,
      },
    ],
    districtId,
    materials: [{ color: [0.1, 0.2, 0.3], id: "ground" }],
    ...(schemaVersion === STREAMING_DISTRICT_INDEX_SCHEMA_VERSION ? { resources } : {}),
    schemaVersion,
  })}\n`;
  const indexDigest = createHash("sha256").update(indexBody).digest("hex");
  return Object.freeze({
    cellBody,
    cellDigest,
    cellPath,
    indexBody,
    indexDigest,
    indexPath: `immutable/${cellIdentity.artifactScope}-index-${indexDigest}.json`,
  });
}

describe("build manifest validation", () => {
  it("keeps the in-game benchmark consumer pinned to the current manifest contract", () => {
    expect(BENCHMARK_BUILD_MANIFEST_SCHEMA_VERSION).toBe(BUILD_MANIFEST_SCHEMA_VERSION);
  });

  it("accepts a served tree whose files are all listed in the manifest", async () => {
    const root = await writeFixture();
    const validated = await readAndValidateBuildManifest(root);
    expect(validated.manifest.artifacts).toHaveLength(15);
    expect(validated.artifactDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    "app",
    "decode",
    "engine",
    "game",
    "installer",
    "render",
    "streaming",
    "wasm",
    "wasm-thread",
  ] as const)("rejects an internally rebound %s shell path whose suffix differs from its artifact digest", async (category) => {
    const root = await writeFixture();
    await forgeContentAddressedFixturePath(root, category);
    await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
      /Content-addressed (?:JavaScript|Wasm) path does not bind its artifact SHA-256/u,
    );
  });

  it("uses the shared canonical resource ID for a punctuated district producer and validator", async () => {
    const districtId = " District.One__A ";
    const root = await writeFixture(STREAMING_DISTRICT_INDEX_SCHEMA_VERSION, districtId);
    const validated = await readAndValidateBuildManifest(root);
    expect(canonicalStreamingDistrictIndexResourceId(districtId)).toBe(
      "game-specific-district-index-district-one-a",
    );
    expect(
      validated.installManifest.resources.find((resource) => resource.kind === "district-index"),
    ).toMatchObject({
      id: "game-specific-district-index-district-one-a",
      kind: "district-index",
    });
  });

  it("rejects a semantic world-cell resource ID drift with unchanged bytes and hash", async () => {
    const root = await writeFixture();
    const manifestPath = join(root, "build-manifest.json");
    const installPath = join(root, "install-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      artifacts: Array<{ bytes: number; path: string; sha256: string }>;
    };
    const install = JSON.parse(await readFile(installPath, "utf8")) as {
      resources: Array<Record<string, unknown>>;
    };
    const cell = install.resources.find((resource) => resource.kind === "world-cell");
    if (cell === undefined) throw new Error("Fixture omitted its world-cell resource");
    cell.id = "game-specific-world-cell-test-district-99-99";
    install.resources.sort((left, right) => String(left.id).localeCompare(String(right.id)));
    const bytes = Buffer.from(`${JSON.stringify(install)}\n`);
    await writeFile(installPath, bytes);
    const artifact = manifest.artifacts.find(
      (candidate) => candidate.path === "install-manifest.json",
    );
    if (artifact === undefined) throw new Error("Fixture omitted its install manifest");
    artifact.bytes = bytes.byteLength;
    artifact.sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
      /Local install resource classification mismatch/,
    );
  });

  it("rejects build-manifest key drift and an inexact install-manifest entrypoint", async () => {
    const extraRoot = await writeFixture();
    const extraPath = join(extraRoot, "build-manifest.json");
    const extra = JSON.parse(await readFile(extraPath, "utf8")) as Record<string, unknown>;
    extra.releaseId = "forbidden-self-reference";
    await writeFile(extraPath, JSON.stringify(extra));
    await expect(readAndValidateBuildManifest(extraRoot)).rejects.toThrow(/top-level keys/);

    const entryRoot = await writeFixture();
    const entryPath = join(entryRoot, "build-manifest.json");
    const entry = JSON.parse(await readFile(entryPath, "utf8")) as {
      installManifestEntrypoint: Record<string, unknown>;
    };
    entry.installManifestEntrypoint.extra = true;
    await writeFile(entryPath, JSON.stringify(entry));
    await expect(readAndValidateBuildManifest(entryRoot)).rejects.toThrow(
      /exact install-manifest v1 entrypoint/,
    );
  });

  it("accepts multiple uniquely identified district entrypoints and rejects empty or duplicate sets", async () => {
    const root = await writeFixture();
    const manifestPath = join(root, "build-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      artifacts: Array<{ bytes: number; path: string; sha256: string }>;
      gameContentEntrypoints: Array<{
        districtId: string;
        path: string;
        schemaVersion: number;
        scope: string;
        targetType: string;
      }>;
    };
    const second = fixtureDistrictArtifacts("second-district");
    await writeFile(join(root, second.cellPath), second.cellBody);
    await writeFile(join(root, second.indexPath), second.indexBody);
    manifest.artifacts.push({
      bytes: Buffer.byteLength(second.cellBody),
      path: second.cellPath,
      sha256: second.cellDigest,
    });
    manifest.artifacts.push({
      bytes: Buffer.byteLength(second.indexBody),
      path: second.indexPath,
      sha256: second.indexDigest,
    });
    manifest.gameContentEntrypoints.push({
      districtId: "second-district",
      path: second.indexPath,
      schemaVersion: STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
      scope: "game-specific",
      targetType: "district",
    });
    await addFixtureInstallResource(root, manifest.artifacts, {
      bytes: Buffer.byteLength(second.cellBody),
      id: "game-specific-world-cell-second-district-00-00",
      kind: "world-cell",
      scope: "game-specific",
      sha256: second.cellDigest,
      source: second.cellPath,
      target: "opfs",
    });
    await addFixtureInstallResource(root, manifest.artifacts, {
      bytes: Buffer.byteLength(second.indexBody),
      id: "game-specific-district-index-second-district",
      kind: "district-index",
      scope: "game-specific",
      sha256: second.indexDigest,
      source: second.indexPath,
      target: "opfs",
    });
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(readAndValidateBuildManifest(root)).resolves.toMatchObject({
      manifest: {
        gameContentEntrypoints: [
          { districtId: "test-district" },
          { districtId: "second-district" },
        ],
      },
    });

    const secondEntrypoint = manifest.gameContentEntrypoints[1];
    if (secondEntrypoint === undefined) throw new Error("Fixture omitted its second district");
    manifest.gameContentEntrypoints[1] = {
      ...secondEntrypoint,
      districtId: "test-district",
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
      "unique game-content district IDs and paths",
    );

    const emptyRoot = await writeFixture();
    const emptyManifestPath = join(emptyRoot, "build-manifest.json");
    const emptyManifest = JSON.parse(await readFile(emptyManifestPath, "utf8")) as {
      gameContentEntrypoints: unknown[];
    };
    emptyManifest.gameContentEntrypoints = [];
    await writeFile(emptyManifestPath, JSON.stringify(emptyManifest));
    await expect(readAndValidateBuildManifest(emptyRoot)).rejects.toThrow(
      "at least one game-content district entrypoint",
    );
  });

  it("rejects a served tree containing files the manifest does not list", async () => {
    const root = await writeFixture();
    await writeFile(join(root, "immutable", "stray.js"), "export const stray = true;");
    await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
      "not in the build manifest: immutable/stray.js",
    );
  });

  it("rejects a manifest artifact whose bytes changed on disk", async () => {
    const root = await writeFixture();
    await writeFile(join(root, "index.html"), "<!doctype html><title>Tampered</title>");
    await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
      "does not match its manifest: index.html",
    );
  });

  it("rejects missing or duplicate worker roles in manifest v15", async () => {
    const root = await writeFixture();
    const manifestPath = join(root, "build-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      workerEntrypoints: unknown[];
    };
    manifest.workerEntrypoints = manifest.workerEntrypoints.slice(0, 1);
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
      "requires exactly one distinct decode, installer, render, streaming, and WASM-thread worker",
    );

    const duplicateRoot = await writeFixture();
    const duplicateManifestPath = join(duplicateRoot, "build-manifest.json");
    const duplicateManifest = JSON.parse(await readFile(duplicateManifestPath, "utf8")) as {
      workerEntrypoints: Array<{ path: string; role: string; targetType: string }>;
    };
    const renderEntrypoint = duplicateManifest.workerEntrypoints[0];
    if (renderEntrypoint === undefined) throw new Error("Fixture omitted its render worker");
    duplicateManifest.workerEntrypoints[1] = { ...renderEntrypoint };
    await writeFile(duplicateManifestPath, JSON.stringify(duplicateManifest));

    await expect(readAndValidateBuildManifest(duplicateRoot)).rejects.toThrow(
      "requires exactly one distinct decode, installer, render, streaming, and WASM-thread worker",
    );
  });

  it("rejects distinct path spellings that resolve to the same worker artifact", async () => {
    const root = await writeFixture();
    const manifestPath = join(root, "build-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      artifacts: Array<{ bytes: number; path: string; sha256: string }>;
      workerEntrypoints: Array<{ path: string; role: string; targetType: string }>;
    };
    const renderEntrypoint = manifest.workerEntrypoints.find(
      (entrypoint) => entrypoint.role === "render",
    );
    const renderArtifact = manifest.artifacts.find(
      (artifact) => artifact.path === renderEntrypoint?.path,
    );
    if (renderEntrypoint === undefined || renderArtifact === undefined) {
      throw new Error("Fixture omitted its render worker");
    }
    const aliasedRenderPath = `immutable/../${renderEntrypoint.path}`;
    manifest.artifacts.push({ ...renderArtifact, path: aliasedRenderPath });
    const streamingIndex = manifest.workerEntrypoints.findIndex(
      (entrypoint) => entrypoint.role === "streaming",
    );
    manifest.workerEntrypoints[streamingIndex] = {
      path: aliasedRenderPath,
      role: "streaming",
      targetType: "worker",
    };
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
      "requires exactly one distinct decode, installer, render, streaming, and WASM-thread worker",
    );
  });

  it("rejects malformed game-content entrypoint fields", async () => {
    for (const invalidEntrypoint of [
      {
        districtId: "   ",
        path: "immutable/unused.json",
        schemaVersion: STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
        scope: "game-specific",
        targetType: "district",
      },
      {
        districtId: "test-district",
        path: "",
        schemaVersion: STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
        scope: "game-specific",
        targetType: "district",
      },
      {
        districtId: "test-district",
        path: "immutable/unused.json",
        schemaVersion: 1,
        scope: "game-specific",
        targetType: "district",
      },
      {
        districtId: "test-district",
        path: "immutable/unused.json",
        schemaVersion: STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
        scope: "engine-shared",
        targetType: "district",
      },
      {
        districtId: "test-district",
        path: "immutable/unused.json",
        schemaVersion: STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
        scope: "game-specific",
        targetType: "cell",
      },
    ]) {
      const root = await writeFixture();
      const manifestPath = join(root, "build-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        gameContentEntrypoints: unknown[];
      };
      manifest.gameContentEntrypoints = [invalidEntrypoint];
      await writeFile(manifestPath, JSON.stringify(manifest));
      await expect(readAndValidateBuildManifest(root)).rejects.toThrow(
        "Invalid build-manifest game content entrypoint",
      );
    }
  });

  it("binds the declared district ID to the referenced index", async () => {
    const idRoot = await writeFixture();
    const manifestPath = join(idRoot, "build-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      gameContentEntrypoints: Array<Record<string, unknown>>;
    };
    const entrypoint = manifest.gameContentEntrypoints[0];
    if (entrypoint === undefined) throw new Error("Fixture omitted district entrypoint");
    manifest.gameContentEntrypoints[0] = { ...entrypoint, districtId: "other-district" };
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(readAndValidateBuildManifest(idRoot)).rejects.toThrow(
      "does not match its district index",
    );
  });

  it("rejects a referenced district index outside the runtime schema contract", async () => {
    const schemaRoot = await writeFixture(1);
    await expect(readAndValidateBuildManifest(schemaRoot)).rejects.toThrow(
      "district index violates the runtime contract",
    );
  });
});
