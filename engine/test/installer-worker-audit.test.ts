import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("installer worker architecture audit", () => {
  it("publishes only verified releases and keeps persistence requests and store-lock ownership out", async () => {
    const source = await readFile(
      new URL("../src/workers/installer-worker.ts", import.meta.url),
      "utf8",
    );
    const repairSource = await readFile(
      new URL("../src/install/installer-repair.ts", import.meta.url),
      "utf8",
    );
    const repairWorkerOperationSource = await readFile(
      new URL("../src/install/installer-repair-worker-operation.ts", import.meta.url),
      "utf8",
    );
    const sessionSource = await readFile(
      new URL("../src/workers/installer-worker-session.ts", import.meta.url),
      "utf8",
    );
    const activationSource = await readFile(
      new URL("../src/install/installer-activation.ts", import.meta.url),
      "utf8",
    );
    const repairStoreSource = await readFile(
      new URL("../src/install/installer-repair-store-operation.ts", import.meta.url),
      "utf8",
    );
    expect(sessionSource).toContain("INSTALL_TRANSFER_LOCK_NAME");
    expect(source).toContain("createInstallerWorkerSession({");
    expect(source).toContain("const PRODUCTION_CONCURRENCY = 1;");
    expect(source).toContain("const PRODUCTION_CHECKPOINT_BYTES = 8 * 1024 * 1024;");
    expect(source).toContain("navigator.locks");
    expect(source).toContain("navigator.storage.persisted()");
    expect(source).toContain("loadInstallerTargetIdentity");
    expect(source).toContain("baseUrl: buildRootUrl");
    expect(source).not.toContain("baseUrl: location.href");
    expect(source).not.toContain("navigator.storage.persist()");
    expect(source).toContain("await verifyAndPublishInstallerRelease({");
    expect(source).toContain("store.findRepairRelease(identity.releaseDigest)");
    for (const boundary of [
      "admit-repair-release",
      "complete-repair-release",
      "find-repair-release",
      "get-active-release",
      "probe-quota",
      "stage-release",
      "verify-release",
    ]) {
      expect(`${source}\n${repairSource}\n${activationSource}`).toMatch(
        new RegExp(`callInstallerRepairStore\\(\\s*"${boundary}"`, "u"),
      );
      expect(repairStoreSource).toContain(`rule("${boundary}"`);
    }
    expect(source).toContain("installerRepairStoreFailureDiagnostic(error)");
    expect(source).toContain("executeInstallerRepairWorkerOperation({");
    expect(repairWorkerOperationSource).toContain("await repairInstalledRelease({");
    expect(repairSource).toContain("input.store.admitRepairRelease(");
    expect(repairSource).toContain("await verifyAndRestoreInstallerRepair(");
    expect(repairSource).toContain("await verifyExistingInstallerRelease(");
    expect(source.indexOf('if (operation === "repair")')).toBeLessThan(
      source.indexOf("await verifyAndPublishInstallerRelease({"),
    );
    expect(source).toContain("beginPublication:");
    expect(source).toContain("createInstallerRepairState()");
    expect(source).toContain("repairResource: async (resourceId: string)");
    expect(repairSource).toContain("await repairInstallResource(");
    expect(source).toContain(
      'const plan = operation === "install" ? await store.planRelease(identity.releaseDigest) : null;',
    );
    expect(source).toContain('operation === "install"\n      ? await transferInstallResources(');
    expect(source.match(/transferInstallResources\(/gu)).toHaveLength(1);
    expect(source.match(/store\.planRelease\(/gu)).toHaveLength(1);
    expect(source).toContain(
      "plan?.reusedResourceIds ?? opfsResources.map((resource) => resource.id)",
    );
    expect(source).toContain("runInstallerRequestWithTimeout");
    expect(source.match(/runInstallerRequestWithTimeout\(/gu)).toHaveLength(2);
    expect(source).toContain('"Install target discovery timed out"');
    expect(source).toMatch(
      /"Install target discovery timed out",[\s\S]*?undefined,\s*signal,\s*\);/u,
    );
    expect(source).toContain("await store.getActiveReleaseDigest()");
    expect(source).not.toContain("await store.getSelection()");
    expect(source).not.toContain(".rollbackToPrevious(");
    expect(source).not.toContain("INSTALL_STORE_LOCK_NAME");
    expect(source).not.toMatch(/trust.?fault|fault.?token|fault.?nonce|qualification.?hook/iu);
    expect(source).not.toContain("__parallaxInstallerFault");
    expect(sessionSource).not.toMatch(
      /trust.?fault|fault.?token|fault.?nonce|qualification.?hook/iu,
    );
  });
});
