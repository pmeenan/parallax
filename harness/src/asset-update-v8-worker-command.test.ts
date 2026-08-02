import { describe, expect, it } from "vitest";
import { waitForAssetUpdateV8WorkerCommand } from "./asset-update-v8-worker-command.js";

describe("asset-update installer-worker commands", () => {
  it("records timeout as protocol failure and removes the pending waiter", async () => {
    let pending = true;
    let protocolFailure: unknown = null;
    await expect(
      waitForAssetUpdateV8WorkerCommand({
        completion: new Promise<void>(() => undefined),
        fail: (error) => {
          protocolFailure = error;
        },
        label: "Installer-worker Network.disable",
        removeWaiter: () => {
          pending = false;
        },
        timeoutMs: 1,
      }),
    ).rejects.toThrow("Installer-worker Network.disable timed out");
    expect(protocolFailure).toBeInstanceOf(Error);
    expect(pending).toBe(false);
  });

  it("removes a successfully completed command waiter without protocol failure", async () => {
    let pending = true;
    let protocolFailure: unknown = null;
    await waitForAssetUpdateV8WorkerCommand({
      completion: Promise.resolve(),
      fail: (error) => {
        protocolFailure = error;
      },
      label: "Installer-worker Network.enable",
      removeWaiter: () => {
        pending = false;
      },
      timeoutMs: 1,
    });
    expect(protocolFailure).toBeNull();
    expect(pending).toBe(false);
  });
});
