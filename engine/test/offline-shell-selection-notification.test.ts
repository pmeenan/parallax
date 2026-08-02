import { describe, expect, it, vi } from "vitest";
import {
  notifyOfflineShellSelectionChangeFromDurableRead,
  postOfflineShellSelectionChange,
} from "../src/offline-shell/offline-shell-selection-notification";
import {
  failedOfflineShellTelemetrySnapshot,
  type OfflineShellTelemetrySnapshot,
  unavailableOfflineShellTelemetrySnapshot,
} from "../src/offline-shell/shell-generation-contract";

const RELEASE_A = "a".repeat(64);
const RELEASE_B = "b".repeat(64);
const GENERATION_A = `${RELEASE_A}:${RELEASE_A}`;
const GENERATION_B = `${RELEASE_B}:${RELEASE_B}`;

describe("offline-shell selection notifications", () => {
  it("isolates a detached client throw and continues notifying peers", () => {
    const peer = vi.fn();
    expect(() =>
      postOfflineShellSelectionChange(
        [
          {
            postMessage() {
              throw new Error("detached client");
            },
          },
          { postMessage: peer },
        ],
        unavailableOfflineShellTelemetrySnapshot(),
      ),
    ).not.toThrow();
    expect(peer).toHaveBeenCalledOnce();
    expect(peer.mock.calls[0]?.[0]).toMatchObject({
      kind: "selection-changed",
      protocolVersion: 1,
    });
  });

  it("notifies concurrent A-to-B selection from durable B, never requester-local failure", async () => {
    const responseFailure = failedOfflineShellTelemetrySnapshot(
      "shell-release-mismatch",
      "stale A admission",
    );
    const durableB = activeTelemetry(GENERATION_B, RELEASE_B);
    const notify = vi.fn(async () => undefined);

    await notifyOfflineShellSelectionChangeFromDurableRead(
      GENERATION_A,
      async () => ({ generationId: GENERATION_B, telemetry: durableB }),
      notify,
    );

    expect(responseFailure.state).toBe("failed");
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(GENERATION_A, durableB);
    expect(notify).not.toHaveBeenCalledWith(GENERATION_A, responseFailure);
  });

  it("emits no selection notification when durable selection reread fails", async () => {
    const notify = vi.fn(async () => undefined);

    await notifyOfflineShellSelectionChangeFromDurableRead(
      GENERATION_A,
      async () => Promise.reject(new Error("durable selection unavailable")),
      notify,
    );

    expect(notify).not.toHaveBeenCalled();
  });
});

function activeTelemetry(
  generationId: string,
  releaseDigest: string,
): OfflineShellTelemetrySnapshot {
  return Object.freeze({
    ...unavailableOfflineShellTelemetrySnapshot(),
    activeArtifactDigest: generationId.slice(0, 64),
    activeGenerationId: generationId,
    activeReleaseDigest: releaseDigest,
    state: "active",
  });
}
