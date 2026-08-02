import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  canonicalStreamingCellArtifactIdentity,
  type InstallManifest,
  parseStreamingDistrictIndex,
  STREAMING_DEPENDENCY_ENCODED_MAX_BYTES,
  STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
  scaleStreamingDependencyResourceId,
} from "@parallax/engine";
import { beforeAll, describe, expect, it } from "vitest";
import type { BuildManifest } from "./build-manifest.js";
import { readAndValidateBuildManifest } from "./build-manifest.js";
import {
  createScaleStreamingManifestModel,
  createScaleStreamingTargetDocuments,
  type GeneratedScaleStreamingCorpus,
  parseGeneratedScaleStreamingCorpus,
  readGeneratedScaleStreamingCorpus,
  SCALE_STREAMING_CELL_COUNT,
  SCALE_STREAMING_CLASS_FLOOR_BYTES,
  SCALE_STREAMING_DEPENDENCY_GRAPH_COUNT,
} from "./scale-streaming-corpus.js";
import {
  deriveScaleStreamingConsumerPopulation,
  materializeScaleStreamingTarget,
  removeMaterializedScaleStreamingTarget,
} from "./scale-streaming-runner-core.js";
import { startHarnessTarget } from "./target.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
let firstRoot = "";
let secondRoot = "";
let firstDocument: Readonly<Record<string, unknown>>;
let secondDocument: Readonly<Record<string, unknown>>;
let corpus: GeneratedScaleStreamingCorpus;

beforeAll(async () => {
  [firstRoot, secondRoot] = await Promise.all([
    mkdtemp(join(tmpdir(), "parallax-scale-streaming-a-")),
    mkdtemp(join(tmpdir(), "parallax-scale-streaming-b-")),
  ]);
  await Promise.all([generate(firstRoot), generate(secondRoot)]);
  firstDocument = JSON.parse(
    await readFile(join(firstRoot, "scale-streaming-corpus.json"), "utf8"),
  ) as Readonly<Record<string, unknown>>;
  secondDocument = JSON.parse(
    await readFile(join(secondRoot, "scale-streaming-corpus.json"), "utf8"),
  ) as Readonly<Record<string, unknown>>;
  corpus = await readGeneratedScaleStreamingCorpus(firstRoot, firstDocument);
}, 30_000);

describe("representative scale-streaming corpus", () => {
  it("serves and revalidates the exact materialized model inventory while rejecting every drift", async () => {
    const productionRoot = join(repositoryRoot, "dist");
    const production = await readAndValidateBuildManifest(productionRoot);
    const productionDistrict = production.manifest.gameContentEntrypoints.find(
      ({ districtId }) => districtId === "district-1-surface",
    );
    if (productionDistrict === undefined) throw new Error("Production D1 entrypoint is absent");
    const materialized = await materializeScaleStreamingTarget({
      corpusDocument: corpus,
      corpusRoot: firstRoot,
      productionRoot,
    });
    try {
      const validatedMaterialized = await readAndValidateBuildManifest(materialized.root, {
        installOnlyFiles: materialized.installOnlyFiles,
      });
      expect(validatedMaterialized).toMatchObject({
        artifactDigest: materialized.artifactDigest,
        releaseDigest: materialized.releaseDigest,
      });
      expect(validatedMaterialized.installSummary.bytesByTarget.shell).toBeGreaterThan(0);
      expect(validatedMaterialized.installSummary.countByTarget.shell).toBeGreaterThan(0);
      expect(materialized.population).toMatchObject({
        installBytes: validatedMaterialized.installSummary.bytesByTarget.opfs,
        installResourceCount: validatedMaterialized.installSummary.countByTarget.opfs,
      });
      expect(materialized.population.installBytes).toBe(2_623_040_066);
      expect(materialized.population.installResourceCount).toBe(284);
      expect(materialized.population.representativeResourceCount).toBe(275);
      const heroIndex = corpus.graphs
        .find(({ id }) => id === "hero")
        ?.resources.find(({ role }) => role === "indices");
      if (heroIndex === undefined) throw new Error("Generated hero index resource is absent");
      expect(Object.isFrozen(materialized.expectedStreamingResourceCacheKeys)).toBe(true);
      expect(Object.keys(materialized.expectedStreamingResourceCacheKeys)).toHaveLength(18);
      expect(materialized.expectedStreamingResourceCacheKeys[heroIndex.resourceId]).toHaveLength(
        542,
      );
      const composedDistrict = materialized.buildManifest.gameContentEntrypoints.find(
        ({ districtId }) => districtId === "district-1-surface",
      );
      if (composedDistrict === undefined) throw new Error("Composed D1 entrypoint is absent");
      const districtIndexResource = validatedMaterialized.installManifest.resources.find(
        ({ kind, source }) => kind === "district-index" && source === composedDistrict.path,
      );
      if (districtIndexResource === undefined) {
        throw new Error("Materialized scale-streaming district index resource is absent");
      }
      const representativeResourceIds = new Set([
        districtIndexResource.id,
        ...validatedMaterialized.installManifest.resources
          .filter(({ kind }) => kind === "world-cell")
          .map(({ id }) => id),
        ...corpus.graphs.flatMap(({ resources }) => resources.map(({ resourceId }) => resourceId)),
      ]);
      const consumers = deriveScaleStreamingConsumerPopulation(
        validatedMaterialized.installManifest.resources,
        representativeResourceIds,
      );
      expect(consumers).toMatchObject({
        modelBytes: APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.reduce(
          (sum, artifact) => sum + artifact.bytes,
          0,
        ),
        modelResourceCount: APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length,
        opfsBytes: materialized.population.installBytes,
        opfsResourceCount: materialized.population.installResourceCount,
        representativeBytes: materialized.population.representativeBytes,
        representativeResourceCount: materialized.population.representativeResourceCount,
      });
      expect(consumers.otherBytes).toBeGreaterThan(0);
      expect(consumers.otherResourceCount).toBeGreaterThan(0);
      expect(consumers.representativeBytes + consumers.modelBytes + consumers.otherBytes).toBe(
        consumers.opfsBytes,
      );
      expect(
        consumers.representativeResourceCount +
          consumers.modelResourceCount +
          consumers.otherResourceCount,
      ).toBe(consumers.opfsResourceCount);
      expect(
        materialized.population.installBytes +
          validatedMaterialized.installSummary.bytesByTarget.shell,
      ).toBe(validatedMaterialized.installSummary.resourceBytes);
      expect(
        materialized.population.installResourceCount +
          validatedMaterialized.installSummary.countByTarget.shell,
      ).toBe(validatedMaterialized.installSummary.resourceCount);
      for (const model of materialized.installOnlyFiles) {
        expect(materialized.exactRangeResources).toContainEqual(model);
      }
      const target = await startHarnessTarget({
        artifactDigest: materialized.artifactDigest,
        buildManifest: materialized.buildManifest,
        buildRoot: materialized.root,
        exactRangeResources: materialized.exactRangeResources,
        installOnlyFiles: materialized.installOnlyFiles,
        request: "local",
      });
      try {
        const response = await fetch(`${target.baseUrl}/${composedDistrict.path}`, {
          cache: "no-store",
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
        expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
        const servedBytes = Buffer.from(await response.arrayBuffer());
        const servedSha256 = createHash("sha256").update(servedBytes).digest("hex");
        expect(composedDistrict.path).toBe(
          `immutable/district-1-surface-index-${servedSha256}.json`,
        );
        for (const [extension, contentType] of [
          [".ktx2", "image/ktx2"],
          [".meshopt", "application/octet-stream"],
        ] as const) {
          const resource = materialized.exactRangeResources.find(({ source }) =>
            source.endsWith(extension),
          );
          if (resource === undefined)
            throw new Error(`Materialized ${extension} fixture is absent`);
          const url = `${target.baseUrl}/${resource.source}`;
          const full = await fetch(url, { cache: "no-store" });
          expect(full.status).toBe(200);
          expect(full.headers.get("accept-ranges")).toBe("bytes");
          expect(full.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
          expect(full.headers.get("content-length")).toBe(String(resource.bytes));
          expect(full.headers.get("content-type")).toBe(contentType);
          expect(full.headers.get("x-content-type-options")).toBe("nosniff");
          expect((await full.arrayBuffer()).byteLength).toBe(resource.bytes);

          const bounded = await fetch(url, { headers: { Range: "bytes=0-0" } });
          expect(bounded.status).toBe(206);
          expect(bounded.headers.get("accept-ranges")).toBe("bytes");
          expect(bounded.headers.get("cache-control")).toBe("no-cache");
          expect(bounded.headers.get("content-length")).toBe("1");
          expect(bounded.headers.get("content-range")).toBe(`bytes 0-0/${resource.bytes}`);
          expect(bounded.headers.get("content-type")).toBe(contentType);
          expect(bounded.headers.get("x-content-type-options")).toBe("nosniff");
          expect((await bounded.arrayBuffer()).byteLength).toBe(1);

          const completed = await fetch(url, {
            headers: { Range: `bytes=${resource.bytes}-` },
          });
          expect(completed.status).toBe(416);
          expect(completed.headers.get("accept-ranges")).toBe("bytes");
          expect(completed.headers.get("cache-control")).toBe("no-cache");
          expect(completed.headers.get("content-length")).toBe("0");
          expect(completed.headers.get("content-range")).toBe(`bytes */${resource.bytes}`);
          expect(completed.headers.get("content-type")).toBe(contentType);
          expect(completed.headers.get("x-content-type-options")).toBe("nosniff");
          expect((await completed.arrayBuffer()).byteLength).toBe(0);
        }
        await expect(target.revalidate()).resolves.toMatchObject({
          artifactDigest: materialized.artifactDigest,
          releaseDigest: materialized.releaseDigest,
        });
      } finally {
        await target.stop();
      }

      expect(composedDistrict.path).not.toBe(productionDistrict.path);
      const supersededDistrictPath = join(materialized.root, productionDistrict.path);
      await expect(readFile(supersededDistrictPath)).rejects.toMatchObject({ code: "ENOENT" });
      await copyFile(join(productionRoot, productionDistrict.path), supersededDistrictPath);
      await expect(
        readAndValidateBuildManifest(materialized.root, {
          installOnlyFiles: materialized.installOnlyFiles,
        }),
      ).rejects.toThrow(/not in the build manifest/u);
      await rm(supersededDistrictPath);

      const extra = join(materialized.root, "ordinary-extra.bin");
      await writeFile(extra, "unexpected");
      await expect(
        readAndValidateBuildManifest(materialized.root, {
          installOnlyFiles: materialized.installOnlyFiles,
        }),
      ).rejects.toThrow(/not in the build manifest/u);
      await rm(extra);

      const artifact = APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS[0];
      const model = materialized.installOnlyFiles.find(({ sha256 }) => sha256 === artifact?.sha256);
      if (artifact === undefined || model === undefined) {
        throw new Error("Exact materialized model fixture is absent");
      }
      const modelPath = join(materialized.root, model.source);
      const sourcePath = join(
        homedir(),
        ".parallax",
        "harness",
        "models",
        "gemma-4-E2B-it-qat-GGUF-66a399f6",
        artifact.path,
      );
      await rm(modelPath);
      await expect(
        readAndValidateBuildManifest(materialized.root, {
          installOnlyFiles: materialized.installOnlyFiles,
        }),
      ).rejects.toThrow();
      await link(sourcePath, modelPath);

      await rm(modelPath);
      await writeFile(modelPath, "mismatched model");
      await expect(
        readAndValidateBuildManifest(materialized.root, {
          installOnlyFiles: materialized.installOnlyFiles,
        }),
      ).rejects.toThrow(/bytes or digest differ/u);
      await rm(modelPath);
      await link(sourcePath, modelPath);

      await rm(modelPath);
      await link(sourcePath, modelPath);
      const immutablePath = join(materialized.root, "immutable");
      const directImmutablePath = join(materialized.root, "immutable-direct");
      await rename(immutablePath, directImmutablePath);
      await symlink(directImmutablePath, immutablePath, "junction");
      await expect(
        readAndValidateBuildManifest(materialized.root, {
          installOnlyFiles: materialized.installOnlyFiles,
        }),
      ).rejects.toThrow(/not a direct regular file/u);
      await rm(immutablePath, { force: true, recursive: true });
      await rename(directImmutablePath, immutablePath);
    } finally {
      await removeMaterializedScaleStreamingTarget(materialized.root);
    }
  }, 120_000);

  it("generates six deterministic real content-addressed UASTC and meshopt graphs", async () => {
    const secondCorpus = await readGeneratedScaleStreamingCorpus(secondRoot, secondDocument);
    expect(secondDocument).toEqual(firstDocument);
    expect(secondCorpus).toEqual(corpus);
    expect(corpus.graphs).toHaveLength(6);
    expect(corpus.totals.resourceCount).toBe(18);
    expect(corpus.totals.encodedBytes).toBeGreaterThan(1024 * 1024);
    expect(new Set(corpus.graphs.map(({ texture }) => texture.width * texture.height)).size).toBe(
      6,
    );
    expect(new Set(corpus.graphs.map(({ vertexCount }) => vertexCount)).size).toBe(6);
    expect(corpus.graphs.every(({ entropy }) => Number.isFinite(entropy.transitionRatio))).toBe(
      true,
    );
    expect(
      Math.max(...corpus.graphs.map(({ entropy }) => entropy.transitionRatio)) -
        Math.min(...corpus.graphs.map(({ entropy }) => entropy.transitionRatio)),
    ).toBeGreaterThan(0.4);
    const firstFiles = corpus.graphs.flatMap(({ resources }) => resources);
    const secondFiles = secondCorpus.graphs.flatMap(({ resources }) => resources);
    for (const [index, resource] of firstFiles.entries()) {
      const peer = secondFiles[index];
      if (peer === undefined) throw new Error(`Missing repeated resource ${index}`);
      expect(await readFile(join(firstRoot, resource.source))).toEqual(
        await readFile(join(secondRoot, peer.source)),
      );
    }
  });

  it("resolves codecs from the emitted harness module layout", async () => {
    const metadataPath = join(firstRoot, "scale-streaming-corpus.json");
    await writeFile(metadataPath, `${JSON.stringify(firstDocument)}\n`);
    const moduleUrl = pathToFileURL(
      join(repositoryRoot, "harness/dist/types/scale-streaming-corpus.js"),
    ).href;
    const stdout = await executeNode([
      "--input-type=module",
      "--eval",
      `
        import { readFile } from "node:fs/promises";
        const module = await import(${JSON.stringify(moduleUrl)});
        const document = JSON.parse(await readFile(${JSON.stringify(metadataPath)}, "utf8"));
        const corpus = await module.readGeneratedScaleStreamingCorpus(${JSON.stringify(firstRoot)}, document);
        process.stdout.write(JSON.stringify(corpus.totals));
      `,
    ]);
    expect(JSON.parse(stdout)).toEqual(corpus.totals);
  });

  it("models an exact deterministic 65,536-cell >=100 GiB class without materializing it", () => {
    const first = createScaleStreamingManifestModel(corpus);
    const second = createScaleStreamingManifestModel(corpus);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      cellCount: SCALE_STREAMING_CELL_COUNT,
      dependencyGraphCount: SCALE_STREAMING_DEPENDENCY_GRAPH_COUNT,
      dependencyReusePerGraph: SCALE_STREAMING_CELL_COUNT / SCALE_STREAMING_DEPENDENCY_GRAPH_COUNT,
      materializedBytes: 0,
      materializedResources: 0,
      minimumClassBytes: SCALE_STREAMING_CLASS_FLOOR_BYTES,
    });
    expect(first.dependencyReusePerGraph).toBe(32);
    expect(first.exactModeledBytes).toBeGreaterThanOrEqual(SCALE_STREAMING_CLASS_FLOOR_BYTES);
    expect(first.exactModeledBytes).toBe(first.cellModeledBytes + first.dependencyModeledBytes);
    expect(first.exactModeledResourceCount).toBe(
      first.cellModeledResourceCount + first.dependencyModeledResourceCount,
    );
    expect(first.sizeBuckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(
      SCALE_STREAMING_CELL_COUNT,
    );
    expect(first.manifestIdentitySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.dependencyAssignmentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.cellIdentitySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.dependencyIdentitySha256).toMatch(/^[a-f0-9]{64}$/);
    const changedDocument = structuredClone(firstDocument);
    const changedGraphs = changedDocument.graphs as Array<Record<string, unknown>>;
    const changedResources = changedGraphs[0]?.resources as Array<Record<string, unknown>>;
    if (changedResources[0] === undefined) throw new Error("Modeled dependency fixture is absent");
    changedResources[0].bytes = Number(changedResources[0].bytes) + 1;
    const changedTotals = changedDocument.totals as Record<string, unknown>;
    changedTotals.encodedBytes = Number(changedTotals.encodedBytes) + 1;
    const changed = createScaleStreamingManifestModel(
      parseGeneratedScaleStreamingCorpus(changedDocument),
    );
    expect(changed.dependencyModeledBytes).not.toBe(first.dependencyModeledBytes);
    expect(changed.manifestIdentitySha256).not.toBe(first.manifestIdentitySha256);
  });

  it("composes a deterministic valid v2 installed D1 sample while preserving production resources", () => {
    const fixture = productionFixture();
    const first = createScaleStreamingTargetDocuments(
      fixture.build,
      fixture.manifest,
      fixture.index,
      corpus,
    );
    const second = createScaleStreamingTargetDocuments(
      fixture.build,
      fixture.manifest,
      fixture.index,
      corpus,
    );
    expect(second.buildManifestBytes).toEqual(first.buildManifestBytes);
    expect(second.installManifestBytes).toEqual(first.installManifestBytes);
    expect(second.districtIndexBytes).toEqual(first.districtIndexBytes);
    expect(first).toMatchObject({
      dependencyCount: 18,
      graphCount: 6,
      materializedSampleResourceCount: 25,
    });
    expect(first.materializedSampleBytes).toBe(
      first.dependencyBytes +
        first.districtIndexBytes.byteLength +
        fixture.manifest.resources
          .filter(({ kind }) => kind === "world-cell")
          .reduce((sum, resource) => sum + resource.bytes, 0),
    );
    const composedIndex = parseStreamingDistrictIndex(
      JSON.parse(first.districtIndexBytes.toString("utf8")),
      "district-1-surface",
    );
    expect(composedIndex.schemaVersion).toBe(2);
    expect(composedIndex.resources).toHaveLength(18);
    expect(composedIndex.cells.map(({ dependencies }) => dependencies?.[0])).toEqual(
      corpus.graphs.map(({ resources }) => resources[2].resourceId),
    );
    for (const original of fixture.manifest.resources) {
      const composed = first.installManifest.resources.find(({ id }) => id === original.id);
      expect(composed).toBeDefined();
      if (original.kind !== "district-index") expect(composed).toEqual(original);
    }
    const districtSha256 = createHash("sha256").update(first.districtIndexBytes).digest("hex");
    const originalDistrict = fixture.manifest.resources.find(
      ({ id }) => id === "game-specific-district-index-district-1-surface",
    );
    const composedDistrict = first.installManifest.resources.find(
      ({ id }) => id === "game-specific-district-index-district-1-surface",
    );
    const composedEntrypoint = first.buildManifest.gameContentEntrypoints.find(
      ({ districtId }) => districtId === "district-1-surface",
    );
    const composedArtifact = first.buildManifest.artifacts.find(
      ({ path }) => path === first.districtIndexPath,
    );
    if (
      originalDistrict === undefined ||
      composedDistrict === undefined ||
      composedEntrypoint === undefined ||
      composedArtifact === undefined
    ) {
      throw new Error("Composed D1 identity fixture is incomplete");
    }
    expect(first.districtIndexPath).toBe(
      `immutable/district-1-surface-index-${districtSha256}.json`,
    );
    expect(first.districtIndexPath).not.toBe(originalDistrict.source);
    expect(composedDistrict).toMatchObject({
      bytes: first.districtIndexBytes.byteLength,
      sha256: districtSha256,
      source: first.districtIndexPath,
    });
    expect(composedEntrypoint).toMatchObject({
      path: first.districtIndexPath,
      schemaVersion: STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
    });
    expect(composedArtifact).toMatchObject({
      bytes: first.districtIndexBytes.byteLength,
      sha256: districtSha256,
    });
    expect(first.buildManifest.artifacts.some(({ path }) => path === originalDistrict.source)).toBe(
      false,
    );
  });

  it("materializes an authoritative valid v15 build/install inventory", async () => {
    const productionRoot = join(repositoryRoot, "dist");
    const targetRoot = await mkdtemp(join(tmpdir(), "parallax-scale-streaming-target-"));
    await cp(productionRoot, targetRoot, { recursive: true });
    const production = await readAndValidateBuildManifest(targetRoot);
    const districtEntrypoint = production.manifest.gameContentEntrypoints.find(
      ({ districtId }) => districtId === "district-1-surface",
    );
    if (districtEntrypoint === undefined) throw new Error("Production D1 entrypoint is absent");
    const districtIndex = JSON.parse(
      await readFile(join(targetRoot, districtEntrypoint.path), "utf8"),
    ) as unknown;
    const target = createScaleStreamingTargetDocuments(
      production.manifest,
      production.installManifest,
      districtIndex,
      corpus,
    );
    await mkdir(join(targetRoot, "immutable"), { recursive: true });
    for (const resource of corpus.graphs.flatMap(({ resources }) => resources)) {
      await copyFile(join(firstRoot, resource.source), join(targetRoot, resource.source));
    }
    await rm(join(targetRoot, districtEntrypoint.path));
    await writeFile(join(targetRoot, target.districtIndexPath), target.districtIndexBytes);
    await writeFile(join(targetRoot, "install-manifest.json"), target.installManifestBytes);
    await writeFile(join(targetRoot, "build-manifest.json"), target.buildManifestBytes);
    const materializedIndex = JSON.parse(
      await readFile(join(targetRoot, target.districtIndexPath), "utf8"),
    ) as unknown;
    expect(() =>
      parseStreamingDistrictIndex(materializedIndex, "district-1-surface"),
    ).not.toThrow();
    const validated = await readAndValidateBuildManifest(targetRoot);
    expect(validated.releaseDigest).toBe(target.releaseDigest);
    expect(validated.manifest.artifacts).toHaveLength(
      production.manifest.artifacts.length + corpus.totals.resourceCount,
    );
    const expectedCorpusResourceIds = corpus.graphs.flatMap(({ resources }) =>
      resources.map(({ resourceId }) => resourceId),
    );
    const expectedCorpusResourceIdSet = new Set(expectedCorpusResourceIds);
    expect(expectedCorpusResourceIdSet.size).toBe(corpus.totals.resourceCount);
    const exactCorpusResourceIds = validated.installManifest.resources
      .filter(({ id }) => expectedCorpusResourceIdSet.has(id))
      .map(({ id }) => id)
      .sort();
    expect(exactCorpusResourceIds).toEqual([...expectedCorpusResourceIds].sort());
  });

  it("rejects coordinated content-addressed fake KTX2 and meshopt replacements", async () => {
    for (const resourceOrdinal of [0, 1] as const) {
      const replacementRoot = await mkdtemp(
        join(tmpdir(), `parallax-scale-streaming-codec-${resourceOrdinal}-`),
      );
      await generate(replacementRoot);
      const document = JSON.parse(
        await readFile(join(replacementRoot, "scale-streaming-corpus.json"), "utf8"),
      ) as Record<string, unknown>;
      const graphs = document.graphs as Array<Record<string, unknown>>;
      const resources = graphs[0]?.resources as Array<Record<string, unknown>> | undefined;
      const resource = resources?.[resourceOrdinal];
      if (resource === undefined) throw new Error("Codec replacement resource is absent");
      const originalBytes = Number(resource.bytes);
      const fakeBytes = Buffer.alloc(originalBytes, resourceOrdinal === 0 ? 0x4b : 0xff);
      const fakeSha256 = createHash("sha256").update(fakeBytes).digest("hex");
      const role = String(resource.role);
      if (role !== "texture" && role !== "vertices" && role !== "indices") {
        throw new Error("Codec replacement role is invalid");
      }
      const extension = role === "texture" ? "ktx2" : "meshopt";
      const fakeSource = `immutable/streaming-${role}-${fakeSha256}.${extension}`;
      resource.sha256 = fakeSha256;
      resource.source = fakeSource;
      resource.resourceId = scaleStreamingDependencyResourceId(role, fakeSha256);
      await writeFile(join(replacementRoot, fakeSource), fakeBytes);
      await expect(readGeneratedScaleStreamingCorpus(replacementRoot, document)).rejects.toThrow(
        /codec payload is invalid/,
      );
    }
  });

  it("fails closed on production omission, identity mutation, and dependency collision", () => {
    const fixture = productionFixture();
    const indexId = "game-specific-district-index-district-1-surface";
    const omitted = {
      ...fixture.manifest,
      resources: fixture.manifest.resources.filter(({ id }) => id !== indexId),
    } as InstallManifest;
    expect(() =>
      createScaleStreamingTargetDocuments(fixture.build, omitted, fixture.index, corpus),
    ).toThrow(/index resource is absent/);

    const mutated = {
      ...fixture.manifest,
      resources: fixture.manifest.resources.map((resource) =>
        resource.id === indexId ? { ...resource, kind: "asset-pack" as const } : resource,
      ),
    } as InstallManifest;
    expect(() =>
      createScaleStreamingTargetDocuments(fixture.build, mutated, fixture.index, corpus),
    ).toThrow(/index identity is invalid/);

    const staleSource = {
      ...fixture.manifest,
      resources: fixture.manifest.resources.map((resource) =>
        resource.id === indexId
          ? { ...resource, source: "immutable/stale-district-index.json" }
          : resource,
      ),
    } as InstallManifest;
    expect(() =>
      createScaleStreamingTargetDocuments(fixture.build, staleSource, fixture.index, corpus),
    ).toThrow(/index identity is invalid/);

    const staleEntrypoint = {
      ...fixture.build,
      gameContentEntrypoints: fixture.build.gameContentEntrypoints.map((entrypoint) =>
        entrypoint.districtId === "district-1-surface"
          ? { ...entrypoint, path: "immutable/stale-district-index.json" }
          : entrypoint,
      ),
    } as BuildManifest;
    expect(() =>
      createScaleStreamingTargetDocuments(staleEntrypoint, fixture.manifest, fixture.index, corpus),
    ).toThrow(/index identity is invalid/);

    const staleArtifact = {
      ...fixture.build,
      artifacts: fixture.build.artifacts.map((artifact) =>
        artifact.path === "immutable/district-index-fixture.json"
          ? { ...artifact, path: "immutable/stale-district-index.json" }
          : artifact,
      ),
    } as BuildManifest;
    expect(() =>
      createScaleStreamingTargetDocuments(staleArtifact, fixture.manifest, fixture.index, corpus),
    ).toThrow(/index artifact is invalid/);

    const colliding = structuredClone(corpus) as unknown as Record<string, unknown>;
    const graphs = colliding.graphs as Array<Record<string, unknown>>;
    const graphResources = graphs[0]?.resources as Array<Record<string, unknown>> | undefined;
    if (graphResources?.[0] === undefined) throw new Error("Collision fixture resource is absent");
    graphResources[0].resourceId = "app-shell-document-index";
    expect(() =>
      createScaleStreamingTargetDocuments(
        fixture.build,
        fixture.manifest,
        fixture.index,
        colliding as unknown as GeneratedScaleStreamingCorpus,
      ),
    ).toThrow(/resource 0:0|collides with production/);
  });

  it("rejects metadata drift, cap violations, total drift, and content corruption", async () => {
    expect(() => parseGeneratedScaleStreamingCorpus({ ...firstDocument, surprise: true })).toThrow(
      /identity/,
    );
    expect(() =>
      parseGeneratedScaleStreamingCorpus({
        ...firstDocument,
        totals: { ...(firstDocument.totals as object), encodedBytes: 1 },
      }),
    ).toThrow(/totals/);
    const graphs = structuredClone(firstDocument.graphs) as Array<Record<string, unknown>>;
    const resources = graphs[0]?.resources as Array<Record<string, unknown>> | undefined;
    if (resources === undefined || resources[0] === undefined)
      throw new Error("Fixture resource absent");
    resources[0].bytes = STREAMING_DEPENDENCY_ENCODED_MAX_BYTES + 1;
    expect(() => parseGeneratedScaleStreamingCorpus({ ...firstDocument, graphs })).toThrow(
      /resource 0:0/,
    );
    for (const transitionRatio of [Number.NaN, -0.01, 1.01]) {
      const entropyGraphs = structuredClone(firstDocument.graphs) as Array<Record<string, unknown>>;
      const entropy = entropyGraphs[0]?.entropy as Record<string, unknown> | undefined;
      if (entropy === undefined) throw new Error("Entropy corruption target is absent");
      entropy.transitionRatio = transitionRatio;
      expect(() =>
        parseGeneratedScaleStreamingCorpus({ ...firstDocument, graphs: entropyGraphs }),
      ).toThrow(/graph 0/);
    }
    const target = corpus.graphs[0]?.resources[0];
    if (target === undefined) throw new Error("Generated corruption target is absent");
    const path = join(secondRoot, target.source);
    const bytes = await readFile(path);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    await writeFile(path, bytes);
    await expect(readGeneratedScaleStreamingCorpus(secondRoot, secondDocument)).rejects.toThrow(
      /bytes drifted/,
    );
  });
});

function generate(output: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      process.execPath,
      [
        join(repositoryRoot, "harness/scripts/generate-scale-streaming-corpus.mjs"),
        "--output",
        output,
      ],
      { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error !== null)
          reject(new Error(`Corpus generator failed: ${stderr}`, { cause: error }));
        else resolvePromise();
      },
    );
  });
}

function executeNode(arguments_: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      process.execPath,
      arguments_,
      { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null) reject(new Error(`Emitted module failed: ${stderr}`, { cause: error }));
        else resolvePromise(stdout);
      },
    );
  });
}

function productionFixture(): Readonly<{
  build: BuildManifest;
  index: Readonly<Record<string, unknown>>;
  manifest: InstallManifest;
}> {
  const cells = Array.from({ length: 6 }, (_, x) => {
    const sha256 = digest(`cell-${x}`);
    const identity = canonicalStreamingCellArtifactIdentity("district-1-surface", [x, 0], sha256);
    return Object.freeze({
      bytes: 100 + x,
      cellId: identity.cellId,
      coordinate: [x, 0] as const,
      path: identity.source,
      sha256,
    });
  });
  const index = Object.freeze({
    bounds: { maximum: [1536, 100, 256], minimum: [0, 0, 0] },
    cellSizeMeters: 256,
    cells,
    districtId: "district-1-surface",
    materials: [{ color: [0.2, 0.3, 0.4], id: "ground" }],
    resources: [],
    schemaVersion: STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
  });
  const indexSha = digest(JSON.stringify(index));
  const productionResources = (
    [
      {
        bytes: 20,
        id: "app-shell-document-index",
        kind: "document",
        scope: "app-shell",
        sha256: digest("index"),
        source: "index.html",
        target: "shell",
      },
      {
        bytes: 30,
        id: "common-module-engine",
        kind: "module",
        scope: "common",
        sha256: digest("engine"),
        source: `immutable/engine-${digest("engine")}.js`,
        target: "shell",
      },
      {
        bytes: JSON.stringify(index).length,
        id: "game-specific-district-index-district-1-surface",
        kind: "district-index",
        scope: "game-specific",
        sha256: indexSha,
        source: "immutable/district-index-fixture.json",
        target: "opfs",
      },
      ...cells.map((cell) => ({
        bytes: cell.bytes,
        id: canonicalStreamingCellArtifactIdentity(
          "district-1-surface",
          cell.coordinate,
          cell.sha256,
        ).resourceId,
        kind: "world-cell" as const,
        scope: "game-specific" as const,
        sha256: cell.sha256,
        source: cell.path,
        target: "opfs" as const,
      })),
      {
        bytes: 40,
        id: "game-specific-pso-warmup",
        kind: "asset-pack",
        scope: "game-specific",
        sha256: digest("pso"),
        source: `immutable/pso-${digest("pso")}.json`,
        target: "opfs",
      },
    ] as InstallManifest["resources"][number][]
  ).sort((left, right) => left.id.localeCompare(right.id));
  const manifest: InstallManifest = Object.freeze({
    gameId: "parallax",
    resources: Object.freeze(productionResources),
    schemaVersion: 1,
  });
  const build: BuildManifest = Object.freeze({
    artifacts: Object.freeze([
      { bytes: 20, path: "index.html", sha256: digest("index") },
      {
        bytes: JSON.stringify(index).length,
        path: "immutable/district-index-fixture.json",
        sha256: indexSha,
      },
      { bytes: 1, path: "install-manifest.json", sha256: digest("manifest") },
    ]),
    gameContentEntrypoints: Object.freeze([
      {
        districtId: "district-1-surface",
        path: "immutable/district-index-fixture.json",
        schemaVersion:
          STREAMING_DISTRICT_INDEX_SCHEMA_VERSION as typeof STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
        scope: "game-specific" as const,
        targetType: "district" as const,
      },
    ]),
    installManifestEntrypoint: {
      path: "install-manifest.json" as const,
      schemaVersion: 1 as const,
    },
    offlineShell: {
      generationSchemaVersion: 1 as const,
      saveSchemaVersion: 1 as const,
      serviceWorkerPath: "service-worker.js" as const,
    },
    schemaVersion: 15,
    workerEntrypoints: Object.freeze([]),
  });
  return Object.freeze({ build, index, manifest });
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
