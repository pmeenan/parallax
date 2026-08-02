import { describe, expect, it, vi } from "vitest";
import { createInstallerTrustFaultOwnership } from "./installer-trust-faults-lifecycle.js";

describe("installer trust-fault protected ownership", () => {
  it("cleans an owned profile after later setup/listen failure", async () => {
    const removeProfile = vi.fn(async () => undefined);
    const ownership = createInstallerTrustFaultOwnership();
    ownership.add({ operation: "remove-profile", run: removeProfile });
    await expect(
      ownership.finish({ error: new Error("listen failed"), operation: "listen-server" }),
    ).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          cause: expect.objectContaining({ message: "listen failed" }),
          operation: "listen-server",
          stage: "primary",
        }),
      ],
    });
    expect(removeProfile).toHaveBeenCalledOnce();
  });

  it("retains setup and every distinct cleanup failure", async () => {
    const ownership = createInstallerTrustFaultOwnership();
    ownership.add({
      operation: "remove-profile",
      run: async () => {
        throw new Error("profile cleanup");
      },
    });
    ownership.add({
      operation: "stop-server",
      run: async () => {
        throw new Error("server cleanup");
      },
    });
    await expect(
      ownership.finish({ error: new Error("prepare failed"), operation: "prepare-serving-root" }),
    ).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: expect.stringMatching(/prepare-serving-root/) }),
        expect.objectContaining({ operation: "stop-server", stage: "cleanup" }),
        expect.objectContaining({ operation: "remove-profile", stage: "cleanup" }),
      ],
    });
  });

  it("retains a profile cleanup failure after successful qualification work", async () => {
    const ownership = createInstallerTrustFaultOwnership();
    ownership.add({
      operation: "remove-profile",
      run: async () => {
        throw new Error("profile cleanup");
      },
    });
    await expect(ownership.finish(null)).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: expect.stringMatching(/remove-profile/) })],
    });
  });
});
