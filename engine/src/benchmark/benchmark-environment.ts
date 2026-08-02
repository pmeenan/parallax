import { BUILD_MANIFEST_SCHEMA_VERSION } from "../build/build-manifest-contract";
import {
  OFFLINE_SHELL_GENERATION_SCHEMA_VERSION,
  OFFLINE_SHELL_SAVE_SCHEMA_VERSION,
} from "../offline-shell/shell-generation-contract";
import {
  INSTALL_MANIFEST_PATH,
  INSTALL_MANIFEST_SCHEMA_VERSION,
  parseInstallManifest,
} from "../storage/install-manifest";
import { scaleStreamingDependencyResourceId } from "../streaming/scale-streaming-resource-id";
import {
  canonicalStreamingDistrictIndexResourceId,
  parseStreamingCellArtifactSource,
} from "../streaming/streaming-cell-identity";
import { STREAMING_DISTRICT_INDEX_SCHEMA_VERSION } from "../streaming/streaming-protocol";
import {
  type BenchmarkBrowserIdentity,
  type BenchmarkCapability,
  type BenchmarkEnvironmentIdentity,
  type BenchmarkGpuAdapterIdentity,
  type BenchmarkMetric,
  type BenchmarkQualityPreset,
  type BenchmarkScreenIdentity,
  invalidMetric,
  measuredMetric,
  notApplicableMetric,
  unsupportedMetric,
} from "./benchmark-contract";

interface NavigatorUserAgentData {
  readonly brands: readonly Readonly<{ readonly brand: string; readonly version: string }>[];
  getHighEntropyValues(hints: readonly string[]): Promise<
    Readonly<{
      readonly architecture?: string;
      readonly bitness?: string;
      readonly fullVersionList?: readonly Readonly<{
        readonly brand: string;
        readonly version: string;
      }>[];
      readonly mobile?: boolean;
      readonly model?: string;
      readonly platform?: string;
      readonly platformVersion?: string;
      readonly wow64?: boolean;
    }>
  >;
  readonly mobile: boolean;
  readonly platform: string;
}

type NavigatorWithBenchmarkSurfaces = Navigator & {
  readonly deviceMemory?: number;
  readonly userAgentData?: NavigatorUserAgentData;
};

// Independent page-consumer pin. Harness regression coverage binds this to the
// producer-side build-manifest contract so either side drifting fails review.
export const BENCHMARK_BUILD_MANIFEST_SCHEMA_VERSION = BUILD_MANIFEST_SCHEMA_VERSION;

export interface BenchmarkLongTaskMonitor {
  finish(): BenchmarkMetric<number>;
}

export interface BenchmarkPlatform {
  captureEnvironment(preset: BenchmarkQualityPreset): Promise<BenchmarkEnvironmentIdentity>;
  createLongTaskMonitor(): BenchmarkLongTaskMonitor;
  generatedAt(): string;
}

export function createBrowserBenchmarkPlatform(): BenchmarkPlatform {
  return Object.freeze({
    captureEnvironment: captureBrowserBenchmarkEnvironment,
    createLongTaskMonitor: createBrowserLongTaskMonitor,
    generatedAt: () => new Date().toISOString(),
  });
}

export async function captureBrowserBenchmarkEnvironment(
  _preset: BenchmarkQualityPreset,
): Promise<BenchmarkEnvironmentIdentity> {
  const benchmarkNavigator = navigator as NavigatorWithBenchmarkSurfaces;
  const [browser, buildIdentity, gpuAdapter] = await Promise.all([
    readBrowserIdentity(benchmarkNavigator),
    readBuildIdentity(),
    readGpuAdapter(benchmarkNavigator),
  ]);
  return Object.freeze({
    artifactDigest: buildIdentity.artifactDigest,
    browser,
    capabilities: readCapabilities(benchmarkNavigator),
    gpuAdapter,
    hardwareConcurrency: navigator.hardwareConcurrency,
    hostIdentity: unsupportedMetric<never>(
      "Page APIs do not expose registered-machine identity, host OS build, complete GPU driver identity, or physical-console attestation",
    ),
    powerAndSessionState: unsupportedMetric<never>(
      "Page APIs do not attest OS power scheme, remote-session state, display wake state, or display-adapter routing",
    ),
    referenceEligibility:
      browser.name === "Google Chrome"
        ? unsupportedMetric<true>(
            "Chrome reference eligibility requires registered host, power, driver, and physical-console evidence unavailable to the in-game page",
          )
        : notApplicableMetric<true>(
            "Only Chrome on a registered reference machine can carry budgets",
          ),
    releaseDigest: buildIdentity.releaseDigest,
    screen: readScreenIdentity(),
  });
}

export function createBrowserLongTaskMonitor(): BenchmarkLongTaskMonitor {
  if (!PerformanceObserver.supportedEntryTypes.includes("longtask")) {
    return Object.freeze({
      finish: () =>
        unsupportedMetric<number>(
          "This browser does not expose the Window-scoped Long Tasks performance entry",
        ),
    });
  }
  let count = 0;
  let finished = false;
  const observer = new PerformanceObserver((list) => {
    count += list.getEntries().filter((entry) => entry.duration > 50).length;
  });
  observer.observe({ type: "longtask" } as PerformanceObserverInit);
  return Object.freeze({
    finish(): BenchmarkMetric<number> {
      if (finished) return invalidMetric("Long-task measurement was finished more than once");
      finished = true;
      count += observer.takeRecords().filter((entry) => entry.duration > 50).length;
      observer.disconnect();
      return measuredMetric(count);
    },
  });
}

async function readBrowserIdentity(
  benchmarkNavigator: NavigatorWithBenchmarkSurfaces,
): Promise<BenchmarkBrowserIdentity> {
  const uaData = benchmarkNavigator.userAgentData;
  if (uaData !== undefined) {
    try {
      const highEntropy = await uaData.getHighEntropyValues([
        "architecture",
        "bitness",
        "fullVersionList",
        "model",
        "platformVersion",
        "wow64",
      ]);
      const fullVersionList = Object.freeze(
        (highEntropy.fullVersionList ?? uaData.brands).map((item) =>
          Object.freeze({ brand: item.brand, version: item.version }),
        ),
      );
      const selected = selectBrowserBrand(fullVersionList);
      return Object.freeze({
        engine: chromiumBrand(fullVersionList) ? "Chromium" : "unknown",
        fullVersionList,
        mobile: highEntropy.mobile ?? uaData.mobile,
        name: selected?.brand ?? "unknown",
        platform: highEntropy.platform ?? uaData.platform,
        platformVersion: highEntropy.platformVersion ?? null,
        userAgent: benchmarkNavigator.userAgent,
        version: selected?.version ?? null,
      });
    } catch {
      // UA-CH is an identity enhancement. Preserve the ordinary user agent below
      // when policy or browser implementation rejects high-entropy values.
    }
  }
  const parsed = parseReducedUserAgent(benchmarkNavigator.userAgent);
  return Object.freeze({
    engine: parsed.engine,
    fullVersionList: Object.freeze([]),
    mobile: null,
    name: parsed.name,
    platform: benchmarkNavigator.platform || null,
    platformVersion: null,
    userAgent: benchmarkNavigator.userAgent,
    version: parsed.version,
  });
}

function selectBrowserBrand(
  brands: readonly Readonly<{ readonly brand: string; readonly version: string }>[],
): Readonly<{ readonly brand: string; readonly version: string }> | undefined {
  return (
    brands.find((brand) => brand.brand === "Google Chrome") ??
    brands.find((brand) => brand.brand === "Microsoft Edge") ??
    brands.find((brand) => brand.brand === "Chromium") ??
    brands.find((brand) => !/not.?a.?brand/i.test(brand.brand))
  );
}

function chromiumBrand(
  brands: readonly Readonly<{ readonly brand: string; readonly version: string }>[],
): boolean {
  return brands.some((brand) => brand.brand === "Chromium");
}

function parseReducedUserAgent(userAgent: string): Readonly<{
  readonly engine: string;
  readonly name: string;
  readonly version: string | null;
}> {
  const firefox = userAgent.match(/Firefox\/([0-9.]+)/);
  if (firefox !== null) {
    return Object.freeze({ engine: "Gecko", name: "Firefox", version: firefox[1] ?? null });
  }
  const edge = userAgent.match(/Edg\/([0-9.]+)/);
  if (edge !== null) {
    return Object.freeze({ engine: "Chromium", name: "Microsoft Edge", version: edge[1] ?? null });
  }
  const chrome = userAgent.match(/Chrome\/([0-9.]+)/);
  if (chrome !== null) {
    return Object.freeze({ engine: "Chromium", name: "Google Chrome", version: chrome[1] ?? null });
  }
  const safari = userAgent.match(/Version\/([0-9.]+).*Safari\//);
  if (safari !== null) {
    return Object.freeze({ engine: "WebKit", name: "Safari", version: safari[1] ?? null });
  }
  return Object.freeze({ engine: "unknown", name: "unknown", version: null });
}

export async function readBuildIdentity(): Promise<
  Readonly<{ artifactDigest: BenchmarkMetric<string>; releaseDigest: BenchmarkMetric<string> }>
> {
  try {
    const response = await fetch(new URL("/build-manifest.json", location.href), {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Build manifest request returned HTTP ${response.status}`);
    }
    const buildBytes = await response.arrayBuffer();
    const parsed = JSON.parse(new TextDecoder().decode(buildBytes)) as unknown;
    if (
      !record(parsed) ||
      !hasExactKeys(parsed, [
        "artifacts",
        "gameContentEntrypoints",
        "installManifestEntrypoint",
        "offlineShell",
        "schemaVersion",
        "workerEntrypoints",
      ]) ||
      parsed.schemaVersion !== BENCHMARK_BUILD_MANIFEST_SCHEMA_VERSION ||
      !Array.isArray(parsed.artifacts) ||
      !Array.isArray(parsed.workerEntrypoints) ||
      !Array.isArray(parsed.gameContentEntrypoints) ||
      !record(parsed.installManifestEntrypoint) ||
      !hasExactKeys(parsed.installManifestEntrypoint, ["path", "schemaVersion"]) ||
      parsed.installManifestEntrypoint.path !== INSTALL_MANIFEST_PATH ||
      parsed.installManifestEntrypoint.schemaVersion !== INSTALL_MANIFEST_SCHEMA_VERSION ||
      !record(parsed.offlineShell) ||
      !hasExactKeys(parsed.offlineShell, [
        "generationSchemaVersion",
        "saveSchemaVersion",
        "serviceWorkerPath",
      ]) ||
      parsed.offlineShell.generationSchemaVersion !== OFFLINE_SHELL_GENERATION_SCHEMA_VERSION ||
      parsed.offlineShell.saveSchemaVersion !== OFFLINE_SHELL_SAVE_SCHEMA_VERSION ||
      parsed.offlineShell.serviceWorkerPath !== "service-worker.js"
    ) {
      throw new Error(
        `Build manifest does not satisfy schema v${BENCHMARK_BUILD_MANIFEST_SCHEMA_VERSION} identity fields`,
      );
    }
    const workerEntrypoints = parsed.workerEntrypoints;
    const gameContentEntrypoints = parsed.gameContentEntrypoints;
    const artifacts = parseBuildArtifacts(parsed.artifacts);
    validateBuildEntrypoints(workerEntrypoints, gameContentEntrypoints, artifacts);
    const installArtifacts = artifacts.filter(
      (artifact) => artifact.path === INSTALL_MANIFEST_PATH,
    );
    const installArtifact = installArtifacts[0];
    if (installArtifacts.length !== 1 || installArtifact === undefined) {
      throw new Error("Build manifest does not bind the install-manifest artifact");
    }
    const installResponse = await fetch(new URL(`/${INSTALL_MANIFEST_PATH}`, location.href), {
      cache: "no-store",
    });
    if (!installResponse.ok) {
      throw new Error(`Install manifest request returned HTTP ${installResponse.status}`);
    }
    const installBytes = await installResponse.arrayBuffer();
    const installDigest = hex(await crypto.subtle.digest("SHA-256", installBytes));
    if (
      installBytes.byteLength !== installArtifact.bytes ||
      installDigest !== installArtifact.sha256
    ) {
      throw new Error("Install manifest bytes do not match the build manifest");
    }
    parseInstallManifest(
      JSON.parse(new TextDecoder().decode(installBytes)) as unknown,
      artifacts
        .filter((artifact) => artifact.path !== INSTALL_MANIFEST_PATH)
        .map((artifact) =>
          expectedInstallResource(artifact, workerEntrypoints, gameContentEntrypoints),
        ),
    );
    return Object.freeze({
      artifactDigest: measuredMetric(hex(await crypto.subtle.digest("SHA-256", buildBytes))),
      releaseDigest: measuredMetric(installDigest),
    });
  } catch (error: unknown) {
    const invalid = invalidMetric<string>(
      `Build artifact identity is unavailable: ${errorMessage(error)}`,
    );
    return Object.freeze({ artifactDigest: invalid, releaseDigest: invalid });
  }
}

export function expectedInstallResource(
  artifact: BenchmarkBuildArtifact,
  workers: readonly unknown[],
  districts: readonly unknown[],
): import("../storage/install-manifest").InstallResource {
  const base = { bytes: artifact.bytes, sha256: artifact.sha256, source: artifact.path };
  if (artifact.path === "index.html")
    return {
      ...base,
      id: "app-shell-document-index",
      kind: "document",
      scope: "app-shell",
      target: "shell",
    };
  if (artifact.path === "service-worker.js")
    return {
      ...base,
      id: "common-worker-service",
      kind: "worker",
      scope: "common",
      target: "shell",
    };
  for (const [pattern, id, scope] of [
    [/^immutable\/app-[a-f0-9]{64}\.js$/, "app-shell-module-app", "app-shell"],
    [/^immutable\/engine-[a-f0-9]{64}\.js$/, "common-module-engine", "common"],
    [/^immutable\/game-[a-f0-9]{64}\.js$/, "game-specific-module-game", "game-specific"],
  ] as const) {
    if (pattern.test(artifact.path)) return { ...base, id, kind: "module", scope, target: "shell" };
  }
  const worker = workers.find((candidate) => record(candidate) && candidate.path === artifact.path);
  if (record(worker))
    return {
      ...base,
      id: `common-worker-${String(worker.role)}`,
      kind: "worker",
      scope: "common",
      target: "shell",
    };
  const wasm = artifact.path.match(/^immutable\/([a-z0-9-]+)-[a-f0-9]{64}\.wasm$/);
  if (wasm?.[1] !== undefined)
    return {
      ...base,
      id: `common-wasm-${wasm[1]}`,
      kind: "wasm",
      scope: "common",
      target: "shell",
    };
  if (/^immutable\/pso-warmup-trace-[a-f0-9]{64}\.json$/.test(artifact.path))
    return {
      ...base,
      id: "game-specific-pso-warmup-trace",
      kind: "asset-pack",
      scope: "game-specific",
      target: "opfs",
    };
  if (/^immutable\/representative-streaming-ktx2-[a-f0-9]{64}\.ktx2$/.test(artifact.path))
    return {
      ...base,
      id: "game-specific-streaming-00-texture",
      kind: "asset-pack",
      scope: "game-specific",
      target: "opfs",
    };
  if (/^immutable\/representative-streaming-meshopt-[a-f0-9]{64}\.meshopt$/.test(artifact.path))
    return {
      ...base,
      id: "game-specific-streaming-01-mesh",
      kind: "asset-pack",
      scope: "game-specific",
      target: "opfs",
    };
  const productionStreaming = artifact.path.match(
    /^immutable\/streaming-(texture|vertices|indices)-[a-f0-9]{64}\.(ktx2|meshopt)$/,
  );
  if (productionStreaming !== null) {
    const role = productionStreaming[1];
    if (role !== "texture" && role !== "vertices" && role !== "indices") {
      throw new Error(`Streaming asset-pack role is invalid: ${artifact.path}`);
    }
    return {
      ...base,
      id: scaleStreamingDependencyResourceId(role, artifact.sha256),
      kind: "asset-pack",
      scope: "game-specific",
      target: "opfs",
    };
  }
  const district = districts.find(
    (candidate) => record(candidate) && candidate.path === artifact.path,
  );
  if (record(district))
    return {
      ...base,
      id: canonicalStreamingDistrictIndexResourceId(String(district.districtId)),
      kind: "district-index",
      scope: "game-specific",
      target: "opfs",
    };
  if (/^immutable\/[a-z0-9-]+-cell-/.test(artifact.path)) {
    const identity = parseStreamingCellArtifactSource(artifact.path);
    if (identity.sha256 !== artifact.sha256) {
      throw new Error(`Streaming cell filename hash does not match artifact: ${artifact.path}`);
    }
    return {
      ...base,
      id: identity.resourceId,
      kind: "world-cell",
      scope: "game-specific",
      target: "opfs",
    };
  }
  throw new Error(`Build artifact has no exact install classification: ${artifact.path}`);
}

interface BenchmarkBuildArtifact {
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}

function parseBuildArtifacts(input: readonly unknown[]): readonly BenchmarkBuildArtifact[] {
  const paths = new Set<string>();
  const hashes = new Set<string>();
  return input.map((candidate) => {
    if (
      !record(candidate) ||
      !hasExactKeys(candidate, ["bytes", "path", "sha256"]) ||
      !Number.isSafeInteger(candidate.bytes) ||
      (candidate.bytes as number) <= 0 ||
      typeof candidate.path !== "string" ||
      candidate.path === "" ||
      !/^[A-Za-z0-9._/-]+$/.test(candidate.path) ||
      candidate.path.startsWith("/") ||
      candidate.path.includes("\\") ||
      candidate.path
        .split("/")
        .some((segment) => segment === "" || segment === "." || segment === "..") ||
      typeof candidate.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(candidate.sha256) ||
      paths.has(candidate.path) ||
      hashes.has(candidate.sha256)
    ) {
      throw new Error("Build manifest contains an invalid or duplicate artifact");
    }
    paths.add(candidate.path);
    hashes.add(candidate.sha256);
    return Object.freeze({
      bytes: candidate.bytes as number,
      path: candidate.path,
      sha256: candidate.sha256,
    });
  });
}

function validateBuildEntrypoints(
  workers: readonly unknown[],
  districts: readonly unknown[],
  artifacts: readonly BenchmarkBuildArtifact[],
): void {
  const artifactPaths = new Set(artifacts.map((artifact) => artifact.path));
  const roles = new Set<string>();
  const workerPaths = new Set<string>();
  for (const worker of workers) {
    if (
      !record(worker) ||
      !hasExactKeys(worker, ["path", "role", "targetType"]) ||
      typeof worker.path !== "string" ||
      typeof worker.role !== "string" ||
      !["decode", "installer", "render", "streaming", "wasm-thread"].includes(worker.role) ||
      worker.targetType !== "worker" ||
      !artifactPaths.has(worker.path) ||
      roles.has(worker.role) ||
      workerPaths.has(worker.path)
    ) {
      throw new Error("Build manifest contains an invalid worker entrypoint");
    }
    roles.add(worker.role);
    workerPaths.add(worker.path);
  }
  if (workers.length !== 5 || roles.size !== 5) {
    throw new Error("Build manifest does not contain the exact five worker roles");
  }
  if (districts.length === 0) throw new Error("Build manifest contains no district entrypoint");
  const districtIds = new Set<string>();
  const districtPaths = new Set<string>();
  for (const district of districts) {
    if (
      !record(district) ||
      !hasExactKeys(district, ["districtId", "path", "schemaVersion", "scope", "targetType"]) ||
      typeof district.districtId !== "string" ||
      district.districtId === "" ||
      typeof district.path !== "string" ||
      district.schemaVersion !== STREAMING_DISTRICT_INDEX_SCHEMA_VERSION ||
      district.scope !== "game-specific" ||
      district.targetType !== "district" ||
      !artifactPaths.has(district.path) ||
      districtIds.has(district.districtId) ||
      districtPaths.has(district.path)
    ) {
      throw new Error("Build manifest contains an invalid district entrypoint");
    }
    districtIds.add(district.districtId);
    districtPaths.add(district.path);
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

async function readGpuAdapter(
  benchmarkNavigator: NavigatorWithBenchmarkSurfaces,
): Promise<BenchmarkMetric<BenchmarkGpuAdapterIdentity>> {
  if (benchmarkNavigator.gpu === undefined) {
    return unsupportedMetric("WebGPU is unavailable");
  }
  try {
    const adapter = await benchmarkNavigator.gpu.requestAdapter();
    if (adapter === null) return invalidMetric("WebGPU did not return an adapter");
    return measuredMetric(
      Object.freeze({
        architecture: adapter.info.architecture,
        description: adapter.info.description,
        device: adapter.info.device,
        isFallbackAdapter: adapter.info.isFallbackAdapter,
        source: "window-request-adapter" as const,
        vendor: adapter.info.vendor,
      }),
    );
  } catch (error: unknown) {
    return invalidMetric(`WebGPU adapter identity failed: ${errorMessage(error)}`);
  }
}

function readScreenIdentity(): BenchmarkScreenIdentity {
  const devicePixelRatio = window.devicePixelRatio;
  return Object.freeze({
    availableCssPixels: Object.freeze({ height: screen.availHeight, width: screen.availWidth }),
    colorDepth: screen.colorDepth,
    cssPixels: Object.freeze({ height: screen.height, width: screen.width }),
    devicePixelRatio,
    orientation: Object.freeze({
      angle: screen.orientation?.angle ?? 0,
      type: screen.orientation?.type ?? "unknown",
    }),
    physicalPixelEstimate: Object.freeze({
      height: Math.round(screen.height * devicePixelRatio),
      width: Math.round(screen.width * devicePixelRatio),
    }),
    viewportCssPixels: Object.freeze({ height: innerHeight, width: innerWidth }),
  });
}

function readCapabilities(
  benchmarkNavigator: NavigatorWithBenchmarkSurfaces,
): readonly BenchmarkCapability[] {
  const sharedMemory = supportsSharedWasmMemory();
  return Object.freeze([
    capability("cross-origin-isolated", crossOriginIsolated),
    capability("offscreen-canvas", typeof OffscreenCanvas === "function"),
    capability("opfs", typeof benchmarkNavigator.storage?.getDirectory === "function"),
    capability("shared-array-buffer", typeof SharedArrayBuffer === "function"),
    capability("wasm-simd", supportsWasmSimd()),
    capability("wasm-threads", sharedMemory),
    capability("webgpu", benchmarkNavigator.gpu !== undefined),
    capability("window-long-tasks", PerformanceObserver.supportedEntryTypes.includes("longtask")),
  ]);
}

function capability(id: BenchmarkCapability["id"], available: boolean): BenchmarkCapability {
  return Object.freeze({ id, state: available ? "available" : "unavailable" });
}

function supportsSharedWasmMemory(): boolean {
  try {
    return (
      typeof SharedArrayBuffer === "function" &&
      new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof
        SharedArrayBuffer
    );
  } catch {
    return false;
  }
}

export function supportsWasmSimd(): boolean {
  return WebAssembly.validate(
    new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 9, 1, 7, 0, 65, 0, 253, 15,
      26, 11,
    ]),
  );
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}
