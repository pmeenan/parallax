import { open, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS } from "../src/ai/app-owned-llm-spike-protocol";
import { verifyAndPublishInstallerRelease } from "../src/install/installer-activation";
import {
  type InstallerManifestIdentity,
  parseInstallerBuildManifest,
  validateInstallerManifestBytes,
} from "../src/install/installer-build-manifest";
import {
  type InstallerTransferTelemetrySnapshot,
  idleInstallerTransferTelemetrySnapshot,
  parseInstallerResponse,
} from "../src/install/installer-protocol";
import {
  type InstallerRepairOperationStore,
  repairInstalledRelease,
} from "../src/install/installer-repair";
import {
  createInstallerRepairCompleteResponse,
  createInstallerRepairTransferObserver,
  executeInstallerRepairWorkerOperation,
} from "../src/install/installer-repair-worker-operation";
import {
  createInstallerRepairState,
  type InstallerTransferObserver,
  type InstallerTransferPlatform,
  transferInstallResources,
} from "../src/install/installer-transfer";
import type { InstallResource } from "../src/storage/install-manifest";
import { parseInstallManifestDocument } from "../src/storage/install-manifest";
import {
  createOpfsReleaseStore,
  type InstallerRepairAdmission,
} from "../src/storage/opfs-release-store";
import {
  INSTALL_STORE_ROOT,
  serializeInstallStoreRecord,
} from "../src/storage/opfs-release-store-contract";
import {
  assertInstallStorePath,
  createMemoryInstallStorePlatform,
  type InstallStoreListOptions,
  InstallStorePathNotFoundError,
  type InstallStorePlatform,
  type InstallStorePlatformEntry,
  type MemoryInstallStorePlatform,
} from "../src/storage/opfs-release-store-platform";

const encoder = new TextEncoder();
const strongEtag = '"installer-repair-integration"';

describe("installer repair integration", () => {
  it("naturally carries exact completion credit from seed install into same-worker Repair", async () => {
    const fixtures = ["seed-alpha", "seed-bravo"].map((value, index) => {
      const bytes = encoder.encode(value);
      return Object.freeze({
        bytes,
        id: `same-worker-resource-${index}`,
        sha256: bytesToHex(sha256(bytes)),
      });
    });
    const resources: readonly InstallResource[] = fixtures.map((fixture) =>
      Object.freeze({
        bytes: fixture.bytes.byteLength,
        id: fixture.id,
        kind: "asset-pack",
        scope: "game-specific",
        sha256: fixture.sha256,
        source: `immutable/${fixture.id}.bin`,
        target: "opfs",
      }),
    );
    const manifestBytes = encoder.encode(
      `${JSON.stringify({ gameId: "parallax", resources, schemaVersion: 1 })}\n`,
    );
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes);
    const totalBytes = resources.reduce((total, resource) => total + resource.bytes, 0);
    let transfer: InstallerTransferTelemetrySnapshot = Object.freeze({
      ...idleInstallerTransferTelemetrySnapshot(1, 8),
      activeReleaseDigest: staged.releaseDigest,
      activeRequestId: 1,
      plannedDownloadBytes: totalBytes,
      resourceCount: resources.length,
      state: "transferring" as const,
      totalBytes,
    });
    const apply = (partial: Partial<InstallerTransferTelemetrySnapshot>): void => {
      transfer = Object.freeze({ ...transfer, ...partial });
    };
    const controller = { accumulate: apply, snapshot: () => transfer, update: apply };
    const seedObserver = createInstallerRepairTransferObserver(controller, new Set());
    const signal = new AbortController().signal;
    const transferPlatform = fixtureTransferPlatform(resources, fixtures);
    const seed = await transferInstallResources(store, transferPlatform, seedObserver, {
      baseUrl: "https://example.test/",
      policy: { checkpointBytes: 8, concurrency: 1, requestTimeoutMs: 1_000 },
      releaseDigest: staged.releaseDigest,
      resources,
      signal,
    });
    await verifyAndPublishInstallerRelease({
      beginPublication: () => undefined,
      expectedBytes: totalBytes,
      expectedResourceCount: resources.length,
      releaseDigest: staged.releaseDigest,
      repairResource: async () => {
        throw new Error("Seed verification unexpectedly requested repair");
      },
      signal,
      store,
      transferredBytes: seed.readyBytes,
      transferredResourceCount: seed.readyResourceCount,
    });
    const publicationCount = store.snapshot().publicationCount;
    expect(transfer).toMatchObject({
      completedResourceCount: resources.length,
      verifiedBytes: totalBytes,
    });

    const corrupt = fixtures[0];
    if (corrupt === undefined) throw new Error("Same-worker corruption fixture is absent");
    const reference = await store.getResource(staged.releaseDigest, corrupt.id);
    const corruptBytes = corrupt.bytes.slice();
    corruptBytes[0] = (corruptBytes[0] ?? 0) ^ 0xff;
    platform.seedExternalFile(reference.path, corruptBytes);
    transfer = Object.freeze({
      ...transfer,
      activeRequestId: 2,
      plannedDownloadBytes: 0,
      reusedBytes: totalBytes,
      state: "transferring",
    });
    const observer = createInstallerRepairTransferObserver(
      controller,
      new Set(resources.map(({ id }) => id)),
      {
        releaseDigest: staged.releaseDigest,
        resourceCount: resources.length,
        totalBytes,
      },
    );
    await repairInstalledRelease({
      admission: null,
      beginCompletion: () => undefined,
      expectedBytes: totalBytes,
      expectedResourceCount: resources.length,
      observer,
      resources,
      signal,
      store,
      transferInput: {
        baseUrl: "https://example.test/",
        policy: { checkpointBytes: 8, concurrency: 1, requestTimeoutMs: 1_000 },
        releaseDigest: staged.releaseDigest,
        repairState: createInstallerRepairState(),
        resources,
        signal,
      },
      transferPlatform,
    });
    expect(transfer).toMatchObject({
      completedResourceCount: resources.length,
      operationRepairedBytes: corrupt.bytes.byteLength,
      operationRepairedResourceCount: 1,
      verifiedBytes: totalBytes,
    });
    expect(store.snapshot()).toMatchObject({
      activeReleaseDigest: staged.releaseDigest,
      publicationCount,
      state: "ready",
    });
    const restarted = Object.freeze({
      ...idleInstallerTransferTelemetrySnapshot(1, 8),
      activeReleaseDigest: staged.releaseDigest,
      resourceCount: resources.length,
      totalBytes,
    });
    expect(restarted).toMatchObject({ completedResourceCount: 0, verifiedBytes: 0 });
  });

  it("drives seed, same-size corruption, explicit repair, and exact active restoration", async () => {
    const fixtures = ["alpha", "bravo", "charlie"].map((value, index) => {
      const bytes = encoder.encode(value);
      return Object.freeze({
        bytes,
        id: `resource-${index}`,
        sha256: bytesToHex(sha256(bytes)),
      });
    });
    const resources: readonly InstallResource[] = fixtures.map((fixture) =>
      Object.freeze({
        bytes: fixture.bytes.byteLength,
        id: fixture.id,
        kind: "asset-pack",
        scope: "game-specific",
        sha256: fixture.sha256,
        source: `immutable/${fixture.id}.bin`,
        target: "opfs",
      }),
    );
    const manifestBytes = encoder.encode(
      `${JSON.stringify({ gameId: "parallax", resources, schemaVersion: 1 })}\n`,
    );
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes);
    for (const fixture of fixtures) {
      await store.appendPartial({
        bytes: fixture.bytes,
        expectedOffset: 0,
        releaseDigest: staged.releaseDigest,
        resourceId: fixture.id,
        strongEtag,
      });
      await store.finalizePartial(staged.releaseDigest, fixture.id);
    }
    await store.markReleaseReady(staged.releaseDigest);
    await store.publishRelease(staged.releaseDigest);
    const baselineMetadata = await exactPublicationMetadata(platform, staged.releaseDigest);
    const commitsBefore = await platform.list("parallax-install-v1/commits", {
      recursive: true,
    });
    const corruptFixture = fixtures[0];
    if (corruptFixture === undefined) throw new Error("Corruption fixture is absent");
    const corruptReference = await store.getResource(staged.releaseDigest, corruptFixture.id);
    platform.seedExternalFile(corruptReference.path, encoder.encode("ALPHA"));

    const signal = new AbortController().signal;
    const repairState = createInstallerRepairState();
    const transferPlatform: InstallerTransferPlatform = Object.freeze({
      clearTimeout: () => undefined,
      async fetch(input: string) {
        expect(telemetry.snapshot()).toMatchObject({
          activeResourceCount: 1,
          activeResourceId: corruptFixture.id,
        });
        const resource = resources.find(
          (candidate) => new URL(candidate.source, "https://example.test/").href === input,
        );
        const fixture = fixtures.find((candidate) => candidate.id === resource?.id);
        if (resource === undefined || fixture === undefined) {
          throw new Error("Unexpected repair resource");
        }
        const response = new Response(fixture.bytes, {
          headers: {
            "content-length": String(fixture.bytes.byteLength),
            "content-range": `bytes 0-${fixture.bytes.byteLength - 1}/${fixture.bytes.byteLength}`,
            etag: strongEtag,
          },
          status: 206,
        });
        Object.defineProperty(response, "url", { value: input });
        return response;
      },
      now: () => 0,
      setTimeout: () => 0,
      sleep: async () => undefined,
    });
    const expectedBytes = resources.reduce((total, resource) => total + resource.bytes, 0);
    const telemetry = sharedRepairTelemetry(
      resources,
      expectedBytes,
      "same-worker",
      staged.releaseDigest,
    );
    let completionStarted = false;
    await repairInstalledRelease({
      admission: null,
      beginCompletion: () => {
        completionStarted = true;
      },
      expectedBytes,
      expectedResourceCount: resources.length,
      observer: telemetry.observer,
      resources,
      signal,
      store,
      transferInput: {
        baseUrl: "https://example.test/",
        policy: { checkpointBytes: 8, concurrency: 1, requestTimeoutMs: 1_000 },
        releaseDigest: staged.releaseDigest,
        repairState,
        resources,
        signal,
      },
      transferPlatform,
    });

    expect(completionStarted).toBe(true);
    expect(await store.getSelection()).toEqual({
      activeReleaseDigest: staged.releaseDigest,
      previousReleaseDigest: null,
    });
    expect(store.snapshot()).toMatchObject({
      activeReleaseDigest: staged.releaseDigest,
      readyReleaseCount: 1,
      state: "ready",
    });
    expect(await platform.list("parallax-install-v1/commits", { recursive: true })).toEqual(
      commitsBefore,
    );
    const eligibilityPath = `${INSTALL_STORE_ROOT}/releases/${staged.releaseDigest}/repair-eligibility.json`;
    expect(await platform.read(eligibilityPath)).toBeNull();
    expect(await exactPublicationMetadata(platform, staged.releaseDigest)).toEqual(
      baselineMetadata,
    );
    expect(telemetry.snapshot()).toMatchObject({
      activeResourceCount: 0,
      activeResourceId: null,
      completedResourceCount: resources.length,
      downloadedBytes: corruptFixture.bytes.byteLength,
      integrityFailureCount: 1,
      operationRepairAttemptCount: 1,
      operationRepairedBytes: corruptFixture.bytes.byteLength,
      operationRepairedResourceCount: 1,
      verifiedBytes: expectedBytes,
    });

    platform.seedExternalFile(corruptReference.path, encoder.encode("ALPHA"));
    await expect(store.verifyObject(corruptReference)).resolves.toMatchObject({ ok: false });
    const eligibility = await platform.read(eligibilityPath);
    if (eligibility === null) throw new Error("Transient repair eligibility is absent");
    const transientMetadata = await exactPublicationMetadata(platform, staged.releaseDigest);
    expect(
      transientMetadata.filter(
        (entry) => !baselineMetadata.some((baseline) => baseline.path === entry.path),
      ),
    ).toEqual([
      {
        bytes: eligibility.byteLength,
        path: eligibilityPath,
        sha256: bytesToHex(sha256(eligibility)),
      },
    ]);
    expect(transientMetadata.length).toBe(baselineMetadata.length + 1);
  });

  it("repairs a pathname mutated after its final-verification snapshot without double completion credit", async () => {
    const fixtures = ["stable-alpha", "stable-bravo"].map((value, index) => {
      const bytes = encoder.encode(value);
      return Object.freeze({
        bytes,
        id: `stable-read-resource-${index}`,
        sha256: bytesToHex(sha256(bytes)),
      });
    });
    const resources: readonly InstallResource[] = fixtures.map((fixture) =>
      Object.freeze({
        bytes: fixture.bytes.byteLength,
        id: fixture.id,
        kind: "asset-pack",
        scope: "game-specific",
        sha256: fixture.sha256,
        source: `immutable/${fixture.id}.bin`,
        target: "opfs",
      }),
    );
    const manifestBytes = encoder.encode(
      `${JSON.stringify({ gameId: "parallax", resources, schemaVersion: 1 })}\n`,
    );
    const basePlatform = createMemoryInstallStorePlatform();
    let mutationPath: string | null = null;
    let mutationArmed = false;
    const platform: MemoryInstallStorePlatform = Object.freeze({
      ...basePlatform,
      async *readChunks(path: string, chunkBytes: number) {
        for await (const chunk of basePlatform.readChunks(path, chunkBytes)) {
          if (mutationArmed && path === mutationPath) {
            const corrupt = chunk.slice();
            corrupt[0] = (corrupt[0] ?? 0) ^ 0xff;
            basePlatform.seedExternalFile(path, corrupt);
            mutationArmed = false;
          }
          yield chunk;
        }
      },
    });
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes);
    for (const fixture of fixtures) {
      await store.appendPartial({
        bytes: fixture.bytes,
        expectedOffset: 0,
        releaseDigest: staged.releaseDigest,
        resourceId: fixture.id,
        strongEtag,
      });
      await store.finalizePartial(staged.releaseDigest, fixture.id);
    }
    await store.markReleaseReady(staged.releaseDigest);
    await store.publishRelease(staged.releaseDigest);
    const target = fixtures[0];
    if (target === undefined) throw new Error("Stable-read mutation fixture is absent");
    mutationPath = (await store.getResource(staged.releaseDigest, target.id)).path;
    mutationArmed = true;
    const expectedBytes = resources.reduce((total, resource) => total + resource.bytes, 0);
    const telemetry = sharedRepairTelemetry(
      resources,
      expectedBytes,
      "same-worker",
      staged.releaseDigest,
    );
    const ranges: string[] = [];
    const baseTransfer = fixtureTransferPlatform(resources, fixtures);
    const transferPlatform: InstallerTransferPlatform = Object.freeze({
      ...baseTransfer,
      async fetch(url: string, init?: RequestInit) {
        ranges.push(new Headers(init?.headers).get("range") ?? "<absent>");
        return baseTransfer.fetch(url, init ?? {});
      },
    });
    let completionStarted = false;
    const signal = new AbortController().signal;
    await repairInstalledRelease({
      admission: null,
      beginCompletion: () => {
        completionStarted = true;
      },
      expectedBytes,
      expectedResourceCount: resources.length,
      observer: telemetry.observer,
      resources,
      signal,
      store,
      transferInput: {
        baseUrl: "https://example.test/",
        policy: { checkpointBytes: 8, concurrency: 1, requestTimeoutMs: 1_000 },
        releaseDigest: staged.releaseDigest,
        repairState: createInstallerRepairState(),
        resources,
        signal,
      },
      transferPlatform,
    });

    expect(mutationArmed).toBe(false);
    expect(completionStarted).toBe(true);
    expect(ranges).toEqual(["bytes=0-"]);
    expect(telemetry.snapshot()).toMatchObject({
      completedResourceCount: resources.length,
      downloadedBytes: target.bytes.byteLength,
      integrityFailureCount: 1,
      operationRepairAttemptCount: 1,
      operationRepairedBytes: target.bytes.byteLength,
      operationRepairedResourceCount: 1,
      verifiedBytes: expectedBytes,
    });
    expect(await store.getSelection()).toEqual({
      activeReleaseDigest: staged.releaseDigest,
      previousReleaseDigest: null,
    });
    expect(await store.verifyRelease(staged.releaseDigest)).toMatchObject({
      bytes: expectedBytes,
      ok: true,
    });
  });

  it("credits durable corruption once across restart, failed replacement, and later Repair", async () => {
    const fixtures = ["alpha", "bravo"].map((value, index) => {
      const bytes = encoder.encode(value);
      return Object.freeze({
        bytes,
        id: `restart-resource-${index}`,
        sha256: bytesToHex(sha256(bytes)),
      });
    });
    const resources: readonly InstallResource[] = fixtures.map((fixture) =>
      Object.freeze({
        bytes: fixture.bytes.byteLength,
        id: fixture.id,
        kind: "asset-pack",
        scope: "game-specific",
        sha256: fixture.sha256,
        source: `immutable/${fixture.id}.bin`,
        target: "opfs",
      }),
    );
    const manifestBytes = encoder.encode(
      `${JSON.stringify({ gameId: "parallax", resources, schemaVersion: 1 })}\n`,
    );
    const platform = createMemoryInstallStorePlatform();
    const initialStore = createOpfsReleaseStore(platform);
    const staged = await initialStore.stageRelease(manifestBytes);
    for (const fixture of fixtures) {
      await initialStore.appendPartial({
        bytes: fixture.bytes,
        expectedOffset: 0,
        releaseDigest: staged.releaseDigest,
        resourceId: fixture.id,
        strongEtag,
      });
      await initialStore.finalizePartial(staged.releaseDigest, fixture.id);
    }
    await initialStore.markReleaseReady(staged.releaseDigest);
    await initialStore.publishRelease(staged.releaseDigest);
    const baselineMetadata = await exactPublicationMetadata(platform, staged.releaseDigest);
    const corruptFixture = fixtures[0];
    if (corruptFixture === undefined) throw new Error("Restart corruption fixture is absent");
    const corruptReference = await initialStore.getResource(
      staged.releaseDigest,
      corruptFixture.id,
    );
    platform.seedExternalFile(corruptReference.path, encoder.encode("ALPHA"));

    await expect(initialStore.verifyObject(corruptReference)).resolves.toMatchObject({
      ok: false,
    });
    expect(initialStore.snapshot()).toMatchObject({
      activeReleaseDigest: null,
      integrityFailures: 1,
      readyReleaseCount: 0,
      verifiedObjectCount: 1,
    });

    const failedStore = createOpfsReleaseStore(platform.reconstruct());
    await failedStore.reconcile();
    const durableAdmission = await failedStore.findRepairRelease(staged.releaseDigest);
    if (durableAdmission === null) throw new Error("Durable repair admission is absent");
    expect(failedStore.snapshot()).toMatchObject({
      activeReleaseDigest: null,
      integrityFailures: 0,
      readyReleaseCount: 0,
      verifiedObjectCount: 1,
    });
    const expectedBytes = resources.reduce((total, resource) => total + resource.bytes, 0);
    const failedTelemetry = sharedRepairTelemetry(resources, expectedBytes, "restarted");
    await expect(
      runRepairOperation({
        admission: durableAdmission,
        bytes: encoder.encode("xxxxx"),
        observer: failedTelemetry.observer,
        resources,
        store: failedStore,
      }),
    ).rejects.toThrow();
    expect(failedTelemetry.snapshot()).toMatchObject({
      completedResourceCount: 0,
      downloadedBytes: corruptFixture.bytes.byteLength,
      httpRequestCount: 1,
      integrityFailureCount: 1,
      operationRepairAttemptCount: 1,
      operationRepairedResourceCount: 0,
      verifiedBytes: 0,
    });
    expect(failedStore.snapshot()).toMatchObject({
      activeReleaseDigest: null,
      integrityFailures: 1,
      readyReleaseCount: 0,
      verifiedObjectCount: 1,
    });

    const repairedStore = createOpfsReleaseStore(platform.reconstruct());
    await repairedStore.reconcile();
    const restartedAdmission = await repairedStore.findRepairRelease(staged.releaseDigest);
    if (restartedAdmission === null) throw new Error("Restarted repair admission is absent");
    expect(restartedAdmission).toEqual(durableAdmission);
    expect(repairedStore.snapshot()).toMatchObject({
      activeReleaseDigest: null,
      integrityFailures: 0,
      readyReleaseCount: 0,
      verifiedObjectCount: 1,
    });
    const repairedTelemetry = sharedRepairTelemetry(resources, expectedBytes, "restarted");
    await runRepairOperation({
      admission: restartedAdmission,
      bytes: corruptFixture.bytes,
      observer: repairedTelemetry.observer,
      resources,
      store: repairedStore,
    });
    expect(repairedTelemetry.snapshot()).toMatchObject({
      completedResourceCount: 0,
      downloadedBytes: corruptFixture.bytes.byteLength,
      hashedBytes: corruptFixture.bytes.byteLength,
      httpRequestCount: 1,
      operationRepairAttemptCount: 1,
      operationRepairedBytes: corruptFixture.bytes.byteLength,
      operationRepairedResourceCount: 1,
      verifiedBytes: 0,
    });
    expect(repairedStore.snapshot()).toMatchObject({
      activeReleaseDigest: staged.releaseDigest,
      integrityFailures: 0,
      publicationCount: 0,
      readyReleaseCount: 1,
      state: "ready",
      verifiedObjectCount: resources.length,
    });
    expect(await repairedStore.getSelection()).toEqual({
      activeReleaseDigest: staged.releaseDigest,
      previousReleaseDigest: null,
    });
    const eligibilityPath = `${INSTALL_STORE_ROOT}/releases/${staged.releaseDigest}/repair-eligibility.json`;
    expect(await platform.read(eligibilityPath)).toBeNull();
    expect(await exactPublicationMetadata(platform, staged.releaseDigest)).toEqual(
      baselineMetadata,
    );
    const postRepairRestart = createOpfsReleaseStore(platform.reconstruct());
    await expect(postRepairRestart.reconcile()).resolves.toMatchObject({
      activeReleaseDigest: staged.releaseDigest,
      previousReleaseDigest: null,
    });
    expect(await exactPublicationMetadata(platform, staged.releaseDigest)).toEqual(
      baselineMetadata,
    );
  });

  it.skip(
    "replays exact production bytes through the real store and rejects a second corruption",
    async () => {
      const startedAt = performance.now();
      const repositoryRoot = resolve(import.meta.dirname, "../..");
      const installManifestBytes = await readFile(
        resolve(repositoryRoot, "dist/install-manifest.json"),
      );
      const buildManifest = parseInstallerBuildManifest(
        JSON.parse(
          new TextDecoder().decode(
            await readFile(resolve(repositoryRoot, "dist/build-manifest.json")),
          ),
        ),
      );
      const identity = validateInstallerManifestBytes(buildManifest, installManifestBytes);
      const parsed = parseInstallManifestDocument(
        JSON.parse(new TextDecoder().decode(installManifestBytes)),
      );
      const resources = parsed.manifest.resources;
      const opfsResources = resources.filter((resource) => resource.target === "opfs");
      expect(bytesToHex(sha256(encoder.encode(JSON.stringify(opfsResources))))).toBe(
        "efccdb6aa126dcda0f866913bfd5977751e03013b9f5f842c5e313a84e34cff8",
      );
      expect(parsed.summary.countByTarget.opfs).toBe(263);
      expect(parsed.summary.bytesByTarget.opfs).toBe(2_621_434_134);
      const admittedResource = [...opfsResources].sort(
        (left, right) => left.bytes - right.bytes,
      )[0];
      if (admittedResource === undefined) throw new Error("Production OPFS resources are absent");
      expect(admittedResource).toMatchObject({
        bytes: 2432,
        id: "game-specific-world-cell-district-1-surface-15-07",
        sha256: "c5dcce140fd0a6b5e2fc5fffa9b20df824d9bdbcee476baec1fe88637a06d4bb",
      });

      const platform = createSourceBackedInstallStorePlatform();
      const store = createOpfsReleaseStore(platform);
      const staged = await store.stageRelease(installManifestBytes);
      expect(staged.releaseDigest).toBe(bytesToHex(sha256(installManifestBytes)));
      for (const resource of opfsResources) {
        if (resource.scope === "app-shell") {
          throw new Error("Production OPFS resource has invalid app-shell scope");
        }
        const sourcePath = productionResourceSource(repositoryRoot, resource);
        const sourceStat = await stat(sourcePath);
        expect(sourceStat.isFile()).toBe(true);
        expect(sourceStat.size).toBe(resource.bytes);
        const objectPath = productionObjectPath(resource);
        platform.bindSource(objectPath, sourcePath, resource.bytes);
        await platform.writeRecord(
          objectPath.replace(/\.data$/u, ".verified.json"),
          serializeInstallStoreRecord({
            bytes: resource.bytes,
            schemaVersion: 1,
            scope: resource.scope,
            sha256: resource.sha256,
          }),
        );
      }
      await store.reconcile();
      platform.resetMetrics();
      await expect(store.verifyRelease(staged.releaseDigest)).resolves.toMatchObject({
        bytes: parsed.summary.bytesByTarget.opfs,
        ok: true,
      });
      expect(platform.metrics()).toMatchObject({
        sourceReadBytes: parsed.summary.bytesByTarget.opfs,
        sourceReadOperations: opfsResources.length,
      });
      await store.markReleaseReady(staged.releaseDigest);
      await store.publishRelease(staged.releaseDigest);
      const baselineMetadata = await exactPublicationMetadata(platform, staged.releaseDigest);
      expect(store.snapshot()).toMatchObject({
        activeReleaseDigest: staged.releaseDigest,
        integrityFailures: 0,
        publicationCount: 1,
        readyReleaseCount: 1,
        verifiedObjectBytes: parsed.summary.bytesByTarget.opfs,
        verifiedObjectCount: opfsResources.length,
      });

      const admittedReference = await store.getResource(staged.releaseDigest, admittedResource.id);
      const admittedBytes = new Uint8Array(
        await readFile(productionResourceSource(repositoryRoot, admittedResource)),
      );
      const corruptBytes = admittedBytes.slice();
      corruptBytes[0] = (corruptBytes[0] ?? 0) ^ 0xff;
      platform.replaceWithOwned(admittedReference.path, corruptBytes);
      await expect(store.verifyObject(admittedReference)).resolves.toMatchObject({
        bytes: admittedResource.bytes,
        ok: false,
      });
      expect(
        await platform.read(admittedReference.path.replace(/\.data$/u, ".verified.json")),
      ).toBe(null);
      expect(await store.getSelection()).toEqual({
        activeReleaseDigest: null,
        previousReleaseDigest: null,
      });
      expect(store.snapshot()).toMatchObject({
        activeReleaseDigest: null,
        integrityFailures: 1,
        readyReleaseCount: 0,
        verifiedObjectBytes: parsed.summary.bytesByTarget.opfs - admittedResource.bytes,
        verifiedObjectCount: opfsResources.length - 1,
      });

      platform.resetMetrics();
      const admission = await store.admitRepairRelease(staged.releaseDigest);
      const admissionMetrics = platform.metrics();
      expect(admission).toMatchObject({
        bytes: admittedResource.bytes,
        releaseDigest: staged.releaseDigest,
        resourceId: admittedResource.id,
        state: "repair-required",
      });
      expect(admissionMetrics.sourceReadBytes).toBe(
        parsed.summary.bytesByTarget.opfs - admittedResource.bytes,
      );
      expect(admissionMetrics.sourceReadOperations).toBe(opfsResources.length - 1);
      expect(admissionMetrics.distinctSourcePaths).toBe(opfsResources.length - 1);
      expect(admissionMetrics.distinctVerifiedMarkerPaths).toBe(opfsResources.length - 1);

      let completionStarted = false;
      let rangeHeader: string | null = null;
      let ifRangeHeader: string | null = null;
      let publicTransfer: InstallerTransferTelemetrySnapshot = Object.freeze({
        ...idleInstallerTransferTelemetrySnapshot(1, 8 * 1024 * 1024),
        activeReleaseDigest: staged.releaseDigest,
        activeRequestId: 1,
        completedResourceCount: opfsResources.length,
        plannedDownloadBytes: 0,
        resourceCount: opfsResources.length,
        reusedBytes: parsed.summary.bytesByTarget.opfs,
        state: "transferring",
        totalBytes: parsed.summary.bytesByTarget.opfs,
        verifiedBytes: parsed.summary.bytesByTarget.opfs,
      });
      const publicSnapshots: Array<
        Readonly<{
          installStore: ReturnType<typeof store.snapshot>;
          installerTransfer: InstallerTransferTelemetrySnapshot;
        }>
      > = [];
      const updatePublicTransfer = (partial: Partial<InstallerTransferTelemetrySnapshot>): void => {
        publicTransfer = Object.freeze({ ...publicTransfer, ...partial });
        publicSnapshots.push(
          Object.freeze({
            installStore: store.snapshot(),
            installerTransfer: publicTransfer,
          }),
        );
      };
      const unsubscribe = store.subscribe((snapshot) => {
        updatePublicTransfer({
          finalVerificationBytes: snapshot.finalVerificationBytes,
          finalVerificationPhase: snapshot.finalVerificationPhase,
          finalVerificationResourceCount: snapshot.finalVerificationResourceCount,
          finalVerificationTotalBytes: snapshot.finalVerificationTotalBytes,
          finalVerificationTotalResourceCount: snapshot.finalVerificationTotalResourceCount,
        });
      });
      const publicObserver = createInstallerRepairTransferObserver(
        {
          accumulate: (partial) => {
            publicTransfer = Object.freeze({ ...publicTransfer, ...partial });
          },
          snapshot: () => publicTransfer,
          update: updatePublicTransfer,
        },
        new Set(opfsResources.map((resource) => resource.id)),
        {
          releaseDigest: staged.releaseDigest,
          resourceCount: opfsResources.length,
          totalBytes: parsed.summary.bytesByTarget.opfs,
        },
      );
      const signal = new AbortController().signal;
      const transferPlatform: InstallerTransferPlatform = Object.freeze({
        clearTimeout: () => undefined,
        async fetch(url: string, init?: RequestInit) {
          expect(publicTransfer).toMatchObject({
            activeResourceCount: 1,
            activeResourceId: admittedResource.id,
          });
          expect(url).toBe(new URL(admittedResource.source, "https://example.test/").href);
          const headers = new Headers(init?.headers);
          rangeHeader = headers.get("range");
          ifRangeHeader = headers.get("if-range");
          const response = new Response(admittedBytes, {
            headers: {
              "content-length": String(admittedBytes.byteLength),
              "content-range": `bytes 0-${admittedBytes.byteLength - 1}/${admittedBytes.byteLength}`,
              etag: strongEtag,
            },
            status: 206,
          });
          Object.defineProperty(response, "url", { value: url });
          return response;
        },
        now: () => 0,
        setTimeout: () => 0,
        sleep: async () => undefined,
      });
      platform.resetMetrics();
      const request = {
        expectedReleaseDigest: admission.releaseDigest,
        kind: "repair",
        requestId: 1,
        shellEntrypointPath: buildManifest.artifacts.find(({ path }) =>
          /^immutable\/app-[a-f0-9]{64}\.js$/u.test(path),
        )?.path,
      };
      if (request.shellEntrypointPath === undefined) {
        throw new Error("Production app entrypoint is absent");
      }
      const result = await executeInstallerRepairWorkerOperation({
        admission,
        beginCompletion: () => {
          completionStarted = true;
        },
        identity,
        observer: publicObserver,
        request,
        signal,
        store,
        transferInput: {
          baseUrl: "https://example.test/",
          policy: {
            checkpointBytes: 8 * 1024 * 1024,
            concurrency: 1,
            requestTimeoutMs: 30_000,
          },
          releaseDigest: staged.releaseDigest,
          repairState: createInstallerRepairState(),
          resources,
          signal,
        },
        transferPlatform,
      });
      publicTransfer = Object.freeze({
        ...publicTransfer,
        activeRequestId: null,
        activeReleaseDigest: result.releaseDigest,
        state: "ready",
      });
      const workerResponse = parseInstallerResponse(
        createInstallerRepairCompleteResponse(request, result),
      );
      const repairMetrics = platform.metrics();
      expect(completionStarted).toBe(true);
      expect(rangeHeader).toBe("bytes=0-");
      expect(ifRangeHeader).toBeNull();
      expect(repairMetrics.sourceReadBytes).toBe(
        3 * (parsed.summary.bytesByTarget.opfs - admittedResource.bytes),
      );
      expect(repairMetrics.sourceReadOperations).toBe(3 * (opfsResources.length - 1));
      expect(repairMetrics.distinctSourcePaths).toBe(opfsResources.length - 1);
      expect(repairMetrics.distinctVerifiedMarkerPaths).toBe(opfsResources.length);
      expect(workerResponse).toEqual({
        kind: "install-complete",
        readyBytes: parsed.summary.bytesByTarget.opfs,
        readyResourceCount: opfsResources.length,
        releaseDigest: staged.releaseDigest,
        requestId: 1,
      });
      expect(publicTransfer).toMatchObject({
        activeReleaseDigest: staged.releaseDigest,
        activeRequestId: null,
        activeResourceCount: 0,
        activeResourceId: null,
        downloadedBytes: admittedResource.bytes,
        failureCode: null,
        finalVerificationBytes: parsed.summary.bytesByTarget.opfs,
        finalVerificationPhase: "complete",
        finalVerificationResourceCount: opfsResources.length,
        finalVerificationTotalBytes: parsed.summary.bytesByTarget.opfs,
        finalVerificationTotalResourceCount: opfsResources.length,
        hashedBytes: admittedResource.bytes,
        httpRequestCount: 1,
        integrityFailureCount: 0,
        operationRepairAttemptCount: 1,
        operationRepairedBytes: admittedResource.bytes,
        operationRepairedResourceCount: 1,
        plannedDownloadBytes: admittedResource.bytes,
        rangeRequestCount: 1,
        reusedBytes: parsed.summary.bytesByTarget.opfs - admittedResource.bytes,
        state: "ready",
      });
      expect(publicSnapshots.length).toBeGreaterThan(0);
      expect(await store.getSelection()).toEqual({
        activeReleaseDigest: staged.releaseDigest,
        previousReleaseDigest: null,
      });
      expect(await exactPublicationMetadata(platform, staged.releaseDigest)).toEqual(
        baselineMetadata,
      );
      expect(store.snapshot()).toMatchObject({
        activeReleaseDigest: staged.releaseDigest,
        integrityFailures: 1,
        publicationCount: 1,
        readyReleaseCount: 1,
        verifiedObjectBytes: parsed.summary.bytesByTarget.opfs,
        verifiedObjectCount: opfsResources.length,
      });
      expect(publicTransfer.finalVerificationBytes).toBe(store.snapshot().finalVerificationBytes);
      expect(publicTransfer.finalVerificationResourceCount).toBe(
        store.snapshot().finalVerificationResourceCount,
      );
      unsubscribe();

      const secondResource = opfsResources[0];
      if (secondResource === undefined || secondResource.id === admittedResource.id) {
        throw new Error("Second production corruption resource is absent");
      }
      const secondReference = await store.getResource(staged.releaseDigest, secondResource.id);
      const secondMarkerPath = secondReference.path.replace(/\.data$/u, ".verified.json");
      const secondMarkerBefore = await platform.read(secondMarkerPath);
      expect(secondMarkerBefore).not.toBeNull();
      platform.replaceWithOwned(admittedReference.path, corruptBytes);
      await expect(store.verifyObject(admittedReference)).resolves.toMatchObject({ ok: false });
      const eligibilityPath = `${INSTALL_STORE_ROOT}/releases/${staged.releaseDigest}/repair-eligibility.json`;
      const eligibilityBeforeSecondCorruption = await platform.read(eligibilityPath);
      expect(eligibilityBeforeSecondCorruption).not.toBeNull();
      const secondBytes = new Uint8Array(
        await readFile(productionResourceSource(repositoryRoot, secondResource)),
      );
      secondBytes[0] = (secondBytes[0] ?? 0) ^ 0xff;
      platform.replaceWithOwned(secondReference.path, secondBytes);
      await expect(store.admitRepairRelease(staged.releaseDigest)).rejects.toThrow(
        /corrupt resource|unverified resource/u,
      );
      expect(await platform.read(eligibilityPath)).toEqual(eligibilityBeforeSecondCorruption);
      expect(await platform.read(secondMarkerPath)).toEqual(secondMarkerBefore);

      const finalReport = {
        elapsedMs: Math.round(performance.now() - startedAt),
        manifestSha256: bytesToHex(sha256(installManifestBytes)),
        opfsBytes: parsed.summary.bytesByTarget.opfs,
        opfsResourceCount: parsed.summary.countByTarget.opfs,
        resourceIdentitySha256: bytesToHex(sha256(encoder.encode(JSON.stringify(opfsResources)))),
        sourceReadBytes:
          parsed.summary.bytesByTarget.opfs +
          admissionMetrics.sourceReadBytes +
          repairMetrics.sourceReadBytes,
      };
      console.info(`exact-production-store-replay@1 ${JSON.stringify(finalReport)}`);
    },
    30 * 60_000,
  );
});

interface SourceBackedMetrics {
  readonly distinctSourcePaths: number;
  readonly distinctVerifiedMarkerPaths: number;
  readonly sourceReadBytes: number;
  readonly sourceReadOperations: number;
}

interface SourceBackedInstallStorePlatform extends InstallStorePlatform {
  bindSource(path: string, sourcePath: string, bytes: number): void;
  metrics(): SourceBackedMetrics;
  replaceWithOwned(path: string, bytes: Uint8Array): void;
  resetMetrics(): void;
}

interface SourceBackedState {
  active: boolean;
  readonly owned: Map<string, Uint8Array>;
  readonly queue: Array<() => Promise<void>>;
  sourceReadBytes: number;
  sourceReadOperations: number;
  readonly sourceReadPaths: Set<string>;
  readonly sources: Map<string, Readonly<{ bytes: number; sourcePath: string }>>;
  readonly verifiedMarkerReadPaths: Set<string>;
}

function createSourceBackedInstallStorePlatform(): SourceBackedInstallStorePlatform {
  const state: SourceBackedState = {
    active: false,
    owned: new Map(),
    queue: [],
    sourceReadBytes: 0,
    sourceReadOperations: 0,
    sourceReadPaths: new Set(),
    sources: new Map(),
    verifiedMarkerReadPaths: new Set(),
  };
  const hasPath = (path: string): boolean => state.owned.has(path) || state.sources.has(path);
  const entries = async (
    directory: string,
    recursive: boolean,
  ): Promise<readonly InstallStorePlatformEntry[]> => {
    const result = new Map<string, InstallStorePlatformEntry>();
    const prefix = `${directory}/`;
    for (const path of new Set([...state.owned.keys(), ...state.sources.keys()])) {
      if (!path.startsWith(prefix)) continue;
      const segments = path.slice(prefix.length).split("/");
      const filePath = recursive ? path : `${directory}/${segments[0]}`;
      if (!recursive && segments.length > 1) {
        result.set(filePath, { kind: "directory", path: filePath, size: 0 });
        continue;
      }
      if (recursive) {
        for (let depth = 1; depth < segments.length; depth += 1) {
          const directoryPath = `${directory}/${segments.slice(0, depth).join("/")}`;
          result.set(directoryPath, { kind: "directory", path: directoryPath, size: 0 });
        }
      }
      result.set(filePath, {
        kind: "file",
        path: filePath,
        size:
          state.owned.get(path)?.byteLength ??
          state.sources.get(path)?.bytes ??
          (() => {
            throw new Error(`Source-backed entry disappeared: ${path}`);
          })(),
      });
    }
    return [...result.values()].sort((left, right) => left.path.localeCompare(right.path));
  };
  const platform: SourceBackedInstallStorePlatform = {
    async append(path, expectedOffset, bytes) {
      assertInstallStorePath(path);
      const current = state.owned.get(path) ?? new Uint8Array();
      if (state.sources.has(path) || current.byteLength !== expectedOffset) {
        throw new Error("Source-backed append offset mismatch");
      }
      const next = new Uint8Array(current.byteLength + bytes.byteLength);
      next.set(current);
      next.set(bytes, current.byteLength);
      state.owned.set(path, next);
      return bytes.byteLength;
    },
    bindSource(path, sourcePath, bytes) {
      assertInstallStorePath(path);
      if (hasPath(path)) throw new Error(`Source-backed path is already bound: ${path}`);
      state.sources.set(path, Object.freeze({ bytes, sourcePath }));
    },
    async flush(path) {
      assertInstallStorePath(path);
      if (!hasPath(path)) throw new InstallStorePathNotFoundError(path);
    },
    async list(directory: string, options?: InstallStoreListOptions) {
      assertInstallStorePath(directory);
      return entries(directory, options?.recursive === true);
    },
    metrics() {
      return Object.freeze({
        distinctSourcePaths: state.sourceReadPaths.size,
        distinctVerifiedMarkerPaths: state.verifiedMarkerReadPaths.size,
        sourceReadBytes: state.sourceReadBytes,
        sourceReadOperations: state.sourceReadOperations,
      });
    },
    now: () => performance.now(),
    async probe(bytes) {
      const path = `${INSTALL_STORE_ROOT}/source-backed-quota-probe.bin`;
      await platform.remove(path);
      await platform.append(path, 0, bytes);
      await platform.flush(path);
      await platform.remove(path);
    },
    async read(path) {
      assertInstallStorePath(path);
      const owned = state.owned.get(path);
      if (owned !== undefined) {
        if (path.endsWith(".verified.json")) state.verifiedMarkerReadPaths.add(path);
        return owned.slice();
      }
      const source = state.sources.get(path);
      return source === undefined ? null : new Uint8Array(await readFile(source.sourcePath));
    },
    async *readChunks(path, chunkBytes) {
      assertInstallStorePath(path);
      if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
        throw new Error("Source-backed read chunk size is invalid");
      }
      const owned = state.owned.get(path);
      if (owned !== undefined) {
        for (let offset = 0; offset < owned.byteLength; offset += chunkBytes) {
          yield owned.slice(offset, Math.min(owned.byteLength, offset + chunkBytes));
        }
        return;
      }
      const source = state.sources.get(path);
      if (source === undefined) throw new InstallStorePathNotFoundError(path);
      state.sourceReadOperations += 1;
      state.sourceReadPaths.add(path);
      const handle = await open(source.sourcePath, "r");
      let observed = 0;
      try {
        const buffer = Buffer.allocUnsafe(Math.min(chunkBytes, source.bytes));
        while (observed < source.bytes) {
          const expected = Math.min(buffer.byteLength, source.bytes - observed);
          const { bytesRead } = await handle.read(buffer, 0, expected, observed);
          if (bytesRead === 0) break;
          observed += bytesRead;
          state.sourceReadBytes += bytesRead;
          yield new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead).slice();
        }
      } finally {
        await handle.close();
      }
      if (observed !== source.bytes) {
        throw new Error(
          `Source-backed read length ${observed} differs from expected ${source.bytes}: ${path}`,
        );
      }
    },
    async remove(path, recursive = false) {
      assertInstallStorePath(path);
      if (recursive) {
        for (const candidate of [...state.owned.keys(), ...state.sources.keys()]) {
          if (candidate === path || candidate.startsWith(`${path}/`)) {
            state.owned.delete(candidate);
            state.sources.delete(candidate);
          }
        }
        return;
      }
      state.owned.delete(path);
      state.sources.delete(path);
    },
    replaceWithOwned(path, bytes) {
      assertInstallStorePath(path);
      if (!hasPath(path)) throw new InstallStorePathNotFoundError(path);
      state.sources.delete(path);
      state.owned.set(path, bytes.slice());
    },
    resetMetrics() {
      state.sourceReadBytes = 0;
      state.sourceReadOperations = 0;
      state.sourceReadPaths.clear();
      state.verifiedMarkerReadPaths.clear();
    },
    runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolvePromise, rejectPromise) => {
        state.queue.push(async () => {
          try {
            resolvePromise(await operation());
          } catch (error: unknown) {
            rejectPromise(error);
          }
        });
        drainSourceBackedQueue(state);
      });
    },
    async size(path) {
      assertInstallStorePath(path);
      return state.owned.get(path)?.byteLength ?? state.sources.get(path)?.bytes ?? null;
    },
    async truncate(path, bytes) {
      assertInstallStorePath(path);
      const current = state.owned.get(path);
      if (
        current === undefined ||
        !Number.isSafeInteger(bytes) ||
        bytes < 0 ||
        bytes > current.byteLength
      ) {
        throw new Error("Source-backed truncate is invalid");
      }
      state.owned.set(path, current.slice(0, bytes));
    },
    async writeRecord(path, bytes) {
      assertInstallStorePath(path);
      state.sources.delete(path);
      state.owned.set(path, bytes.slice());
    },
  };
  return Object.freeze(platform);
}

function drainSourceBackedQueue(state: SourceBackedState): void {
  if (state.active) return;
  const next = state.queue.shift();
  if (next === undefined) return;
  state.active = true;
  void next().finally(() => {
    state.active = false;
    drainSourceBackedQueue(state);
  });
}

function productionObjectPath(resource: InstallResource): string {
  if (resource.scope !== "common" && resource.scope !== "game-specific") {
    throw new Error(`Production OPFS resource scope is invalid: ${resource.id}`);
  }
  const namespace = resource.scope === "common" ? "objects/common" : "objects/games/parallax";
  return (
    `${INSTALL_STORE_ROOT}/${namespace}/sha256/${resource.sha256.slice(0, 2)}/` +
    `${resource.sha256}.data`
  );
}

function productionResourceSource(repositoryRoot: string, resource: InstallResource): string {
  const model = APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.find(
    (candidate) => candidate.sha256 === resource.sha256,
  );
  return model === undefined
    ? resolve(repositoryRoot, "dist", resource.source)
    : join(
        homedir(),
        ".parallax",
        "harness",
        "models",
        "gemma-4-E2B-it-qat-GGUF-66a399f6",
        model.path,
      );
}

async function exactPublicationMetadata(
  platform: InstallStorePlatform,
  releaseDigest: string,
): Promise<readonly Readonly<{ bytes: number; path: string; sha256: string }>[]> {
  const releaseEntries = await platform.list(`${INSTALL_STORE_ROOT}/releases/${releaseDigest}`, {
    recursive: true,
  });
  const commitEntries = await platform.list(`${INSTALL_STORE_ROOT}/commits`, {
    recursive: true,
  });
  const files = [...releaseEntries, ...commitEntries]
    .filter((entry) => entry.kind === "file")
    .sort((left, right) => left.path.localeCompare(right.path));
  return Promise.all(
    files.map(async ({ path, size }) => {
      const bytes = await platform.read(path);
      if (bytes === null) throw new Error(`Publication metadata disappeared: ${path}`);
      expect(bytes.byteLength).toBe(size);
      return Object.freeze({ bytes: size, path, sha256: bytesToHex(sha256(bytes)) });
    }),
  );
}

async function runRepairOperation(input: {
  readonly admission: InstallerRepairAdmission;
  readonly bytes: Uint8Array;
  readonly observer: InstallerTransferObserver;
  readonly resources: readonly InstallResource[];
  readonly store: InstallerRepairOperationStore;
}): Promise<void> {
  const resource = input.resources.find((candidate) => candidate.id === input.admission.resourceId);
  if (resource === undefined) throw new Error("Repair operation resource is absent");
  const signal = new AbortController().signal;
  const transferPlatform: InstallerTransferPlatform = Object.freeze({
    clearTimeout: () => undefined,
    async fetch(url: string, init?: RequestInit) {
      expect(url).toBe(new URL(resource.source, "https://example.test/").href);
      expect(new Headers(init?.headers).get("range")).toBe("bytes=0-");
      expect(new Headers(init?.headers).get("if-range")).toBeNull();
      const response = new Response(new Uint8Array(input.bytes).buffer, {
        headers: {
          "content-length": String(input.bytes.byteLength),
          "content-range": `bytes 0-${input.bytes.byteLength - 1}/${input.bytes.byteLength}`,
          etag: strongEtag,
        },
        status: 206,
      });
      Object.defineProperty(response, "url", { value: url });
      return response;
    },
    now: () => 0,
    setTimeout: () => 0,
    sleep: async () => undefined,
  });
  const manifestBytes = encoder.encode(
    `${JSON.stringify({
      gameId: "parallax",
      resources: input.resources,
      schemaVersion: 1,
    })}\n`,
  );
  const identity: InstallerManifestIdentity = Object.freeze({
    buildManifest: Object.freeze({}) as InstallerManifestIdentity["buildManifest"],
    installManifest: parseInstallManifestDocument(
      JSON.parse(new TextDecoder().decode(manifestBytes)),
    ),
    installManifestBytes: manifestBytes,
    releaseDigest: input.admission.releaseDigest,
  });
  const result = await executeInstallerRepairWorkerOperation({
    admission: input.admission,
    beginCompletion: () => undefined,
    identity,
    observer: input.observer,
    request: {
      expectedReleaseDigest: input.admission.releaseDigest,
      kind: "repair",
      requestId: 1,
      shellEntrypointPath: `immutable/app-${"a".repeat(64)}.js`,
    },
    signal,
    store: input.store,
    transferInput: {
      baseUrl: "https://example.test/",
      policy: { checkpointBytes: 8, concurrency: 1, requestTimeoutMs: 1_000 },
      releaseDigest: input.admission.releaseDigest,
      repairState: createInstallerRepairState(),
      resources: input.resources,
      signal,
    },
    transferPlatform,
  });
  expect(result).toEqual({
    readyBytes: input.resources.reduce((total, candidate) => total + candidate.bytes, 0),
    readyResourceCount: input.resources.length,
    releaseDigest: input.admission.releaseDigest,
  });
}

function fixtureTransferPlatform(
  resources: readonly InstallResource[],
  fixtures: readonly Readonly<{ bytes: Uint8Array; id: string }>[],
): InstallerTransferPlatform {
  return Object.freeze({
    clearTimeout: () => undefined,
    async fetch(url: string, init?: RequestInit) {
      const resource = resources.find(
        (candidate) => new URL(candidate.source, "https://example.test/").href === url,
      );
      const fixture = fixtures.find((candidate) => candidate.id === resource?.id);
      if (resource === undefined || fixture === undefined) {
        throw new Error("Unexpected fixture transfer resource");
      }
      const offset = Number(
        new Headers(init?.headers).get("range")?.match(/^bytes=([0-9]+)-$/u)?.[1] ?? 0,
      );
      const body = fixture.bytes.slice(offset);
      const response = new Response(body, {
        headers: {
          "content-length": String(body.byteLength),
          "content-range": `bytes ${String(offset)}-${String(resource.bytes - 1)}/${String(resource.bytes)}`,
          etag: strongEtag,
        },
        status: 206,
      });
      Object.defineProperty(response, "url", { value: url });
      return response;
    },
    now: () => 0,
    setTimeout: () => 0,
    sleep: async () => undefined,
  });
}

function sharedRepairTelemetry(
  resources: readonly InstallResource[],
  totalBytes: number,
  lifetime: "restarted" | "same-worker",
  releaseDigest = "a".repeat(64),
): Readonly<{
  observer: InstallerTransferObserver;
  snapshot: () => InstallerTransferTelemetrySnapshot;
}> {
  let snapshot: InstallerTransferTelemetrySnapshot = Object.freeze({
    ...idleInstallerTransferTelemetrySnapshot(1, 8),
    activeReleaseDigest: releaseDigest,
    activeRequestId: 1,
    completedResourceCount: lifetime === "same-worker" ? resources.length : 0,
    resourceCount: resources.length,
    reusedBytes: totalBytes,
    state: "transferring",
    totalBytes,
    verifiedBytes: lifetime === "same-worker" ? totalBytes : 0,
  });
  const accumulate = (partial: Partial<InstallerTransferTelemetrySnapshot>): void => {
    snapshot = Object.freeze({ ...snapshot, ...partial });
  };
  return Object.freeze({
    observer: createInstallerRepairTransferObserver(
      {
        accumulate,
        snapshot: () => snapshot,
        update: accumulate,
      },
      new Set(resources.map(({ id }) => id)),
      lifetime === "same-worker"
        ? {
            releaseDigest,
            resourceCount: resources.length,
            totalBytes,
          }
        : null,
    ),
    snapshot: () => snapshot,
  });
}
