import { describe, expect, it } from "vitest";
import type { InstallerUiSnapshot } from "../src/installer-controller";
import {
  createInstallerDiagnosticSnapshot,
  createInstallerViewModel,
  setTextContentIfChanged,
} from "../src/installer-ui";

describe("installer UI diagnostics", () => {
  it("retains exact failure, recovery, persistence, and subsystem transitions", () => {
    const snapshot = installerSnapshot();
    const diagnostic = createInstallerDiagnosticSnapshot(snapshot);

    expect(diagnostic).toEqual({
      failure: {
        code: "shell-contract",
        failureClass: "offline-shell",
        failureEvidence: "offline-shell",
        message: "Offline shell response contract failed for immutable/app.js",
        operation: "session",
        recovery: "reload",
        resourceId: null,
      },
      persistence: "not-requested",
      state: "failed",
      storeState: "idle",
      transferState: "idle",
    });
    expect(diagnostic.failure).not.toBe(snapshot.failure);
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(Object.isFrozen(diagnostic.failure)).toBe(true);
  });

  it("distinguishes repaired success from a repeated integrity failure", () => {
    const repaired = {
      ...installerSnapshot(),
      failure: null,
      repairedBytes: 8,
      repairedResourceCount: 1,
      state: "ready" as const,
    };
    expect(createInstallerViewModel(repaired).status).toMatch(
      /repaired 1 corrupted local resource and verified/,
    );

    const failed = {
      ...installerSnapshot(),
      failure: {
        code: "integrity" as const,
        failureClass: "installer-transfer" as const,
        failureEvidence: "transfer-integrity" as const,
        message: "Resource failed integrity after its single repair cycle",
        operation: "repair" as const,
        recovery: "repair" as const,
        resourceId: "resource-a",
      },
    };
    expect(createInstallerViewModel(failed).error).toMatch(
      /Repair installation.*new bounded repair operation.*single repair cycle/,
    );
  });

  it("does not rewrite an aria-live message when its copy is unchanged", () => {
    let writes = 0;
    let textContent: string | null = "Installing and verifying…";
    const liveRegion = {
      get textContent() {
        return textContent;
      },
      set textContent(value: string | null) {
        writes += 1;
        textContent = value;
      },
    };

    setTextContentIfChanged(liveRegion, "Installing and verifying…");
    setTextContentIfChanged(liveRegion, "Installing and verifying district-1…");
    setTextContentIfChanged(liveRegion, "Installing and verifying district-1…");

    expect(writes).toBe(1);
  });
});

function installerSnapshot(): InstallerUiSnapshot {
  return {
    activeResourceId: null,
    checkpointedBytes: 0,
    completedResourceCount: 0,
    downloadedBytes: 0,
    failure: {
      code: "shell-contract",
      failureClass: "offline-shell",
      failureEvidence: "offline-shell",
      message: "Offline shell response contract failed for immutable/app.js",
      operation: "session",
      recovery: "reload",
      resourceId: null,
    },
    finalVerificationBytes: 0,
    finalVerificationPhase: "idle",
    finalVerificationResourceCount: 0,
    finalVerificationTotalBytes: 0,
    finalVerificationTotalResourceCount: 0,
    persistence: "not-requested",
    plannedDownloadBytes: 0,
    repairAttemptCount: 0,
    repairedBytes: 0,
    repairedResourceCount: 0,
    releaseDigest: null,
    resourceCount: 0,
    resumedBytes: 0,
    reusedBytes: 0,
    shellGenerationId: null,
    state: "failed",
    storeState: "idle",
    totalBytes: 0,
    transferState: "idle",
    verifiedBytes: 0,
  };
}
