import { describe, expect, it } from "vitest";
import { installerFailureRecoveryAction } from "../src";
import {
  callInstallerRepairStore,
  INSTALLER_REPAIR_STORE_BOUNDARY_RULES,
  type InstallerRepairStoreBoundary,
  InstallerRepairStoreOperationError,
  installerRepairStoreFailureDiagnostic,
} from "../src/install/installer-repair-store-operation";
import { InstallStoreIntegrityError } from "../src/storage/opfs-release-store-contract";

const RESOURCE_ID = "resource-a";

describe("installer Repair store operation authority", () => {
  it.each(
    INSTALLER_REPAIR_STORE_BOUNDARY_RULES,
  )("classifies raw Error at $boundary without losing its exact boundary or cause", async (rule) => {
    const cause = new Error(
      "raw store error at C:\\private\\profile secret=do-not-retain because write failed",
    );
    const failure = await rejectedStoreCall(rule.boundary, resourceId(rule.boundary), cause);

    expect(failure).toBeInstanceOf(InstallerRepairStoreOperationError);
    expect(failure).toMatchObject({
      boundary: rule.boundary,
      cause,
      causeFamily: "error",
      diagnostic: {
        code: "store",
        failureClass: "installer-store",
        failureEvidence: rule.failureEvidence,
        operation: "repair",
        resourceId: resourceId(rule.boundary),
      },
    });
    expect(failure.diagnostic.message).not.toMatch(/private|do-not-retain/iu);
    expect(failure.diagnostic.message.length).toBeLessThanOrEqual(256);
    expect(installerFailureRecoveryAction(failure.diagnostic)).toBe("retry");
    expect(installerRepairStoreFailureDiagnostic(failure)).toBe(failure.diagnostic);
  });

  it.each([
    ["dom-exception", () => new DOMException("OPFS operation failed", "InvalidStateError")],
    [
      "install-store-integrity",
      () => new InstallStoreIntegrityError("Stored release record is contradictory"),
    ],
    [
      "aggregate-error",
      () =>
        new AggregateError(
          [new Error("first"), new DOMException("second", "InvalidStateError")],
          "Two store operations failed",
        ),
    ],
    ["non-error", () => Object.freeze({ malicious: "<script>", token: "do-not-retain" })],
  ] as const)("retains and safely classifies the %s cause family", async (family, createCause) => {
    const cause = createCause();
    const failure = await rejectedStoreCall("verify-release", RESOURCE_ID, cause);

    expect(failure).toMatchObject({
      boundary: "verify-release",
      cause,
      causeFamily: family,
      diagnostic: {
        code: family === "install-store-integrity" ? "integrity" : "store",
        failureClass: "installer-store",
        failureEvidence: "store-verify-release",
        operation: "repair",
        resourceId: RESOURCE_ID,
      },
    });
    expect(installerFailureRecoveryAction(failure.diagnostic)).toBe(
      family === "install-store-integrity" ? "repair" : "retry",
    );
    expect(failure.diagnostic.message).not.toContain("do-not-retain");
  });

  it("maps exact QuotaExceededError to the quota tuple before recovery", async () => {
    const cause = new DOMException("disk path C:\\private\\quota", "QuotaExceededError");
    const failure = await rejectedStoreCall("verify-release", RESOURCE_ID, cause);

    expect(failure).toMatchObject({
      boundary: "verify-release",
      cause,
      causeFamily: "dom-exception",
      diagnostic: {
        code: "quota",
        failureClass: "quota",
        failureEvidence: "quota-exceeded",
        operation: "repair",
        resourceId: RESOURCE_ID,
      },
    });
    expect(installerFailureRecoveryAction(failure.diagnostic)).toBe("retry");
    expect(failure.diagnostic.message).not.toContain("private");
  });

  it("bounds oversized unknown residuals and rejects invalid boundary/resource pairings", async () => {
    const failure = await rejectedStoreCall("verify-release", null, "x".repeat(20_000));
    expect(failure.diagnostic.message.length).toBeLessThanOrEqual(256);
    expect(failure.diagnostic.resourceId).toBeNull();

    await expect(
      callInstallerRepairStore("admit-repair-release", null, async () => undefined),
    ).rejects.toThrow(/boundary authority/u);
    await expect(
      callInstallerRepairStore("get-active-release", RESOURCE_ID, async () => undefined),
    ).rejects.toThrow(/boundary authority/u);
  });
});

async function rejectedStoreCall(
  boundary: InstallerRepairStoreBoundary,
  resourceId: string | null,
  cause: unknown,
): Promise<InstallerRepairStoreOperationError> {
  const failure = await callInstallerRepairStore(boundary, resourceId, () =>
    Promise.reject(cause),
  ).catch((error: unknown) => error);
  if (!(failure instanceof InstallerRepairStoreOperationError)) {
    throw new Error("Expected typed Installer Repair store failure");
  }
  return failure;
}

function resourceId(boundary: InstallerRepairStoreBoundary): string | null {
  return boundary === "admit-repair-release" || boundary === "complete-repair-release"
    ? RESOURCE_ID
    : null;
}
