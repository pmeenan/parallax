import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import {
  INSTALL_MANIFEST_SCHEMA_VERSION,
  type InstallResource,
} from "../src/storage/install-manifest";
import { createOpfsReleaseStore, type OpfsReleaseStore } from "../src/storage/opfs-release-store";
import { InstallStoreIntegrityError } from "../src/storage/opfs-release-store-contract";
import {
  createDirectoryPersistentMemoryInstallStorePlatform,
  createMemoryInstallStorePlatform,
  type InstallStoreListOptions,
  InstallStorePathChangedError,
  type MemoryInstallStorePlatform,
} from "../src/storage/opfs-release-store-platform";

const encoder = new TextEncoder();
const HELLO = encoder.encode("hello");
const WORLD = encoder.encode("world");
const THIRD = encoder.encode("third");
const HELLO_SHA = bytesToHex(sha256(HELLO));
const STRONG_ETAG = '"test-etag"';

describe("crash-safe OPFS release store", () => {
  it("stages the live manifest schema authority in its durable record", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "schema.bin", HELLO));
    const record = await platform.read(
      `parallax-install-v1/releases/${staged.releaseDigest}/staged.json`,
    );
    if (record === null) throw new Error("Staged release omitted its durable record");
    expect(JSON.parse(new TextDecoder().decode(record))).toMatchObject({
      installManifestSchemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
      releaseDigest: staged.releaseDigest,
    });
  });

  it("retains typed primary and cleanup failures and recovers corrupt partial cleanup idempotently", async () => {
    const memory = createMemoryInstallStorePlatform();
    let failCleanup = true;
    const platform: MemoryInstallStorePlatform = {
      ...memory,
      async remove(path, recursive) {
        if (failCleanup && path.includes("/partials/") && recursive === true) {
          throw new Error("injected partial cleanup failure");
        }
        await memory.remove(path, recursive);
      },
    };
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "cleanup.bin", HELLO));
    await store.appendPartial({
      bytes: WORLD,
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    const failure = await store
      .finalizePartial(staged.releaseDigest, "test-asset")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InstallStoreIntegrityError);
    expect((failure as Error).cause).toBeInstanceOf(AggregateError);
    expect(((failure as Error).cause as AggregateError).errors).toHaveLength(2);

    failCleanup = false;
    await expect(store.finalizePartial(staged.releaseDigest, "test-asset")).rejects.toBeInstanceOf(
      InstallStoreIntegrityError,
    );
    expect(
      await memory.list(`parallax-install-v1/partials/${staged.releaseDigest}/test-asset`, {
        recursive: true,
      }),
    ).toEqual([]);
  });

  it("admits only the active release while fully revalidating exact re-admission", async () => {
    const resourceCount = 64;
    const platform = createMemoryInstallStorePlatform();
    const setupStore = createOpfsReleaseStore(platform);
    const previousFixture = manyResourceManifest(resourceCount, "previous");
    const previousDigest = await installMany(setupStore, previousFixture);
    await setupStore.publishRelease(previousDigest);
    const activeFixture = manyResourceManifest(resourceCount, "active");
    const activeDigest = await installMany(setupStore, activeFixture);
    await setupStore.publishRelease(activeDigest);

    const measurementPlatform = platform.reconstruct();
    const markerReads: string[] = [];
    const manifestOperations: string[] = [];
    const countingPlatform: MemoryInstallStorePlatform = Object.freeze({
      ...measurementPlatform,
      async read(path: string) {
        if (path.endsWith(".verified.json")) markerReads.push(path);
        return measurementPlatform.read(path);
      },
    });
    const runtimeStore = createOpfsReleaseStore(countingPlatform, {
      record: (operation) => manifestOperations.push(operation),
    });
    const activeMarkerPaths = new Set(
      activeFixture.resources.map(
        ({ sha256: digest }) =>
          `parallax-install-v1/objects/games/parallax/sha256/${digest.slice(0, 2)}/${digest}.verified.json`,
      ),
    );

    await expect(runtimeStore.admitActiveRelease(activeDigest)).resolves.toMatchObject({
      gameId: "parallax",
    });
    expect(markerReads).toHaveLength(resourceCount);
    expect(new Set(markerReads)).toEqual(activeMarkerPaths);
    expect(manifestOperations).toEqual(["manifest-hash", "manifest-parse"]);

    const secondAdmissionStart = markerReads.length;
    await expect(runtimeStore.admitActiveRelease(activeDigest)).resolves.toMatchObject({
      gameId: "parallax",
    });
    expect(markerReads.slice(secondAdmissionStart)).toHaveLength(resourceCount);
    expect(new Set(markerReads.slice(secondAdmissionStart))).toEqual(activeMarkerPaths);
    expect(manifestOperations).toEqual([
      "manifest-hash",
      "manifest-parse",
      "manifest-hash",
      "manifest-parse",
    ]);

    const activeManifestPath = `parallax-install-v1/releases/${activeDigest}/install-manifest.json`;
    countingPlatform.seedExternalFile(activeManifestPath, encoder.encode("{}"));
    await expect(runtimeStore.admitActiveRelease(activeDigest)).rejects.toThrow(
      "not the exact active selection",
    );
    countingPlatform.seedExternalFile(activeManifestPath, activeFixture.manifest);
    await expect(runtimeStore.admitActiveRelease(activeDigest)).resolves.toMatchObject({
      gameId: "parallax",
    });

    const firstActiveMarker = [...activeMarkerPaths][0];
    if (firstActiveMarker === undefined) throw new Error("Active fixture has no marker");
    await countingPlatform.remove(firstActiveMarker);
    await expect(runtimeStore.admitActiveRelease(activeDigest)).rejects.toThrow(
      "not the exact active selection",
    );
  });

  it("reports only validated active authority without consuming or publishing rollback state", async () => {
    const resourceCount = 16;
    const platform = createMemoryInstallStorePlatform();
    const setupStore = createOpfsReleaseStore(platform);
    const previousFixture = manyResourceManifest(resourceCount, "status-previous");
    const previousDigest = await installMany(setupStore, previousFixture);
    await setupStore.publishRelease(previousDigest);
    const activeFixture = manyResourceManifest(resourceCount, "status-active");
    const activeDigest = await installMany(setupStore, activeFixture);
    await setupStore.publishRelease(activeDigest);

    const measurementPlatform = platform.reconstruct();
    const markerReads: string[] = [];
    const countingPlatform: MemoryInstallStorePlatform = Object.freeze({
      ...measurementPlatform,
      async read(path: string) {
        if (path.endsWith(".verified.json")) markerReads.push(path);
        return measurementPlatform.read(path);
      },
    });
    const store = createOpfsReleaseStore(countingPlatform);
    const activePaths = resourcePaths(activeFixture);
    const previousPaths = resourcePaths(previousFixture);

    await expect(store.getActiveReleaseDigest()).resolves.toBe(activeDigest);
    expect(new Set(markerReads)).toEqual(new Set(activePaths.map(({ marker }) => marker)));
    expect(store.snapshot()).toMatchObject({
      activeReleaseDigest: null,
      previousReleaseDigest: null,
    });

    countingPlatform.seedExternalFile(
      `parallax-install-v1/commits/00000000000000000003-${"f".repeat(64)}.json`,
      encoder.encode('{"ordinal":3'),
    );
    markerReads.length = 0;
    await expect(store.getActiveReleaseDigest()).resolves.toBe(activeDigest);
    expect(new Set(markerReads)).toEqual(new Set(activePaths.map(({ marker }) => marker)));

    const previousMarker = previousPaths[0];
    if (previousMarker === undefined) throw new Error("Previous fixture has no resource");
    await countingPlatform.remove(previousMarker.marker);
    markerReads.length = 0;
    await expect(store.getActiveReleaseDigest()).resolves.toBe(activeDigest);
    expect(new Set(markerReads)).toEqual(new Set(activePaths.map(({ marker }) => marker)));

    const activeManifestPath = `parallax-install-v1/releases/${activeDigest}/install-manifest.json`;
    countingPlatform.seedExternalFile(activeManifestPath, encoder.encode("{}"));
    await expect(store.getActiveReleaseDigest()).resolves.not.toBe(activeDigest);
    countingPlatform.seedExternalFile(activeManifestPath, activeFixture.manifest);

    const activeResource = activePaths[0];
    if (activeResource === undefined) throw new Error("Active fixture has no resource");
    const activeMarkerBytes = await countingPlatform.read(activeResource.marker);
    if (activeMarkerBytes === null) throw new Error("Active fixture marker is missing");
    await countingPlatform.remove(activeResource.marker);
    await expect(store.getActiveReleaseDigest()).resolves.not.toBe(activeDigest);
    countingPlatform.seedExternalFile(activeResource.marker, activeMarkerBytes);

    await countingPlatform.remove(activeResource.data);
    await expect(store.getActiveReleaseDigest()).resolves.not.toBe(activeDigest);
  });

  it("keeps checkpoint append and resource finalization inventory work O(1)", async () => {
    const manifestOperations: string[] = [];
    const bytes = Uint8Array.from({ length: 400 }, (_, index) => index % 251);
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform, {
      record: (operation) => manifestOperations.push(operation),
    });
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", bytes));
    manifestOperations.length = 0;
    const platformOperationStart = platform.operationLog.length;
    for (let offset = 0; offset < bytes.byteLength; offset += 1) {
      await store.appendPartial({
        bytes: bytes.slice(offset, offset + 1),
        expectedOffset: offset,
        releaseDigest: staged.releaseDigest,
        resourceId: "test-asset",
        strongEtag: STRONG_ETAG,
      });
    }
    const appendOperations = platform.operationLog.slice(platformOperationStart);
    expect(manifestOperations).toEqual([]);
    expect(
      appendOperations.filter((operation) => operation.includes("/install-manifest.json")),
    ).toHaveLength(0);
    expect(
      appendOperations.filter(
        (operation) => operation.startsWith("list:") && operation.endsWith(":recursive"),
      ),
    ).toHaveLength(0);
    expect(appendOperations.filter((operation) => operation.startsWith("list:"))).toHaveLength(
      400 * 4,
    );
    const finalizeOperationStart = platform.operationLog.length;
    await store.finalizePartial(staged.releaseDigest, "test-asset");
    expect(manifestOperations).toEqual([]);
    expect(
      platform.operationLog
        .slice(finalizeOperationStart)
        .filter((operation) => operation.includes("/install-manifest.json")),
    ).toHaveLength(0);
    expect(store.snapshot()).toMatchObject({
      currentCheckpointCount: 0,
      etagBoundPartialCount: 0,
      partialBytes: 0,
      partialResourceCount: 0,
      verifiedObjectBytes: bytes.byteLength,
      verifiedObjectCount: 1,
    });
  });

  it("finalizes hundreds of resources with linear local inventory operations", async () => {
    const resourceCount = 200;
    const fixture = manyResourceManifest(resourceCount);
    const manifestOperations: string[] = [];
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform, {
      record: (operation) => manifestOperations.push(operation),
    });
    const staged = await store.stageRelease(fixture.manifest);
    manifestOperations.length = 0;
    const platformOperationStart = platform.operationLog.length;
    for (const resource of fixture.resources) {
      await store.appendPartial({
        bytes: resource.bytes,
        expectedOffset: 0,
        releaseDigest: staged.releaseDigest,
        resourceId: resource.id,
        strongEtag: STRONG_ETAG,
      });
      await store.finalizePartial(staged.releaseDigest, resource.id);
    }
    const localOperations = platform.operationLog.slice(platformOperationStart);
    expect(manifestOperations).toEqual([]);
    expect(
      localOperations.filter((operation) => operation.includes("/install-manifest.json")),
    ).toHaveLength(0);
    expect(
      localOperations.filter(
        (operation) => operation.startsWith("list:") && operation.endsWith(":recursive"),
      ),
    ).toHaveLength(0);
    expect(localOperations.filter((operation) => operation.startsWith("list:")).length).toBe(
      resourceCount * 7,
    );
    expect(store.snapshot()).toMatchObject({
      partialResourceCount: 0,
      verifiedObjectCount: resourceCount,
    });
  });

  it("reconciliation repairs inventory drift after a crash and reopen", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    platform.setFault({ kind: "fail-after", operation: 3 });
    await expect(
      store.appendPartial({
        bytes: HELLO.slice(0, 2),
        expectedOffset: 0,
        releaseDigest: staged.releaseDigest,
        resourceId: "test-asset",
        strongEtag: STRONG_ETAG,
      }),
    ).rejects.toThrow();
    expect(store.snapshot()).toMatchObject({
      currentCheckpointCount: 1,
      partialBytes: 2,
      partialResourceCount: 1,
    });
    platform.clearFault();
    const reopened = createOpfsReleaseStore(platform.reconstruct());
    await reopened.reconcile();
    expect(reopened.snapshot()).toMatchObject({
      currentCheckpointCount: 1,
      etagBoundPartialCount: 1,
      partialBytes: 2,
      partialResourceCount: 1,
    });
  });

  it("keeps reconciled checkpoint metadata exact through append, finalize, and discard deltas", async () => {
    const platform = createMemoryInstallStorePlatform();
    const fixture = manyResourceManifest(2, "inventory-delta");
    const stagingStore = createOpfsReleaseStore(platform);
    const staged = await stagingStore.stageRelease(fixture.manifest);
    for (const target of fixture.resources) {
      await stagingStore.appendPartial({
        bytes: target.bytes.slice(0, 4),
        expectedOffset: 0,
        releaseDigest: staged.releaseDigest,
        resourceId: target.id,
        strongEtag: STRONG_ETAG,
      });
    }

    const reopened = createOpfsReleaseStore(platform.reconstruct());
    await reopened.reconcile();
    expect(reopened.snapshot()).toMatchObject({
      currentCheckpointCount: 2,
      etagBoundPartialCount: 2,
      partialResourceCount: 2,
    });

    const finalized = fixture.resources[0];
    const discarded = fixture.resources[1];
    if (finalized === undefined || discarded === undefined) throw new Error("missing fixture");
    await reopened.appendPartial({
      bytes: finalized.bytes.slice(4),
      expectedOffset: 4,
      releaseDigest: staged.releaseDigest,
      resourceId: finalized.id,
      strongEtag: STRONG_ETAG,
    });
    await reopened.finalizePartial(staged.releaseDigest, finalized.id);
    expect(reopened.snapshot()).toMatchObject({
      currentCheckpointCount: 1,
      etagBoundPartialCount: 1,
      partialResourceCount: 1,
    });

    await reopened.appendPartial({
      bytes: discarded.bytes.slice(4, 6),
      expectedOffset: 4,
      releaseDigest: staged.releaseDigest,
      resourceId: discarded.id,
      strongEtag: STRONG_ETAG,
    });
    await reopened.discardPartial(staged.releaseDigest, discarded.id);
    expect(reopened.snapshot()).toMatchObject({
      currentCheckpointCount: 0,
      etagBoundPartialCount: 0,
      partialBytes: 0,
      partialResourceCount: 0,
    });
  });

  it("scopes a validated manifest cache to one session and invalidates it on reconciliation", async () => {
    const platform = createMemoryInstallStorePlatform();
    const manifest = manifestBytes("game-specific", "asset.bin", HELLO);
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifest);
    await expect(store.beginPartial(staged.releaseDigest, "test-asset")).resolves.toMatchObject({
      bytesCommitted: 0,
    });
    const manifestPath = `parallax-install-v1/releases/${staged.releaseDigest}/install-manifest.json`;
    platform.seedExternalFile(manifestPath, encoder.encode("{}"));

    await expect(store.beginPartial(staged.releaseDigest, "test-asset")).resolves.toMatchObject({
      bytesCommitted: 0,
    });
    await store.reconcile();
    await expect(store.beginPartial(staged.releaseDigest, "test-asset")).rejects.toThrow(
      "no exact install manifest",
    );

    const reopened = createOpfsReleaseStore(platform.reconstruct());
    await expect(reopened.beginPartial(staged.releaseDigest, "test-asset")).rejects.toThrow(
      "no exact install manifest",
    );
  });

  it("publishes monotonic final-release verification progress separately", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const releaseDigest = await install(
      store,
      platform,
      manifestBytes("game-specific", "asset.bin", HELLO),
      HELLO,
    );
    const progress: Array<ReturnType<typeof store.snapshot>> = [];
    const unsubscribe = store.subscribe((snapshot) => {
      if (snapshot.finalVerificationPhase !== "idle") progress.push(snapshot);
    });
    await expect(store.verifyRelease(releaseDigest)).resolves.toMatchObject({
      bytes: HELLO.byteLength,
      ok: true,
    });
    unsubscribe();
    expect(progress.at(0)).toMatchObject({
      finalVerificationBytes: 0,
      finalVerificationPhase: "verifying",
      finalVerificationResourceCount: 0,
      finalVerificationTotalBytes: HELLO.byteLength,
      finalVerificationTotalResourceCount: 1,
    });
    expect(progress.at(-1)).toMatchObject({
      finalVerificationBytes: HELLO.byteLength,
      finalVerificationPhase: "complete",
      finalVerificationResourceCount: 1,
    });
    for (let index = 1; index < progress.length; index += 1) {
      expect(progress[index]?.finalVerificationBytes).toBeGreaterThanOrEqual(
        progress[index - 1]?.finalVerificationBytes ?? 0,
      );
      expect(progress[index]?.finalVerificationResourceCount).toBeGreaterThanOrEqual(
        progress[index - 1]?.finalVerificationResourceCount ?? 0,
      );
    }
  });

  it("recounts a stable path-change retry without under-reporting final verification", async () => {
    const memory = createMemoryInstallStorePlatform();
    const installed = createOpfsReleaseStore(memory);
    const releaseDigest = await install(
      installed,
      memory,
      manifestBytes("game-specific", "asset.bin", HELLO),
      HELLO,
    );
    const base = memory.reconstruct();
    let injectPathChange = true;
    const platform: MemoryInstallStorePlatform = {
      ...base,
      async *readChunks(path, chunkBytes) {
        if (injectPathChange) {
          injectPathChange = false;
          yield HELLO.slice(0, 2);
          throw new InstallStorePathChangedError(path);
        }
        yield* base.readChunks(path, chunkBytes);
      },
    };
    const reopened = createOpfsReleaseStore(platform);
    const progress: number[] = [];
    reopened.subscribe((snapshot) => {
      if (snapshot.finalVerificationPhase !== "idle") {
        progress.push(snapshot.finalVerificationBytes);
      }
    });

    await expect(reopened.verifyRelease(releaseDigest)).resolves.toMatchObject({
      bytes: HELLO.byteLength,
      ok: true,
    });

    expect(reopened.snapshot()).toMatchObject({
      finalVerificationBytes: HELLO.byteLength,
      finalVerificationPhase: "complete",
      finalVerificationTotalBytes: HELLO.byteLength,
    });
    expect(progress).toContain(2);
    expect(progress.at(-1)).toBe(HELLO.byteLength);
    for (let index = 1; index < progress.length; index += 1) {
      expect(progress[index]).toBeGreaterThanOrEqual(progress[index - 1] ?? 0);
    }
  });

  it("batch-resolves ordered resources with O(1) manifest and staged-record reads", async () => {
    const small = await preparedBatchStore(1);
    const large = await preparedBatchStore(256);

    for (const fixture of [small, large]) {
      const references = await fixture.store.getResources(fixture.releaseDigest, fixture.ids);
      expect(references.map(({ resourceId }) => resourceId)).toEqual(fixture.ids);
      const releaseRoot = `parallax-install-v1/releases/${fixture.releaseDigest}`;
      expect(fixture.readCounts.get(`${releaseRoot}/install-manifest.json`)).toBe(1);
      expect(fixture.readCounts.get(`${releaseRoot}/staged.json`)).toBe(1);
      const reversedIds = [...fixture.ids].reverse();
      await expect(
        fixture.store.getResources(fixture.releaseDigest, reversedIds),
      ).resolves.toMatchObject(reversedIds.map((resourceId) => ({ resourceId })));
      const firstId = fixture.ids[0];
      if (firstId === undefined) throw new Error("Batch test has no first resource ID");
      await expect(
        fixture.store.getResources(fixture.releaseDigest, [firstId, firstId]),
      ).rejects.toThrow(/distinct resource IDs/);
      const first = references[0];
      if (first === undefined) throw new Error("Batch test has no first reference");
      fixture.platform.seedExternalFile(
        first.path.replace(/\.data$/, ".verified.json"),
        encoder.encode(
          `${JSON.stringify({
            bytes: first.bytes + 1,
            schemaVersion: 1,
            scope: first.scope,
            sha256: first.sha256,
          })}\n`,
        ),
      );
      await expect(fixture.store.getResources(fixture.releaseDigest, fixture.ids)).rejects.toThrow(
        /no exact verified object/,
      );
    }
  });

  it("stages, resumes, verifies, readies, publishes, and full-verifies incrementally", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const manifest = manifestBytes("game-specific", "asset.bin", HELLO);
    const staged = await store.stageRelease(manifest);

    expect(await store.beginPartial(staged.releaseDigest, "test-asset")).toMatchObject({
      bytesCommitted: 0,
      expectedBytes: 5,
    });
    await store.appendPartial({
      bytes: HELLO.slice(0, 2),
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    const reconstructed = createOpfsReleaseStore(platform.reconstruct());
    expect(await reconstructed.beginPartial(staged.releaseDigest, "test-asset")).toMatchObject({
      bytesCommitted: 2,
    });
    await reconstructed.appendPartial({
      bytes: HELLO.slice(2),
      expectedOffset: 2,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    const reference = await reconstructed.finalizePartial(staged.releaseDigest, "test-asset");
    expect(reference.path).toContain("/objects/games/parallax/");
    expect(await reconstructed.verifyObject(reference)).toEqual({
      bytes: 5,
      ok: true,
      sha256: HELLO_SHA,
    });
    await reconstructed.markReleaseReady(staged.releaseDigest);
    expect(await reconstructed.getSelection()).toEqual({
      activeReleaseDigest: null,
      previousReleaseDigest: null,
    });
    expect(await reconstructed.publishRelease(staged.releaseDigest)).toEqual({
      activeReleaseDigest: staged.releaseDigest,
      previousReleaseDigest: null,
    });
    expect(await reconstructed.verifyRelease(staged.releaseDigest)).toMatchObject({
      bytes: 5,
      ok: true,
    });
  });

  it("binds the first append to one strong ETag and rejects drift before writing", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    const first = await store.appendPartial({
      bytes: HELLO.slice(0, 2),
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    expect(first).toMatchObject({ bytesCommitted: 2, strongEtag: STRONG_ETAG });
    expect(store.snapshot()).toMatchObject({
      checkpointWriteCount: 1,
      currentCheckpointCount: 1,
      etagBoundPartialCount: 1,
      schemaVersion: 3,
    });
    await expect(
      store.appendPartial({
        bytes: HELLO.slice(2),
        expectedOffset: 2,
        releaseDigest: staged.releaseDigest,
        resourceId: "test-asset",
        strongEtag: '"changed"',
      }),
    ).rejects.toThrow("does not match");
    expect(await store.beginPartial(staged.releaseDigest, "test-asset")).toMatchObject({
      bytesCommitted: 2,
      strongEtag: STRONG_ETAG,
    });
  });

  it("invalidates a legacy checkpoint and truncates its partial to zero", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    await store.appendPartial({
      bytes: HELLO.slice(0, 2),
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    const root = `parallax-install-v1/partials/${staged.releaseDigest}/test-asset`;
    const checkpoint = `${root}/checkpoints/00000000000000000002.json`;
    await platform.writeRecord(
      checkpoint,
      encoder.encode(
        `${JSON.stringify({
          bytesCommitted: 2,
          expectedBytes: 5,
          expectedSha256: HELLO_SHA,
          releaseDigest: staged.releaseDigest,
          resourceId: "test-asset",
          schemaVersion: 1,
          source: "asset.bin",
        })}\n`,
      ),
    );

    expect(
      await createOpfsReleaseStore(platform.reconstruct()).prepareResource(
        staged.releaseDigest,
        "test-asset",
      ),
    ).toEqual({
      bytesCommitted: 0,
      expectedBytes: 5,
      state: "partial",
      strongEtag: null,
    });
    expect(await platform.size(`${root}/data.partial`)).toBe(0);
    expect(await platform.read(checkpoint)).toBeNull();

    const reconciled = createOpfsReleaseStore(platform.reconstruct());
    await reconciled.reconcile();
    expect(reconciled.snapshot()).toMatchObject({
      currentCheckpointCount: 0,
      etagBoundPartialCount: 0,
      partialBytes: 0,
      partialResourceCount: 1,
    });
    await reconciled.appendPartial({
      bytes: HELLO,
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    expect(reconciled.snapshot()).toMatchObject({
      currentCheckpointCount: 1,
      etagBoundPartialCount: 1,
      partialBytes: HELLO.byteLength,
      partialResourceCount: 1,
    });
    await reconciled.finalizePartial(staged.releaseDigest, "test-asset");
    expect(reconciled.snapshot()).toMatchObject({
      currentCheckpointCount: 0,
      etagBoundPartialCount: 0,
      partialBytes: 0,
      partialResourceCount: 0,
    });
  });

  it("keeps a zero-byte partial exact after invalid-checkpoint recovery through append and discard", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    await store.appendPartial({
      bytes: HELLO.slice(0, 2),
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    const root = `parallax-install-v1/partials/${staged.releaseDigest}/test-asset`;
    const checkpoint = `${root}/checkpoints/00000000000000000002.json`;
    await platform.writeRecord(checkpoint, encoder.encode("{invalid checkpoint"));

    const recovery = createOpfsReleaseStore(platform.reconstruct());
    await expect(recovery.prepareResource(staged.releaseDigest, "test-asset")).resolves.toEqual({
      bytesCommitted: 0,
      expectedBytes: HELLO.byteLength,
      state: "partial",
      strongEtag: null,
    });
    expect(await platform.size(`${root}/data.partial`)).toBe(0);
    expect(await platform.read(checkpoint)).toBeNull();

    const reconciled = createOpfsReleaseStore(platform.reconstruct());
    await reconciled.reconcile();
    expect(reconciled.snapshot()).toMatchObject({
      currentCheckpointCount: 0,
      etagBoundPartialCount: 0,
      partialBytes: 0,
      partialResourceCount: 1,
    });
    await reconciled.appendPartial({
      bytes: HELLO.slice(0, 2),
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    expect(reconciled.snapshot()).toMatchObject({
      currentCheckpointCount: 1,
      etagBoundPartialCount: 1,
      partialBytes: 2,
      partialResourceCount: 1,
    });
    await reconciled.discardPartial(staged.releaseDigest, "test-asset");
    expect(reconciled.snapshot()).toMatchObject({
      currentCheckpointCount: 0,
      etagBoundPartialCount: 0,
      partialBytes: 0,
      partialResourceCount: 0,
    });
  });

  it("recovers deterministically across every append/checkpoint mutation boundary", async () => {
    for (const kind of ["fail-before", "fail-after"] as const) {
      for (const operation of [1, 2, 3]) {
        const platform = createMemoryInstallStorePlatform();
        const store = createOpfsReleaseStore(platform);
        const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
        platform.setFault({ kind, operation });
        await expect(
          store.appendPartial({
            bytes: HELLO.slice(0, 2),
            expectedOffset: 0,
            releaseDigest: staged.releaseDigest,
            resourceId: "test-asset",
            strongEtag: STRONG_ETAG,
          }),
        ).rejects.toThrow();
        platform.clearFault();
        const recovered = await createOpfsReleaseStore(platform.reconstruct()).prepareResource(
          staged.releaseDigest,
          "test-asset",
        );
        expect(recovered).toMatchObject({
          bytesCommitted: kind === "fail-after" && operation === 3 ? 2 : 0,
          strongEtag: kind === "fail-after" && operation === 3 ? STRONG_ETAG : null,
        });
      }
    }

    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    platform.setFault({ kind: "torn-record", operation: 3 });
    await expect(
      store.appendPartial({
        bytes: HELLO.slice(0, 2),
        expectedOffset: 0,
        releaseDigest: staged.releaseDigest,
        resourceId: "test-asset",
        strongEtag: STRONG_ETAG,
      }),
    ).rejects.toThrow();
    platform.clearFault();
    expect(
      await createOpfsReleaseStore(platform.reconstruct()).prepareResource(
        staged.releaseDigest,
        "test-asset",
      ),
    ).toMatchObject({ bytesCommitted: 0, strongEtag: null });
  });

  it("plans missing, partial, and verified release resources exactly", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    expect(await store.planRelease(staged.releaseDigest)).toEqual({
      largestUnverifiedResourceBytes: 5,
      missingBytes: 5,
      missingResourceCount: 1,
      partialBytes: 0,
      partialResources: [],
      partialResourceCount: 0,
      reusedBytes: 0,
      reusedResourceIds: [],
      reusedResourceCount: 0,
      totalBytes: 5,
      totalResourceCount: 1,
    });
    await store.appendPartial({
      bytes: HELLO.slice(0, 2),
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    expect(await store.planRelease(staged.releaseDigest)).toMatchObject({
      largestUnverifiedResourceBytes: 5,
      missingBytes: 3,
      missingResourceCount: 0,
      partialBytes: 2,
      partialResources: [{ bytesCommitted: 2, resourceId: "test-asset" }],
      partialResourceCount: 1,
    });
    await store.appendPartial({
      bytes: HELLO.slice(2),
      expectedOffset: 2,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    const reference = await store.finalizePartial(staged.releaseDigest, "test-asset");
    expect(await store.prepareResource(staged.releaseDigest, "test-asset")).toEqual({
      bytesCommitted: 5,
      expectedBytes: 5,
      reference,
      state: "verified",
      strongEtag: null,
    });
    expect(await store.planRelease(staged.releaseDigest)).toEqual({
      largestUnverifiedResourceBytes: 0,
      missingBytes: 0,
      missingResourceCount: 0,
      partialBytes: 0,
      partialResources: [],
      partialResourceCount: 0,
      reusedBytes: 5,
      reusedResourceIds: ["test-asset"],
      reusedResourceCount: 1,
      totalBytes: 5,
      totalResourceCount: 1,
    });
  });

  it("performs a bounded flushed quota probe and reports quota denial without residue", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    await expect(store.probeQuota(0)).rejects.toThrow("must be positive");
    await expect(store.probeQuota(1024 * 1024 + 1)).rejects.toThrow("must not exceed");
    expect(await store.probeQuota(1024)).toEqual({ bytes: 1024, completed: true });
    expect(platform.operationLog).toEqual(
      expect.arrayContaining([
        "append:parallax-install-v1/quota-probe.bin",
        "flush:parallax-install-v1/quota-probe.bin",
        "remove:parallax-install-v1/quota-probe.bin",
      ]),
    );
    expect(await platform.size("parallax-install-v1/quota-probe.bin")).toBeNull();

    platform.setFault({ kind: "quota", operation: 2 });
    expect(await store.probeQuota(1024)).toEqual({ bytes: 1024, completed: false });
    platform.clearFault();
    expect(await platform.size("parallax-install-v1/quota-probe.bin")).toBeNull();
    expect(store.snapshot().quotaExceededCount).toBe(1);
  });

  it("truncates an uncheckpointed tail and rejects offset/source identity drift", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    await store.appendPartial({
      bytes: HELLO.slice(0, 2),
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    const dataPath = `parallax-install-v1/partials/${staged.releaseDigest}/test-asset/data.partial`;
    await platform.append(dataPath, 2, HELLO.slice(2));

    const recovered = createOpfsReleaseStore(platform.reconstruct());
    expect(await recovered.beginPartial(staged.releaseDigest, "test-asset")).toMatchObject({
      bytesCommitted: 2,
    });
    expect(await platform.size(dataPath)).toBe(2);
    await expect(
      recovered.appendPartial({
        bytes: HELLO.slice(2),
        expectedOffset: 3,
        releaseDigest: staged.releaseDigest,
        resourceId: "test-asset",
        strongEtag: STRONG_ETAG,
      }),
    ).rejects.toThrow("durable checkpoint 2");
  });

  it("ignores a checkpoint whose source identity no longer matches the manifest", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    await store.appendPartial({
      bytes: HELLO.slice(0, 2),
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    const checkpoint =
      `parallax-install-v1/partials/${staged.releaseDigest}/test-asset/` +
      "checkpoints/00000000000000000002.json";
    await platform.writeRecord(
      checkpoint,
      encoder.encode(
        `${JSON.stringify({
          bytesCommitted: 2,
          expectedBytes: 5,
          expectedSha256: HELLO_SHA,
          releaseDigest: staged.releaseDigest,
          resourceId: "test-asset",
          schemaVersion: 2,
          source: "different.bin",
          strongEtag: STRONG_ETAG,
        })}\n`,
      ),
    );

    expect(
      await createOpfsReleaseStore(platform.reconstruct()).beginPartial(
        staged.releaseDigest,
        "test-asset",
      ),
    ).toMatchObject({ bytesCommitted: 0 });
  });

  it("keeps active/previous old-or-new across torn publication and rolls back by new commit", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const first = await install(
      store,
      platform,
      manifestBytes("game-specific", "first.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(first);
    const second = await install(
      store,
      platform,
      manifestBytes("game-specific", "second.bin", WORLD),
      WORLD,
    );

    platform.setFault({ kind: "torn-record", operation: 1 });
    await expect(store.publishRelease(second)).rejects.toThrow();
    platform.clearFault();
    expect(await createOpfsReleaseStore(platform.reconstruct()).getSelection()).toEqual({
      activeReleaseDigest: first,
      previousReleaseDigest: null,
    });
    const recovered = createOpfsReleaseStore(platform.reconstruct());
    expect(await recovered.publishRelease(second)).toEqual({
      activeReleaseDigest: second,
      previousReleaseDigest: first,
    });
    expect(await recovered.rollbackToPrevious()).toEqual({
      activeReleaseDigest: first,
      previousReleaseDigest: second,
    });
  });

  it("accepts a fully valid commit after its caller missed close completion", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", "asset.bin", HELLO),
      HELLO,
    );
    platform.setFault({ kind: "fail-after", operation: 1 });
    await expect(store.publishRelease(digest)).rejects.toThrow();
    platform.clearFault();

    expect(await createOpfsReleaseStore(platform.reconstruct()).getSelection()).toEqual({
      activeReleaseDigest: digest,
      previousReleaseDigest: null,
    });
    await createOpfsReleaseStore(platform.reconstruct()).reconcile();
    expect(
      await platform.read(`parallax-install-v1/releases/${digest}/published.json`),
    ).not.toBeNull();
  });

  it("keeps the current release active across a torn rollback commit", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const first = await install(
      store,
      platform,
      manifestBytes("game-specific", "first.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(first);
    const second = await install(
      store,
      platform,
      manifestBytes("game-specific", "second.bin", WORLD),
      WORLD,
    );
    await store.publishRelease(second);
    platform.setFault({ kind: "torn-record", operation: 1 });
    await expect(store.rollbackToPrevious()).rejects.toThrow();
    platform.clearFault();
    expect(store.snapshot()).toMatchObject({
      activeReleaseDigest: second,
      previousReleaseDigest: first,
      readyReleaseCount: 2,
      verifiedObjectCount: 2,
    });
    const recovered = createOpfsReleaseStore(platform.reconstruct());
    expect(await recovered.getSelection()).toEqual({
      activeReleaseDigest: second,
      previousReleaseDigest: first,
    });
    expect(await recovered.rollbackToPrevious()).toEqual({
      activeReleaseDigest: first,
      previousReleaseDigest: second,
    });
  });

  it("fails closed on duplicate commit ordinals instead of choosing by filename order", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const first = await install(
      store,
      platform,
      manifestBytes("game-specific", "first.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(first);
    const second = await install(
      store,
      platform,
      manifestBytes("game-specific", "second.bin", WORLD),
      WORLD,
    );
    await platform.writeRecord(
      `parallax-install-v1/commits/00000000000000000001-${second}.json`,
      encoder.encode(
        `${JSON.stringify({ ordinal: 1, releaseDigest: second, schemaVersion: 1 })}\n`,
      ),
    );

    const recovered = createOpfsReleaseStore(platform.reconstruct());
    expect(await recovered.getSelection()).toEqual({
      activeReleaseDigest: null,
      previousReleaseDigest: null,
    });
    await expect(recovered.getActiveReleaseDigest()).resolves.toBeNull();
    await expect(recovered.admitActiveRelease(first)).rejects.toThrow(
      "not the exact active selection",
    );
    await expect(recovered.admitActiveRelease(second)).rejects.toThrow(
      "not the exact active selection",
    );
  });

  it("converges after every stage mutation boundary and never authorizes torn metadata", async () => {
    const manifest = manifestBytes("game-specific", "asset.bin", HELLO);
    for (const operation of [1, 2]) {
      const platform = createMemoryInstallStorePlatform();
      platform.setFault({ kind: "fail-after", operation });
      await expect(createOpfsReleaseStore(platform).stageRelease(manifest)).rejects.toThrow();
      platform.clearFault();
      const reconstructed = createOpfsReleaseStore(platform.reconstruct());
      const staged = await reconstructed.stageRelease(manifest);
      expect(staged.staged).toBe(true);
      expect((await reconstructed.getSelection()).activeReleaseDigest).toBeNull();
    }
  });

  it("never treats a torn ready marker as active and converges on retry", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    await store.appendPartial({
      bytes: HELLO,
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    await store.finalizePartial(staged.releaseDigest, "test-asset");
    platform.setFault({ kind: "torn-record", operation: 1 });
    await expect(store.markReleaseReady(staged.releaseDigest)).rejects.toThrow();
    platform.clearFault();
    const recovered = createOpfsReleaseStore(platform.reconstruct());
    expect(await recovered.getSelection()).toEqual({
      activeReleaseDigest: null,
      previousReleaseDigest: null,
    });
    await recovered.markReleaseReady(staged.releaseDigest);
    await expect(recovered.publishRelease(staged.releaseDigest)).resolves.toMatchObject({
      activeReleaseDigest: staged.releaseDigest,
    });
  });

  it("keeps equal hashes physically separate across common and game namespaces", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const game = await install(
      store,
      platform,
      manifestBytes("game-specific", "game.bin", HELLO),
      HELLO,
    );
    const common = await install(
      store,
      platform,
      manifestBytes("common", "common.bin", HELLO),
      HELLO,
    );
    const gameRef = await store.getResource(game, "test-asset");
    const commonRef = await store.getResource(common, "test-asset");

    expect(gameRef.sha256).toBe(commonRef.sha256);
    expect(gameRef.path).not.toBe(commonRef.path);
    expect(gameRef.path).toContain("/games/parallax/");
    expect(commonRef.path).toContain("/objects/common/");
  });

  it("fails closed on quota and short writes, then resumes from the last checkpoint", async () => {
    for (const kind of ["quota", "short-append"] as const) {
      const platform = createMemoryInstallStorePlatform();
      const store = createOpfsReleaseStore(platform);
      const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
      platform.setFault({ kind, operation: 1 });
      await expect(
        store.appendPartial({
          bytes: HELLO,
          expectedOffset: 0,
          releaseDigest: staged.releaseDigest,
          resourceId: "test-asset",
          strongEtag: STRONG_ETAG,
        }),
      ).rejects.toThrow();
      platform.clearFault();
      const recovered = createOpfsReleaseStore(platform.reconstruct());
      expect(await recovered.beginPartial(staged.releaseDigest, "test-asset")).toMatchObject({
        bytesCommitted: 0,
      });
    }
  });

  it("converges after every finalization mutation boundary without redownloading", async () => {
    for (const operation of [1, 2, 3, 4, 5]) {
      const platform = createMemoryInstallStorePlatform();
      const store = createOpfsReleaseStore(platform);
      const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
      await store.appendPartial({
        bytes: HELLO,
        expectedOffset: 0,
        releaseDigest: staged.releaseDigest,
        resourceId: "test-asset",
        strongEtag: STRONG_ETAG,
      });
      platform.setFault({ kind: "fail-after", operation });
      await expect(store.finalizePartial(staged.releaseDigest, "test-asset")).rejects.toThrow();
      platform.clearFault();
      const reconstructed = createOpfsReleaseStore(platform.reconstruct());
      const reference = await reconstructed.finalizePartial(staged.releaseDigest, "test-asset");
      expect(await reconstructed.verifyObject(reference)).toMatchObject({ bytes: 5, ok: true });
    }
  });

  it("queues contenders FIFO and reconstruction cannot clear a live owner", async () => {
    const platform = createMemoryInstallStorePlatform();
    const contender = platform.forkContender();
    const reconstructed = platform.reconstruct();
    const order: string[] = [];
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = platform.runExclusive(async () => {
      order.push("first-start");
      await blocked;
      order.push("first-end");
    });
    const second = contender.runExclusive(async () => {
      order.push("second");
    });
    const third = reconstructed.runExclusive(async () => {
      order.push("third");
    });
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    release?.();
    await Promise.all([first, second, third]);
    expect(order).toEqual(["first-start", "first-end", "second", "third"]);
  });

  it("recovers a post-truncate reconciliation failure at the exact checkpoint", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    await store.appendPartial({
      bytes: HELLO.slice(0, 2),
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    const dataPath = `parallax-install-v1/partials/${staged.releaseDigest}/test-asset/data.partial`;
    await platform.append(dataPath, 2, HELLO.slice(2));
    platform.setFault({ kind: "fail-after", operation: 1 });
    await expect(store.reconcile()).rejects.toThrow();
    platform.clearFault();
    const recovered = createOpfsReleaseStore(platform.reconstruct());
    expect(await recovered.beginPartial(staged.releaseDigest, "test-asset")).toMatchObject({
      bytesCommitted: 2,
    });
  });

  it("bounds deterministic garbage collection without touching another subsystem root", async () => {
    const platform = createMemoryInstallStorePlatform();
    platform.seedExternalFile("parallax-streaming-v1/keep.bin", HELLO);
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    await store.appendPartial({
      bytes: HELLO,
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    await store.finalizePartial(staged.releaseDigest, "test-asset");
    await store.abandonRelease(staged.releaseDigest);

    const first = await store.collectGarbage({ maxEntries: 1 });
    expect(first.entriesRemoved).toBe(1);
    expect(first.remainingWork).toBe(true);
    while ((await store.collectGarbage({ maxEntries: 1 })).remainingWork) {
      // Bounded resumable collection converges.
    }
    await expect(platform.read("parallax-streaming-v1/keep.bin")).rejects.toThrow(
      "outside the parallax-install-v1 capability",
    );
    expect(platform.hasSeededFile("parallax-streaming-v1/keep.bin")).toBe(true);
  });

  it("preserves an exactly bound pending repair alongside two selected releases", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const first = await install(
      store,
      platform,
      manifestBytes("game-specific", "first.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(first);
    const second = await install(
      store,
      platform,
      manifestBytes("game-specific", "second.bin", WORLD),
      WORLD,
    );
    await store.publishRelease(second);
    const third = await install(
      store,
      platform,
      manifestBytes("game-specific", "third.bin", THIRD),
      THIRD,
    );
    await store.publishRelease(third);
    const reference = await store.getResource(third, "test-asset");
    const corrupted = new Uint8Array(THIRD.byteLength).fill(0x78);
    platform.seedExternalFile(reference.path, corrupted);
    await expect(store.verifyObject(reference)).resolves.toMatchObject({ ok: false });
    const repairPath = `parallax-install-v1/releases/${third}/repair-eligibility.json`;
    const repairRecord = await platform.read(repairPath);
    if (repairRecord === null) throw new Error("Repair eligibility fixture is absent");

    await expect(store.collectGarbage({ maxEntries: 128 })).resolves.toMatchObject({
      remainingWork: false,
    });

    expect(await platform.read(reference.path)).toEqual(corrupted);
    expect(await platform.read(repairPath)).toEqual(repairRecord);
    await expect(store.getResource(first, "test-asset")).resolves.toMatchObject({
      releaseDigest: first,
    });
    await expect(store.getResource(second, "test-asset")).resolves.toMatchObject({
      releaseDigest: second,
    });
    await expect(store.findRepairRelease(third)).resolves.toMatchObject({
      releaseDigest: third,
      resourceId: "test-asset",
      state: "repair-required",
    });
  });

  it("collects malformed repair junk instead of treating its path as authority", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const first = await install(
      store,
      platform,
      manifestBytes("game-specific", "first.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(first);
    const second = await install(
      store,
      platform,
      manifestBytes("game-specific", "second.bin", WORLD),
      WORLD,
    );
    await store.publishRelease(second);
    const third = await install(
      store,
      platform,
      manifestBytes("game-specific", "third.bin", THIRD),
      THIRD,
    );
    await store.publishRelease(third);
    const junkPath = `parallax-install-v1/releases/${first}/repair-eligibility.json`;
    platform.seedExternalFile(junkPath, encoder.encode("{malformed repair authority"));

    await expect(store.collectGarbage({ maxEntries: 128 })).resolves.toMatchObject({
      remainingWork: false,
    });

    expect(await platform.read(junkPath)).toBeNull();
    await expect(store.getResource(first, "test-asset")).rejects.toThrow(
      "no exact install manifest",
    );
    await expect(store.getResource(second, "test-asset")).resolves.toMatchObject({
      releaseDigest: second,
    });
    await expect(store.getResource(third, "test-asset")).resolves.toMatchObject({
      releaseDigest: third,
    });
  });

  it("collects releases older than active/previous while preserving both live roots", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const first = await install(
      store,
      platform,
      manifestBytes("game-specific", "first.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(first);
    const second = await install(
      store,
      platform,
      manifestBytes("game-specific", "second.bin", WORLD),
      WORLD,
    );
    await store.publishRelease(second);
    const third = await install(
      store,
      platform,
      manifestBytes("game-specific", "third.bin", THIRD),
      THIRD,
    );
    expect(await store.publishRelease(third)).toEqual({
      activeReleaseDigest: third,
      previousReleaseDigest: second,
    });

    while ((await store.collectGarbage({ maxEntries: 1 })).remainingWork) {
      // One deterministic candidate per pass exercises resumability.
    }
    await expect(store.getResource(first, "test-asset")).rejects.toThrow(
      "no exact install manifest",
    );
    await expect(store.getResource(second, "test-asset")).resolves.toMatchObject({
      releaseDigest: second,
    });
    await expect(store.getResource(third, "test-asset")).resolves.toMatchObject({
      releaseDigest: third,
    });
  });

  it("resumes GC after caller-observed removal failure and preserves external roots", async () => {
    const platform = createMemoryInstallStorePlatform();
    platform.seedExternalFile("saves/keep.bin", HELLO);
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    await store.appendPartial({
      bytes: HELLO,
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    await store.finalizePartial(staged.releaseDigest, "test-asset");
    await store.abandonRelease(staged.releaseDigest);
    platform.setFault({ kind: "fail-after", operation: 1 });
    await expect(store.collectGarbage({ maxEntries: 1 })).rejects.toThrow();
    platform.clearFault();
    const recovered = createOpfsReleaseStore(platform.reconstruct());
    while ((await recovered.collectGarbage({ maxEntries: 1 })).remainingWork) {
      // Resume until no deterministic candidate remains.
    }
    await expect(platform.read("saves/keep.bin")).rejects.toThrow(
      "outside the parallax-install-v1 capability",
    );
    expect(platform.hasSeededFile("saves/keep.bin")).toBe(true);
  });

  it("publishes observable schema-v3 telemetry from the first state transition", async () => {
    const store = createOpfsReleaseStore(createMemoryInstallStorePlatform());
    const snapshots: unknown[] = [];
    const unsubscribe = store.subscribe((snapshot) => snapshots.push(snapshot));
    await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    unsubscribe();

    expect(snapshots).toContainEqual(
      expect.objectContaining({ schemaVersion: 3, state: "staging" }),
    );
    expect(store.snapshot()).toMatchObject({
      failureMessage: null,
      schemaVersion: 3,
      stagedReleaseCount: 1,
      state: "idle",
    });
  });

  it("confines every platform operation and distinguishes direct from recursive listing", async () => {
    const platform = createMemoryInstallStorePlatform();
    for (const action of [
      () => platform.read("saves/file"),
      () => platform.writeRecord("saves/file", HELLO),
      () => platform.list("saves"),
      () => platform.remove("saves/file"),
    ]) {
      await expect(
        (async () => {
          await action();
        })(),
      ).rejects.toThrow("outside the parallax-install-v1 capability");
    }
    await platform.writeRecord("parallax-install-v1/a/b/file.bin", HELLO);
    await platform.writeRecord("parallax-install-v1/a/direct.bin", WORLD);
    expect(await platform.list("parallax-install-v1/a")).toEqual([
      { kind: "directory", path: "parallax-install-v1/a/b", size: 0 },
      { kind: "file", path: "parallax-install-v1/a/direct.bin", size: 5 },
    ]);
    expect(
      (await platform.list("parallax-install-v1/a", { recursive: true })).map(
        (entry) => entry.path,
      ),
    ).toEqual([
      "parallax-install-v1/a/b",
      "parallax-install-v1/a/b/file.bin",
      "parallax-install-v1/a/direct.bin",
    ]);
  });

  it("ignores nested canonical-looking metadata and never recursively removes it", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    const nestedCommit = `parallax-install-v1/commits/nested/00000000000000000001-${staged.releaseDigest}.json`;
    const nestedObject =
      `parallax-install-v1/objects/common/sha256/${HELLO_SHA.slice(0, 2)}/nested/` +
      `${HELLO_SHA}.data`;
    await platform.writeRecord(
      nestedCommit,
      encoder.encode(
        `${JSON.stringify({
          ordinal: 1,
          releaseDigest: staged.releaseDigest,
          schemaVersion: 1,
        })}\n`,
      ),
    );
    await platform.writeRecord(nestedObject, HELLO);

    expect(await store.getSelection()).toEqual({
      activeReleaseDigest: null,
      previousReleaseDigest: null,
    });
    await store.collectGarbage({ maxEntries: 100 });
    expect(await platform.read(nestedCommit)).not.toBeNull();
    expect(await platform.read(nestedObject)).toEqual(HELLO);
  });

  it("invalidates authorization before exact-size rewrite and repairs after interruption", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", "asset.bin", HELLO),
      HELLO,
    );
    const reference = await store.getResource(digest, "test-asset");
    const markerPath = reference.path.replace(/\.data$/, ".verified.json");
    await platform.remove(reference.path);
    await platform.append(reference.path, 0, WORLD);
    expect(await store.verifyObject(reference)).toEqual({
      bytes: 5,
      ok: false,
      sha256: bytesToHex(sha256(WORLD)),
    });
    expect(await platform.read(markerPath)).toBeNull();
    expect(store.snapshot()).toMatchObject({
      activeReleaseDigest: null,
      readyReleaseCount: 0,
      verifiedObjectBytes: 0,
      verifiedObjectCount: 0,
    });
    expect(await store.getSelection()).toEqual({
      activeReleaseDigest: null,
      previousReleaseDigest: null,
    });

    await store.appendPartial({
      bytes: HELLO,
      expectedOffset: 0,
      releaseDigest: digest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    platform.setFault({ kind: "fail-after", operation: 3 });
    await expect(store.finalizePartial(digest, "test-asset")).rejects.toThrow();
    platform.clearFault();
    expect(await platform.size(reference.path)).toBe(5);
    expect(await platform.read(markerPath)).toBeNull();
    expect(store.snapshot()).toMatchObject({
      activeReleaseDigest: null,
      readyReleaseCount: 0,
      verifiedObjectCount: 0,
    });
    await expect(store.getResource(digest, "test-asset")).rejects.toThrow(
      "no exact verified object",
    );
    const repaired = await createOpfsReleaseStore(platform.reconstruct()).finalizePartial(
      digest,
      "test-asset",
    );
    expect(await store.verifyObject(repaired)).toMatchObject({ ok: true });
  });

  it("revokes live inventory and active selection immediately after marker removal", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", "asset.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(digest);
    const reference = await store.getResource(digest, "test-asset");
    await platform.remove(reference.path.replace(/\.data$/, ".verified.json"));

    await expect(store.getResource(digest, "test-asset")).rejects.toThrow(
      "no exact verified object",
    );
    expect(store.snapshot()).toMatchObject({
      activeReleaseDigest: null,
      readyReleaseCount: 0,
      verifiedObjectBytes: 0,
      verifiedObjectCount: 0,
    });
    expect(await store.getSelection()).toEqual({
      activeReleaseDigest: null,
      previousReleaseDigest: null,
    });
  });

  it("admits only the restart-stable exact corrupt head and rejects it after a newer commit", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const first = await install(
      store,
      platform,
      manifestBytes("game-specific", "repair-head.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(first);
    const reference = await store.getResource(first, "test-asset");
    platform.seedExternalFile(reference.path, WORLD);
    await expect(store.verifyObject(reference)).resolves.toMatchObject({ ok: false });

    const reopened = createOpfsReleaseStore(platform.reconstruct());
    await expect(reopened.admitRepairRelease(first)).resolves.toMatchObject({
      bytes: HELLO.byteLength,
      releaseDigest: first,
      resourceId: "test-asset",
      state: "repair-required",
    });

    const second = await install(
      reopened,
      platform,
      manifestBytes("game-specific", "new-head.bin", THIRD),
      THIRD,
    );
    await reopened.publishRelease(second);
    await expect(reopened.admitRepairRelease(first)).rejects.toThrow(
      /ready\/published\/current commit target/u,
    );

    const recordPath = `parallax-install-v1/releases/${first}/repair-eligibility.json`;
    const recordBytes = await platform.read(recordPath);
    if (recordBytes === null) throw new Error("Superseded repair record is absent");
    const reconciler = createOpfsReleaseStore(platform.reconstruct());
    await expect(reconciler.reconcile({ maxCleanupEntries: 0 })).resolves.toMatchObject({
      activeReleaseDigest: second,
      cleanupBytesRemoved: 0,
      cleanupEntriesRemoved: 0,
      cleanupMutations: 0,
      cleanupRemaining: true,
    });
    expect(await platform.read(recordPath)).toEqual(recordBytes);
    await expect(reconciler.reconcile({ maxCleanupEntries: 1 })).resolves.toMatchObject({
      activeReleaseDigest: second,
      cleanupBytesRemoved: recordBytes.byteLength,
      cleanupEntriesRemoved: 1,
      cleanupMutations: 1,
      cleanupRemaining: false,
    });
    expect(await platform.read(recordPath)).toBeNull();
    expect(reconciler.snapshot()).toMatchObject({
      activeReleaseDigest: second,
      readyReleaseCount: 1,
      reconciliationCount: 2,
      verifiedObjectBytes: THIRD.byteLength,
      verifiedObjectCount: 1,
    });
    await expect(createOpfsReleaseStore(platform.reconstruct()).reconcile()).resolves.toMatchObject(
      { activeReleaseDigest: second },
    );
  });

  it("budget-cleans torn non-current repair records deterministically after reopen", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", "repair-current.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(digest);
    const firstDigest = "d".repeat(64);
    const secondDigest = "e".repeat(64);
    const firstPath = `parallax-install-v1/releases/${firstDigest}/repair-eligibility.json`;
    const secondPath = `parallax-install-v1/releases/${secondDigest}/repair-eligibility.json`;
    const firstBytes = encoder.encode('{"schemaVersion":2');
    const secondBytes = encoder.encode("not-json\n");
    platform.seedExternalFile(firstPath, firstBytes);
    platform.seedExternalFile(secondPath, secondBytes);

    const reopened = createOpfsReleaseStore(platform.reconstruct());
    await expect(reopened.reconcile({ maxCleanupEntries: 0 })).resolves.toMatchObject({
      activeReleaseDigest: digest,
      cleanupBytesRemoved: 0,
      cleanupEntriesRemoved: 0,
      cleanupMutations: 0,
      cleanupRemaining: true,
    });
    expect(await platform.read(firstPath)).toEqual(firstBytes);
    expect(await platform.read(secondPath)).toEqual(secondBytes);

    await expect(reopened.reconcile({ maxCleanupEntries: 1 })).resolves.toMatchObject({
      cleanupBytesRemoved: firstBytes.byteLength,
      cleanupEntriesRemoved: 1,
      cleanupMutations: 1,
      cleanupRemaining: true,
    });
    expect(await platform.read(firstPath)).toBeNull();
    expect(await platform.read(secondPath)).toEqual(secondBytes);
    await expect(reopened.reconcile({ maxCleanupEntries: 1 })).resolves.toMatchObject({
      cleanupBytesRemoved: secondBytes.byteLength,
      cleanupEntriesRemoved: 1,
      cleanupMutations: 1,
      cleanupRemaining: false,
    });
    expect(await platform.read(secondPath)).toBeNull();
  });

  it("cleans a manifest-less superseded repair record but rejects a missing current manifest", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const first = await install(
      store,
      platform,
      manifestBytes("game-specific", "repair-missing-manifest.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(first);
    const firstReference = await store.getResource(first, "test-asset");
    platform.seedExternalFile(firstReference.path, WORLD);
    await expect(store.verifyObject(firstReference)).resolves.toMatchObject({ ok: false });
    const firstRecordPath = `parallax-install-v1/releases/${first}/repair-eligibility.json`;

    const second = await install(
      store,
      platform,
      manifestBytes("game-specific", "repair-missing-current-manifest.bin", THIRD),
      THIRD,
    );
    await store.publishRelease(second);
    await platform.remove(`parallax-install-v1/releases/${first}/install-manifest.json`);
    await expect(
      createOpfsReleaseStore(platform.reconstruct()).reconcile({ maxCleanupEntries: 1 }),
    ).resolves.toMatchObject({
      activeReleaseDigest: second,
      cleanupEntriesRemoved: 1,
      cleanupMutations: 1,
    });
    expect(await platform.read(firstRecordPath)).toBeNull();

    const secondReference = await store.getResource(second, "test-asset");
    platform.seedExternalFile(secondReference.path, HELLO);
    await expect(store.verifyObject(secondReference)).resolves.toMatchObject({ ok: false });
    const secondRecordPath = `parallax-install-v1/releases/${second}/repair-eligibility.json`;
    await platform.remove(`parallax-install-v1/releases/${second}/install-manifest.json`);
    await expect(createOpfsReleaseStore(platform.reconstruct()).reconcile()).rejects.toThrow();
    expect(await platform.read(secondRecordPath)).not.toBeNull();
  });

  it("retains valid current repair authority and rejects malformed or ambiguous current authority", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", "repair-retained-current.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(digest);
    const reference = await store.getResource(digest, "test-asset");
    platform.seedExternalFile(reference.path, WORLD);
    await expect(store.verifyObject(reference)).resolves.toMatchObject({ ok: false });
    const recordPath = `parallax-install-v1/releases/${digest}/repair-eligibility.json`;
    const recordBytes = await platform.read(recordPath);
    if (recordBytes === null) throw new Error("Current repair record is absent");

    const reopened = createOpfsReleaseStore(platform.reconstruct());
    await expect(reopened.reconcile({ maxCleanupEntries: 100 })).resolves.toMatchObject({
      cleanupBytesRemoved: 0,
      cleanupEntriesRemoved: 0,
      cleanupMutations: 0,
    });
    expect(await platform.read(recordPath)).toEqual(recordBytes);
    await expect(reopened.findRepairRelease(digest)).resolves.toMatchObject({
      releaseDigest: digest,
      state: "repair-required",
    });

    platform.seedExternalFile(recordPath, encoder.encode('{"schemaVersion":2'));
    await expect(createOpfsReleaseStore(platform.reconstruct()).reconcile()).rejects.toThrow(
      /exact durable corruption eligibility record/u,
    );
    expect(await platform.read(recordPath)).not.toBeNull();

    platform.seedExternalFile(recordPath, recordBytes);
    const competingDigest = "f".repeat(64);
    platform.seedExternalFile(
      `parallax-install-v1/commits/00000000000000000001-${competingDigest}.json`,
      encoder.encode(
        `${JSON.stringify({ ordinal: 1, releaseDigest: competingDigest, schemaVersion: 1 })}\n`,
      ),
    );
    await expect(createOpfsReleaseStore(platform.reconstruct()).reconcile()).rejects.toThrow(
      /newest commit authority is ambiguous/u,
    );
    expect(await platform.read(recordPath)).toEqual(recordBytes);
  });

  it.each([
    "releaseDigest",
    "commitOrdinal",
    "commitRecordSha256",
  ] as const)("rejects a canonical stale-path record that spoofs current %s authority", async (spoofedField) => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", `repair-spoof-${spoofedField}.bin`, HELLO),
      HELLO,
    );
    await store.publishRelease(digest);
    const reference = await store.getResource(digest, "test-asset");
    platform.seedExternalFile(reference.path, WORLD);
    await expect(store.verifyObject(reference)).resolves.toMatchObject({ ok: false });
    const currentPath = `parallax-install-v1/releases/${digest}/repair-eligibility.json`;
    const currentBytes = await platform.read(currentPath);
    if (currentBytes === null) throw new Error("Current repair record is absent");
    const current = JSON.parse(new TextDecoder().decode(currentBytes)) as Record<string, unknown>;
    const staleDigest =
      spoofedField === "releaseDigest"
        ? "a".repeat(64)
        : spoofedField === "commitOrdinal"
          ? "b".repeat(64)
          : "c".repeat(64);
    const stale = {
      ...current,
      commitOrdinal:
        spoofedField === "commitOrdinal"
          ? current.commitOrdinal
          : (current.commitOrdinal as number) + 100,
      commitRecordSha256:
        spoofedField === "commitRecordSha256" ? current.commitRecordSha256 : "d".repeat(64),
      releaseDigest: spoofedField === "releaseDigest" ? current.releaseDigest : staleDigest,
    };
    const staleBytes = encoder.encode(
      `${JSON.stringify(
        Object.fromEntries(
          Object.entries(stale).sort(([left], [right]) => left.localeCompare(right)),
        ),
      )}\n`,
    );
    const stalePath = `parallax-install-v1/releases/${staleDigest}/repair-eligibility.json`;
    platform.seedExternalFile(stalePath, staleBytes);

    await expect(createOpfsReleaseStore(platform.reconstruct()).reconcile()).rejects.toThrow(
      /purports to authorize current commit authority/u,
    );
    expect(await platform.read(stalePath)).toEqual(staleBytes);
    expect(await platform.read(currentPath)).toEqual(currentBytes);
  });

  it("budget-cleans an orphan repair record when no commit authority exists", async () => {
    const platform = createMemoryInstallStorePlatform();
    const digest = "c".repeat(64);
    const recordPath = `parallax-install-v1/releases/${digest}/repair-eligibility.json`;
    const bytes = encoder.encode("torn\n");
    platform.seedExternalFile(recordPath, bytes);

    const reopened = createOpfsReleaseStore(platform.reconstruct());
    await expect(reopened.reconcile({ maxCleanupEntries: 0 })).resolves.toMatchObject({
      cleanupEntriesRemoved: 0,
      cleanupRemaining: true,
    });
    expect(await platform.read(recordPath)).toEqual(bytes);
    await expect(reopened.reconcile({ maxCleanupEntries: 1 })).resolves.toMatchObject({
      activeReleaseDigest: null,
      cleanupBytesRemoved: bytes.byteLength,
      cleanupEntriesRemoved: 1,
      cleanupMutations: 1,
      cleanupRemaining: false,
    });
    expect(await platform.read(recordPath)).toBeNull();
  });

  it("recovers a crash after durable repair-record write before marker revocation idempotently", async () => {
    const memory = createMemoryInstallStorePlatform();
    let failMarkerRemoval = true;
    const platform: MemoryInstallStorePlatform = {
      ...memory,
      async remove(path, recursive) {
        if (
          failMarkerRemoval &&
          path.endsWith(".verified.json") &&
          (await memory.list("parallax-install-v1/releases", { recursive: true })).some((entry) =>
            entry.path.endsWith("/repair-eligibility.json"),
          )
        ) {
          failMarkerRemoval = false;
          throw new Error("injected crash before marker revocation");
        }
        await memory.remove(path, recursive);
      },
    };
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", "repair-crash.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(digest);
    const reference = await store.getResource(digest, "test-asset");
    const markerPath = reference.path.replace(/\.data$/, ".verified.json");
    const recordPath = `parallax-install-v1/releases/${digest}/repair-eligibility.json`;
    const commitsBefore = await memory.list("parallax-install-v1/commits");
    memory.seedExternalFile(reference.path, WORLD);

    const failure = await store.verifyObject(reference).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InstallStoreIntegrityError);
    expect((failure as Error).cause).toBeInstanceOf(AggregateError);
    expect(((failure as Error).cause as AggregateError).errors).toHaveLength(2);
    expect((((failure as Error).cause as AggregateError).errors[0] as Error).message).toMatch(
      /failed exact integrity verification/u,
    );
    expect(await memory.read(recordPath)).not.toBeNull();
    expect(await memory.read(markerPath)).not.toBeNull();

    const reopenedMemory = memory.reconstruct();
    let failRecordCleanup = true;
    const reopenedPlatform: MemoryInstallStorePlatform = {
      ...reopenedMemory,
      async remove(path, recursive) {
        if (failRecordCleanup && path === recordPath) {
          failRecordCleanup = false;
          throw new Error("injected repair-record cleanup failure");
        }
        await reopenedMemory.remove(path, recursive);
      },
    };
    const reopened = createOpfsReleaseStore(reopenedPlatform);
    await expect(reopened.reconcile()).resolves.toMatchObject({
      activeReleaseDigest: null,
      previousReleaseDigest: null,
    });
    expect(await memory.read(markerPath)).toBeNull();
    const firstAdmission = await reopened.findRepairRelease(digest);
    await expect(reopened.reconcile()).resolves.toMatchObject({
      activeReleaseDigest: null,
      previousReleaseDigest: null,
    });
    expect(await reopened.findRepairRelease(digest)).toEqual(firstAdmission);

    if (firstAdmission === null) throw new Error("Crash recovery omitted repair admission");
    await reopened.appendPartial({
      bytes: HELLO,
      expectedOffset: 0,
      releaseDigest: digest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    await reopened.finalizePartial(digest, "test-asset");
    const cleanupFailure = await reopened
      .completeRepairRelease(firstAdmission)
      .catch((error: unknown) => error);
    expect(cleanupFailure).toBeInstanceOf(InstallStoreIntegrityError);
    expect((cleanupFailure as Error).cause).toBeInstanceOf(AggregateError);
    expect(await memory.read(recordPath)).not.toBeNull();
    await expect(reopened.completeRepairRelease(firstAdmission)).resolves.toEqual({
      activeReleaseDigest: digest,
      previousReleaseDigest: null,
    });
    expect(await memory.read(recordPath)).toBeNull();
    expect(await memory.list("parallax-install-v1/commits")).toEqual(commitsBefore);
    expect(reopened.snapshot().publicationCount).toBe(0);
  });

  it("budgets restart authorization revocation after a durable repair-record crash", async () => {
    const memory = createMemoryInstallStorePlatform();
    let failMarkerRemoval = true;
    const platform: MemoryInstallStorePlatform = {
      ...memory,
      async remove(path, recursive) {
        if (
          failMarkerRemoval &&
          path.endsWith(".verified.json") &&
          (await memory.list("parallax-install-v1/releases", { recursive: true })).some((entry) =>
            entry.path.endsWith("/repair-eligibility.json"),
          )
        ) {
          failMarkerRemoval = false;
          throw new Error("injected crash before budgeted marker revocation");
        }
        await memory.remove(path, recursive);
      },
    };
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", "repair-budgeted-revocation.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(digest);
    const reference = await store.getResource(digest, "test-asset");
    const markerPath = reference.path.replace(/\.data$/, ".verified.json");
    const recordPath = `parallax-install-v1/releases/${digest}/repair-eligibility.json`;
    memory.seedExternalFile(reference.path, WORLD);
    await expect(store.verifyObject(reference)).rejects.toBeInstanceOf(InstallStoreIntegrityError);
    const markerBytes = await memory.read(markerPath);
    const recordBytes = await memory.read(recordPath);
    if (markerBytes === null || recordBytes === null) {
      throw new Error("Crash fixture did not retain repair authority and its marker");
    }

    const reopened = createOpfsReleaseStore(memory.reconstruct());
    await expect(reopened.reconcile({ maxCleanupEntries: 0 })).resolves.toMatchObject({
      activeReleaseDigest: null,
      cleanupBytesRemoved: 0,
      cleanupEntriesRemoved: 0,
      cleanupMutations: 0,
      cleanupRemaining: true,
    });
    expect(reopened.snapshot()).toMatchObject({
      activeReleaseDigest: null,
      readyReleaseCount: 0,
    });
    expect(await memory.read(markerPath)).toEqual(markerBytes);
    expect(await memory.read(recordPath)).toEqual(recordBytes);
    await expect(reopened.admitActiveRelease(digest)).rejects.toThrow(
      /not the exact active selection/u,
    );

    await expect(reopened.reconcile({ maxCleanupEntries: 1 })).resolves.toMatchObject({
      activeReleaseDigest: null,
      cleanupBytesRemoved: markerBytes.byteLength,
      cleanupEntriesRemoved: 1,
      cleanupMutations: 1,
      cleanupRemaining: false,
    });
    expect(reopened.snapshot()).toMatchObject({
      activeReleaseDigest: null,
      readyReleaseCount: 0,
    });
    expect(await memory.read(markerPath)).toBeNull();
    expect(await memory.read(recordPath)).toEqual(recordBytes);
  });

  it("retains caller-missed repair-record close failure while restart admits the durable record", async () => {
    const memory = createMemoryInstallStorePlatform();
    let failRepairRecordClose = true;
    const platform: MemoryInstallStorePlatform = {
      ...memory,
      async writeRecord(path, bytes) {
        await memory.writeRecord(path, bytes);
        if (failRepairRecordClose && path.endsWith("/repair-eligibility.json")) {
          failRepairRecordClose = false;
          throw new Error("injected caller-missed repair-record close");
        }
      },
    };
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", "repair-close.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(digest);
    const reference = await store.getResource(digest, "test-asset");
    memory.seedExternalFile(reference.path, WORLD);

    const failure = await store.verifyObject(reference).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InstallStoreIntegrityError);
    expect((failure as Error).cause).toBeInstanceOf(AggregateError);
    const retained = ((failure as Error).cause as AggregateError).errors;
    expect(retained).toHaveLength(2);
    expect((retained[0] as Error).message).toMatch(/failed exact integrity verification/u);
    expect((retained[1] as Error).message).toMatch(/caller-missed repair-record close/u);
    expect(
      await memory.read(`parallax-install-v1/releases/${digest}/repair-eligibility.json`),
    ).not.toBeNull();
    await expect(
      createOpfsReleaseStore(memory.reconstruct()).findRepairRelease(digest),
    ).resolves.toMatchObject({
      releaseDigest: digest,
      resourceId: "test-asset",
      state: "repair-required",
    });
  });

  it("admits repair across restart with OPFS-persistent empty directory scaffolding", async () => {
    const platform = createDirectoryPersistentMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", "repair-empty-directories.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(digest);
    const reference = await store.getResource(digest, "test-asset");
    platform.seedExternalFile(reference.path, WORLD);
    await expect(store.verifyObject(reference)).resolves.toMatchObject({ ok: false });
    const partialsRoot = `parallax-install-v1/partials/${digest}`;
    platform.seedExternalDirectory(`${partialsRoot}/test-asset/checkpoints`);
    platform.seedExternalDirectory(`${partialsRoot}/empty-sibling/nested/scaffolding`);

    const reopened = createOpfsReleaseStore(platform.reconstruct());
    await expect(reopened.reconcile()).resolves.toMatchObject({
      activeReleaseDigest: null,
      previousReleaseDigest: null,
    });
    await expect(reopened.findRepairRelease(digest)).resolves.toMatchObject({
      releaseDigest: digest,
      resourceId: "test-asset",
      state: "repair-required",
    });
    expect(
      (await platform.list("parallax-install-v1/partials", { recursive: true })).filter(
        ({ kind }) => kind === "file",
      ),
    ).toEqual([]);
    expect(
      (await platform.list("parallax-install-v1/partials", { recursive: true })).some(
        ({ kind, path }) => kind === "directory" && path === partialsRoot,
      ),
    ).toBe(true);
    expect(
      (await platform.list("parallax-install-v1/partials", { recursive: true })).some(
        ({ kind, path }) =>
          kind === "directory" && path === `${partialsRoot}/empty-sibling/nested/scaffolding`,
      ),
    ).toBe(true);
  });

  it.each([
    "partial",
    "checkpoint",
    "unknown",
  ] as const)("rejects sibling %s residue after restart without erasing the nonempty subtree", async (kind) => {
    const platform = createDirectoryPersistentMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const fixture = manyResourceManifest(2, `repair-sibling-${kind}`);
    const digest = await installMany(store, fixture);
    await store.publishRelease(digest);
    const [admittedResource, siblingResource] = fixture.resources;
    if (admittedResource === undefined || siblingResource === undefined) {
      throw new Error("Directory-persistent sibling fixture is incomplete");
    }
    const reference = await store.getResource(digest, admittedResource.id);
    platform.seedExternalFile(reference.path, WORLD);
    await expect(store.verifyObject(reference)).resolves.toMatchObject({ ok: false });
    const relativePath =
      kind === "partial"
        ? `${siblingResource.id}/data.partial`
        : kind === "checkpoint"
          ? `${siblingResource.id}/checkpoints/00000000000000000001.json`
          : `${siblingResource.id}/unknown-residue.bin`;
    const residuePath = `parallax-install-v1/partials/${digest}/${relativePath}`;
    platform.seedExternalFile(residuePath, THIRD);

    const reopened = createOpfsReleaseStore(platform.reconstruct());
    await reopened.reconcile();
    await expect(reopened.findRepairRelease(digest)).rejects.toThrow(
      /partial or checkpoint residue/u,
    );
    const retainedResidue = await platform.read(residuePath);
    expect(retainedResidue).not.toBeNull();
    expect(retainedResidue).toEqual(kind === "partial" ? new Uint8Array() : THIRD);
  });

  it("fails closed on an unsupported recursive partial entry kind", async () => {
    const memory = createDirectoryPersistentMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(memory);
    const digest = await install(
      store,
      memory,
      manifestBytes("game-specific", "repair-unsupported-kind.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(digest);
    const reference = await store.getResource(digest, "test-asset");
    memory.seedExternalFile(reference.path, WORLD);
    await expect(store.verifyObject(reference)).resolves.toMatchObject({ ok: false });
    const reconstructed = memory.reconstruct();
    const platform: MemoryInstallStorePlatform = Object.freeze({
      ...reconstructed,
      async list(directory: string, options?: InstallStoreListOptions) {
        const entries = await reconstructed.list(directory, options);
        return directory === "parallax-install-v1/partials" && options?.recursive === true
          ? [
              ...entries,
              {
                kind: "symlink" as never,
                path: `parallax-install-v1/partials/${digest}/unsupported`,
                size: 0,
              },
            ]
          : entries;
      },
    });
    await expect(createOpfsReleaseStore(platform).findRepairRelease(digest)).rejects.toThrow(
      /partial or checkpoint residue/u,
    );
  });

  it("rejects second corruption, unrelated residue, and a competing repair record without replacing admission", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const fixture = manyResourceManifest(2, "repair-boundary");
    const digest = await installMany(store, fixture);
    await store.publishRelease(digest);
    const [firstResource, secondResource] = fixture.resources;
    if (firstResource === undefined || secondResource === undefined) {
      throw new Error("Repair-boundary fixture is incomplete");
    }
    const first = await store.getResource(digest, firstResource.id);
    const second = await store.getResource(digest, secondResource.id);
    platform.seedExternalFile(first.path, new Uint8Array(first.bytes).fill(1));
    platform.seedExternalFile(second.path, new Uint8Array(second.bytes).fill(2));
    await expect(store.verifyObject(first)).resolves.toMatchObject({ ok: false });
    const recordPath = `parallax-install-v1/releases/${digest}/repair-eligibility.json`;
    const admittedRecord = await platform.read(recordPath);
    if (admittedRecord === null) throw new Error("Primary repair record is absent");

    await expect(store.verifyObject(second)).rejects.toBeInstanceOf(InstallStoreIntegrityError);
    expect(await platform.read(recordPath)).toEqual(admittedRecord);
    await expect(store.admitRepairRelease(digest)).rejects.toThrow(
      /corrupt resource|unverified resource/u,
    );
    expect(await platform.read(recordPath)).toEqual(admittedRecord);

    await store.appendPartial({
      bytes: secondResource.bytes,
      expectedOffset: 0,
      releaseDigest: digest,
      resourceId: secondResource.id,
      strongEtag: STRONG_ETAG,
    });
    await expect(store.admitRepairRelease(digest)).rejects.toThrow(
      /partial or checkpoint residue/u,
    );
    expect(await platform.read(recordPath)).toEqual(admittedRecord);
    await store.finalizePartial(digest, secondResource.id);

    const competingDigest = "f".repeat(64);
    const competingPath = `parallax-install-v1/releases/${competingDigest}/repair-eligibility.json`;
    platform.seedExternalFile(competingPath, admittedRecord);
    await expect(store.admitRepairRelease(digest)).rejects.toThrow(/competing record/u);
    expect(await platform.read(recordPath)).toEqual(admittedRecord);
    await platform.remove(competingPath);
    await expect(store.admitRepairRelease(digest)).resolves.toMatchObject({
      releaseDigest: digest,
      resourceId: firstResource.id,
      state: "repair-required",
    });
  });

  it("rejects a same-size rewritten durable repair record after restart", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", "repair-spoof.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(digest);
    const reference = await store.getResource(digest, "test-asset");
    platform.seedExternalFile(reference.path, WORLD);
    await store.verifyObject(reference);
    const recordPath = `parallax-install-v1/releases/${digest}/repair-eligibility.json`;
    const recordBytes = await platform.read(recordPath);
    if (recordBytes === null) throw new Error("Repair eligibility fixture is absent");
    const text = new TextDecoder().decode(recordBytes);
    const rewritten = text.replace(
      /"readyRecordSha256":"[a-f0-9]{64}"/u,
      `"readyRecordSha256":"${"e".repeat(64)}"`,
    );
    expect(rewritten.length).toBe(text.length);
    platform.seedExternalFile(recordPath, encoder.encode(rewritten));

    await expect(
      createOpfsReleaseStore(platform.reconstruct()).admitRepairRelease(digest),
    ).rejects.toThrow(/ready\/published\/current commit target/u);
  });

  it("makes abandonment terminal and rejects ready or committed abandonment", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const manifest = manifestBytes("game-specific", "abandoned.bin", HELLO);
    const staged = await store.stageRelease(manifest);
    await store.abandonRelease(staged.releaseDigest);
    await expect(store.stageRelease(manifest)).rejects.toThrow("cannot be staged again");
    await expect(store.beginPartial(staged.releaseDigest, "test-asset")).rejects.toThrow(
      "permanently abandoned",
    );
    await expect(
      store.appendPartial({
        bytes: HELLO,
        expectedOffset: 0,
        releaseDigest: staged.releaseDigest,
        resourceId: "test-asset",
        strongEtag: STRONG_ETAG,
      }),
    ).rejects.toThrow("permanently abandoned");
    await expect(store.finalizePartial(staged.releaseDigest, "test-asset")).rejects.toThrow(
      "permanently abandoned",
    );
    await expect(store.markReleaseReady(staged.releaseDigest)).rejects.toThrow(
      "permanently abandoned",
    );
    await expect(store.publishRelease(staged.releaseDigest)).rejects.toThrow(
      "permanently abandoned",
    );

    const ready = await install(
      store,
      platform,
      manifestBytes("game-specific", "ready.bin", WORLD),
      WORLD,
    );
    await expect(store.abandonRelease(ready)).rejects.toThrow("ready or published");
    await store.publishRelease(ready);
    await expect(store.abandonRelease(ready)).rejects.toThrow("ready or published");
  });

  it("does not authorize abandonment when marker identity differs from its directory", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    await platform.writeRecord(
      `parallax-install-v1/releases/${staged.releaseDigest}/abandoned.json`,
      encoder.encode(`${JSON.stringify({ releaseDigest: "b".repeat(64), schemaVersion: 1 })}\n`),
    );
    await store.collectGarbage({ maxEntries: 100 });
    expect(
      await platform.read(
        `parallax-install-v1/releases/${staged.releaseDigest}/install-manifest.json`,
      ),
    ).not.toBeNull();
  });

  it("rejects every release-scoped read and stale reference after finalization is abandoned", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    await store.appendPartial({
      bytes: HELLO,
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    const staleReference = await store.finalizePartial(staged.releaseDigest, "test-asset");
    await store.abandonRelease(staged.releaseDigest);

    await expect(store.getResource(staged.releaseDigest, "test-asset")).rejects.toThrow(
      "permanently abandoned",
    );
    await expect(store.verifyObject(staleReference)).rejects.toThrow("permanently abandoned");
    await expect(store.verifyRelease(staged.releaseDigest)).rejects.toThrow(
      "permanently abandoned",
    );
  });

  it("derives verification paths from manifest identity and reports missing data explicitly", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", "asset.bin", HELLO),
      HELLO,
    );
    const reference = await store.getResource(digest, "test-asset");
    await expect(
      store.verifyObject({ ...reference, path: "parallax-install-v1/releases/forged" }),
    ).rejects.toThrow("does not match");

    await platform.remove(reference.path);
    expect(await store.verifyObject(reference)).toEqual({
      bytes: 0,
      ok: false,
      sha256: bytesToHex(sha256(new Uint8Array())),
    });
    const observations: unknown[] = [];
    expect(
      await store.verifyRelease(digest, (_verified, result) => observations.push(result)),
    ).toMatchObject({ bytes: 0, ok: false });
    expect(observations).toEqual([
      { bytes: 0, ok: false, sha256: bytesToHex(sha256(new Uint8Array())) },
    ]);
    expect(store.snapshot().integrityFailures).toBe(2);
  });

  it("isolates throwing and reentrant telemetry observers from durable operations", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    let immediateCalls = 0;
    expect(() =>
      store.subscribe(() => {
        immediateCalls += 1;
        throw new Error("observer failure");
      }),
    ).toThrow("observer failure");
    await store.stageRelease(manifestBytes("game-specific", "first.bin", HELLO));
    expect(immediateCalls).toBe(1);

    let armed = false;
    store.subscribe(() => {
      if (armed) throw new Error("later observer failure");
    });
    armed = true;
    let reentrant: Promise<unknown> | undefined;
    let requested = false;
    store.subscribe((snapshot) => {
      if (!requested && snapshot.state === "staging") {
        requested = true;
        reentrant = store.reconcile();
      }
    });
    await store.stageRelease(manifestBytes("game-specific", "second.bin", WORLD));
    await expect(reentrant).resolves.toMatchObject({ recoveredPartials: 0 });
  });

  it("counts only eligible ready releases and exact canonical verified inventory", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", "asset.bin", HELLO),
      HELLO,
    );
    const reference = await store.getResource(digest, "test-asset");
    await platform.writeRecord(
      reference.path.replace(/\.data$/, ".verified.json"),
      encoder.encode(
        `${JSON.stringify({
          bytes: 5,
          schemaVersion: 1,
          scope: "game-specific",
          sha256: "b".repeat(64),
        })}\n`,
      ),
    );
    await platform.writeRecord(
      `parallax-install-v1/objects/games/parallax/sha256/${HELLO_SHA.slice(0, 2)}/nested/` +
        `${HELLO_SHA}.verified.json`,
      encoder.encode(
        `${JSON.stringify({
          bytes: 5,
          schemaVersion: 1,
          scope: "game-specific",
          sha256: HELLO_SHA,
        })}\n`,
      ),
    );
    await store.reconcile();
    expect(store.snapshot()).toMatchObject({
      readyReleaseCount: 0,
      verifiedObjectBytes: 0,
      verifiedObjectCount: 0,
    });
  });

  it("removes verified markers before data during bounded garbage collection", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const staged = await store.stageRelease(manifestBytes("game-specific", "asset.bin", HELLO));
    await store.appendPartial({
      bytes: HELLO,
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: "test-asset",
      strongEtag: STRONG_ETAG,
    });
    const reference = await store.finalizePartial(staged.releaseDigest, "test-asset");
    await store.abandonRelease(staged.releaseDigest);
    await store.collectGarbage({ maxEntries: 1 });
    expect(await platform.read(reference.path.replace(/\.data$/, ".verified.json"))).toBeNull();
    expect(await platform.read(reference.path)).toEqual(HELLO);
  });

  it("bounds checkpoints and retained commit selection metadata", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const bytes = new Uint8Array(20).fill(7);
    const staged = await store.stageRelease(manifestBytes("game-specific", "large.bin", bytes));
    for (let offset = 0; offset < bytes.byteLength; offset += 1) {
      await store.appendPartial({
        bytes: bytes.slice(offset, offset + 1),
        expectedOffset: offset,
        releaseDigest: staged.releaseDigest,
        resourceId: "test-asset",
        strongEtag: STRONG_ETAG,
      });
    }
    const checkpointRoot = `parallax-install-v1/partials/${staged.releaseDigest}/test-asset/checkpoints`;
    expect(await platform.list(checkpointRoot)).toHaveLength(2);
    await store.finalizePartial(staged.releaseDigest, "test-asset");
    await store.markReleaseReady(staged.releaseDigest);
    await store.publishRelease(staged.releaseDigest);

    const second = await install(
      store,
      platform,
      manifestBytes("game-specific", "second.bin", WORLD),
      WORLD,
    );
    await store.publishRelease(second);
    for (let iteration = 0; iteration < 80; iteration += 1) {
      await store.rollbackToPrevious();
    }
    expect(await platform.list("parallax-install-v1/commits")).toHaveLength(64);
    expect(await store.getSelection()).toEqual({
      activeReleaseDigest: second,
      previousReleaseDigest: staged.releaseDigest,
    });
  });

  it("budgets commit compaction exactly through garbage collection", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", "asset.bin", HELLO),
      HELLO,
    );
    await store.publishRelease(digest);
    await seedCommitRange(platform, digest, 2, 70);
    expect(await platform.list("parallax-install-v1/commits")).toHaveLength(70);

    const first = await store.collectGarbage({ maxEntries: 1 });
    expect(first).toMatchObject({ entriesRemoved: 1, remainingWork: true });
    expect(await platform.list("parallax-install-v1/commits")).toHaveLength(69);
    let result = first;
    while (result.remainingWork) {
      result = await store.collectGarbage({ maxEntries: 1 });
    }
    expect(await platform.list("parallax-install-v1/commits")).toHaveLength(64);
  });

  it("budgets caller-missed published-marker repair before commit pruning", async () => {
    const platform = createMemoryInstallStorePlatform();
    const store = createOpfsReleaseStore(platform);
    const digest = await install(
      store,
      platform,
      manifestBytes("game-specific", "asset.bin", HELLO),
      HELLO,
    );
    platform.setFault({ kind: "fail-after", operation: 1 });
    await expect(store.publishRelease(digest)).rejects.toThrow();
    platform.clearFault();
    await seedCommitRange(platform, digest, 2, 70);
    const markerPath = `parallax-install-v1/releases/${digest}/published.json`;
    expect(await platform.read(markerPath)).toBeNull();

    const observed = await store.reconcile({ maxCleanupEntries: 0 });
    expect(observed).toMatchObject({
      cleanupBytesRemoved: 0,
      cleanupEntriesRemoved: 0,
      cleanupMutations: 0,
      cleanupRemaining: true,
    });
    expect(await platform.read(markerPath)).toBeNull();
    expect(await platform.list("parallax-install-v1/commits")).toHaveLength(70);

    const repaired = await store.reconcile({ maxCleanupEntries: 1 });
    expect(repaired).toMatchObject({
      cleanupBytesRemoved: 0,
      cleanupEntriesRemoved: 0,
      cleanupMutations: 1,
      cleanupRemaining: true,
    });
    expect(await platform.read(markerPath)).not.toBeNull();
    expect(await platform.list("parallax-install-v1/commits")).toHaveLength(70);

    const pruned = await store.collectGarbage({ maxEntries: 1 });
    expect(pruned).toMatchObject({ entriesRemoved: 1, remainingWork: true });
    expect(await platform.list("parallax-install-v1/commits")).toHaveLength(69);
  });
});

async function preparedBatchStore(resourceCount: number): Promise<{
  readonly ids: readonly string[];
  readonly platform: MemoryInstallStorePlatform;
  readonly readCounts: ReadonlyMap<string, number>;
  readonly releaseDigest: string;
  readonly store: OpfsReleaseStore;
}> {
  const resources = Array.from({ length: resourceCount }, (_, index) => {
    const bytes = encoder.encode(`resource-${index}`);
    return {
      bytes,
      id: `resource-${index.toString().padStart(3, "0")}`,
      sha256: bytesToHex(sha256(bytes)),
    };
  });
  const manifest = encoder.encode(
    `${JSON.stringify({
      gameId: "parallax",
      resources: resources.map(({ bytes, id, sha256: digest }) => ({
        bytes: bytes.byteLength,
        id,
        kind: "asset-pack",
        scope: "game-specific",
        sha256: digest,
        source: `immutable/${id}.bin`,
        target: "opfs",
      })),
      schemaVersion: 1,
    })}\n`,
  );
  const platform = createMemoryInstallStorePlatform();
  const stagingStore = createOpfsReleaseStore(platform);
  const staged = await stagingStore.stageRelease(manifest);
  for (const resource of resources) {
    const objectRoot = `parallax-install-v1/objects/games/parallax/sha256/${resource.sha256.slice(0, 2)}/${resource.sha256}`;
    platform.seedExternalFile(`${objectRoot}.data`, resource.bytes);
    platform.seedExternalFile(
      `${objectRoot}.verified.json`,
      encoder.encode(
        `${JSON.stringify({
          bytes: resource.bytes.byteLength,
          schemaVersion: 1,
          scope: "game-specific",
          sha256: resource.sha256,
        })}\n`,
      ),
    );
  }
  const measurementPlatform = platform.reconstruct();
  const readCounts = new Map<string, number>();
  const countingPlatform: MemoryInstallStorePlatform = Object.freeze({
    ...measurementPlatform,
    async read(path: string) {
      readCounts.set(path, (readCounts.get(path) ?? 0) + 1);
      return measurementPlatform.read(path);
    },
  });
  return Object.freeze({
    ids: Object.freeze(resources.map(({ id }) => id)),
    platform: countingPlatform,
    readCounts,
    releaseDigest: staged.releaseDigest,
    store: createOpfsReleaseStore(countingPlatform),
  });
}

async function install(
  store: OpfsReleaseStore,
  _platform: MemoryInstallStorePlatform,
  manifest: Uint8Array,
  bytes: Uint8Array,
): Promise<string> {
  const staged = await store.stageRelease(manifest);
  await store.appendPartial({
    bytes,
    expectedOffset: 0,
    releaseDigest: staged.releaseDigest,
    resourceId: "test-asset",
    strongEtag: STRONG_ETAG,
  });
  await store.finalizePartial(staged.releaseDigest, "test-asset");
  await store.markReleaseReady(staged.releaseDigest);
  return staged.releaseDigest;
}

function manifestBytes(
  scope: "common" | "game-specific",
  source: string,
  bytes: Uint8Array,
): Uint8Array {
  const testResource: InstallResource = {
    bytes: bytes.byteLength,
    id: "test-asset",
    kind: "asset-pack",
    scope,
    sha256: bytesToHex(sha256(bytes)),
    source,
    target: "opfs",
  };
  const resources: InstallResource[] = [testResource].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return encoder.encode(`${JSON.stringify({ gameId: "parallax", resources, schemaVersion: 1 })}\n`);
}

function manyResourceManifest(
  resourceCount: number,
  namespace = "resource",
): Readonly<{
  manifest: Uint8Array;
  resources: readonly Readonly<{ bytes: Uint8Array; id: string; sha256: string }>[];
}> {
  const resources = Array.from({ length: resourceCount }, (_, index) => {
    const suffix = index.toString().padStart(4, "0");
    const bytes = encoder.encode(`${namespace}-${suffix}`);
    return Object.freeze({
      bytes,
      id: `${namespace}-${suffix}`,
      sha256: bytesToHex(sha256(bytes)),
    });
  });
  return Object.freeze({
    manifest: encoder.encode(
      `${JSON.stringify({
        gameId: "parallax",
        resources: resources.map((resource) => ({
          bytes: resource.bytes.byteLength,
          id: resource.id,
          kind: "asset-pack",
          scope: "game-specific",
          sha256: resource.sha256,
          source: `immutable/${resource.id}.bin`,
          target: "opfs",
        })),
        schemaVersion: 1,
      })}\n`,
    ),
    resources: Object.freeze(
      resources.map(({ bytes, id, sha256: digest }) =>
        Object.freeze({ bytes, id, sha256: digest }),
      ),
    ),
  });
}

async function installMany(
  store: OpfsReleaseStore,
  fixture: ReturnType<typeof manyResourceManifest>,
): Promise<string> {
  const staged = await store.stageRelease(fixture.manifest);
  for (const resource of fixture.resources) {
    await store.appendPartial({
      bytes: resource.bytes,
      expectedOffset: 0,
      releaseDigest: staged.releaseDigest,
      resourceId: resource.id,
      strongEtag: STRONG_ETAG,
    });
    await store.finalizePartial(staged.releaseDigest, resource.id);
  }
  await store.markReleaseReady(staged.releaseDigest);
  return staged.releaseDigest;
}

function resourcePaths(
  fixture: ReturnType<typeof manyResourceManifest>,
): readonly Readonly<{ data: string; marker: string }>[] {
  return fixture.resources.map(({ sha256: digest }) => {
    const root = `parallax-install-v1/objects/games/parallax/sha256/${digest.slice(0, 2)}/${digest}`;
    return Object.freeze({ data: `${root}.data`, marker: `${root}.verified.json` });
  });
}

async function seedCommitRange(
  platform: MemoryInstallStorePlatform,
  releaseDigest: string,
  first: number,
  last: number,
): Promise<void> {
  for (let ordinal = first; ordinal <= last; ordinal += 1) {
    await platform.writeRecord(
      `parallax-install-v1/commits/${String(ordinal).padStart(20, "0")}-${releaseDigest}.json`,
      encoder.encode(`${JSON.stringify({ ordinal, releaseDigest, schemaVersion: 1 })}\n`),
    );
  }
}
