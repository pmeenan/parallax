import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  admitOfflineShellGeneration,
  failedOfflineShellTelemetrySnapshot,
  INSTALL_STORE_LOCK_NAME,
  initialOfflineShellStoreRecord,
  OFFLINE_SHELL_LOCK_NAME,
  OFFLINE_SHELL_PREPARE_LOCK_NAME,
  type OfflineShellFetchedResource,
  type OfflineShellStorePlatform,
  type OfflineShellStoreRecord,
  parseOfflineShellTelemetry,
  prepareAndActivateOfflineShellGeneration,
  resolveOfflineShellRequestFailureTelemetry,
  resolveOfflineShellResource,
  withUninstallDeletionAuthority,
} from "../src/index";

interface BuildFixture {
  readonly appPath: string;
  readonly build: unknown;
  readonly install: unknown;
  readonly network: ReadonlyMap<string, OfflineShellFetchedResource>;
  readonly releaseDigest: string;
}

class MemoryPlatform implements OfflineShellStorePlatform {
  public beforeFetch: (path: string) => Promise<void> = () => Promise.resolve();
  public beforeMatch: (generationId: string, path: string) => Promise<void> = () =>
    Promise.resolve();
  public beforePut: (generationId: string, path: string) => Promise<void> = () => Promise.resolve();
  public readonly caches = new Map<string, Map<string, OfflineShellFetchedResource>>();
  public readonly operations: string[] = [];
  public readonly origin = "https://parallax.test";
  public readonly writes: OfflineShellStoreRecord[] = [];
  public deleteFailureGenerationId: string | null = null;
  public writeFailureGenerationId: string | null = null;
  public network = new Map<string, OfflineShellFetchedResource>();
  public readonly longOperationsUnderExclusive: string[] = [];
  private clock = 0;
  private exclusiveDepth = 0;
  private record = initialOfflineShellStoreRecord();
  private queue = Promise.resolve();
  private prepareQueue = Promise.resolve();

  public async collectGenerations(retainedGenerationIds: ReadonlySet<string>): Promise<void> {
    for (const generationId of [...this.caches.keys()]) {
      if (!retainedGenerationIds.has(generationId)) await this.deleteGeneration(generationId);
    }
  }

  public deleteGeneration(generationId: string): Promise<void> {
    if (this.exclusiveDepth > 0) this.longOperationsUnderExclusive.push("delete");
    this.operations.push(`delete:${generationId}`);
    if (generationId === this.deleteFailureGenerationId) {
      return Promise.reject(new Error(`cache deletion failed: ${generationId}`));
    }
    this.caches.delete(generationId);
    return Promise.resolve();
  }

  public async fetch(path: string): Promise<OfflineShellFetchedResource> {
    if (this.exclusiveDepth > 0) this.longOperationsUnderExclusive.push("fetch");
    await this.beforeFetch(path);
    const response = this.network.get(path);
    if (response === undefined) throw new Error(`offline network miss: ${path}`);
    return cloneResponse(response);
  }

  public async match(
    generationId: string,
    path: string,
  ): Promise<OfflineShellFetchedResource | null> {
    if (this.exclusiveDepth > 0) this.longOperationsUnderExclusive.push("match");
    await this.beforeMatch(generationId, path);
    const response = this.caches.get(generationId)?.get(path);
    return response === undefined ? null : cloneResponse(response);
  }

  public now(): number {
    this.clock += 1;
    return this.clock;
  }

  public async put(
    generationId: string,
    path: string,
    response: OfflineShellFetchedResource,
  ): Promise<void> {
    if (this.exclusiveDepth > 0) this.longOperationsUnderExclusive.push("put");
    await this.beforePut(generationId, path);
    let cache = this.caches.get(generationId);
    if (cache === undefined) {
      cache = new Map();
      this.caches.set(generationId, cache);
    }
    cache.set(path, cloneResponse(response));
  }

  public readRecord(): Promise<OfflineShellStoreRecord> {
    return Promise.resolve(this.record);
  }

  public runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const guarded = async () => {
      if (this.exclusiveDepth !== 0) throw new Error("nested offline-shell exclusive lock");
      this.exclusiveDepth += 1;
      try {
        return await operation();
      } finally {
        this.exclusiveDepth -= 1;
      }
    };
    const result = this.queue.then(guarded, guarded);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  public runPrepareExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.prepareQueue.then(operation, operation);
    this.prepareQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  public updateRecord(
    update: (record: OfflineShellStoreRecord) => OfflineShellStoreRecord,
  ): Promise<OfflineShellStoreRecord> {
    this.record = update(this.record);
    this.writes.push(this.record);
    return Promise.resolve(this.record);
  }

  public writeRecord(record: OfflineShellStoreRecord): Promise<void> {
    if (
      record.active?.generationId === this.writeFailureGenerationId &&
      record.candidate === null
    ) {
      this.operations.push(`write-failed:${record.active.generationId}`);
      return Promise.reject(new Error(`selection write failed: ${record.active.generationId}`));
    }
    this.record = record;
    this.writes.push(record);
    this.operations.push(`write:${record.active?.generationId ?? "none"}`);
    return Promise.resolve();
  }
}

describe("offline shell generation store", () => {
  it("keeps existing-generation resolution live while an update fetch is blocked", async () => {
    const first = buildFixture("blocked-old");
    const second = buildFixture("blocked-new");
    const platform = platformFor(first);
    const active = await prepareAndActivateOfflineShellGeneration(platform, first.appPath);
    platform.network = new Map(second.network);
    let releaseFetch!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let reportFetch!: () => void;
    const entered = new Promise<void>((resolve) => {
      reportFetch = resolve;
    });
    platform.beforeFetch = async (path) => {
      if (path === "build-manifest.json") {
        reportFetch();
        await blocked;
      }
    };

    const update = prepareAndActivateOfflineShellGeneration(platform, second.appPath, {
      allowUpdate: true,
    });
    await entered;
    await expect(resolveOfflineShellResource(platform, "index.html")).resolves.toMatchObject({
      generationId: active.generationId,
    });
    releaseFetch();
    await expect(update).resolves.toMatchObject({ appEntrypoint: { path: second.appPath } });
  });

  it("serializes same-target prepares and converges on one populated generation", async () => {
    const fixture = buildFixture("concurrent-same");
    const platform = platformFor(fixture);
    const [first, second] = await Promise.all([
      prepareAndActivateOfflineShellGeneration(platform, fixture.appPath),
      prepareAndActivateOfflineShellGeneration(platform, fixture.appPath),
    ]);

    expect(second.generationId).toBe(first.generationId);
    expect(platform.caches.size).toBe(1);
    expect((await platform.readRecord()).telemetry).toMatchObject({
      activateCount: 1,
      prepareCount: 1,
    });
  });

  it("rejects stale target activation when rollback changes selection during transfer", async () => {
    const oldestFixture = buildFixture("drift-oldest");
    const activeFixture = buildFixture("drift-active");
    const targetFixture = buildFixture("drift-target");
    const platform = platformFor(oldestFixture);
    const oldest = await prepareAndActivateOfflineShellGeneration(platform, oldestFixture.appPath);
    platform.network = new Map(activeFixture.network);
    const active = await prepareAndActivateOfflineShellGeneration(platform, activeFixture.appPath, {
      allowUpdate: true,
    });
    platform.caches.get(active.generationId)?.delete("index.html");
    platform.network = new Map(targetFixture.network);
    let releaseFetch!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let reportFetch!: () => void;
    const entered = new Promise<void>((resolve) => {
      reportFetch = resolve;
    });
    platform.beforeFetch = async (path) => {
      if (path === targetFixture.appPath) {
        reportFetch();
        await blocked;
      }
    };

    const update = prepareAndActivateOfflineShellGeneration(platform, targetFixture.appPath, {
      allowUpdate: true,
    });
    await entered;
    await expect(resolveOfflineShellResource(platform, "index.html")).resolves.toMatchObject({
      generationId: oldest.generationId,
    });
    releaseFetch();
    await expect(update).rejects.toMatchObject({ code: "shell-release-mismatch" });
    expect((await platform.readRecord()).active?.generationId).toBe(oldest.generationId);
  });

  it("never deletes or repopulates an authorized previous generation used as the target", async () => {
    const first = buildFixture("reuse-previous");
    const second = buildFixture("reuse-active");
    const platform = platformFor(first);
    const previous = await prepareAndActivateOfflineShellGeneration(platform, first.appPath);
    platform.network = new Map(second.network);
    await prepareAndActivateOfflineShellGeneration(platform, second.appPath, { allowUpdate: true });
    platform.network = new Map(first.network);
    const before = platform.caches.get(previous.generationId);
    if (before === undefined) throw new Error("previous cache is missing");
    before.delete("index.html");
    platform.operations.length = 0;

    await expect(
      prepareAndActivateOfflineShellGeneration(platform, first.appPath, { allowUpdate: true }),
    ).rejects.toMatchObject({ code: "shell-unavailable" });
    expect(platform.operations).not.toContain(`delete:${previous.generationId}`);
    expect(platform.caches.get(previous.generationId)).toBe(before);
  });

  it("makes uninstall wait for a blocked initial fetch and leaves shell storage empty", async () => {
    const fixture = buildFixture("uninstall-fetch");
    const platform = platformFor(fixture);
    const databases = new Set(["parallax-offline-shell-v1"]);
    let releaseFetch!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let reportFetch!: () => void;
    const entered = new Promise<void>((resolve) => {
      reportFetch = resolve;
    });
    platform.beforeFetch = async (path) => {
      if (path === "build-manifest.json") {
        reportFetch();
        await blocked;
      }
    };
    const authority = uninstallAuthorityFor(platform);
    let teardownStarted = false;

    const prepare = prepareAndActivateOfflineShellGeneration(platform, fixture.appPath);
    await entered;
    const uninstall = authority(async () => {
      teardownStarted = true;
      platform.caches.clear();
      databases.clear();
      await platform.writeRecord(initialOfflineShellStoreRecord());
    });
    await Promise.resolve();
    expect(teardownStarted).toBe(false);

    releaseFetch();
    await prepare;
    await uninstall;
    expect(platform.caches.size).toBe(0);
    expect([...databases]).toEqual([]);
    expect(await platform.readRecord()).toEqual(initialOfflineShellStoreRecord());
  });

  it("makes uninstall wait for blocked candidate population and leaves shell storage empty", async () => {
    const fixture = buildFixture("uninstall-population");
    const platform = platformFor(fixture);
    const databases = new Set(["parallax-offline-shell-v1"]);
    let releasePut!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    let reportPut!: () => void;
    const entered = new Promise<void>((resolve) => {
      reportPut = resolve;
    });
    let blockedOnce = false;
    platform.beforePut = async () => {
      if (!blockedOnce) {
        blockedOnce = true;
        reportPut();
        await blocked;
      }
    };
    const authority = uninstallAuthorityFor(platform);
    let teardownStarted = false;

    const prepare = prepareAndActivateOfflineShellGeneration(platform, fixture.appPath);
    await entered;
    const uninstall = authority(async () => {
      teardownStarted = true;
      platform.caches.clear();
      databases.clear();
      await platform.writeRecord(initialOfflineShellStoreRecord());
    });
    await Promise.resolve();
    expect(teardownStarted).toBe(false);

    releasePut();
    await prepare;
    await uninstall;
    expect(platform.caches.size).toBe(0);
    expect([...databases]).toEqual([]);
    expect(await platform.readRecord()).toEqual(initialOfflineShellStoreRecord());
  });

  it("removes its fresh candidate when rollback clears candidate metadata during verification", async () => {
    const previousFixture = buildFixture("rollback-b");
    const activeFixture = buildFixture("rollback-a");
    const candidateFixture = buildFixture("rollback-c");
    const platform = platformFor(previousFixture);
    const previous = await prepareAndActivateOfflineShellGeneration(
      platform,
      previousFixture.appPath,
    );
    platform.network = new Map(activeFixture.network);
    const active = await prepareAndActivateOfflineShellGeneration(platform, activeFixture.appPath, {
      allowUpdate: true,
    });
    platform.caches.get(active.generationId)?.delete("index.html");
    platform.network = new Map(candidateFixture.network);
    const candidateId = `${sha256(jsonBytes(candidateFixture.build))}:${candidateFixture.releaseDigest}`;
    let releaseMatch!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseMatch = resolve;
    });
    let reportMatch!: () => void;
    const entered = new Promise<void>((resolve) => {
      reportMatch = resolve;
    });
    let blockedOnce = false;
    platform.beforeMatch = async (generationId) => {
      if (generationId === candidateId && !blockedOnce) {
        blockedOnce = true;
        reportMatch();
        await blocked;
      }
    };

    const update = prepareAndActivateOfflineShellGeneration(platform, candidateFixture.appPath, {
      allowUpdate: true,
    });
    await entered;
    await expect(resolveOfflineShellResource(platform, "index.html")).resolves.toMatchObject({
      generationId: previous.generationId,
    });
    releaseMatch();
    await expect(update).rejects.toMatchObject({ code: "shell-release-mismatch" });
    expect((await platform.readRecord()).active?.generationId).toBe(previous.generationId);
    expect(platform.caches.has(previous.generationId)).toBe(true);
    expect(platform.caches.has(candidateId)).toBe(false);
  });

  it("keeps transfer, population, and full verification outside the selection lock", async () => {
    const fixture = buildFixture("lock-audit");
    const platform = platformFor(fixture);
    await prepareAndActivateOfflineShellGeneration(platform, fixture.appPath);
    expect(platform.longOperationsUnderExclusive).toEqual([]);
  });

  it("populates and verifies a complete candidate before selecting it", async () => {
    const fixture = buildFixture("a");
    const platform = platformFor(fixture);
    const generation = await prepareAndActivateOfflineShellGeneration(platform, fixture.appPath);

    expect(generation.releaseDigest).toBe(fixture.releaseDigest);
    expect(
      platform.writes.some((record) => record.candidate !== null && record.active === null),
    ).toBe(true);
    const firstActive = platform.writes.findIndex((record) => record.active !== null);
    expect(firstActive).toBeGreaterThan(0);
    expect(platform.caches.get(generation.generationId)?.size).toBe(generation.resources.length);
    expect(platform.writes.at(-1)?.telemetry).toMatchObject({
      activateCount: 1,
      mixedGenerationCount: 0,
      prepareCount: 1,
      state: "active",
      verifyCount: 1,
    });
  });

  it("normalizes parameters around the one application/javascript shell MIME essence", async () => {
    const fixture = buildFixture("mime-parameters");
    const platform = platformFor(fixture);
    platform.network = new Map(
      [...platform.network].map(([path, fetched]) => [
        path,
        path.endsWith(".js")
          ? mutateHeader(fetched, "content-type", "application/javascript; charset=utf-8")
          : fetched,
      ]),
    );

    const generation = await prepareAndActivateOfflineShellGeneration(platform, fixture.appPath);

    expect(
      generation.resources
        .filter((resource) => resource.path.endsWith(".js"))
        .map((resource) => resource.mimeType),
    ).toEqual(
      generation.resources
        .filter((resource) => resource.path.endsWith(".js"))
        .map(() => "application/javascript"),
    );
  });

  it("rejects text/javascript even though browsers recognize it as a script MIME", async () => {
    const fixture = buildFixture("mime-alias");
    const platform = platformFor(fixture);
    const app = platform.network.get(fixture.appPath);
    if (app === undefined) throw new Error("Fixture app response is missing");
    platform.network.set(
      fixture.appPath,
      mutateHeader(app, "content-type", "text/javascript; charset=utf-8"),
    );

    await expect(
      prepareAndActivateOfflineShellGeneration(platform, fixture.appPath),
    ).rejects.toMatchObject({ code: "shell-contract" });
    expect((await platform.readRecord()).active).toBeNull();
  });

  it("leaves the active generation untouched when a replacement candidate fails", async () => {
    const first = buildFixture("a");
    const second = buildFixture("b");
    const platform = platformFor(first);
    const active = await prepareAndActivateOfflineShellGeneration(platform, first.appPath);
    platform.network = new Map(second.network);
    const enginePath = [...platform.network.keys()].find((path) =>
      path.startsWith("immutable/engine-"),
    );
    if (enginePath === undefined) throw new Error("fixture engine response is missing");
    platform.network.delete(enginePath);

    await expect(
      prepareAndActivateOfflineShellGeneration(platform, second.appPath, {
        allowUpdate: true,
      }),
    ).rejects.toThrow(/network miss/);

    const record = await platform.readRecord();
    expect(record.active?.generationId).toBe(active.generationId);
    expect(record.previous).toBeNull();
    expect(record.candidate).toBeNull();
    expect(record.telemetry).toMatchObject({
      failureCount: 1,
      mixedGenerationCount: 0,
      state: "failed",
    });
  });

  it("cleans only the failed staged generation after population and preserves rollback authority", async () => {
    const first = buildFixture("post-publish-old");
    const second = buildFixture("post-publish-new");
    const platform = platformFor(first);
    const active = await prepareAndActivateOfflineShellGeneration(platform, first.appPath);
    platform.network = new Map(second.network);
    const candidateId = `${sha256(jsonBytes(second.build))}:${second.releaseDigest}`;
    let corrupted = false;
    platform.beforeMatch = (generationId, path) => {
      if (generationId === candidateId && !corrupted) {
        const cached = platform.caches.get(generationId)?.get(path);
        if (cached === undefined) throw new Error("staged candidate response is missing");
        platform.caches
          .get(generationId)
          ?.set(path, Object.freeze({ ...cached, bytes: Uint8Array.of(1, 2, 3) }));
        corrupted = true;
      }
      return Promise.resolve();
    };

    await expect(
      prepareAndActivateOfflineShellGeneration(platform, second.appPath, { allowUpdate: true }),
    ).rejects.toMatchObject({ code: "shell-contract" });

    const record = await platform.readRecord();
    expect(record.active?.generationId).toBe(active.generationId);
    expect(record.previous).toBeNull();
    expect(record.candidate).toBeNull();
    expect(platform.caches.has(active.generationId)).toBe(true);
    expect(platform.caches.has(candidateId)).toBe(false);
  });

  it("records partial verification work when a later candidate resource is corrupt", async () => {
    const fixture = buildFixture("a");
    const platform = platformFor(fixture);
    let matchCount = 0;
    platform.beforeMatch = (generationId, path) => {
      matchCount += 1;
      if (matchCount === 3) {
        const cached = platform.caches.get(generationId)?.get(path);
        if (cached === undefined) throw new Error(`candidate cache is missing ${path}`);
        platform.caches
          .get(generationId)
          ?.set(path, Object.freeze({ ...cached, bytes: Uint8Array.of(1, 2, 3) }));
      }
      return Promise.resolve();
    };

    await expect(
      prepareAndActivateOfflineShellGeneration(platform, fixture.appPath),
    ).rejects.toThrow();

    const record = await platform.readRecord();
    expect(matchCount).toBe(3);
    expect(record.active).toBeNull();
    expect(record.candidate).toBeNull();
    expect(record.telemetry).toMatchObject({
      failureCount: 1,
      state: "failed",
      verifyCount: 1,
    });
    expect(record.telemetry.verifiedBytes).toBeGreaterThan(0);
    expect(record.telemetry.verifyDurationMs).toBeGreaterThan(0);
    expect(record.telemetry.verifyHighWaterMs).toBeGreaterThan(0);
  });

  it("records partial cached-active verification before default-path rollback", async () => {
    const first = buildFixture("a");
    const second = buildFixture("b");
    const platform = platformFor(first);
    const previous = await prepareAndActivateOfflineShellGeneration(platform, first.appPath);
    platform.network = new Map(second.network);
    const active = await prepareAndActivateOfflineShellGeneration(platform, second.appPath, {
      allowUpdate: true,
    });
    const before = await platform.readRecord();
    let matchCount = 0;
    platform.beforeMatch = (generationId, path) => {
      if (generationId === active.generationId) {
        matchCount += 1;
        if (matchCount === 3) {
          const cached = platform.caches.get(generationId)?.get(path);
          if (cached === undefined) throw new Error(`active cache is missing ${path}`);
          platform.caches
            .get(generationId)
            ?.set(path, Object.freeze({ ...cached, bytes: Uint8Array.of(1, 2, 3) }));
        }
      }
      return Promise.resolve();
    };

    await expect(
      prepareAndActivateOfflineShellGeneration(platform, active.appEntrypoint.path),
    ).rejects.toMatchObject({ code: "shell-release-mismatch" });

    const record = await platform.readRecord();
    const partialActiveBytes = active.resources
      .slice(0, 2)
      .reduce((total, resource) => total + resource.bytes, 0);
    const previousBytes = previous.resources.reduce((total, resource) => total + resource.bytes, 0);
    expect(matchCount).toBe(3);
    expect(record.active?.generationId).toBe(previous.generationId);
    expect(record.telemetry).toMatchObject({
      rollbackCount: before.telemetry.rollbackCount + 1,
      state: "active",
      verifiedBytes: before.telemetry.verifiedBytes + partialActiveBytes + previousBytes,
      verifyCount: before.telemetry.verifyCount + 2,
      verifyDurationMs: before.telemetry.verifyDurationMs + 2,
    });
  });

  it("retains one exact previous generation and rolls back without mixing resources", async () => {
    const first = buildFixture("a");
    const second = buildFixture("b");
    const platform = platformFor(first);
    const previous = await prepareAndActivateOfflineShellGeneration(platform, first.appPath);
    platform.network = new Map(second.network);
    const active = await prepareAndActivateOfflineShellGeneration(platform, second.appPath, {
      allowUpdate: true,
    });
    expect((await platform.readRecord()).previous?.generationId).toBe(previous.generationId);

    platform.caches.get(active.generationId)?.delete("index.html");
    platform.deleteFailureGenerationId = active.generationId;
    const recoveredNavigation = await resolveOfflineShellResource(platform, "index.html");
    expect(recoveredNavigation?.generationId).toBe(previous.generationId);

    const rolledBack = await platform.readRecord();
    expect(rolledBack.active?.generationId).toBe(previous.generationId);
    expect(rolledBack.previous).toBeNull();
    expect(rolledBack.telemetry).toMatchObject({
      mixedGenerationCount: 0,
      rollbackCount: 1,
    });
    await expect(resolveOfflineShellResource(platform, active.appEntrypoint.path)).rejects.toThrow(
      /mix/,
    );
    expect((await platform.readRecord()).telemetry.mixedGenerationCount).toBe(1);
    expect(platform.caches.has(active.generationId)).toBe(true);
  });

  it.each([
    "shell-contract",
    "shell-release-mismatch",
    "shell-unavailable",
  ] as const)("constructs contract-valid fallback telemetry for %s", (code) => {
    const diagnostic = `${code} diagnostic`;
    const telemetry = failedOfflineShellTelemetrySnapshot(code, diagnostic);
    expect(parseOfflineShellTelemetry(telemetry)).toEqual(telemetry);
    expect(telemetry).toMatchObject({
      failureCode: code,
      failureCount: 1,
      failureMessage: diagnostic,
      schemaVersion: 2,
      state: "failed",
    });
  });

  it("preserves the durable active/previous pair when the candidate selection write fails", async () => {
    const first = buildFixture("a");
    const second = buildFixture("b");
    const third = buildFixture("c");
    const platform = platformFor(first);
    const oldest = await prepareAndActivateOfflineShellGeneration(platform, first.appPath);
    platform.network = new Map(second.network);
    const active = await prepareAndActivateOfflineShellGeneration(platform, second.appPath, {
      allowUpdate: true,
    });
    platform.network = new Map(third.network);
    const candidateId = `${sha256(jsonBytes(third.build))}:${third.releaseDigest}`;
    platform.writeFailureGenerationId = candidateId;

    await expect(
      prepareAndActivateOfflineShellGeneration(platform, third.appPath, {
        allowUpdate: true,
      }),
    ).rejects.toThrow(/selection write failed/);
    const record = await platform.readRecord();
    expect(record.active?.generationId).toBe(active.generationId);
    expect(record.previous?.generationId).toBe(oldest.generationId);
    expect(record.candidate).toBeNull();
    expect(platform.caches.has(candidateId)).toBe(false);
    expect(platform.caches.has(active.generationId)).toBe(true);
    expect(platform.caches.has(oldest.generationId)).toBe(true);
    expect(record.telemetry).toMatchObject({
      failureCount: 1,
      state: "failed",
    });
  });

  it("commits the third-generation selection before garbage-collecting the obsolete cache", async () => {
    const first = buildFixture("a");
    const second = buildFixture("b");
    const third = buildFixture("c");
    const platform = platformFor(first);
    const oldest = await prepareAndActivateOfflineShellGeneration(platform, first.appPath);
    platform.network = new Map(second.network);
    const previous = await prepareAndActivateOfflineShellGeneration(platform, second.appPath, {
      allowUpdate: true,
    });
    platform.operations.length = 0;
    platform.network = new Map(third.network);

    const active = await prepareAndActivateOfflineShellGeneration(platform, third.appPath, {
      allowUpdate: true,
    });

    const committed = platform.operations.indexOf(`write:${active.generationId}`);
    const collected = platform.operations.indexOf(`delete:${oldest.generationId}`);
    expect(committed).toBeGreaterThanOrEqual(0);
    expect(collected).toBeGreaterThan(committed);
    expect(await platform.readRecord()).toMatchObject({
      active: { generationId: active.generationId },
      previous: { generationId: previous.generationId },
    });
  });

  it("keeps a committed third generation active when obsolete-cache GC fails", async () => {
    const first = buildFixture("a");
    const second = buildFixture("b");
    const third = buildFixture("c");
    const platform = platformFor(first);
    const orphan = await prepareAndActivateOfflineShellGeneration(platform, first.appPath);
    platform.network = new Map(second.network);
    const previous = await prepareAndActivateOfflineShellGeneration(platform, second.appPath, {
      allowUpdate: true,
    });
    platform.network = new Map(third.network);
    platform.deleteFailureGenerationId = orphan.generationId;

    const active = await prepareAndActivateOfflineShellGeneration(platform, third.appPath, {
      allowUpdate: true,
    });

    expect(await platform.readRecord()).toMatchObject({
      active: { generationId: active.generationId },
      previous: { generationId: previous.generationId },
      telemetry: { failureCount: 0, state: "active" },
    });
    expect(platform.caches.has(orphan.generationId)).toBe(true);
    expect(platform.caches.has(previous.generationId)).toBe(true);
    expect(platform.caches.has(active.generationId)).toBe(true);

    platform.deleteFailureGenerationId = null;
    await prepareAndActivateOfflineShellGeneration(platform, active.appEntrypoint.path);
    expect(platform.caches.has(orphan.generationId)).toBe(false);
  });

  it.each([
    [
      "MIME",
      (response: OfflineShellFetchedResource) =>
        mutateHeader(response, "content-type", "text/plain"),
    ],
    [
      "isolation",
      (response: OfflineShellFetchedResource) =>
        mutateHeader(response, "cross-origin-opener-policy", "unsafe-none"),
    ],
    [
      "cache policy",
      (response: OfflineShellFetchedResource) =>
        mutateHeader(response, "cache-control", "public, max-age=60"),
    ],
    [
      "hash",
      (response: OfflineShellFetchedResource) =>
        Object.freeze({ ...response, bytes: Uint8Array.of(1, 2, 3) }),
    ],
    [
      "origin",
      (response: OfflineShellFetchedResource) =>
        Object.freeze({
          ...response,
          url: new URL(response.url).href.replace("parallax.test", "other.test"),
        }),
    ],
  ])("rejects a candidate with an invalid %s contract", async (_label, mutate) => {
    const fixture = buildFixture("a");
    const platform = platformFor(fixture);
    const response = platform.network.get("index.html");
    if (response === undefined) throw new Error("fixture index response is missing");
    platform.network.set("index.html", mutate(response));

    await expect(
      prepareAndActivateOfflineShellGeneration(platform, fixture.appPath),
    ).rejects.toThrow();
    expect((await platform.readRecord()).active).toBeNull();
  });

  it("serves cached target discovery offline and makes repeat preparation idempotent", async () => {
    const fixture = buildFixture("a");
    const platform = platformFor(fixture);
    const generation = await prepareAndActivateOfflineShellGeneration(platform, fixture.appPath);
    platform.network.clear();

    await expect(
      prepareAndActivateOfflineShellGeneration(platform, fixture.appPath, {
        allowUpdate: true,
      }),
    ).resolves.toEqual(generation);
    const build = await resolveOfflineShellResource(platform, "build-manifest.json");
    const install = await resolveOfflineShellResource(platform, "install-manifest.json");
    expect(JSON.parse(new TextDecoder().decode(build?.response.bytes))).toMatchObject({
      offlineShell: { generationSchemaVersion: 1, saveSchemaVersion: 1 },
      schemaVersion: 15,
    });
    expect(JSON.parse(new TextDecoder().decode(install?.response.bytes))).toMatchObject({
      schemaVersion: 1,
    });
    expect((await platform.readRecord()).telemetry).toMatchObject({
      activateCount: 1,
      cacheHitCount: 2,
      prepareCount: 1,
      verifyCount: 2,
    });
  });

  it("revalidates the exact selected generation for launch admission", async () => {
    const fixture = buildFixture("a");
    const platform = platformFor(fixture);
    const generation = await prepareAndActivateOfflineShellGeneration(platform, fixture.appPath);
    const before = await platform.readRecord();

    await expect(
      admitOfflineShellGeneration(platform, {
        generationId: generation.generationId,
        releaseDigest: generation.releaseDigest,
      }),
    ).resolves.toMatchObject({
      activeGenerationId: generation.generationId,
      activeReleaseDigest: generation.releaseDigest,
      state: "active",
      verifiedBytes:
        before.telemetry.verifiedBytes +
        generation.resources.reduce((total, resource) => total + resource.bytes, 0),
      verifyCount: before.telemetry.verifyCount + 1,
      verifyDurationMs: before.telemetry.verifyDurationMs + 1,
    });
    const beforeMismatch = await platform.readRecord();
    let mismatch: unknown;
    try {
      await admitOfflineShellGeneration(platform, {
        generationId: `${"f".repeat(64)}:${generation.releaseDigest}`,
        releaseDigest: generation.releaseDigest,
      });
    } catch (error: unknown) {
      mismatch = error;
    }
    expect(mismatch).toMatchObject({
      code: "shell-release-mismatch",
      name: "OfflineShellAdmissionMismatchError",
    });
    await expect(
      resolveOfflineShellRequestFailureTelemetry(
        platform,
        mismatch,
        "shell-release-mismatch",
        "Selected offline shell changed before launch admission",
      ),
    ).resolves.toMatchObject({
      activeGenerationId: beforeMismatch.telemetry.activeGenerationId,
      activeReleaseDigest: beforeMismatch.telemetry.activeReleaseDigest,
      failureCode: "shell-release-mismatch",
      failureCount: beforeMismatch.telemetry.failureCount + 1,
      failureMessage: "Selected offline shell changed before launch admission",
      state: "failed",
    });
    expect(await platform.readRecord()).toEqual(beforeMismatch);
  });

  it("records a corrupt-cache admission rejection with exact failure telemetry", async () => {
    const fixture = buildFixture("a");
    const platform = platformFor(fixture);
    const generation = await prepareAndActivateOfflineShellGeneration(platform, fixture.appPath);
    const before = await platform.readRecord();
    platform.caches.get(generation.generationId)?.delete("index.html");

    let rejection: unknown;
    try {
      await admitOfflineShellGeneration(platform, {
        generationId: generation.generationId,
        releaseDigest: generation.releaseDigest,
      });
    } catch (error: unknown) {
      rejection = error;
    }

    expect(rejection).toMatchObject({ code: "shell-unavailable" });
    const record = await platform.readRecord();
    expect(record.active?.generationId).toBe(generation.generationId);
    expect(record.telemetry).toMatchObject({
      failureCode: "shell-unavailable",
      failureCount: 1,
      failureMessage: (rejection as Error).message,
      state: "failed",
      verifiedBytes:
        before.telemetry.verifiedBytes +
        generation.resources
          .slice(
            0,
            generation.resources.findIndex((resource) => resource.path === "index.html"),
          )
          .reduce((total, resource) => total + resource.bytes, 0),
    });
  });

  it("records a typed failed admission after corrupt active selection rolls back", async () => {
    const first = buildFixture("a");
    const second = buildFixture("b");
    const platform = platformFor(first);
    const previous = await prepareAndActivateOfflineShellGeneration(platform, first.appPath);
    platform.network = new Map(second.network);
    const active = await prepareAndActivateOfflineShellGeneration(platform, second.appPath, {
      allowUpdate: true,
    });
    platform.caches.get(active.generationId)?.delete("index.html");

    await expect(
      admitOfflineShellGeneration(platform, {
        generationId: active.generationId,
        releaseDigest: active.releaseDigest,
      }),
    ).rejects.toMatchObject({
      code: "shell-release-mismatch",
      message: "Selected offline shell failed launch admission and was rolled back",
    });

    const record = await platform.readRecord();
    expect(record.active?.generationId).toBe(previous.generationId);
    expect(record.previous).toBeNull();
    expect(record.telemetry).toMatchObject({
      activeGenerationId: previous.generationId,
      failureCode: "shell-release-mismatch",
      failureCount: 1,
      failureMessage: "Selected offline shell failed launch admission and was rolled back",
      rollbackCount: 1,
      state: "failed",
    });
  });

  it("serializes fetch dispatch against an atomic generation change", async () => {
    const first = buildFixture("a");
    const second = buildFixture("b");
    const platform = platformFor(first);
    const previous = await prepareAndActivateOfflineShellGeneration(platform, first.appPath);
    let releaseMatch!: () => void;
    const matchBlocked = new Promise<void>((resolve) => {
      releaseMatch = resolve;
    });
    let matchEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      matchEntered = resolve;
    });
    platform.beforeMatch = async (generationId, path) => {
      if (generationId === previous.generationId && path === "index.html") {
        matchEntered();
        await matchBlocked;
      }
    };

    const dispatch = resolveOfflineShellResource(platform, "index.html");
    await entered;
    platform.network = new Map(second.network);
    const update = prepareAndActivateOfflineShellGeneration(platform, second.appPath, {
      allowUpdate: true,
    });
    expect((await platform.readRecord()).active?.generationId).toBe(previous.generationId);

    releaseMatch();
    await expect(dispatch).resolves.toMatchObject({ generationId: previous.generationId });
    const active = await update;
    expect((await platform.readRecord()).active?.generationId).toBe(active.generationId);
  });

  it("rejects an incompatible save-schema generation before selection", async () => {
    const fixture = buildFixture("a", 2);
    const platform = platformFor(fixture);
    await expect(
      prepareAndActivateOfflineShellGeneration(platform, fixture.appPath),
    ).rejects.toThrow(/compatible/);
    expect((await platform.readRecord()).active).toBeNull();
  });
});

function platformFor(fixture: BuildFixture): MemoryPlatform {
  const platform = new MemoryPlatform();
  platform.network = new Map(fixture.network);
  return platform;
}

function uninstallAuthorityFor(
  platform: MemoryPlatform,
): <T>(operation: () => Promise<T>) => Promise<T> {
  let installQueue = Promise.resolve();
  return <T>(operation: () => Promise<T>) =>
    withUninstallDeletionAuthority(<R>(name: string, lockedOperation: () => Promise<R>) => {
      if (name === OFFLINE_SHELL_PREPARE_LOCK_NAME) {
        return platform.runPrepareExclusive(lockedOperation);
      }
      if (name === OFFLINE_SHELL_LOCK_NAME) return platform.runExclusive(lockedOperation);
      if (name !== INSTALL_STORE_LOCK_NAME)
        return Promise.reject(new Error(`unknown lock ${name}`));
      const result = installQueue.then(lockedOperation, lockedOperation);
      installQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }, operation);
}

function buildFixture(token: string, saveSchemaVersion = 1): BuildFixture {
  const source = (name: string, mimeType: string, cacheControl: string) => {
    const bytes = new TextEncoder().encode(`${name}-${token}\n`);
    return {
      artifact: {
        bytes: bytes.byteLength,
        path: name,
        sha256: sha256(bytes),
      },
      bytes,
      response: response(name, bytes, mimeType, cacheControl),
    };
  };
  const index = source("index.html", "text/html", "no-cache");
  const serviceWorker = source("service-worker.js", "application/javascript", "no-cache");
  const appBytes = new TextEncoder().encode(`app-${token}\n`);
  const appHash = sha256(appBytes);
  const appPath = `immutable/app-${appHash}.js`;
  const app = {
    artifact: { bytes: appBytes.byteLength, path: appPath, sha256: appHash },
    bytes: appBytes,
    response: response(
      appPath,
      appBytes,
      "application/javascript",
      "public, max-age=31536000, immutable",
    ),
  };
  const engineBytes = new TextEncoder().encode(`engine-${token}\n`);
  const engineHash = sha256(engineBytes);
  const enginePath = `immutable/engine-${engineHash}.js`;
  const engine = {
    artifact: { bytes: engineBytes.byteLength, path: enginePath, sha256: engineHash },
    bytes: engineBytes,
    response: response(
      enginePath,
      engineBytes,
      "application/javascript",
      "public, max-age=31536000, immutable",
    ),
  };
  const workers = ["decode", "installer", "render", "streaming", "wasm-thread"].map((role) => {
    const bytes = new TextEncoder().encode(`${role}-${token}\n`);
    const hash = sha256(bytes);
    const path = `immutable/${role}-worker-${hash}.js`;
    return {
      artifact: { bytes: bytes.byteLength, path, sha256: hash },
      bytes,
      response: response(
        path,
        bytes,
        "application/javascript",
        "public, max-age=31536000, immutable",
      ),
      role,
    };
  });
  const local = [index, serviceWorker, app, engine, ...workers];
  const resources = local
    .map((resource) => {
      const role = "role" in resource ? resource.role : null;
      const [id, kind, scope] =
        resource === index
          ? (["app-shell-document-index", "document", "app-shell"] as const)
          : resource === serviceWorker
            ? (["common-worker-service", "worker", "common"] as const)
            : resource === app
              ? (["app-shell-module-app", "module", "app-shell"] as const)
              : resource === engine
                ? (["common-module-engine", "module", "common"] as const)
                : ([`common-worker-${role}`, "worker", "common"] as const);
      return {
        bytes: resource.artifact.bytes,
        id,
        kind,
        sha256: resource.artifact.sha256,
        scope,
        source: resource.artifact.path,
        target: "shell",
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const install = { gameId: "parallax", resources, schemaVersion: 1 };
  const installBytes = jsonBytes(install);
  const installArtifact = {
    bytes: installBytes.byteLength,
    path: "install-manifest.json",
    sha256: sha256(installBytes),
  };
  const build = {
    artifacts: [...local.map(({ artifact }) => artifact), installArtifact].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    gameContentEntrypoints: [],
    installManifestEntrypoint: { path: "install-manifest.json", schemaVersion: 1 },
    offlineShell: {
      generationSchemaVersion: 1,
      saveSchemaVersion,
      serviceWorkerPath: "service-worker.js",
    },
    schemaVersion: 15,
    workerEntrypoints: workers.map((worker) => ({
      path: worker.artifact.path,
      role: worker.role,
      targetType: "worker",
    })),
  };
  const buildBytes = jsonBytes(build);
  const network = new Map<string, OfflineShellFetchedResource>([
    [
      "build-manifest.json",
      response("build-manifest.json", buildBytes, "application/json", "no-cache"),
    ],
    [
      "install-manifest.json",
      response("install-manifest.json", installBytes, "application/json", "no-cache"),
    ],
    ...local.map((resource) => [resource.artifact.path, resource.response] as const),
  ]);
  return Object.freeze({
    appPath,
    build,
    install,
    network,
    releaseDigest: installArtifact.sha256,
  });
}

function response(
  path: string,
  bytes: Uint8Array,
  mimeType: string,
  cacheControl: string,
): OfflineShellFetchedResource {
  return Object.freeze({
    bytes: bytes.slice(),
    headers: Object.freeze({
      "cache-control": cacheControl,
      "content-type": mimeType,
      "cross-origin-embedder-policy": "require-corp",
      "cross-origin-opener-policy": "same-origin",
      "x-content-type-options": "nosniff",
    }),
    status: 200,
    url: `https://parallax.test/${path}`,
  });
}

function cloneResponse(response: OfflineShellFetchedResource): OfflineShellFetchedResource {
  return Object.freeze({
    ...response,
    bytes: response.bytes.slice(),
    headers: Object.freeze({ ...response.headers }),
  });
}

function mutateHeader(
  response: OfflineShellFetchedResource,
  name: string,
  value: string,
): OfflineShellFetchedResource {
  return Object.freeze({
    ...response,
    headers: Object.freeze({ ...response.headers, [name]: value }),
  });
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
