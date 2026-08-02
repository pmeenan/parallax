import { describe, expect, it } from "vitest";
import {
  createInstallerRepairTransferObserver,
  type InstallerTransferTelemetrySnapshot,
  idleInstallerTransferTelemetrySnapshot,
  resolveInstallerRepairCompletionCredit,
} from "../src/index";

describe("installer Repair worker telemetry observer", () => {
  it("accumulates high-frequency download chunks without publishing a snapshot per chunk", () => {
    let snapshot: InstallerTransferTelemetrySnapshot = Object.freeze({
      ...idleInstallerTransferTelemetrySnapshot(1, 8 * 1024 * 1024),
      activeReleaseDigest: "a".repeat(64),
      activeRequestId: 7,
      resourceCount: 1,
      state: "transferring",
      totalBytes: 10_000,
    });
    let accumulated = 0;
    let published = 0;
    const observer = createInstallerRepairTransferObserver(
      {
        accumulate: (partial) => {
          accumulated += 1;
          snapshot = Object.freeze({ ...snapshot, ...partial });
        },
        snapshot: () => snapshot,
        update: (partial) => {
          published += 1;
          snapshot = Object.freeze({ ...snapshot, ...partial });
        },
      },
      new Set(["resource"]),
    );

    for (let chunk = 0; chunk < 10_000; chunk += 1) observer.downloaded(1);

    expect(accumulated).toBe(10_000);
    expect(published).toBe(0);
    expect(snapshot.downloadedBytes).toBe(10_000);

    observer.checkpoint(10_000);

    expect(published).toBe(1);
    expect(snapshot).toMatchObject({
      checkpointedBytes: 10_000,
      downloadedBytes: 10_000,
    });
  });

  it("revokes and restores exactly one same-worker completion credit", () => {
    const controller = telemetryController(3, 30, 3, 30);
    const observer = createInstallerRepairTransferObserver(
      controller,
      new Set(["repair"]),
      exactCredit(3, 30),
    );

    expect(observer.repairCompletionCreditRevoked("repair", 10)).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      completedResourceCount: 2,
      verifiedBytes: 20,
    });
    observer.resourceComplete("repair", 10);
    expect(controller.snapshot()).toMatchObject({
      completedResourceCount: 3,
      verifiedBytes: 30,
    });
  });

  it("does not invent historical completion credit after worker restart", () => {
    const controller = telemetryController(3, 30, 0, 0);
    const observer = createInstallerRepairTransferObserver(controller, new Set(["repair"]));

    expect(observer.repairCompletionCreditRevoked("repair", 10)).toBe(false);
    expect(controller.snapshot()).toMatchObject({
      completedResourceCount: 0,
      verifiedBytes: 0,
    });
  });

  it.each([
    { completedResourceCount: 1, verifiedBytes: 10 },
    { completedResourceCount: 0, verifiedBytes: 10 },
    { completedResourceCount: 3, verifiedBytes: 20 },
  ])("rejects partial lifetime completion counters: %o", (seed) => {
    const controller = telemetryController(3, 30, seed.completedResourceCount, seed.verifiedBytes);
    const observer = createInstallerRepairTransferObserver(
      controller,
      new Set(["repair"]),
      exactCredit(3, 30),
    );

    expect(() => observer.repairCompletionCreditRevoked("repair", 10)).toThrow(
      /partial or inconsistent/u,
    );
    expect(controller.snapshot()).toMatchObject(seed);
  });

  it("uses explicit worker lifetime instead of inferring historical credit from counters", () => {
    const reset = telemetryController(3, 30, 0, 0);
    expect(resolveInstallerRepairCompletionCredit(reset.snapshot(), exactCredit(3, 30))).toBeNull();

    const fullWithoutLifetime = telemetryController(3, 30, 3, 30);
    expect(() =>
      resolveInstallerRepairCompletionCredit(fullWithoutLifetime.snapshot(), null),
    ).toThrow(/no exact worker-lifetime credit/u);

    const partial = telemetryController(3, 30, 2, 20);
    expect(() =>
      resolveInstallerRepairCompletionCredit(partial.snapshot(), exactCredit(3, 30)),
    ).toThrow(/partial or inconsistent/u);
  });
});

function exactCredit(resourceCount: number, totalBytes: number) {
  return Object.freeze({
    releaseDigest: "a".repeat(64),
    resourceCount,
    totalBytes,
  });
}

function telemetryController(
  resourceCount: number,
  totalBytes: number,
  completedResourceCount: number,
  verifiedBytes: number,
) {
  let snapshot: InstallerTransferTelemetrySnapshot = Object.freeze({
    ...idleInstallerTransferTelemetrySnapshot(1, 8),
    activeReleaseDigest: "a".repeat(64),
    completedResourceCount,
    resourceCount,
    totalBytes,
    verifiedBytes,
  });
  const apply = (partial: Partial<InstallerTransferTelemetrySnapshot>): void => {
    snapshot = Object.freeze({ ...snapshot, ...partial });
  };
  return {
    accumulate: apply,
    snapshot: () => snapshot,
    update: apply,
  };
}
