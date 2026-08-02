export const UNINSTALL_EVIDENCE_CONTRACT = "uninstall-verification@1" as const;
export const UNINSTALL_EVIDENCE_SCHEMA_VERSION = 3 as const;
export const UNINSTALL_MINIMUM_SEEDED_BYTES = 32 * 1024 * 1024;

export const UNINSTALL_MECHANISMS = ["client-side", "clear-site-data"] as const;
export type UninstallMechanism = (typeof UNINSTALL_MECHANISMS)[number];
export const UNINSTALL_EVIDENCE_SURFACES = [
  "opfs",
  "service-workers",
  "cache-storage",
  "indexed-db",
  "http-cache",
  "v8-code-cache",
  "dawn-gpu-cache",
] as const;
export type UninstallEvidenceSurface = (typeof UNINSTALL_EVIDENCE_SURFACES)[number];
export type UninstallCoverageVerdict = "cleared" | "retained" | "unobservable";
export type UninstallProbeKind =
  | "cdp-network-cache"
  | "dawn-subprocess-histograms"
  | "page-cache-storage"
  | "page-indexed-db"
  | "page-opfs"
  | "page-service-worker"
  | "v8-trace-code-cache";

export interface UninstallRawSurfaceObservation {
  readonly after: readonly string[];
  readonly before: readonly string[];
  readonly probe: Readonly<{
    readonly attempted: true;
    readonly kind: UninstallProbeKind;
    readonly reason: string | null;
  }>;
  readonly sentinel: string | null;
  readonly source: "cdp" | "page" | "trace";
  readonly surface: UninstallEvidenceSurface;
  readonly verdict: UninstallCoverageVerdict;
}

export interface UninstallMechanismObservation {
  readonly authority: Readonly<{
    readonly artifactDigest: string;
    readonly browser: Readonly<{
      readonly executableSha256: string;
      readonly product: string;
      readonly revision: string;
    }>;
    readonly environment: Readonly<{
      readonly gateState: "measured";
      readonly machineId: string;
      readonly tier: "showcase";
    }>;
    readonly origin: string;
    readonly releaseDigest: string;
    readonly source: Readonly<{ readonly commit: string; readonly dirtyTreeDigest: string | null }>;
    readonly target: unknown;
  }>;
  readonly cleanup: Readonly<{
    readonly postValidationPassed: boolean;
    readonly profileRemoved: boolean;
  }>;
  readonly endpoint: "/uninstall" | null;
  readonly mechanism: UninstallMechanism;
  readonly processId: number;
  readonly productTelemetry: unknown | null;
  readonly profileId: string;
  readonly quota: Readonly<{
    readonly afterQuota: number;
    readonly afterUsage: number;
    readonly beforeQuota: number;
    readonly beforeUsage: number;
    readonly releasedBytes: number;
    readonly seededBytes: number;
  }>;
  readonly response: Readonly<{
    readonly clearSiteData: '"storage", "cache"';
    readonly fromServiceWorker: false;
    readonly method: "POST";
    readonly requestId: string;
    readonly status: 200;
    readonly transport: "client-closed-after-headers" | "completed";
    readonly url: string;
  }> | null;
  readonly surfaces: readonly UninstallRawSurfaceObservation[];
}

export interface UninstallVerificationEvidence {
  readonly contract: typeof UNINSTALL_EVIDENCE_CONTRACT;
  readonly mechanisms: readonly Readonly<
    UninstallMechanismObservation & { readonly passed: boolean; readonly quotaReleased: boolean }
  >[];
  readonly passed: boolean;
  readonly schemaVersion: typeof UNINSTALL_EVIDENCE_SCHEMA_VERSION;
}

const REQUIRED_CLEARED = new Set<UninstallEvidenceSurface>([
  "cache-storage",
  "indexed-db",
  "opfs",
  "service-workers",
]);
const SOURCE_BY_SURFACE = Object.freeze({
  "cache-storage": "page",
  "dawn-gpu-cache": "cdp",
  "http-cache": "cdp",
  "indexed-db": "page",
  opfs: "page",
  "service-workers": "page",
  "v8-code-cache": "trace",
} satisfies Record<UninstallEvidenceSurface, UninstallRawSurfaceObservation["source"]>);
const PROBE_BY_SURFACE = Object.freeze({
  "cache-storage": "page-cache-storage",
  "dawn-gpu-cache": "dawn-subprocess-histograms",
  "http-cache": "cdp-network-cache",
  "indexed-db": "page-indexed-db",
  opfs: "page-opfs",
  "service-workers": "page-service-worker",
  "v8-code-cache": "v8-trace-code-cache",
} satisfies Record<UninstallEvidenceSurface, UninstallProbeKind>);
const MAX_OBSERVATIONS = 4_096;

/** Validate bounded raw observations. Absence is never promoted to cache-clearing proof. */
export function evaluateUninstallEvidence(
  observations: readonly UninstallMechanismObservation[],
  expectedAuthority: UninstallMechanismObservation["authority"],
): UninstallVerificationEvidence {
  if (
    observations.length !== UNINSTALL_MECHANISMS.length ||
    observations.some(({ mechanism }, index) => mechanism !== UNINSTALL_MECHANISMS[index])
  ) {
    throw new Error("Uninstall evidence requires each exact mechanism in fixed order");
  }
  const sentinels = new Set<string>();
  const canonicalAuthority = JSON.stringify(observations[0]?.authority);
  validateAuthority(expectedAuthority);
  if (canonicalAuthority !== JSON.stringify(expectedAuthority)) {
    throw new Error("Uninstall evidence does not bind independently resolved current authority");
  }
  const mechanisms = observations.map((observation, index) => {
    const mechanism = UNINSTALL_MECHANISMS[index];
    if (mechanism === undefined || observation.mechanism !== mechanism) {
      throw new Error("Uninstall mechanism order changed during evaluation");
    }
    requireExactKeys(
      observation,
      [
        "authority",
        "cleanup",
        "endpoint",
        "mechanism",
        "processId",
        "productTelemetry",
        "profileId",
        "quota",
        "response",
        "surfaces",
      ],
      `Uninstall mechanism ${mechanism}`,
    );
    validateAuthority(observation.authority);
    if (JSON.stringify(observation.authority) !== canonicalAuthority) {
      throw new Error("Uninstall mechanisms do not bind the same exact authority");
    }
    if (
      !Number.isSafeInteger(observation.processId) ||
      observation.processId <= 0 ||
      !/^profile-[A-Za-z0-9_-]{8,200}$/u.test(observation.profileId)
    ) {
      throw new Error(`Uninstall mechanism ${mechanism} process/profile identity is invalid`);
    }
    if (
      observations.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          (other.profileId === observation.profileId || other.processId === observation.processId),
      )
    ) {
      throw new Error("Uninstall mechanisms must use distinct fresh profiles and processes");
    }
    if (
      observation.cleanup.profileRemoved !== true ||
      observation.cleanup.postValidationPassed !== true
    ) {
      throw new Error(`Uninstall mechanism ${mechanism} cleanup/postvalidation is incomplete`);
    }
    validateMechanismProvenance(observation);
    validateQuota(observation.quota, mechanism);
    const bySurface = new Map<UninstallEvidenceSurface, UninstallRawSurfaceObservation>();
    for (const surface of observation.surfaces) {
      if (
        !UNINSTALL_EVIDENCE_SURFACES.includes(surface.surface) ||
        bySurface.has(surface.surface)
      ) {
        throw new Error(
          `Uninstall mechanism ${mechanism} has invalid or duplicate surface evidence`,
        );
      }
      validateRawObservation(surface, sentinels);
      bySurface.set(surface.surface, surface);
    }
    if (bySurface.size !== UNINSTALL_EVIDENCE_SURFACES.length) {
      throw new Error(`Uninstall mechanism ${mechanism} omits a required surface`);
    }
    const surfaces = UNINSTALL_EVIDENCE_SURFACES.map((surface) => {
      const value = bySurface.get(surface);
      if (value === undefined) throw new Error(`Missing uninstall surface ${surface}`);
      return freezeSurface(value);
    });
    const quotaReleased = observation.quota.releasedBytes > 0;
    const passed =
      quotaReleased &&
      surfaces.every(
        (surface) => !REQUIRED_CLEARED.has(surface.surface) || surface.verdict === "cleared",
      );
    return Object.freeze({
      ...observation,
      passed,
      quotaReleased,
      surfaces: Object.freeze(surfaces),
    });
  });
  return Object.freeze({
    contract: UNINSTALL_EVIDENCE_CONTRACT,
    mechanisms: Object.freeze(mechanisms),
    passed: mechanisms.every(({ passed }) => passed),
    schemaVersion: UNINSTALL_EVIDENCE_SCHEMA_VERSION,
  });
}

function validateMechanismProvenance(value: UninstallMechanismObservation): void {
  if (value.mechanism === "client-side") {
    if (value.endpoint !== null || value.response !== null || value.productTelemetry === null) {
      throw new Error(
        "Client-side uninstall must retain product telemetry and no endpoint response",
      );
    }
    validateProductTelemetry(value.productTelemetry, value);
    return;
  }
  if (
    value.endpoint !== "/uninstall" ||
    value.productTelemetry !== null ||
    value.response === null
  ) {
    throw new Error("Clear-Site-Data uninstall has incomplete endpoint provenance");
  }
  requireExactKeys(
    value.response,
    ["clearSiteData", "fromServiceWorker", "method", "requestId", "status", "transport", "url"],
    "Clear-Site-Data response",
  );
  if (
    value.response.clearSiteData !== '"storage", "cache"' ||
    value.response.fromServiceWorker !== false ||
    value.response.method !== "POST" ||
    value.response.status !== 200 ||
    (value.response.transport !== "completed" &&
      value.response.transport !== "client-closed-after-headers") ||
    value.response.url !== `${value.authority.origin}/uninstall` ||
    value.response.requestId === ""
  ) {
    throw new Error("Clear-Site-Data network response provenance is invalid");
  }
}

function validateProductTelemetry(
  value: unknown,
  observation: UninstallMechanismObservation,
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Client-side uninstall product telemetry is invalid");
  }
  const telemetry = value as Record<string, unknown>;
  requireExactKeys(
    telemetry,
    [
      "attempt",
      "contract",
      "coverage",
      "failures",
      "quota",
      "quiescence",
      "schemaVersion",
      "state",
      "surfaces",
    ],
    "Client-side uninstall product telemetry",
  );
  if (
    telemetry.contract !== "uninstall-telemetry@1" ||
    telemetry.schemaVersion !== 1 ||
    telemetry.state !== "succeeded" ||
    !Number.isSafeInteger(telemetry.attempt) ||
    Number(telemetry.attempt) <= 0 ||
    !Array.isArray(telemetry.failures) ||
    telemetry.failures.length !== 0 ||
    !Array.isArray(telemetry.surfaces) ||
    telemetry.surfaces.length !== 4
  ) {
    throw new Error("Client-side uninstall product telemetry did not report exact success");
  }
  const coverage = telemetry.coverage as Record<string, unknown>;
  requireExactKeys(
    coverage,
    [
      "cacheStorage",
      "dawnGpuCache",
      "httpCache",
      "indexedDb",
      "opfs",
      "serviceWorkers",
      "v8CodeCache",
    ],
    "Client-side uninstall coverage telemetry",
  );
  if (
    coverage.cacheStorage !== "observed" ||
    coverage.indexedDb !== "observed" ||
    coverage.opfs !== "observed" ||
    coverage.serviceWorkers !== "observed" ||
    coverage.httpCache !== "not-observable-from-page" ||
    coverage.v8CodeCache !== "not-observable-from-page" ||
    coverage.dawnGpuCache !== "not-observable-from-page"
  ) {
    throw new Error("Client-side uninstall coverage telemetry is invalid");
  }
  const quota = telemetry.quota as Record<string, unknown>;
  requireExactKeys(
    quota,
    ["afterQuota", "afterUsage", "beforeQuota", "beforeUsage", "releasedBytes", "teardownKind"],
    "Client-side uninstall quota telemetry",
  );
  const numericQuota = [
    quota.afterQuota,
    quota.afterUsage,
    quota.beforeQuota,
    quota.beforeUsage,
    quota.releasedBytes,
  ];
  if (
    numericQuota.some(
      (value) => typeof value !== "number" || !Number.isFinite(value) || value < 0,
    ) ||
    (quota.beforeUsage as number) <= (quota.afterUsage as number) ||
    quota.releasedBytes !== (quota.beforeUsage as number) - (quota.afterUsage as number) ||
    (quota.releasedBytes as number) <= 0 ||
    quota.teardownKind !== "nonempty"
  ) {
    throw new Error(
      "Client-side uninstall quota telemetry does not prove an exact positive release",
    );
  }
  const quiescence = telemetry.quiescence as Record<string, unknown>;
  requireExactKeys(
    quiescence,
    ["clientCount", "exclusiveLocksHeld", "stableInventoryPasses"],
    "Client-side uninstall quiescence telemetry",
  );
  if (
    quiescence.clientCount !== 1 ||
    quiescence.exclusiveLocksHeld !== true ||
    quiescence.stableInventoryPasses !== 2
  ) {
    throw new Error("Client-side uninstall quiescence telemetry is invalid");
  }
  const required = observation.surfaces.filter(({ surface }) => REQUIRED_CLEARED.has(surface));
  const telemetrySurfaceNames = telemetry.surfaces.map((raw) =>
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).surface
      : null,
  );
  if (
    new Set(telemetrySurfaceNames).size !== REQUIRED_CLEARED.size ||
    telemetrySurfaceNames.some(
      (surface) =>
        typeof surface !== "string" || !REQUIRED_CLEARED.has(surface as UninstallEvidenceSurface),
    )
  ) {
    throw new Error("Client-side uninstall surface telemetry membership is invalid");
  }
  for (const raw of telemetry.surfaces) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("Client-side uninstall surface telemetry is invalid");
    }
    const surface = raw as Record<string, unknown>;
    requireExactKeys(
      surface,
      ["after", "attempted", "before", "removed", "surface"],
      "Client-side uninstall surface telemetry",
    );
    const observed = required.find(({ surface: name }) => name === surface.surface);
    const inventories = [surface.before, surface.attempted, surface.removed, surface.after];
    if (
      observed === undefined ||
      inventories.some(
        (inventory) =>
          !Array.isArray(inventory) ||
          inventory.length > MAX_OBSERVATIONS ||
          inventory.some(
            (entry) => typeof entry !== "string" || entry === "" || entry.length > 1_024,
          ),
      ) ||
      JSON.stringify(surface.attempted) !== JSON.stringify(surface.before) ||
      JSON.stringify(surface.removed) !== JSON.stringify(surface.before) ||
      (surface.after as unknown[]).length !== 0 ||
      !(surface.before as unknown[]).includes(observed.sentinel)
    ) {
      throw new Error("Client-side uninstall surface telemetry does not prove sentinel removal");
    }
  }
}

function validateQuota(value: UninstallMechanismObservation["quota"], mechanism: string): void {
  requireExactKeys(
    value,
    ["afterQuota", "afterUsage", "beforeQuota", "beforeUsage", "releasedBytes", "seededBytes"],
    `Uninstall ${mechanism} quota`,
  );
  for (const [label, number] of Object.entries(value)) {
    if (!Number.isFinite(number) || number < 0)
      throw new Error(`Uninstall quota ${label} is invalid`);
  }
  if (
    value.seededBytes < UNINSTALL_MINIMUM_SEEDED_BYTES ||
    value.beforeUsage <= value.afterUsage ||
    value.releasedBytes !== value.beforeUsage - value.afterUsage ||
    value.releasedBytes < value.seededBytes
  ) {
    throw new Error(`Uninstall mechanism ${mechanism} quota release is not positive and exact`);
  }
}

function validateRawObservation(
  value: UninstallRawSurfaceObservation,
  sentinels: Set<string>,
): void {
  requireExactKeys(
    value,
    ["after", "before", "probe", "sentinel", "source", "surface", "verdict"],
    `Uninstall ${value.surface}`,
  );
  requireExactKeys(
    value.probe,
    ["attempted", "kind", "reason"],
    `Uninstall ${value.surface} probe`,
  );
  if (
    value.source !== SOURCE_BY_SURFACE[value.surface] ||
    value.probe.attempted !== true ||
    value.probe.kind !== PROBE_BY_SURFACE[value.surface]
  ) {
    throw new Error(`Uninstall ${value.surface} source/probe kind is invalid`);
  }
  for (const entries of [value.before, value.after]) {
    if (
      !Array.isArray(entries) ||
      entries.length > MAX_OBSERVATIONS ||
      entries.some((entry) => typeof entry !== "string" || entry === "" || entry.length > 1_024)
    ) {
      throw new Error("Uninstall raw observation contains invalid or oversized entries");
    }
  }
  if (REQUIRED_CLEARED.has(value.surface)) {
    if (
      typeof value.sentinel !== "string" ||
      value.sentinel.length < 16 ||
      !value.before.includes(value.sentinel) ||
      value.after.length !== 0 ||
      sentinels.has(value.sentinel)
    ) {
      throw new Error(
        `Uninstall ${value.surface} does not prove its unique nonempty sentinel was removed`,
      );
    }
    sentinels.add(value.sentinel);
  } else if (value.sentinel !== null) {
    throw new Error(`Uninstall ${value.surface} cache probe may not invent a storage sentinel`);
  }
  if (value.verdict === "cleared" && value.after.length !== 0) {
    throw new Error(`Uninstall ${value.surface} claims cleared with retained observations`);
  }
  if (value.verdict === "retained" && value.after.length === 0) {
    throw new Error(`Uninstall ${value.surface} claims retained without a retained observation`);
  }
  if (value.verdict === "unobservable") {
    const failedProbeEntry = [...value.before, ...value.after].some(
      (entry) =>
        entry.includes(":failed:") ||
        entry.includes(":invalid:") ||
        entry.includes("state=invalid"),
    );
    if (value.surface === "v8-code-cache" && failedProbeEntry) {
      throw new Error("Uninstall V8 trace probe failure cannot be downgraded to unobservable");
    }
    if (
      value.probe.reason === null ||
      value.probe.reason.trim() === "" ||
      value.probe.reason.length > 500
    ) {
      throw new Error(`Uninstall ${value.surface} unobservable probe requires a bounded reason`);
    }
    if (failedProbeEntry && !value.probe.reason.startsWith("Probe failed:")) {
      throw new Error(`Uninstall ${value.surface} failed probe is mislabeled`);
    }
  } else if (value.probe.reason !== null) {
    throw new Error(`Uninstall ${value.surface} observable verdict contradicts its probe reason`);
  }
  if (REQUIRED_CLEARED.has(value.surface) && value.verdict !== "cleared") {
    throw new Error(`Uninstall ${value.surface} is required to be cleared`);
  }
}

function validateAuthority(value: UninstallMechanismObservation["authority"]): void {
  requireExactKeys(
    value,
    ["artifactDigest", "browser", "environment", "origin", "releaseDigest", "source", "target"],
    "Uninstall authority",
  );
  requireExactKeys(
    value.browser,
    ["executableSha256", "product", "revision"],
    "Uninstall browser authority",
  );
  requireExactKeys(
    value.environment,
    ["gateState", "machineId", "tier"],
    "Uninstall environment authority",
  );
  requireExactKeys(value.source, ["commit", "dirtyTreeDigest"], "Uninstall source authority");
  if (
    !isSha(value.artifactDigest) ||
    !isSha(value.releaseDigest) ||
    !isSha(value.browser.executableSha256) ||
    value.browser.product === "" ||
    value.browser.revision === "" ||
    value.environment.gateState !== "measured" ||
    value.environment.machineId === "" ||
    value.environment.tier !== "showcase" ||
    !/^https?:\/\//u.test(value.origin) ||
    !/^[a-f0-9]{40}$/u.test(value.source.commit) ||
    (value.source.dirtyTreeDigest !== null && !isSha(value.source.dirtyTreeDigest))
  ) {
    throw new Error("Uninstall authority identity is invalid");
  }
  if (typeof value.target !== "object" || value.target === null) {
    throw new Error("Uninstall target authority is invalid");
  }
}

function freezeSurface(value: UninstallRawSurfaceObservation): UninstallRawSurfaceObservation {
  return Object.freeze({
    ...value,
    after: Object.freeze([...value.after]),
    before: Object.freeze([...value.before]),
    probe: Object.freeze({ ...value.probe }),
  });
}

function requireExactKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`${label} has invalid fields`);
  }
}

function isSha(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}
