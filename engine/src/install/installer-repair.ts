import type { InstallResource } from "../storage/install-manifest";
import type { InstallerRepairAdmission } from "../storage/opfs-release-store";
import {
  type InstallerExistingActivationStore,
  type InstallerRepairActivationStore,
  verifyAndRestoreInstallerRepair,
  verifyExistingInstallerRelease,
} from "./installer-activation";
import { callInstallerRepairStore } from "./installer-repair-store-operation";
import {
  InstallerTransferError,
  type InstallerTransferInput,
  type InstallerTransferObserver,
  type InstallerTransferPlatform,
  type InstallerTransferStore,
  repairInstallResource,
} from "./installer-transfer";

export interface InstallerRepairOperationStore
  extends InstallerExistingActivationStore,
    InstallerRepairActivationStore,
    InstallerTransferStore {
  admitRepairRelease(releaseDigest: string): Promise<InstallerRepairAdmission>;
}

export interface InstallerRepairOperationInput {
  readonly admission: InstallerRepairAdmission | null;
  readonly beginCompletion: () => void;
  readonly expectedBytes: number;
  readonly expectedResourceCount: number;
  readonly observer: InstallerTransferObserver;
  readonly resources: readonly InstallResource[];
  readonly signal: AbortSignal;
  readonly store: InstallerRepairOperationStore;
  readonly transferInput: InstallerTransferInput;
  readonly transferPlatform: InstallerTransferPlatform;
}

/**
 * The single explicit-Repair product path. It transfers only an exactly admitted
 * resource, then verifies every OPFS resource before restoring the existing commit.
 * It never marks ready or publishes a release.
 */
export async function repairInstalledRelease(input: InstallerRepairOperationInput): Promise<void> {
  const opfsResources = input.resources.filter((resource) => resource.target === "opfs");
  if (
    opfsResources.length !== input.expectedResourceCount ||
    opfsResources.reduce((total, resource) => safeAdd(total, resource.bytes), 0) !==
      input.expectedBytes
  ) {
    throw new InstallerTransferError(
      "validator",
      "Repair resources differ from the exact manifest OPFS totals",
      null,
    );
  }
  const resourcesById = new Map(opfsResources.map((resource) => [resource.id, resource] as const));
  if (resourcesById.size !== opfsResources.length) {
    throw new InstallerTransferError("validator", "Repair resources contain duplicate IDs", null);
  }
  const repair = async (
    admission: InstallerRepairAdmission,
    resourceId: string,
    creditIntegrityDiscovery: boolean,
  ): Promise<void> => {
    const resource = resourcesById.get(resourceId);
    if (
      admission.releaseDigest !== input.transferInput.releaseDigest ||
      admission.resourceId !== resourceId ||
      admission.state !== "repair-required" ||
      resource === undefined
    ) {
      throw new InstallerTransferError(
        "integrity",
        "Repair lacks exact durable resource admission",
        resourceId,
      );
    }
    if (creditIntegrityDiscovery) {
      input.observer.integrityFailure(resourceId);
    }
    input.observer.resourceActive(resource.id);
    try {
      await repairInstallResource(
        input.store,
        input.transferPlatform,
        input.observer,
        input.transferInput,
        resource,
        true,
      );
    } finally {
      input.observer.resourceInactive(resource.id);
    }
  };
  const activationInput = {
    expectedBytes: input.expectedBytes,
    expectedResourceCount: input.expectedResourceCount,
    releaseDigest: input.transferInput.releaseDigest,
    signal: input.signal,
    store: input.store,
    transferredBytes: input.expectedBytes,
    transferredResourceCount: input.expectedResourceCount,
  } as const;
  if (input.admission === null) {
    await verifyExistingInstallerRelease({
      ...activationInput,
      repairResource: async (resourceId: string) => {
        const admission = await callInstallerRepairStore("admit-repair-release", resourceId, () =>
          input.store.admitRepairRelease(input.transferInput.releaseDigest),
        );
        await repair(admission, resourceId, true);
        input.beginCompletion();
        return admission;
      },
    });
    return;
  }
  if (input.admission.state === "repair-required") {
    await repair(input.admission, input.admission.resourceId, false);
  }
  input.beginCompletion();
  await verifyAndRestoreInstallerRepair({ ...activationInput, admission: input.admission });
}

function safeAdd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new InstallerTransferError("validator", "Repair byte total is unsafe", null);
  }
  return total;
}
