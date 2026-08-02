import { describe, expect, it } from "vitest";
import {
  evaluateUninstallEvidence,
  UNINSTALL_EVIDENCE_SURFACES,
  type UninstallMechanism,
  type UninstallMechanismObservation,
} from "./uninstall-evidence";

describe("uninstall evidence", () => {
  it("accepts both isolated mechanisms and keeps attempted cache probes honest", () => {
    const values = [mechanism("client-side", 101), mechanism("clear-site-data", 202)];
    const result = evaluateUninstallEvidence(values, values[0]?.authority ?? failFixture());
    expect(result.passed).toBe(true);
    expect(
      result.mechanisms.flatMap(({ surfaces }) =>
        surfaces.filter(({ verdict }) => verdict === "unobservable"),
      ),
    ).toHaveLength(6);
  });

  it("accepts independently valid quota samples from different observation windows", () => {
    const values = [mechanism("client-side", 101), mechanism("clear-site-data", 202)];
    const [first] = pair(values);
    const telemetry = structuredClone(first.productTelemetry) as Record<string, unknown>;
    const seededBytes = 32 * 1024 * 1024;
    telemetry.quota = {
      afterQuota: 120_000_000,
      afterUsage: 200,
      beforeQuota: 120_000_000,
      beforeUsage: 200 + seededBytes,
      releasedBytes: seededBytes,
      teardownKind: "nonempty",
    };
    values[0] = { ...first, productTelemetry: telemetry };

    expect(evaluateUninstallEvidence(values, first.authority).passed).toBe(true);
  });

  it("accepts independently valid surface inventories bound by the operation sentinel", () => {
    const values = [mechanism("client-side", 101), mechanism("clear-site-data", 202)];
    const [first] = pair(values);
    const telemetry = structuredClone(first.productTelemetry) as Record<string, unknown>;
    const surfaces = telemetry.surfaces as Array<Record<string, unknown>>;
    for (const surface of surfaces) {
      const before = surface.before as string[];
      const independentEntry = `product-window-${String(surface.surface)}`;
      surface.before = [...before, independentEntry];
      surface.attempted = [...before, independentEntry];
      surface.removed = [...before, independentEntry];
    }
    values[0] = { ...first, productTelemetry: telemetry };

    expect(evaluateUninstallEvidence(values, first.authority).passed).toBe(true);
  });

  it.each([
    ["order", (values: UninstallMechanismObservation[]) => values.reverse()],
    [
      "profile reuse",
      (values: UninstallMechanismObservation[]) => {
        const [first, second] = pair(values);
        values[1] = { ...second, profileId: first.profileId };
      },
    ],
    [
      "authority drift",
      (values: UninstallMechanismObservation[]) => {
        const [, second] = pair(values);
        values[1] = {
          ...second,
          authority: { ...second.authority, releaseDigest: "b".repeat(64) },
        };
      },
    ],
    [
      "response provenance",
      (values: UninstallMechanismObservation[]) => {
        const [, second] = pair(values);
        if (second.response === null) throw new Error("Fixture response is missing");
        values[1] = {
          ...second,
          response: { ...second.response, fromServiceWorker: true as false },
        };
      },
    ],
    [
      "sentinel reuse",
      (values: UninstallMechanismObservation[]) => {
        const [first, second] = pair(values);
        const duplicate = first.surfaces[0]?.sentinel;
        if (duplicate === null || duplicate === undefined)
          throw new Error("Fixture sentinel is missing");
        values[1] = {
          ...second,
          surfaces: second.surfaces.map((surface) =>
            surface.surface === "opfs"
              ? { ...surface, before: [duplicate], sentinel: duplicate }
              : surface,
          ),
        };
      },
    ],
    [
      "quota sign",
      (values: UninstallMechanismObservation[]) => {
        const [first] = pair(values);
        values[0] = {
          ...first,
          quota: {
            ...first.quota,
            afterUsage: first.quota.beforeUsage + 1,
            releasedBytes: -1,
          },
        };
      },
    ],
    [
      "underseeded quota",
      (values: UninstallMechanismObservation[]) => {
        const [first] = pair(values);
        values[0] = { ...first, quota: { ...first.quota, seededBytes: 4_096 } };
      },
    ],
    [
      "release below seeded bytes",
      (values: UninstallMechanismObservation[]) => {
        const [first] = pair(values);
        values[0] = {
          ...first,
          quota: {
            ...first.quota,
            beforeUsage: first.quota.afterUsage + 4_096,
            releasedBytes: 4_096,
          },
        };
      },
    ],
    [
      "unattempted probe",
      (values: UninstallMechanismObservation[]) => {
        const [first] = pair(values);
        values[0] = {
          ...first,
          surfaces: first.surfaces.map((surface) =>
            surface.surface === "http-cache"
              ? { ...surface, probe: { ...surface.probe, attempted: false as true } }
              : surface,
          ),
        };
      },
    ],
    [
      "extra key",
      (values: UninstallMechanismObservation[]) => {
        const [first] = pair(values);
        values[0] = { ...first, surprise: true } as UninstallMechanismObservation;
      },
    ],
  ])("rejects adversarial %s evidence", (_label, mutate) => {
    const values = [mechanism("client-side", 101), mechanism("clear-site-data", 202)];
    mutate(values);
    expect(() =>
      evaluateUninstallEvidence(values, mechanism("client-side", 303).authority),
    ).toThrow();
  });

  it("rejects matching arbitrary hashes that differ from current expected authority", () => {
    const expected = mechanism("client-side", 303).authority;
    const values = [mechanism("client-side", 101), mechanism("clear-site-data", 202)].map(
      (value) => ({ ...value, authority: { ...value.authority, artifactDigest: "9".repeat(64) } }),
    );
    expect(() => evaluateUninstallEvidence(values, expected)).toThrow(/independently resolved/);
  });

  it("rejects failed cache observations mislabeled as a successful cumulative probe", () => {
    const values = [mechanism("client-side", 101), mechanism("clear-site-data", 202)];
    const expected = values[0]?.authority ?? failFixture();
    const [first] = pair(values);
    values[0] = {
      ...first,
      surfaces: first.surfaces.map((surface) =>
        surface.surface === "http-cache"
          ? {
              ...surface,
              before: ["cdp-network-cache:before:failed:bounded"],
              probe: { ...surface.probe, reason: "Cumulative signal unavailable." },
            }
          : surface,
      ),
    };
    expect(() => evaluateUninstallEvidence(values, expected)).toThrow(/mislabeled/);
  });

  it.each([
    [
      "false product quota",
      (telemetry: Record<string, unknown>) => {
        (telemetry.quota as Record<string, unknown>).beforeUsage = 99_999;
      },
    ],
    [
      "missing operation sentinel",
      (telemetry: Record<string, unknown>) => {
        const surface = (telemetry.surfaces as Array<Record<string, unknown>>)[0];
        if (surface === undefined) throw new Error("Fixture product surface is missing");
        surface.before = [];
        surface.attempted = [];
        surface.removed = [];
      },
    ],
    [
      "unattempted product inventory",
      (telemetry: Record<string, unknown>) => {
        const surface = (telemetry.surfaces as Array<Record<string, unknown>>)[0];
        if (surface === undefined) throw new Error("Fixture product surface is missing");
        surface.attempted = [];
      },
    ],
    [
      "unremoved product inventory",
      (telemetry: Record<string, unknown>) => {
        const surface = (telemetry.surfaces as Array<Record<string, unknown>>)[0];
        if (surface === undefined) throw new Error("Fixture product surface is missing");
        surface.removed = [];
      },
    ],
    [
      "retained product inventory",
      (telemetry: Record<string, unknown>) => {
        const surface = (telemetry.surfaces as Array<Record<string, unknown>>)[0];
        if (surface === undefined) throw new Error("Fixture product surface is missing");
        surface.after = ["retained-entry"];
      },
    ],
    [
      "malformed product inventory",
      (telemetry: Record<string, unknown>) => {
        const surface = (telemetry.surfaces as Array<Record<string, unknown>>)[0];
        if (surface === undefined) throw new Error("Fixture product surface is missing");
        surface.before = [42];
        surface.attempted = [42];
        surface.removed = [42];
      },
    ],
    [
      "oversized product inventory",
      (telemetry: Record<string, unknown>) => {
        const surface = (telemetry.surfaces as Array<Record<string, unknown>>)[0];
        if (surface === undefined) throw new Error("Fixture product surface is missing");
        const oversized = Array.from({ length: 4_097 }, (_, index) => `entry-${index}`);
        surface.before = oversized;
        surface.attempted = oversized;
        surface.removed = oversized;
      },
    ],
    [
      "arbitrary coverage",
      (telemetry: Record<string, unknown>) => {
        (telemetry.coverage as Record<string, unknown>).arbitrary = "observed";
      },
    ],
    [
      "duplicate surface",
      (telemetry: Record<string, unknown>) => {
        const surfaces = telemetry.surfaces as unknown[];
        surfaces[3] = structuredClone(surfaces[0]);
      },
    ],
    [
      "missing surface",
      (telemetry: Record<string, unknown>) => {
        (telemetry.surfaces as unknown[]).pop();
      },
    ],
    [
      "extra surface",
      (telemetry: Record<string, unknown>) => {
        (telemetry.surfaces as unknown[]).push({
          after: [],
          attempted: ["extra"],
          before: ["extra"],
          removed: ["extra"],
          surface: "extra",
        });
      },
    ],
  ])("rejects adversarial %s telemetry", (_label, mutate) => {
    const values = [mechanism("client-side", 101), mechanism("clear-site-data", 202)];
    const [first] = pair(values);
    const telemetry = structuredClone(first.productTelemetry) as Record<string, unknown>;
    mutate(telemetry);
    values[0] = { ...first, productTelemetry: telemetry };
    expect(() => evaluateUninstallEvidence(values, first.authority)).toThrow();
  });

  it("rejects an invalid V8 capture mislabeled as ordinary unobservable evidence", () => {
    const values = [mechanism("client-side", 101), mechanism("clear-site-data", 202)];
    const [first] = pair(values);
    values[0] = {
      ...first,
      surfaces: first.surfaces.map((surface) =>
        surface.surface === "v8-code-cache"
          ? {
              ...surface,
              before: ["v8-trace:before:invalid:data-loss"],
              probe: { ...surface.probe, reason: "Trace is cumulative." },
            }
          : surface,
      ),
    };
    expect(() => evaluateUninstallEvidence(values, first.authority)).toThrow(
      /cannot be downgraded/,
    );
  });

  it("rejects a failed V8 capture even when labeled as a probe failure", () => {
    const values = [mechanism("client-side", 101), mechanism("clear-site-data", 202)];
    const [first] = pair(values);
    values[0] = {
      ...first,
      surfaces: first.surfaces.map((surface) =>
        surface.surface === "v8-code-cache"
          ? {
              ...surface,
              before: ["v8-trace:before:failed:reload-failed"],
              probe: { ...surface.probe, reason: "Probe failed: reload failed." },
            }
          : surface,
      ),
    };
    expect(() => evaluateUninstallEvidence(values, first.authority)).toThrow(
      /cannot be downgraded/,
    );
  });
});

function pair(
  values: readonly UninstallMechanismObservation[],
): readonly [UninstallMechanismObservation, UninstallMechanismObservation] {
  const first = values[0];
  const second = values[1];
  if (first === undefined || second === undefined)
    throw new Error("Test fixture mechanism pair is incomplete");
  return [first, second];
}

function mechanism(
  mechanismName: UninstallMechanism,
  processId: number,
): UninstallMechanismObservation {
  const authority = {
    artifactDigest: "a".repeat(64),
    browser: { executableSha256: "c".repeat(64), product: "Chrome/151", revision: "r1" },
    environment: { gateState: "measured" as const, machineId: "dev-01", tier: "showcase" as const },
    origin: "https://parallax.test",
    releaseDigest: "d".repeat(64),
    source: { commit: "e".repeat(40), dirtyTreeDigest: "f".repeat(64) },
    target: { artifactDigest: "a".repeat(64), origin: "https://parallax.test" },
  };
  const prefix = mechanismName === "client-side" ? "client" : "header";
  const seededBytes = 32 * 1024 * 1024;
  const quota = {
    afterQuota: 100_000_000,
    afterUsage: 100,
    beforeQuota: 100_000_000,
    beforeUsage: 100 + seededBytes,
    releasedBytes: seededBytes,
    seededBytes,
  };
  const surfaces = UNINSTALL_EVIDENCE_SURFACES.map((surface, index) => {
    const required = ["opfs", "service-workers", "cache-storage", "indexed-db"].includes(surface);
    const sentinel = required ? `${prefix}-${surface}-sentinel-${index}-0123456789` : null;
    const source =
      surface === "http-cache" || surface === "dawn-gpu-cache"
        ? ("cdp" as const)
        : surface === "v8-code-cache"
          ? ("trace" as const)
          : ("page" as const);
    const kind =
      surface === "opfs"
        ? ("page-opfs" as const)
        : surface === "service-workers"
          ? ("page-service-worker" as const)
          : surface === "cache-storage"
            ? ("page-cache-storage" as const)
            : surface === "indexed-db"
              ? ("page-indexed-db" as const)
              : surface === "http-cache"
                ? ("cdp-network-cache" as const)
                : surface === "v8-code-cache"
                  ? ("v8-trace-code-cache" as const)
                  : ("dawn-subprocess-histograms" as const);
    return {
      after: [],
      before: sentinel === null ? [] : [sentinel],
      probe: {
        attempted: true as const,
        kind,
        reason: required ? null : "Actual signal cannot prove origin eviction.",
      },
      sentinel,
      source,
      surface,
      verdict: required ? ("cleared" as const) : ("unobservable" as const),
    };
  });
  return {
    authority,
    cleanup: { postValidationPassed: true, profileRemoved: true },
    endpoint: mechanismName === "clear-site-data" ? "/uninstall" : null,
    mechanism: mechanismName,
    processId,
    productTelemetry:
      mechanismName === "client-side"
        ? {
            attempt: 1,
            contract: "uninstall-telemetry@1",
            coverage: {
              cacheStorage: "observed",
              dawnGpuCache: "not-observable-from-page",
              httpCache: "not-observable-from-page",
              indexedDb: "observed",
              opfs: "observed",
              serviceWorkers: "observed",
              v8CodeCache: "not-observable-from-page",
            },
            failures: [],
            quota: {
              afterQuota: quota.afterQuota,
              afterUsage: quota.afterUsage,
              beforeQuota: quota.beforeQuota,
              beforeUsage: quota.beforeUsage,
              releasedBytes: quota.releasedBytes,
              teardownKind: "nonempty",
            },
            quiescence: { clientCount: 1, exclusiveLocksHeld: true, stableInventoryPasses: 2 },
            schemaVersion: 1,
            state: "succeeded",
            surfaces: surfaces
              .filter(({ sentinel }) => sentinel !== null)
              .map(({ after, before, surface }) => ({
                after,
                attempted: before,
                before,
                removed: before,
                surface,
              })),
          }
        : null,
    profileId: `profile-${prefix}-12345678`,
    quota,
    response:
      mechanismName === "clear-site-data"
        ? {
            clearSiteData: '"storage", "cache"',
            fromServiceWorker: false,
            method: "POST",
            requestId: "request-1",
            status: 200,
            transport: "completed",
            url: "https://parallax.test/uninstall",
          }
        : null,
    surfaces,
  };
}

function failFixture(): never {
  throw new Error("Test fixture authority is missing");
}
