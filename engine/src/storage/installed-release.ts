import type { InstallManifest, InstallResource } from "./install-manifest";
import {
  createOpfsReleaseStore,
  type OpfsReleaseStore,
  type VerifiedObjectRef,
} from "./opfs-release-store";

export const INSTALLED_RELEASE_TELEMETRY_SCHEMA_VERSION = 1;

export interface InstalledReleaseTelemetrySnapshot {
  readonly failureMessage: string | null;
  readonly networkFallbackCount: 0;
  readonly referencedBytes: number;
  readonly referencedResourceCount: number;
  readonly releaseDigest: string;
  readonly schemaVersion: typeof INSTALLED_RELEASE_TELEMETRY_SCHEMA_VERSION;
  readonly state: "ready" | "failed";
}

export interface InstalledReleaseResource {
  readonly manifest: InstallResource;
  readonly reference: VerifiedObjectRef;
}

export interface InstalledReleaseBinding {
  readonly manifest: InstallManifest;
  readonly releaseDigest: string;
  getResource(resourceId: string): Promise<InstalledReleaseResource>;
  getResources(resourceIds: readonly string[]): Promise<readonly InstalledReleaseResource[]>;
  snapshot(): InstalledReleaseTelemetrySnapshot;
}

const SHA256 = /^[a-f0-9]{64}$/;

export async function bindActiveInstalledRelease(
  releaseDigest: string,
  store: OpfsReleaseStore = createOpfsReleaseStore(),
): Promise<InstalledReleaseBinding> {
  if (!SHA256.test(releaseDigest)) {
    throw new Error("Installed runtime requires an exact release digest");
  }
  const manifest = await store.admitActiveRelease(releaseDigest);
  const byId = new Map(
    manifest.resources
      .filter((resource) => resource.target === "opfs")
      .map((resource) => [resource.id, resource] as const),
  );
  let telemetry: InstalledReleaseTelemetrySnapshot = freezeTelemetry({
    failureMessage: null,
    networkFallbackCount: 0,
    referencedBytes: 0,
    referencedResourceCount: 0,
    releaseDigest,
    schemaVersion: INSTALLED_RELEASE_TELEMETRY_SCHEMA_VERSION,
    state: "ready",
  });

  const fail = (error: unknown): never => {
    const message = error instanceof Error && error.message !== "" ? error.message : String(error);
    telemetry = freezeTelemetry({ ...telemetry, failureMessage: message, state: "failed" });
    throw error;
  };

  return Object.freeze({
    manifest,
    releaseDigest,
    async getResource(resourceId: string): Promise<InstalledReleaseResource> {
      if (telemetry.state === "failed") {
        throw new Error(telemetry.failureMessage ?? "Installed release binding failed");
      }
      const resource = byId.get(resourceId);
      if (resource === undefined) {
        return fail(new Error(`Installed release omits OPFS resource ${resourceId}`));
      }
      try {
        const reference = await store.getResource(releaseDigest, resourceId);
        if (
          reference.bytes !== resource.bytes ||
          reference.releaseDigest !== releaseDigest ||
          reference.resourceId !== resource.id ||
          reference.scope !== resource.scope ||
          reference.sha256 !== resource.sha256
        ) {
          throw new Error(`Installed resource reference mismatch for ${resourceId}`);
        }
        telemetry = freezeTelemetry({
          ...telemetry,
          referencedBytes: safeAdd(telemetry.referencedBytes, resource.bytes),
          referencedResourceCount: safeAdd(telemetry.referencedResourceCount, 1),
        });
        return Object.freeze({ manifest: resource, reference });
      } catch (error: unknown) {
        return fail(error);
      }
    },
    async getResources(
      resourceIds: readonly string[],
    ): Promise<readonly InstalledReleaseResource[]> {
      if (telemetry.state === "failed") {
        throw new Error(telemetry.failureMessage ?? "Installed release binding failed");
      }
      if (resourceIds.length === 0 || new Set(resourceIds).size !== resourceIds.length) {
        return fail(new Error("Installed resource batch must contain distinct resource IDs"));
      }
      const resources = resourceIds.map((resourceId) => {
        const resource = byId.get(resourceId);
        if (resource === undefined) {
          return fail(new Error(`Installed release omits OPFS resource ${resourceId}`));
        }
        return resource;
      });
      try {
        const references = await store.getResources(releaseDigest, resourceIds);
        if (references.length !== resources.length) {
          throw new Error("Installed resource batch length mismatch");
        }
        const resolved = references.map((reference, index) => {
          const resource = resources[index];
          if (
            resource === undefined ||
            reference.bytes !== resource.bytes ||
            reference.releaseDigest !== releaseDigest ||
            reference.resourceId !== resource.id ||
            reference.scope !== resource.scope ||
            reference.sha256 !== resource.sha256
          ) {
            throw new Error(
              `Installed resource reference mismatch for ${resourceIds[index] ?? "unknown"}`,
            );
          }
          return Object.freeze({ manifest: resource, reference });
        });
        telemetry = freezeTelemetry({
          ...telemetry,
          referencedBytes: resources.reduce(
            (total, resource) => safeAdd(total, resource.bytes),
            telemetry.referencedBytes,
          ),
          referencedResourceCount: safeAdd(telemetry.referencedResourceCount, resources.length),
        });
        return Object.freeze(resolved);
      } catch (error: unknown) {
        return fail(error);
      }
    },
    snapshot(): InstalledReleaseTelemetrySnapshot {
      return telemetry;
    },
  });
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Installed release telemetry overflow");
  }
  return value;
}

function freezeTelemetry(
  value: InstalledReleaseTelemetrySnapshot,
): InstalledReleaseTelemetrySnapshot {
  return Object.freeze({ ...value });
}
