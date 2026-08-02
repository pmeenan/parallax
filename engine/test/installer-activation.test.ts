import { describe, expect, it, vi } from "vitest";
import {
  verifyAndPublishInstallerRelease,
  verifyAndRestoreInstallerRepair,
  verifyExistingInstallerRelease,
} from "../src/install/installer-activation";
import { InstallerStoreError, InstallerTransferError } from "../src/install/installer-transfer";
import type { IntegrityResult, VerifiedObjectRef } from "../src/storage/opfs-release-store";
import { InstallStoreIntegrityError } from "../src/storage/opfs-release-store-contract";

const digest = "a".repeat(64);

function fixture(input?: {
  readonly activeReleaseDigest?: string | null;
  readonly afterReady?: () => void;
  readonly afterVerify?: () => void;
  readonly bytes?: number;
  readonly ok?: boolean;
}) {
  const order: string[] = [];
  const store = {
    markReleaseReady: vi.fn(async () => {
      order.push("ready");
      input?.afterReady?.();
    }),
    publishRelease: vi.fn(async () => {
      order.push("publish");
      return {
        activeReleaseDigest: input?.activeReleaseDigest ?? digest,
        previousReleaseDigest: null,
      };
    }),
    verifyRelease: vi.fn(async () => {
      order.push("verify");
      input?.afterVerify?.();
      return {
        bytes: input?.bytes ?? 100,
        ok: input?.ok ?? true,
      };
    }),
  };
  return { order, store };
}

describe("installer release activation", () => {
  it("restores an exact durable repair without ready marking or publication", async () => {
    const admission = {
      bytes: 100,
      recordSha256: "b".repeat(64),
      releaseDigest: digest,
      resourceId: "resource-a",
      scope: "common" as const,
      sha256: "c".repeat(64),
      state: "completion-pending" as const,
    };
    const store = {
      completeRepairRelease: vi.fn(async () => ({
        activeReleaseDigest: digest,
        previousReleaseDigest: null,
      })),
      verifyRelease: vi.fn(async () => ({ bytes: 100, ok: true })),
    };

    await expect(
      verifyAndRestoreInstallerRepair({
        admission,
        expectedBytes: 100,
        expectedResourceCount: 1,
        releaseDigest: digest,
        signal: new AbortController().signal,
        store,
        transferredBytes: 100,
        transferredResourceCount: 1,
      }),
    ).resolves.toEqual({ activeReleaseDigest: digest, previousReleaseDigest: null });
    expect(store.verifyRelease).toHaveBeenCalledTimes(1);
    expect(store.completeRepairRelease).toHaveBeenCalledWith(admission);
  });

  it("verifies a healthy explicit Repair without creating another publication", async () => {
    const store = {
      completeRepairRelease: vi.fn(),
      getActiveReleaseDigest: vi.fn(async () => digest),
      verifyRelease: vi.fn(async () => ({ bytes: 100, ok: true })),
    };
    await expect(
      verifyExistingInstallerRelease({
        expectedBytes: 100,
        expectedResourceCount: 1,
        releaseDigest: digest,
        signal: new AbortController().signal,
        store,
        transferredBytes: 100,
        transferredResourceCount: 1,
      }),
    ).resolves.toEqual({ activeReleaseDigest: digest, previousReleaseDigest: null });
  });

  it("repairs final verification through durable admission and completes without publication", async () => {
    const admission = {
      bytes: 100,
      recordSha256: "b".repeat(64),
      releaseDigest: digest,
      resourceId: "resource-a",
      scope: "common" as const,
      sha256: "c".repeat(64),
      state: "repair-required" as const,
    };
    let verification = 0;
    const store = {
      completeRepairRelease: vi.fn(async () => ({
        activeReleaseDigest: digest,
        previousReleaseDigest: null,
      })),
      getActiveReleaseDigest: vi.fn(async () => digest),
      verifyRelease: vi.fn(
        async (
          _releaseDigest: string,
          listener?: (reference: VerifiedObjectRef, result: IntegrityResult) => void,
        ) => {
          verification += 1;
          if (verification === 1) {
            listener?.(
              {
                bytes: 100,
                path: "object.data",
                releaseDigest: digest,
                resourceId: "resource-a",
                scope: "common",
                sha256: "c".repeat(64),
              },
              { bytes: 100, ok: false, sha256: "d".repeat(64) },
            );
            return { bytes: 0, ok: false };
          }
          return { bytes: 100, ok: true };
        },
      ),
    };
    const repairResource = vi.fn(async () => admission);
    await expect(
      verifyExistingInstallerRelease({
        expectedBytes: 100,
        expectedResourceCount: 1,
        releaseDigest: digest,
        repairResource,
        signal: new AbortController().signal,
        store,
        transferredBytes: 100,
        transferredResourceCount: 1,
      }),
    ).resolves.toEqual({ activeReleaseDigest: digest, previousReleaseDigest: null });
    expect(repairResource).toHaveBeenCalledWith("resource-a");
    expect(store.completeRepairRelease).toHaveBeenCalledWith(admission);
    expect(store.getActiveReleaseDigest).not.toHaveBeenCalled();
  });

  it("verifies, marks ready, and publishes in that exact order", async () => {
    const test = fixture();
    const abort = new AbortController();

    await expect(
      verifyAndPublishInstallerRelease({
        beginPublication: () => test.order.push("commit"),
        expectedBytes: 100,
        expectedResourceCount: 1,
        releaseDigest: digest,
        signal: abort.signal,
        store: test.store,
        transferredBytes: 100,
        transferredResourceCount: 1,
      }),
    ).resolves.toMatchObject({ activeReleaseDigest: digest });

    expect(test.order).toEqual(["verify", "ready", "commit", "publish"]);
  });

  it.each([
    "verify",
    "ready",
    "publish",
  ] as const)("retains a typed store failure at the install %s boundary", async (failureBoundary) => {
    const cause = new Error(`injected ${failureBoundary} store failure`);
    const reference = {
      bytes: 100,
      path: "object.data",
      releaseDigest: digest,
      resourceId: "resource-a",
      scope: "common" as const,
      sha256: "b".repeat(64),
    };
    const store = {
      markReleaseReady: vi.fn(async () => {
        if (failureBoundary === "ready") throw cause;
      }),
      publishRelease: vi.fn(async () => {
        if (failureBoundary === "publish") throw cause;
        return { activeReleaseDigest: digest, previousReleaseDigest: null };
      }),
      verifyRelease: vi.fn(
        async (
          _releaseDigest: string,
          listener?: (reference: VerifiedObjectRef, result: IntegrityResult) => void,
        ) => {
          if (failureBoundary === "verify") {
            listener?.(reference, { bytes: 0, ok: false, sha256: "c".repeat(64) });
            throw cause;
          }
          return { bytes: 100, ok: true };
        },
      ),
    };

    const failure = await verifyAndPublishInstallerRelease({
      beginPublication: vi.fn(),
      expectedBytes: 100,
      expectedResourceCount: 1,
      releaseDigest: digest,
      signal: new AbortController().signal,
      store,
      transferredBytes: 100,
      transferredResourceCount: 1,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InstallerStoreError);
    expect(failure).toMatchObject({
      cause,
      operation: "verify-release",
      resourceId: failureBoundary === "verify" ? "resource-a" : null,
    });
  });

  it("preserves typed install-store integrity with exact resource authority", async () => {
    const cause = new InstallStoreIntegrityError("final verification store integrity failed");
    const store = {
      markReleaseReady: vi.fn(async () => undefined),
      publishRelease: vi.fn(async () => ({
        activeReleaseDigest: digest,
        previousReleaseDigest: null,
      })),
      verifyRelease: vi.fn(
        async (
          _releaseDigest: string,
          listener?: (reference: VerifiedObjectRef, result: IntegrityResult) => void,
        ) => {
          listener?.(
            {
              bytes: 100,
              path: "object.data",
              releaseDigest: digest,
              resourceId: "resource-a",
              scope: "common",
              sha256: "b".repeat(64),
            },
            { bytes: 0, ok: false, sha256: "c".repeat(64) },
          );
          throw cause;
        },
      ),
    };

    await expect(
      verifyAndPublishInstallerRelease({
        beginPublication: vi.fn(),
        expectedBytes: 100,
        expectedResourceCount: 1,
        releaseDigest: digest,
        signal: new AbortController().signal,
        store,
        transferredBytes: 100,
        transferredResourceCount: 1,
      }),
    ).rejects.toMatchObject({
      category: "integrity",
      message: cause.message,
      resourceId: "resource-a",
    });
  });

  it.each([
    [{ bytes: 99 }, "size mismatch"],
    [{ ok: false }, "integrity mismatch"],
  ] as const)("never publishes after %s", async (input, _label) => {
    const test = fixture(input);
    const abort = new AbortController();

    const failure = await verifyAndPublishInstallerRelease({
      beginPublication: () => test.order.push("commit"),
      expectedBytes: 100,
      expectedResourceCount: 1,
      releaseDigest: digest,
      signal: abort.signal,
      store: test.store,
      transferredBytes: 100,
      transferredResourceCount: 1,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InstallerTransferError);
    expect(test.order).toEqual(["verify"]);
  });

  it("fails closed when publication does not select the exact release", async () => {
    const test = fixture({ activeReleaseDigest: "b".repeat(64) });
    const abort = new AbortController();

    await expect(
      verifyAndPublishInstallerRelease({
        beginPublication: () => test.order.push("commit"),
        expectedBytes: 100,
        expectedResourceCount: 1,
        releaseDigest: digest,
        signal: abort.signal,
        store: test.store,
        transferredBytes: 100,
        transferredResourceCount: 1,
      }),
    ).rejects.toThrow(/did not become the active selection/);
    expect(test.order).toEqual(["verify", "ready", "commit", "publish"]);
  });

  it("withholds readiness and publication when cancellation arrives during verification", async () => {
    const abort = new AbortController();
    const test = fixture({
      afterVerify: () => abort.abort(new DOMException("cancelled", "AbortError")),
    });

    await expect(
      verifyAndPublishInstallerRelease({
        beginPublication: () => test.order.push("commit"),
        expectedBytes: 100,
        expectedResourceCount: 1,
        releaseDigest: digest,
        signal: abort.signal,
        store: test.store,
        transferredBytes: 100,
        transferredResourceCount: 1,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(test.order).toEqual(["verify"]);
  });

  it("withholds publication when cancellation arrives while marking the release ready", async () => {
    const abort = new AbortController();
    const test = fixture({
      afterReady: () => abort.abort(new DOMException("cancelled", "AbortError")),
    });

    await expect(
      verifyAndPublishInstallerRelease({
        beginPublication: () => test.order.push("commit"),
        expectedBytes: 100,
        expectedResourceCount: 1,
        releaseDigest: digest,
        signal: abort.signal,
        store: test.store,
        transferredBytes: 100,
        transferredResourceCount: 1,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(test.order).toEqual(["verify", "ready"]);
  });

  it("rejects transfer totals that do not exactly match the target manifest", async () => {
    const test = fixture();
    const abort = new AbortController();

    await expect(
      verifyAndPublishInstallerRelease({
        beginPublication: () => test.order.push("commit"),
        expectedBytes: 100,
        expectedResourceCount: 2,
        releaseDigest: digest,
        signal: abort.signal,
        store: test.store,
        transferredBytes: 99,
        transferredResourceCount: 1,
      }),
    ).rejects.toBeInstanceOf(InstallerTransferError);
    expect(test.order).toEqual([]);
  });

  it("repairs the exact final-verification resource before readiness or publication", async () => {
    const order: string[] = [];
    let verificationCount = 0;
    const reference = {
      bytes: 100,
      path: "parallax-install-v1/objects/common/sha256/bb/object.data",
      releaseDigest: digest,
      resourceId: "resource-a",
      scope: "common" as const,
      sha256: "b".repeat(64),
    };
    const store = {
      markReleaseReady: vi.fn(async () => {
        order.push("ready");
      }),
      publishRelease: vi.fn(async () => {
        order.push("publish");
        return { activeReleaseDigest: digest, previousReleaseDigest: "c".repeat(64) };
      }),
      verifyRelease: vi.fn(
        async (
          _releaseDigest: string,
          listener?: (reference: VerifiedObjectRef, result: IntegrityResult) => void,
        ) => {
          verificationCount += 1;
          order.push(`verify-${verificationCount}`);
          if (verificationCount === 1) {
            listener?.(reference, { bytes: 100, ok: false, sha256: "d".repeat(64) });
            return { bytes: 0, ok: false };
          }
          listener?.(reference, { bytes: 100, ok: true, sha256: reference.sha256 });
          return { bytes: 100, ok: true };
        },
      ),
    };

    await expect(
      verifyAndPublishInstallerRelease({
        beginPublication: () => order.push("commit"),
        expectedBytes: 100,
        expectedResourceCount: 1,
        releaseDigest: digest,
        repairResource: async (resourceId) => {
          expect(resourceId).toBe(reference.resourceId);
          order.push(`repair-${resourceId}`);
        },
        signal: new AbortController().signal,
        store,
        transferredBytes: 100,
        transferredResourceCount: 1,
      }),
    ).resolves.toEqual({
      activeReleaseDigest: digest,
      previousReleaseDigest: "c".repeat(64),
    });
    expect(order).toEqual([
      "verify-1",
      "repair-resource-a",
      "verify-2",
      "ready",
      "commit",
      "publish",
    ]);
  });

  it("retains exact resource identity and active/previous safety on failed final repair", async () => {
    const previous = "c".repeat(64);
    const store = {
      markReleaseReady: vi.fn(),
      publishRelease: vi.fn(async () => ({
        activeReleaseDigest: digest,
        previousReleaseDigest: previous,
      })),
      verifyRelease: vi.fn(
        async (
          _releaseDigest: string,
          listener?: (reference: VerifiedObjectRef, result: IntegrityResult) => void,
        ) => {
          listener?.(
            {
              bytes: 100,
              path: "object.data",
              releaseDigest: digest,
              resourceId: "resource-a",
              scope: "common",
              sha256: "b".repeat(64),
            },
            { bytes: 100, ok: false, sha256: "d".repeat(64) },
          );
          return { bytes: 0, ok: false };
        },
      ),
    };

    await expect(
      verifyAndPublishInstallerRelease({
        beginPublication: vi.fn(),
        expectedBytes: 100,
        expectedResourceCount: 1,
        releaseDigest: digest,
        repairResource: async (resourceId) => {
          throw new InstallerTransferError(
            "integrity",
            "Resource failed integrity after its single repair cycle",
            resourceId,
          );
        },
        signal: new AbortController().signal,
        store,
        transferredBytes: 100,
        transferredResourceCount: 1,
      }),
    ).rejects.toMatchObject({
      category: "integrity",
      resourceId: "resource-a",
    });
    expect(store.markReleaseReady).not.toHaveBeenCalled();
    expect(store.publishRelease).not.toHaveBeenCalled();
  });
});
