import { describe, expect, it } from "vitest";
import {
  OFFLINE_SHELL_LOCK_NAME,
  OFFLINE_SHELL_PREPARE_LOCK_NAME,
  OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
} from "../src/offline-shell/shell-generation-contract";
import { INSTALL_STORE_LOCK_NAME } from "../src/storage/opfs-release-store-contract";
import {
  createUninstallService,
  parseUninstallClientCountResponse,
  UNINSTALL_TELEMETRY_CONTRACT,
  type UninstallPlatform,
  withUninstallDeletionAuthority,
} from "../src/storage/uninstall-service";

describe("uninstall service", () => {
  it("fails closed on uninstall client-count response protocol drift", () => {
    expect(
      parseUninstallClientCountResponse({
        clientCount: 2,
        kind: "uninstall-client-count",
        protocolVersion: OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
      }),
    ).toBe(2);
    for (const invalid of [
      { clientCount: 2, kind: "uninstall-client-count" },
      {
        clientCount: 2,
        kind: "uninstall-client-count",
        protocolVersion: OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION + 1,
      },
      {
        clientCount: -1,
        kind: "uninstall-client-count",
        protocolVersion: OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
      },
      {
        clientCount: 2,
        extra: true,
        kind: "uninstall-client-count",
        protocolVersion: OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
      },
    ]) {
      expect(() => parseUninstallClientCountResponse(invalid)).toThrow(/response is invalid/);
    }
  });

  it("acquires destructive authority in install, prepare-owner, selection order", async () => {
    const events: string[] = [];
    await withUninstallDeletionAuthority(
      async <T>(name: string, operation: () => Promise<T>) => {
        events.push(`enter:${name}`);
        try {
          return await operation();
        } finally {
          events.push(`exit:${name}`);
        }
      },
      async () => {
        events.push("teardown");
      },
    );

    expect(events).toEqual([
      `enter:${INSTALL_STORE_LOCK_NAME}`,
      `enter:${OFFLINE_SHELL_PREPARE_LOCK_NAME}`,
      `enter:${OFFLINE_SHELL_LOCK_NAME}`,
      "teardown",
      `exit:${OFFLINE_SHELL_LOCK_NAME}`,
      `exit:${OFFLINE_SHELL_PREPARE_LOCK_NAME}`,
      `exit:${INSTALL_STORE_LOCK_NAME}`,
    ]);
  });

  it("removes every enumerated client-visible surface and retains quota evidence", async () => {
    const fixture = platformFixture();
    const service = createUninstallService(fixture.platform);
    const transitions: string[] = [];
    service.subscribe(({ state }) => transitions.push(state));

    const result = await service.uninstall();

    expect(transitions).toEqual(["idle", "running", "succeeded"]);
    expect(result).toMatchObject({
      attempt: 1,
      contract: UNINSTALL_TELEMETRY_CONTRACT,
      failures: [],
      quota: {
        afterQuota: 1_000,
        afterUsage: 10,
        beforeQuota: 1_000,
        beforeUsage: 900,
        releasedBytes: 890,
        teardownKind: "nonempty",
      },
      state: "succeeded",
    });
    expect(result.surfaces).toEqual([
      {
        after: [],
        attempted: ["https://example.test/a", "https://example.test/b"],
        before: ["https://example.test/a", "https://example.test/b"],
        removed: ["https://example.test/a", "https://example.test/b"],
        surface: "service-workers",
      },
      {
        after: [],
        attempted: ["shell-v1", "shell-v2"],
        before: ["shell-v1", "shell-v2"],
        removed: ["shell-v1", "shell-v2"],
        surface: "cache-storage",
      },
      {
        after: [],
        attempted: ["offline-shell", "settings"],
        before: ["offline-shell", "settings"],
        removed: ["offline-shell", "settings"],
        surface: "indexed-db",
      },
      {
        after: [],
        attempted: ["parallax-install-v1", "saves"],
        before: ["parallax-install-v1", "saves"],
        removed: ["parallax-install-v1", "saves"],
        surface: "opfs",
      },
    ]);
    expect(result.coverage).toMatchObject({
      dawnGpuCache: "not-observable-from-page",
      httpCache: "not-observable-from-page",
      v8CodeCache: "not-observable-from-page",
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("isolates throwing subscribers without stranding uninstall state", async () => {
    const fixture = platformFixture({ emptyInventories: true, usage: [0, 0] });
    const service = createUninstallService(fixture.platform);
    const transitions: string[] = [];
    service.subscribe(() => {
      throw new Error("observer failed");
    });
    service.subscribe(({ state }) => transitions.push(state));

    await expect(service.uninstall()).resolves.toMatchObject({ state: "succeeded" });
    await expect(service.uninstall()).resolves.toMatchObject({ state: "succeeded" });

    expect(transitions).toEqual(["idle", "running", "succeeded", "running", "succeeded"]);
    expect(service.snapshot()).toMatchObject({ attempt: 2, state: "succeeded" });
  });

  it("fails closed when deletion is refused or post-state remains", async () => {
    const fixture = platformFixture();
    fixture.cacheDeleteResult = false;
    const result = await createUninstallService(fixture.platform).uninstall();

    expect(result.state).toBe("failed");
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "delete", surface: "cache-storage" }),
        expect.objectContaining({ phase: "after", surface: "cache-storage" }),
      ]),
    );
    expect(result.surfaces.find(({ surface }) => surface === "cache-storage")?.after).toEqual([
      "shell-v1",
      "shell-v2",
    ]);
  });

  it("does not begin destructive storage work when runtime teardown fails", async () => {
    const fixture = platformFixture();
    let cacheInventoryReads = 0;
    const platform: UninstallPlatform = {
      ...fixture.platform,
      cacheStorage: {
        ...fixture.platform.cacheStorage,
        keys: async () => {
          cacheInventoryReads += 1;
          return fixture.platform.cacheStorage.keys();
        },
      },
    };
    const result = await createUninstallService(platform, async () => {
      throw new Error("installer worker did not terminate");
    }).uninstall();
    expect(result.state).toBe("failed");
    expect(result.failures).toEqual([
      {
        message: "installer worker did not terminate",
        phase: "prepare",
        surface: "runtime",
      },
    ]);
    expect(cacheInventoryReads).toBe(0);
    expect(result.surfaces).toEqual([]);
  });

  it("fails before deletion when another window client exists", async () => {
    const fixture = platformFixture();
    let cacheInventoryReads = 0;
    const result = await createUninstallService({
      ...fixture.platform,
      cacheStorage: {
        ...fixture.platform.cacheStorage,
        keys: async () => {
          cacheInventoryReads += 1;
          return [];
        },
      },
      exclusiveClientCount: async () => 2,
    }).uninstall();
    expect(result.state).toBe("failed");
    expect(result.failures).toEqual([
      expect.objectContaining({ phase: "quiescence", surface: "runtime" }),
    ]);
    expect(cacheInventoryReads).toBe(0);
  });

  it("derives idempotent-empty only from all four exact pre-inventories", async () => {
    const empty = platformFixture({ emptyInventories: true, usage: [500, 500] });
    const emptyResult = await createUninstallService(empty.platform).uninstall();
    expect(emptyResult.state).toBe("succeeded");
    expect(emptyResult.quota).toMatchObject({
      releasedBytes: 0,
      teardownKind: "idempotent-empty",
    });

    const container = platformFixture({
      emptyInventories: true,
      opfs: ["empty-container"],
      usage: [0, 0],
    });
    const containerResult = await createUninstallService(container.platform).uninstall();
    expect(containerResult.state).toBe("failed");
    expect(containerResult.quota.teardownKind).toBe("nonempty");
    expect(containerResult.failures).toEqual([
      expect.objectContaining({ phase: "quota-after", surface: "quota" }),
    ]);
  });
});

function platformFixture(
  options: Readonly<{
    emptyInventories?: boolean;
    opfs?: readonly string[];
    usage?: readonly [number, number];
  }> = {},
): {
  cacheDeleteResult: boolean;
  readonly platform: UninstallPlatform;
} {
  const fixture = { cacheDeleteResult: true };
  const caches = options.emptyInventories ? [] : ["shell-v2", "shell-v1"];
  const databases = options.emptyInventories ? [] : ["settings", "offline-shell"];
  const opfs = [
    ...(options.opfs ?? (options.emptyInventories ? [] : ["saves", "parallax-install-v1"])),
  ];
  const registrations = options.emptyInventories
    ? []
    : ["https://example.test/b", "https://example.test/a"];
  let estimate = 0;
  return Object.assign(fixture, {
    platform: {
      cacheStorage: {
        delete: async (name: string) => {
          if (!fixture.cacheDeleteResult) return false;
          caches.splice(caches.indexOf(name), 1);
          return true;
        },
        keys: async () => caches,
      },
      estimate: async () => ({
        quota: 1_000,
        usage: (options.usage ?? [900, 10])[estimate++ === 0 ? 0 : 1],
      }),
      exclusiveClientCount: async () => 1,
      indexedDb: {
        delete: async (name: string) => {
          databases.splice(databases.indexOf(name), 1);
        },
        names: async () => databases,
      },
      opfs: {
        names: async () => opfs,
        remove: async (name: string) => {
          opfs.splice(opfs.indexOf(name), 1);
        },
      },
      serviceWorkers: {
        registrations: async () =>
          registrations.map((scope) => ({
            scope,
            unregister: async () => {
              registrations.splice(registrations.indexOf(scope), 1);
              return true;
            },
          })),
      },
      taskTurn: async () => undefined,
      withDeletionAuthority: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
    },
  });
}
