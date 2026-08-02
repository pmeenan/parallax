import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAndValidateBuildManifest } from "./build-manifest.js";
import {
  launchPersistentChrome,
  loadChromePin,
  resolveChromeExecutablePath,
  validateChromeExecutable,
} from "./chrome-pin.js";
import {
  type CleanupOperation,
  finalizeCleanup,
  RETRYING_RECURSIVE_REMOVE_OPTIONS,
} from "./cleanup.js";
import { sanitizeEvidenceText } from "./evidence-redaction.js";
import {
  launchAfterPhysicalConsoleDisplayWake,
  withClosedBrowserContext,
} from "./physical-console-preflight.js";
import { type ResultPairReservation, reserveResultPair } from "./result-pair.js";
import { createLocalServer, listenLocalServer, stopLocalServer } from "./server.js";
import { readSourceIdentity } from "./source-identity.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = join(repositoryRoot, "dist");
const resultRoot = join(repositoryRoot, "harness/results/opfs-release-store-adapter");

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const reservation = await reserveResultPair(
    resultRoot,
    startedAt,
    { schemaVersion: 2, startedAt, state: "pending" },
    {},
    "adapter",
    "OPFS release-store browser adapter",
  );
  let base: OpfsAdapterReportBase | null = null;
  let profile: string | null = null;
  let server: ReturnType<typeof createLocalServer> | null = null;
  let evidence: Awaited<ReturnType<typeof runAdapterQualification>> | null = null;
  let terminalFailure: unknown | null = null;
  try {
    const build = await readAndValidateBuildManifest(buildRoot);
    const source = await readSourceIdentity(repositoryRoot);
    const engine = build.installManifest.resources.find(
      (resource) => resource.id === "common-module-engine",
    );
    if (engine === undefined || engine.target !== "shell" || engine.source.startsWith("https://")) {
      throw new Error("Adapter qualification could not resolve the exact engine module");
    }
    const pin = await loadChromePin(join(repositoryRoot, "harness/chrome/stable.json"));
    const executable = await resolveChromeExecutablePath(repositoryRoot, pin);
    const executableSha256 = await validateChromeExecutable(pin, executable);
    base = Object.freeze({
      artifactDigest: build.artifactDigest,
      browser: Object.freeze({ executableSha256, version: pin.version }),
      releaseDigest: build.releaseDigest,
      schemaVersion: 2 as const,
      source,
      startedAt,
    });
    await reservation.publishPendingJson({ ...base, state: "pending" });
    profile = await mkdtemp(join(tmpdir(), "parallax-opfs-release-store-"));
    const activeProfile = profile;
    server = createLocalServer({ root: buildRoot });
    const address = await listenLocalServer(server);
    const origin = `http://127.0.0.1:${address.port}`;
    evidence = await withClosedBrowserContext(
      () =>
        launchAfterPhysicalConsoleDisplayWake(() =>
          launchPersistentChrome(executable, activeProfile),
        ),
      async (context) => {
        const page = context.pages()[0] ?? (await context.newPage());
        await page.goto(`${origin}/__parallax/identity`, { waitUntil: "load" });
        return page.evaluate(runAdapterQualification, {
          engineUrl: `${origin}/${engine.source}`,
        });
      },
    );
    const finalBuild = await readAndValidateBuildManifest(buildRoot);
    const finalSource = await readSourceIdentity(repositoryRoot);
    if (
      finalBuild.artifactDigest !== build.artifactDigest ||
      finalBuild.releaseDigest !== build.releaseDigest ||
      finalSource.commit !== source.commit ||
      finalSource.dirtyTreeDigest !== source.dirtyTreeDigest
    ) {
      throw new Error("Artifact or source identity changed during adapter qualification");
    }
  } catch (error: unknown) {
    terminalFailure = error;
  }
  try {
    await finalizeCleanup(
      terminalFailure,
      createOpfsAdapterCleanupOperations({ profile, server }),
      "OPFS adapter cleanup failed",
    );
  } catch (error: unknown) {
    terminalFailure = error;
  }
  const report: OpfsAdapterReport = Object.freeze({
    artifactDigest: base?.artifactDigest ?? null,
    browser: base?.browser ?? null,
    completedAt: new Date().toISOString(),
    evidence: terminalFailure === null ? evidence : null,
    failure: terminalFailure === null ? null : sanitizeOpfsAdapterFailure(terminalFailure),
    releaseDigest: base?.releaseDigest ?? null,
    schemaVersion: 2,
    source: base?.source ?? null,
    startedAt,
    state: terminalFailure === null ? "passed" : "failed",
  });
  try {
    await publishOpfsAdapterReport(reservation, report);
  } catch (publicationError: unknown) {
    throw new AggregateError(
      terminalFailure === null ? [publicationError] : [terminalFailure, publicationError],
      "OPFS adapter terminal evidence publication failed",
    );
  }
  if (terminalFailure !== null) throw terminalFailure;
  process.stdout.write(
    `${reservation.jsonPath}\n${reservation.markdownPath}\n${JSON.stringify(report, null, 2)}\n`,
  );
}

interface OpfsAdapterReportBase {
  readonly artifactDigest: string;
  readonly browser: { readonly executableSha256: string; readonly version: string };
  readonly releaseDigest: string;
  readonly schemaVersion: 2;
  readonly source: { readonly commit: string; readonly dirtyTreeDigest: string | null };
  readonly startedAt: string;
}

export interface OpfsAdapterReport {
  readonly artifactDigest: string | null;
  readonly browser: OpfsAdapterReportBase["browser"] | null;
  readonly completedAt: string;
  readonly evidence: Awaited<ReturnType<typeof runAdapterQualification>> | null;
  readonly failure: string | null;
  readonly releaseDigest: string | null;
  readonly schemaVersion: 2;
  readonly source: OpfsAdapterReportBase["source"] | null;
  readonly startedAt: string;
  readonly state: "failed" | "passed";
}

export async function publishOpfsAdapterReport(
  reservation: ResultPairReservation,
  report: OpfsAdapterReport,
): Promise<void> {
  try {
    await reservation.publishPair(
      report as unknown as Readonly<Record<string, unknown>>,
      () => formatReport(report),
      report.state,
      { retainJsonPrimaryOnMarkdownFailure: true },
    );
  } catch (publicationError: unknown) {
    const failures: unknown[] = [publicationError];
    await closeOpfsAdapterReservationBoundedly(reservation).catch((closeError: unknown) => {
      failures.push(closeError);
    });
    throw new AggregateError(failures, "OPFS adapter terminal publication and close failed");
  }
}

export async function closeOpfsAdapterReservationBoundedly(
  reservation: ResultPairReservation,
  timeoutMs = 5_000,
): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("OPFS adapter reservation close timeout is invalid");
  }
  const controller = new AbortController();
  const handle = setTimeout(
    () => controller.abort(new Error("OPFS adapter reservation close timed out")),
    timeoutMs,
  );
  handle.unref?.();
  const failures: unknown[] = [];
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (reservation.handleState().jsonClosed && reservation.handleState().markdownClosed) break;
      await Promise.race([
        reservation.close(controller.signal),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
            once: true,
          });
        }),
      ]).catch((error: unknown) => failures.push(error));
      if (controller.signal.aborted) break;
    }
  } finally {
    clearTimeout(handle);
  }
  if (!reservation.handleState().jsonClosed || !reservation.handleState().markdownClosed) {
    failures.push(new Error("OPFS adapter reservation handles remain open"));
  }
  if (failures.length !== 0) {
    throw new AggregateError(failures, "OPFS adapter reservation close required retries");
  }
}

export function sanitizeOpfsAdapterFailure(error: unknown): string {
  return sanitizeEvidenceText(error, {
    fallback: "OPFS adapter qualification failed",
    maximumLength: 320,
  });
}

export function createOpfsAdapterCleanupOperations(resources: {
  readonly profile: string | null;
  readonly server: ReturnType<typeof createLocalServer> | null;
}): readonly CleanupOperation[] {
  const operations: CleanupOperation[] = [];
  if (resources.server !== null) {
    const server = resources.server;
    operations.push({ label: "server", run: () => stopLocalServer(server) });
  }
  if (resources.profile !== null) {
    const profile = resources.profile;
    operations.push({
      label: "profile",
      run: () => rm(profile, RETRYING_RECURSIVE_REMOVE_OPTIONS),
    });
  }
  return Object.freeze(operations);
}

function formatReport(report: OpfsAdapterReport): string {
  return [
    "# OPFS release-store browser adapter",
    "",
    `- State: \`${report.state}\``,
    `- Started: \`${report.startedAt}\``,
    `- Completed: \`${report.completedAt}\``,
    `- Chrome: \`${report.browser?.version ?? "unavailable"}\``,
    `- Chrome executable SHA-256: \`${report.browser?.executableSha256 ?? "unavailable"}\``,
    `- Artifact digest: \`${report.artifactDigest ?? "unavailable"}\``,
    `- Release digest: \`${report.releaseDigest ?? "unavailable"}\``,
    `- Source: \`${report.source === null ? "unavailable" : `${report.source.commit}/${report.source.dirtyTreeDigest ?? "clean"}`}\``,
    ...(report.failure === null ? [] : [`- Failure: ${report.failure}`]),
    "",
  ].join("\n");
}

async function runAdapterQualification(input: { readonly engineUrl: string }): Promise<{
  readonly blockedBeforeRelease: true;
  readonly firstFinalization: true;
  readonly lifecycle: true;
  readonly reopenReconciliation: true;
  readonly terminatedOwnerReleasedLock: true;
}> {
  const workerSource = `
    import {
      createBrowserInstallStorePlatform,
      createOpfsReleaseStore,
    } from ${JSON.stringify(input.engineUrl)};

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const digest = async (bytes) =>
      [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
    const manifest = async (id, source, bytes) => encoder.encode(JSON.stringify({
      gameId: "parallax",
      resources: [{
        bytes: bytes.byteLength,
        id,
        kind: "asset-pack",
        scope: "game-specific",
        sha256: await digest(bytes),
        source,
        target: "opfs",
      }],
      schemaVersion: 1,
    }) + "\\n");

    self.onmessage = async (event) => {
      const command = event.data;
      try {
        if (command.kind === "lifecycle") {
          const platform = createBrowserInstallStorePlatform();
          await platform.remove("parallax-install-v1", true);
          const store = createOpfsReleaseStore(platform);
          const bytes = encoder.encode("adapter-lifecycle");
          const manifestBytes = await manifest("adapter-asset", "adapter.bin", bytes);
          const staged = await store.stageRelease(manifestBytes);
          await store.appendPartial({
            bytes: bytes.slice(0, 7),
            expectedOffset: 0,
            releaseDigest: staged.releaseDigest,
            resourceId: "adapter-asset",
            strongEtag: '"adapter-lifecycle-v1"',
          });
          const resumed = await store.beginPartial(staged.releaseDigest, "adapter-asset");
          if (resumed.bytesCommitted !== 7) throw new Error("Checkpoint resume failed");
          await store.appendPartial({
            bytes: bytes.slice(7),
            expectedOffset: 7,
            releaseDigest: staged.releaseDigest,
            resourceId: "adapter-asset",
            strongEtag: '"adapter-lifecycle-v1"',
          });
          const reference = await store.finalizePartial(staged.releaseDigest, "adapter-asset");
          const verified = await store.verifyObject(reference);
          if (!verified.ok) throw new Error("Finalized object verification failed");
          await store.markReleaseReady(staged.releaseDigest);
          const published = await store.publishRelease(staged.releaseDigest);
          if (published.activeReleaseDigest !== staged.releaseDigest) {
            throw new Error("Release publication failed");
          }
          const reopened = createOpfsReleaseStore(createBrowserInstallStorePlatform());
          const reconciled = await reopened.reconcile();
          const reopenedReference = await reopened.getResource(
            staged.releaseDigest,
            "adapter-asset",
          );
          const reopenedIntegrity = await reopened.verifyObject(reopenedReference);
          if (
            reconciled.activeReleaseDigest !== staged.releaseDigest ||
            !reopenedIntegrity.ok
          ) {
            throw new Error("Reopen reconciliation failed");
          }
          self.postMessage({ kind: "lifecycle-complete" });
        } else if (command.kind === "hold-stage") {
          const base = createBrowserInstallStorePlatform();
          let release;
          const blocked = new Promise((resolve) => { release = resolve; });
          let entered = false;
          const platform = {
            ...base,
            async writeRecord(path, bytes) {
              if (!entered) {
                entered = true;
                self.postMessage({ kind: "store-lock-held" });
                await blocked;
              }
              return base.writeRecord(path, bytes);
            },
          };
          const bytes = encoder.encode(command.text);
          const store = createOpfsReleaseStore(platform);
          const manifestBytes = await manifest(command.id, command.source, bytes);
          self.addEventListener("message", (message) => {
            if (message.data.kind === "release") release();
          });
          await store.stageRelease(manifestBytes);
          self.postMessage({ kind: "stage-complete" });
        } else if (command.kind === "reconcile") {
          const base = createBrowserInstallStorePlatform();
          const platform = {
            ...base,
            runExclusive(operation) {
              const pending = base.runExclusive(operation);
              self.postMessage({ kind: "lock-requested" });
              return pending;
            },
          };
          const store = createOpfsReleaseStore(platform);
          await store.reconcile();
          self.postMessage({ kind: "reconcile-complete" });
        } else if (command.kind === "cleanup") {
          await createBrowserInstallStorePlatform().remove("parallax-install-v1", true);
          self.postMessage({ kind: "cleanup-complete" });
        }
      } catch (error) {
        self.postMessage({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
  `;
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  const workers = new Set<Worker>();
  const makeWorker = (): Worker => {
    const worker = new Worker(workerUrl, { type: "module" });
    workers.add(worker);
    return worker;
  };
  const next = <T extends { readonly kind: string }>(
    worker: Worker,
    expected: T["kind"],
    timeoutMs = 10_000,
  ): Promise<T> =>
    new Promise<T>((resolveMessage, rejectMessage) => {
      const timeout = setTimeout(
        () => rejectMessage(new Error(`Timed out waiting for worker ${expected}`)),
        timeoutMs,
      );
      worker.addEventListener(
        "message",
        (event: MessageEvent<T | { kind: "error"; message: string }>) => {
          clearTimeout(timeout);
          if (event.data.kind === "error" && "message" in event.data) {
            rejectMessage(new Error(event.data.message));
          } else if (event.data.kind === expected) {
            resolveMessage(event.data as T);
          } else {
            rejectMessage(new Error(`Expected ${expected}, received ${event.data.kind}`));
          }
        },
        { once: true },
      );
    });

  try {
    const lifecycle = makeWorker();
    const lifecycleComplete = next<{ kind: "lifecycle-complete" }>(
      lifecycle,
      "lifecycle-complete",
      30_000,
    );
    lifecycle.postMessage({ kind: "lifecycle" });
    await lifecycleComplete;
    lifecycle.terminate();

    const first = makeWorker();
    const second = makeWorker();
    const firstHeld = next<{ kind: "store-lock-held" }>(first, "store-lock-held");
    first.postMessage({
      id: "adapter-contention",
      kind: "hold-stage",
      source: "adapter-contention.bin",
      text: "contention",
    });
    await firstHeld;
    const secondRequested = next<{ kind: "lock-requested" }>(second, "lock-requested");
    second.postMessage({ kind: "reconcile" });
    await secondRequested;
    let secondCompleted = false;
    const secondCompletion = next<{ kind: "reconcile-complete" }>(
      second,
      "reconcile-complete",
    ).then((value) => {
      secondCompleted = true;
      return value;
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    if (secondCompleted) throw new Error("Second store bypassed the first store's Web Lock");
    const firstComplete = next<{ kind: "stage-complete" }>(first, "stage-complete");
    first.postMessage({ kind: "release" });
    await firstComplete;
    await secondCompletion;
    first.terminate();
    second.terminate();

    const owner = makeWorker();
    const waiter = makeWorker();
    const ownerHeld = next<{ kind: "store-lock-held" }>(owner, "store-lock-held");
    owner.postMessage({
      id: "adapter-owner-death",
      kind: "hold-stage",
      source: "adapter-owner-death.bin",
      text: "owner-death",
    });
    await ownerHeld;
    const waiterRequested = next<{ kind: "lock-requested" }>(waiter, "lock-requested");
    waiter.postMessage({ kind: "reconcile" });
    await waiterRequested;
    const waiterCompletion = next<{ kind: "reconcile-complete" }>(waiter, "reconcile-complete");
    owner.terminate();
    await waiterCompletion;
    waiter.terminate();

    const cleaner = makeWorker();
    const cleaned = next<{ kind: "cleanup-complete" }>(cleaner, "cleanup-complete");
    cleaner.postMessage({ kind: "cleanup" });
    await cleaned;
    cleaner.terminate();
    return {
      blockedBeforeRelease: true,
      firstFinalization: true,
      lifecycle: true,
      reopenReconciliation: true,
      terminatedOwnerReleasedLock: true,
    };
  } finally {
    for (const worker of workers) worker.terminate();
    URL.revokeObjectURL(workerUrl);
  }
}
