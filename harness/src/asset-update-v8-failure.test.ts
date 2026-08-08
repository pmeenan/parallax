import { describe, expect, it } from "vitest";
import {
  type AssetUpdateLifecycleResult,
  formatAssetUpdateV8Markdown,
  validateAssetUpdateV8Evidence,
} from "./asset-update-v8-evidence.js";
import { createAssetUpdateV8FailedEvidence } from "./asset-update-v8-failure.js";

const STARTED_AT = "2026-07-30T06:26:26.687Z";
const COMPLETED_AT = "2026-07-30T06:33:12.000Z";
const RESERVATION_ID = "bdb83cb8-27ed-4047-9f86-8ab34b1ff36e";
const COMPANION = "asset-update-v8-v4-2026-07-30T06-26-26-687Z.md";

describe("asset-update V8 failed-evidence fallback", () => {
  it("drops an invalid lifecycle claim but retains bounded raw transfer/journal diagnostics", () => {
    const entries = Array.from({ length: 300 }, (_, index) => ({
      bodyBytes: index === 0 ? 11 : 0,
      path: index === 1 ? "C:\\private\\token=secret" : `/immutable/cell-${index}.json`,
      range: index === 2 ? "malformed" : "bytes=0-",
      sequence: index + 1,
      status: 206,
    }));
    const invalidPartial = {
      publication: {
        postTransfer: {
          activeReleaseDigest: "a".repeat(64),
          checkpointedBytes: 11,
          completedResourceCount: 263,
          downloadedBytes: 11,
          hashedBytes: 2_621_434_134,
          httpRequestCount: 2,
          plannedDownloadBytes: 11,
          rangeRequestCount: 2,
          resourceCount: 263,
          resumedBytes: 0,
          reusedBytes: 2_621_434_123,
          totalBytes: 2_621_434_134,
          verifiedBytes: 2_621_434_134,
        },
        updateServerJournal: {
          entries,
          maximumEntries: 4096,
          overflowed: false,
        },
      },
    } as unknown as AssetUpdateLifecycleResult;

    const hostileError = new Error(
      "Update transfer mismatch at C:/Users/operator/secret.json path=/home/operator/private.json file:///Users/operator/private.json authorization = private",
    );
    hostileError.name = "secret=credential-in-name";
    const evidence = createAssetUpdateV8FailedEvidence({
      authority: null,
      companionPath: COMPANION,
      completedAt: COMPLETED_AT,
      error: hostileError,
      partialResult: invalidPartial,
      phase: "publication",
      postValidationPerformed: false,
      reservationId: RESERVATION_ID,
      startedAt: STARTED_AT,
    });

    expect(validateAssetUpdateV8Evidence(evidence).state).toBe("failed");
    expect(evidence.state).toBe("failed");
    if (evidence.state !== "failed") throw new Error("synthetic failure lost failed state");
    expect(evidence.authority).toBeNull();
    expect(evidence.partialResult).toBeNull();
    expect(evidence.failure.name).toBe("Error");
    expect(evidence.failure.message).toContain("<local-path>");
    expect(evidence.failure.message).toContain("<redacted>");
    expect(evidence.failure.message).not.toContain("operator");
    expect(evidence.failureContext?.transfer).toMatchObject({
      completedResourceCount: 263,
      downloadedBytes: 11,
      hashedBytes: 2_621_434_134,
      verifiedBytes: 2_621_434_134,
    });
    expect(evidence.failureContext?.journal).toMatchObject({
      observedEntryCount: 300,
      retainedEntryCount: 256,
      sourceMaximumEntries: 4096,
      sourceOverflowed: false,
      truncated: true,
    });
    expect(evidence.failureContext?.journal?.entries[1]?.path).toBe("/invalid");
    expect(evidence.failureContext?.journal?.entries[2]?.range).toBeNull();
    expect(evidence.failureContext?.state).toBe("rejected-lifecycle-snapshot");
    if (evidence.failureContext?.state !== "rejected-lifecycle-snapshot") {
      throw new Error("synthetic fallback lost rejected-partial context");
    }
    expect(evidence.failureContext.partialValidation).toEqual({
      message: "Asset-update result has unsupported or missing keys",
      name: "Error",
      state: "rejected",
    });
    const markdown = formatAssetUpdateV8Markdown(evidence);
    expect(markdown).toContain("rejected partial lifecycle");
    expect(markdown).toContain('"completedResourceCount":263');
    expect(markdown).toContain('"observedEntryCount":300');
    expect(markdown).not.toContain("C:\\private");

    const retainedV3 = structuredClone(evidence) as unknown as Record<string, unknown>;
    retainedV3.failureContext = {
      journal: evidence.failureContext.journal,
      state: "unvalidated-lifecycle-snapshot",
      transfer: evidence.failureContext.transfer,
    };
    expect(validateAssetUpdateV8Evidence(retainedV3).state).toBe("failed");
  });
});
