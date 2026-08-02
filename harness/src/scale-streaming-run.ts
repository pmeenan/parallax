import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { BrowserContext, Page } from "playwright-core";
import { readAndValidateBuildManifest } from "./build-manifest.js";
import {
  launchPersistentChrome,
  loadChromePin,
  resolveChromeExecutablePath,
  validateChromeExecutable,
} from "./chrome-pin.js";
import { launchAfterPhysicalConsoleDisplayWake } from "./physical-console-preflight.js";
import { inspectRegisteredEnvironment } from "./registered-environment.js";
import { type ResultPairReservation, reserveResultPair } from "./result-pair.js";
import {
  type GeneratedScaleStreamingCorpus,
  parseGeneratedScaleStreamingCorpus,
} from "./scale-streaming-corpus.js";
import {
  createScaleStreamingPersistedEvidence,
  SCALE_STREAMING_EVIDENCE_CONTRACT,
  SCALE_STREAMING_EVIDENCE_SCHEMA_VERSION,
  type ScaleStreamingCleanupOutcome,
  type ScaleStreamingFailure,
  type ScaleStreamingPhase,
  type ScaleStreamingTerminalReport,
  sanitizeScaleStreamingCause,
  validateScaleStreamingPendingReport,
  validateScaleStreamingTerminalReport,
} from "./scale-streaming-evidence.js";
import {
  createScaleStreamingPageOperations,
  type MaterializedScaleStreamingTarget,
  materializeScaleStreamingTarget,
  removeMaterializedScaleStreamingTarget,
  runScaleStreamingRunnerCore,
  type ScaleStreamingRunnerCoreResult,
} from "./scale-streaming-runner-core.js";
import { readSourceIdentity, type SourceIdentity } from "./source-identity.js";
import { startHarnessTarget } from "./target.js";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = join(repositoryRoot, "dist");
const resultRoot = join(repositoryRoot, "harness/results/scale-streaming");

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main(process.argv.slice(2));
}

export interface ScaleStreamingAttemptOperations<T> {
  readonly cleanup: readonly Readonly<{
    readonly operation: string;
    readonly run: () => Promise<void>;
  }>[];
  readonly postvalidate: (value: T) => Promise<void>;
  readonly prepareEnvironment: () => Promise<void>;
  readonly materialize: () => Promise<void>;
  readonly run: () => Promise<T>;
  readonly validate: () => Promise<void>;
}

export interface ScaleStreamingAttemptOutcome<T> {
  readonly cleanup: readonly ScaleStreamingCleanupOutcome[];
  readonly failure: ScaleStreamingFailure | null;
  readonly progress: Readonly<{
    readonly cleanup: true;
    readonly environment: boolean;
    readonly materialization: boolean;
    readonly postvalidation: boolean;
    readonly runtime: boolean;
    readonly validation: boolean;
  }>;
  readonly value: T | null;
}

export interface ScaleStreamingBrowserExecutableState {
  require(): string;
  set(path: string): void;
}

export function createScaleStreamingBrowserExecutableState(): ScaleStreamingBrowserExecutableState {
  let path: string | null = null;
  return Object.freeze({
    require: () => {
      if (path === null) throw new Error("Scale-streaming browser executable is unavailable");
      return path;
    },
    set: (candidate: string) => {
      if (candidate === "") throw new Error("Scale-streaming browser executable path is empty");
      if (path !== null) throw new Error("Scale-streaming browser executable was already resolved");
      path = candidate;
    },
  });
}

export async function orchestrateScaleStreamingAttempt<T>(
  operations: ScaleStreamingAttemptOperations<T>,
): Promise<ScaleStreamingAttemptOutcome<T>> {
  let phase: Exclude<ScaleStreamingPhase, "complete"> = "validation";
  let failure: ScaleStreamingFailure | null = null;
  let value: T | null = null;
  const progress = {
    cleanup: true as const,
    environment: false,
    materialization: false,
    postvalidation: false,
    runtime: false,
    validation: false,
  };
  try {
    await operations.validate();
    progress.validation = true;
    phase = "materialization";
    await operations.materialize();
    progress.materialization = true;
    phase = "environment";
    await operations.prepareEnvironment();
    progress.environment = true;
    phase = "runtime";
    value = await operations.run();
    progress.runtime = true;
    phase = "postvalidation";
    await operations.postvalidate(value);
    progress.postvalidation = true;
  } catch (error: unknown) {
    failure = Object.freeze({ message: sanitizeScaleStreamingCause(error), phase });
  }
  phase = "cleanup";
  const cleanup: ScaleStreamingCleanupOutcome[] = [];
  for (const operation of operations.cleanup) {
    try {
      await operation.run();
      cleanup.push(
        Object.freeze({ message: null, operation: operation.operation, state: "passed" }),
      );
    } catch (error: unknown) {
      cleanup.push(
        Object.freeze({
          message: sanitizeScaleStreamingCause(error),
          operation: operation.operation,
          state: "failed",
        }),
      );
    }
  }
  if (failure === null) {
    const cleanupFailure = cleanup.find(({ state }) => state === "failed");
    if (cleanupFailure !== undefined) {
      failure = Object.freeze({
        message: cleanupFailure.message ?? "Scale-streaming cleanup failed",
        phase,
      });
    }
  }
  return Object.freeze({
    cleanup: Object.freeze(cleanup),
    failure,
    progress: Object.freeze(progress),
    value,
  });
}

export async function publishScaleStreamingTerminalReport(
  reservation: ResultPairReservation,
  candidate: ScaleStreamingTerminalReport,
  authority: Parameters<typeof validateScaleStreamingTerminalReport>[1],
): Promise<ScaleStreamingTerminalReport> {
  let terminal: ScaleStreamingTerminalReport | null = null;
  let publicationFailure: unknown = null;
  try {
    try {
      terminal = validateScaleStreamingTerminalReport(candidate, authority);
    } catch (error: unknown) {
      // A terminal-validation failure means the candidate authority is not trustworthy.
      // Publish the smallest independently valid failure instead of attempting to retain
      // whichever rejected nested object caused validation to fail. The pending record
      // already preserves the attempt start; the sanitized cause preserves adjudication.
      const failureMessage = sanitizeScaleStreamingCause(error);
      const emergencyAuthority = {
        artifactDigest: null,
        browser: null,
        corpus: null,
        environment: null,
        releaseDigest: null,
        source: null,
        target: null,
      } as const;
      terminal = validateScaleStreamingTerminalReport(
        Object.freeze({
          ...candidate,
          browser: null,
          build: null,
          cleanup: Object.freeze([
            Object.freeze({
              message: failureMessage,
              operation: "terminal-validation",
              state: "failed" as const,
            }),
          ]),
          companion: { path: reservation.markdownPath, state: "requested" as const },
          corpus: null,
          environment: null,
          evidence: null,
          failure: { message: failureMessage, phase: "validation" as const },
          postvalidation: null,
          progress: {
            cleanup: true,
            environment: false,
            materialization: false,
            postvalidation: false,
            runtime: false,
            validation: false,
          },
          source: null,
          state: "failed" as const,
          target: null,
        }),
        emergencyAuthority,
      );
    }
    await reservation.publishPair(terminal, formatMarkdown(terminal), terminal.state, {
      retainJsonPrimaryOnMarkdownFailure: true,
    });
  } catch (error: unknown) {
    publicationFailure = error;
  } finally {
    await reservation.close().catch((closeFailure: unknown) => {
      publicationFailure =
        publicationFailure === null
          ? closeFailure
          : new AggregateError(
              [publicationFailure, closeFailure],
              "Result publication and close failed",
            );
    });
  }
  if (publicationFailure !== null) throw publicationFailure;
  if (terminal === null) throw new Error("Scale-streaming terminal report was not resolved");
  return terminal;
}

async function main(arguments_: readonly string[]): Promise<void> {
  if (arguments_.length !== 1 || arguments_[0] !== "--physical-console-confirmed") {
    throw new Error("Usage: scale-streaming-run --physical-console-confirmed");
  }
  const startedAt = new Date().toISOString();
  const pending = validateScaleStreamingPendingReport({
    contract: SCALE_STREAMING_EVIDENCE_CONTRACT,
    inputs: { machineId: "dev-01", tier: "showcase" },
    phase: "reservation",
    schemaVersion: SCALE_STREAMING_EVIDENCE_SCHEMA_VERSION,
    startedAt,
    state: "pending",
  });
  const reservation = await reserveResultPair(
    resultRoot,
    startedAt,
    pending,
    {},
    "scale-streaming",
    "Representative scale streaming qualification",
  );

  let source: SourceIdentity | null = null;
  let initialBuild: Awaited<ReturnType<typeof readAndValidateBuildManifest>> | null = null;
  let corpus: GeneratedScaleStreamingCorpus | null = null;
  let corpusRoot: string | null = null;
  let corpusDocumentPath: string | null = null;
  let materialized: MaterializedScaleStreamingTarget | null = null;
  let target: Awaited<ReturnType<typeof startHarnessTarget>> | null = null;
  let environment: Awaited<ReturnType<typeof inspectRegisteredEnvironment>> | null = null;
  let browser: ScaleStreamingTerminalReport["browser"] = null;
  let environmentProfile: string | null = null;
  let runtimeProfile: string | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let postvalidation: ScaleStreamingTerminalReport["postvalidation"] = null;
  const browserExecutable = createScaleStreamingBrowserExecutableState();

  const outcome = await orchestrateScaleStreamingAttempt<ScaleStreamingRunnerCoreResult>({
    cleanup: [
      {
        operation: "browser-close",
        run: async () => {
          await context?.close();
          context = null;
          page = null;
        },
      },
      {
        operation: "target-stop",
        run: async () => target?.stop(),
      },
      {
        operation: "runtime-profile-remove",
        run: async () => {
          if (runtimeProfile !== null) await rm(runtimeProfile, { force: true, recursive: true });
        },
      },
      {
        operation: "environment-profile-remove",
        run: async () => {
          if (environmentProfile !== null)
            await rm(environmentProfile, { force: true, recursive: true });
        },
      },
      {
        operation: "materialized-target-remove",
        run: async () => {
          if (materialized !== null)
            await removeMaterializedScaleStreamingTarget(materialized.root);
        },
      },
      {
        operation: "generated-corpus-remove",
        run: async () => {
          if (corpusRoot !== null) await rm(corpusRoot, { force: true, recursive: true });
        },
      },
    ],
    materialize: async () => {
      if (corpus === null || corpusRoot === null) {
        throw new Error("Scale-streaming corpus validation did not complete");
      }
      materialized = await materializeScaleStreamingTarget({
        corpusDocument: corpus,
        corpusRoot,
        productionRoot: buildRoot,
      });
      target = await startHarnessTarget({
        artifactDigest: materialized.artifactDigest,
        buildManifest: materialized.buildManifest,
        buildRoot: materialized.root,
        exactRangeResources: materialized.exactRangeResources,
        installOnlyFiles: materialized.installOnlyFiles,
        localHostname: "localhost",
        request: "local",
      });
    },
    postvalidate: async () => {
      if (initialBuild === null || source === null || materialized === null || target === null) {
        throw new Error("Scale-streaming postvalidation authority is incomplete");
      }
      const [buildAfter, sourceAfter, targetAfter] = await Promise.all([
        readAndValidateBuildManifest(buildRoot),
        readSourceIdentity(repositoryRoot),
        target.revalidate(),
      ]);
      if (
        buildAfter.artifactDigest !== initialBuild.artifactDigest ||
        buildAfter.releaseDigest !== initialBuild.releaseDigest ||
        JSON.stringify(sourceAfter) !== JSON.stringify(source) ||
        targetAfter.artifactDigest !== materialized.artifactDigest ||
        targetAfter.releaseDigest !== materialized.releaseDigest
      ) {
        throw new Error("Scale-streaming source/build/target postvalidation drifted");
      }
      postvalidation = Object.freeze({
        build: {
          artifactDigest: buildAfter.artifactDigest,
          releaseDigest: buildAfter.releaseDigest,
        },
        source: sourceAfter,
        target: {
          artifactDigest: targetAfter.artifactDigest,
          releaseDigest: targetAfter.releaseDigest,
        },
      });
    },
    prepareEnvironment: async () => {
      if (target === null) throw new Error("Scale-streaming target is unavailable");
      const pin = await loadChromePin(join(repositoryRoot, "harness/chrome/stable.json"));
      const browserExecutablePath = await resolveChromeExecutablePath(repositoryRoot, pin);
      browserExecutable.set(browserExecutablePath);
      const executableSha256 = await validateChromeExecutable(pin, browserExecutablePath);
      browser = Object.freeze({
        executableSha256,
        revision: pin.browserRevision,
        version: pin.version,
      });
      environmentProfile = await mkdtemp(join(tmpdir(), "parallax-scale-streaming-environment-"));
      environment = await inspectRegisteredEnvironment({
        chromePin: pin,
        executablePath: browserExecutablePath,
        machineId: "dev-01",
        machineRoot: join(repositoryRoot, "harness/machines"),
        probeUrl: target.probeUrl,
        profilePath: environmentProfile,
        target: target.identity,
        tier: "showcase",
      });
      if (environment.gateIdentity.state !== "measured" || !environment.sandboxVerified) {
        throw new Error("Scale-streaming registered environment is not measured and sandboxed");
      }
    },
    run: async () => {
      if (materialized === null || target === null || browser === null) {
        throw new Error("Scale-streaming runtime authority is incomplete");
      }
      const browserExecutablePath = browserExecutable.require();
      const freshRuntimeProfile = await mkdtemp(
        join(tmpdir(), "parallax-scale-streaming-profile-"),
      );
      runtimeProfile = freshRuntimeProfile;
      const pageOperations = createScaleStreamingPageOperations(target.baseUrl);
      return runScaleStreamingRunnerCore({
        operations: {
          closeProfile: async () => {
            await context?.close();
            context = null;
            page = null;
          },
          createFreshIsolatedProfile: async () => {
            context = await launchAfterPhysicalConsoleDisplayWake(() =>
              launchPersistentChrome(browserExecutablePath, freshRuntimeProfile, [
                "--enable-webgpu-developer-features",
              ]),
            );
            page = context.pages()[0] ?? (await context.newPage());
            return page;
          },
          install: pageOperations.install,
          launch: pageOperations.launch,
          navigateOrdinary: pageOperations.navigateOrdinary,
          readInstall: pageOperations.readInstall,
          readRuntime: pageOperations.readRuntime,
          readTraversal: pageOperations.readTraversal,
          startStandardTraversal: pageOperations.startStandardTraversal,
        },
        target: materialized,
      });
    },
    validate: async () => {
      const nodePath = await validatePinnedToolRegistry();
      initialBuild = await readAndValidateBuildManifest(buildRoot);
      source = await readSourceIdentity(repositoryRoot);
      corpusRoot = await mkdtemp(join(tmpdir(), "parallax-scale-streaming-corpus-"));
      await execFile(
        nodePath,
        [
          join(repositoryRoot, "harness/scripts/generate-scale-streaming-corpus.mjs"),
          "--output",
          corpusRoot,
        ],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      corpusDocumentPath = join(corpusRoot, "scale-streaming-corpus.json");
      const generatedDocument = await readFile(corpusDocumentPath, "utf8");
      corpus = parseGeneratedScaleStreamingCorpus(JSON.parse(generatedDocument) as unknown);
    },
  });

  const retainedMaterialized = materialized as MaterializedScaleStreamingTarget | null;
  const retainedBuild = initialBuild as Awaited<
    ReturnType<typeof readAndValidateBuildManifest>
  > | null;
  const targetEvidence =
    retainedMaterialized === null
      ? null
      : Object.freeze({
          artifactDigest: retainedMaterialized.artifactDigest,
          modelHardLinkBytes: retainedMaterialized.modelHardLinkBytes,
          modelHardLinkCount: retainedMaterialized.modelHardLinkCount,
          modeled: retainedMaterialized.modeled,
          population: retainedMaterialized.population,
          releaseDigest: retainedMaterialized.releaseDigest,
        });
  const baseReport = Object.freeze({
    browser,
    build:
      retainedBuild === null
        ? null
        : {
            artifactDigest: retainedBuild.artifactDigest,
            releaseDigest: retainedBuild.releaseDigest,
          },
    cleanup: outcome.cleanup,
    completedAt: new Date().toISOString(),
    contract: SCALE_STREAMING_EVIDENCE_CONTRACT,
    corpus,
    environment,
    evidence: outcome.value === null ? null : createScaleStreamingPersistedEvidence(outcome.value),
    failure: outcome.failure,
    inputs: {
      corpusDocumentPath: corpusDocumentPath ?? "unavailable",
      corpusRoot: corpusRoot ?? "unavailable",
      machineId: "dev-01" as const,
      tier: "showcase" as const,
    },
    phase: "complete" as const,
    postvalidation,
    progress: outcome.progress,
    schemaVersion: SCALE_STREAMING_EVIDENCE_SCHEMA_VERSION,
    source,
    startedAt,
    state: outcome.failure === null ? ("passed" as const) : ("failed" as const),
    target: targetEvidence,
  });
  const terminal = Object.freeze({
    ...baseReport,
    companion: { path: reservation.markdownPath, state: "requested" as const },
  });
  const retainedBrowser = browser as NonNullable<ScaleStreamingTerminalReport["browser"]> | null;
  const retainedCorpus = corpus as GeneratedScaleStreamingCorpus | null;
  const retainedEnvironment = environment as Awaited<
    ReturnType<typeof inspectRegisteredEnvironment>
  > | null;
  const retainedSource = source as SourceIdentity | null;
  const validationAuthority = {
    artifactDigest: retainedBuild?.artifactDigest ?? null,
    browser: retainedBrowser,
    corpus: retainedCorpus,
    environment: retainedEnvironment,
    releaseDigest: retainedBuild?.releaseDigest ?? null,
    source: retainedSource,
    target: retainedMaterialized,
  };
  const publishedTerminal = await publishScaleStreamingTerminalReport(
    reservation,
    terminal,
    validationAuthority,
  );
  process.stdout.write(`${reservation.jsonPath}\n${reservation.markdownPath}\n`);
  if (publishedTerminal.state !== "passed") process.exitCode = 1;
}

async function validatePinnedToolRegistry(): Promise<string> {
  const registry = JSON.parse(
    await readFile(join(repositoryRoot, ".parallax-toolchain.local.json"), "utf8"),
  ) as { tools?: readonly { id?: unknown; path?: unknown; version?: unknown }[] };
  const node = registry.tools?.find(({ id }) => id === "node");
  if (node?.version !== "24.18.1" || typeof node.path !== "string") {
    throw new Error("Pinned Node 24.18.1 is absent from the machine-local tool registry");
  }
  return validateScaleStreamingPinnedNode({
    currentPath: process.execPath,
    currentVersion: process.version,
    platform: process.platform,
    registeredPath: node.path,
    registeredVersion: node.version,
  });
}

export function validateScaleStreamingPinnedNode(
  input: Readonly<{
    currentPath: string;
    currentVersion: string;
    platform: NodeJS.Platform;
    registeredPath: string;
    registeredVersion: string;
  }>,
): string {
  if (input.currentVersion !== `v${input.registeredVersion}`) {
    throw new Error("Scale-streaming CLI Node version contradicts the registered pin");
  }
  const currentPath = resolve(input.currentPath);
  const registeredPath = resolve(input.registeredPath);
  const samePath =
    input.platform === "win32"
      ? currentPath.toLowerCase() === registeredPath.toLowerCase()
      : currentPath === registeredPath;
  if (!samePath) {
    throw new Error("Scale-streaming CLI is not running under the registered pinned Node");
  }
  return input.registeredPath;
}

function formatMarkdown(report: ScaleStreamingTerminalReport): string {
  return [
    "# Representative scale-streaming qualification",
    "",
    `- State: \`${report.state}\``,
    `- Artifact: \`${report.build?.artifactDigest ?? "unavailable"}\``,
    `- Release: \`${report.build?.releaseDigest ?? "unavailable"}\``,
    `- Modeled bytes: ${report.target?.modeled.exactModeledBytes ?? 0}`,
    `- Materialized install bytes: ${report.target?.population.installBytes ?? 0}`,
    `- Cell-load p95: ${report.evidence?.traversal.p95Ms ?? "unavailable"} ms`,
    `- Failure: ${report.failure?.message ?? "none"}`,
    "",
  ].join("\n");
}
