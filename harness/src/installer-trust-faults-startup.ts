export const INSTALLER_TRUST_STARTUP_TIMEOUT_MS = 30_000;

export interface InstallerTrustStartupScheduledDeadline {
  readonly cancel: () => void;
}

export type InstallerTrustStartupDeadlineScheduler = (
  milliseconds: number,
  expire: () => void,
) => InstallerTrustStartupScheduledDeadline;

export class InstallerTrustStartupTimeoutError extends Error {
  public readonly stage: "delay" | "observe";
  public readonly timeoutMs: number;
  public readonly uiState: string;

  public constructor(stage: "delay" | "observe", timeoutMs: number, uiState: string) {
    super(
      `Installer startup admission ${stage} timed out at the ${timeoutMs} ms absolute deadline in ${uiState} state`,
    );
    this.name = "InstallerTrustStartupTimeoutError";
    this.stage = stage;
    this.timeoutMs = timeoutMs;
    this.uiState = uiState;
  }
}

export interface InstallerTrustStartupExpectedAuthority {
  readonly allowedUiState: "idle" | "ready";
  readonly artifactDigest: string;
  readonly controllerScriptUrl: string;
  readonly generationId: string;
  readonly releaseDigest: string;
}

export interface InstallerTrustStartupObservation {
  readonly controls: Readonly<{
    readonly launchDisabled: boolean;
    readonly repairDisabled: boolean;
    readonly startDisabled: boolean;
  }> | null;
  readonly controller: Readonly<{
    readonly scriptUrl: string;
    readonly state: string;
  }> | null;
  readonly diagnosticsAvailable: boolean;
  readonly installStore: Readonly<{
    readonly activeReleaseDigest: string | null;
    readonly failureMessage: string | null;
    readonly state: string;
  }> | null;
  readonly installerTransfer: Readonly<{
    readonly activeReleaseDigest: string | null;
    readonly failureCode: string | null;
    readonly failureMessage: string | null;
    readonly state: string;
  }> | null;
  readonly installerWorkerObserved: boolean;
  readonly offlineShell: Readonly<{
    readonly activeArtifactDigest: string | null;
    readonly activeGenerationId: string | null;
    readonly activeReleaseDigest: string | null;
    readonly failureCode: string | null;
    readonly failureMessage: string | null;
    readonly state: string;
  }> | null;
  readonly panel: Readonly<{
    readonly failureCode: string | null;
    readonly releaseDigest: string | null;
    readonly shellGenerationId: string | null;
    readonly state: string | null;
    readonly storeState: string | null;
    readonly transferState: string | null;
  }> | null;
  readonly ui: Readonly<{
    readonly failure: unknown;
    readonly releaseDigest: string | null;
    readonly shellGenerationId: string | null;
    readonly state: string;
    readonly storeState: string;
    readonly transferState: string;
  }> | null;
}

export type InstallerTrustStartupClassification = "ready" | "waiting";

export function classifyInstallerTrustStartupObservation(
  observation: InstallerTrustStartupObservation,
  expected: InstallerTrustStartupExpectedAuthority,
): InstallerTrustStartupClassification {
  const panelFailed =
    observation.panel !== null &&
    (observation.panel.failureCode !== null || observation.panel.state === "failed");
  const uiFailed =
    observation.ui !== null &&
    (observation.ui.failure !== null || observation.ui.state === "failed");
  const storeFailed =
    observation.installStore !== null &&
    (observation.installStore.failureMessage !== null ||
      observation.installStore.state === "failed");
  const transferFailed =
    observation.installerTransfer !== null &&
    (observation.installerTransfer.failureCode !== null ||
      observation.installerTransfer.failureMessage !== null ||
      observation.installerTransfer.state === "failed");
  const shellFailed =
    observation.offlineShell !== null &&
    (observation.offlineShell.failureCode !== null ||
      observation.offlineShell.failureMessage !== null ||
      observation.offlineShell.state === "failed");
  if (panelFailed || uiFailed || storeFailed || transferFailed || shellFailed) {
    throw new Error("Installer startup admission observed a terminal failure");
  }
  if (
    observation.panel !== null &&
    observation.ui !== null &&
    (observation.panel.state !== observation.ui.state ||
      observation.panel.storeState !== observation.ui.storeState ||
      observation.panel.transferState !== observation.ui.transferState ||
      observation.panel.releaseDigest !== observation.ui.releaseDigest ||
      observation.panel.shellGenerationId !== observation.ui.shellGenerationId)
  ) {
    throw new Error("Installer startup panel and diagnostics authority contradict");
  }
  if (
    observation.ui !== null &&
    observation.installStore !== null &&
    observation.ui.storeState !== observation.installStore.state
  ) {
    throw new Error("Installer startup UI and store diagnostics authority contradict");
  }
  if (
    observation.ui !== null &&
    observation.installerTransfer !== null &&
    observation.ui.transferState !== observation.installerTransfer.state
  ) {
    throw new Error("Installer startup UI and transfer diagnostics authority contradict");
  }
  if (
    observation.offlineShell !== null &&
    ((observation.offlineShell.activeArtifactDigest !== null &&
      observation.offlineShell.activeArtifactDigest !== expected.artifactDigest) ||
      (observation.offlineShell.activeReleaseDigest !== null &&
        observation.offlineShell.activeReleaseDigest !== expected.releaseDigest) ||
      (observation.offlineShell.activeGenerationId !== null &&
        observation.offlineShell.activeGenerationId !== expected.generationId))
  ) {
    throw new Error("Installer startup shell authority mismatches the current manifest");
  }
  if (
    observation.controller !== null &&
    (observation.controller.scriptUrl !== expected.controllerScriptUrl ||
      observation.controller.state !== "activated")
  ) {
    throw new Error("Installer startup controller authority mismatches the current manifest");
  }
  if (
    !observation.installerWorkerObserved ||
    !observation.diagnosticsAvailable ||
    observation.controls === null ||
    observation.panel === null ||
    observation.ui === null ||
    observation.installStore === null ||
    observation.installerTransfer === null ||
    observation.offlineShell === null
  ) {
    return "waiting";
  }
  const { controls, controller, installStore, installerTransfer, offlineShell, ui } = observation;
  if (ui.state === "checking") {
    if (!controls.startDisabled || !controls.repairDisabled || !controls.launchDisabled) {
      throw new Error("Installer startup checking state exposes an ordinary action");
    }
    return "waiting";
  }
  if (ui.state !== "idle" && ui.state !== "ready") {
    throw new Error(`Installer startup entered unexpected state ${ui.state}`);
  }
  if (ui.state !== expected.allowedUiState) {
    throw new Error(
      `Installer startup reached ${ui.state} while ${expected.allowedUiState} was required`,
    );
  }
  if (
    offlineShell.state !== "active" ||
    offlineShell.activeArtifactDigest !== expected.artifactDigest ||
    offlineShell.activeReleaseDigest !== expected.releaseDigest ||
    offlineShell.activeGenerationId !== expected.generationId ||
    controller === null ||
    controller.scriptUrl !== expected.controllerScriptUrl ||
    controller.state !== "activated"
  ) {
    throw new Error("Installer startup terminal shell/controller authority is incomplete");
  }
  if (ui.state === "idle") {
    if (
      controls.startDisabled ||
      !controls.repairDisabled ||
      !controls.launchDisabled ||
      ui.releaseDigest !== null ||
      ui.shellGenerationId !== null ||
      ui.storeState !== "idle" ||
      ui.transferState !== "idle" ||
      installStore.state !== "idle" ||
      installStore.activeReleaseDigest !== null ||
      installerTransfer.state !== "idle" ||
      installerTransfer.activeReleaseDigest !== null
    ) {
      throw new Error("Installer startup idle admission is not ready for an ordinary install");
    }
    return "ready";
  }
  if (
    !controls.startDisabled ||
    controls.repairDisabled ||
    controls.launchDisabled ||
    ui.releaseDigest !== expected.releaseDigest ||
    ui.shellGenerationId !== expected.generationId ||
    ui.storeState !== "ready" ||
    ui.transferState !== "ready" ||
    installStore.state !== "ready" ||
    installStore.activeReleaseDigest !== expected.releaseDigest ||
    installerTransfer.state !== "ready" ||
    installerTransfer.activeReleaseDigest !== expected.releaseDigest
  ) {
    throw new Error("Installer startup ready admission is not exact");
  }
  return "ready";
}

export async function waitForInstallerTrustStartupAdmission(input: {
  readonly delay: (milliseconds: number) => Promise<void>;
  readonly expected: InstallerTrustStartupExpectedAuthority;
  readonly now: () => number;
  readonly observe: () => Promise<InstallerTrustStartupObservation>;
  readonly pollIntervalMs?: number;
  readonly scheduleDeadline?: InstallerTrustStartupDeadlineScheduler;
  readonly timeoutMs?: number;
}): Promise<InstallerTrustStartupObservation> {
  const timeoutMs = input.timeoutMs ?? INSTALLER_TRUST_STARTUP_TIMEOUT_MS;
  const pollIntervalMs = input.pollIntervalMs ?? 25;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs <= 0
  ) {
    throw new Error("Installer startup admission timing bounds are invalid");
  }
  const startedAt = input.now();
  if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(startedAt + timeoutMs)) {
    throw new Error("Installer startup admission clock is invalid");
  }
  const deadlineAt = startedAt + timeoutMs;
  const scheduleDeadline = input.scheduleDeadline ?? defaultDeadlineScheduler;
  let latest: InstallerTrustStartupObservation | null = null;
  while (true) {
    latest = await raceStartupOperation(
      input.observe(),
      remainingTime(input.now, deadlineAt, timeoutMs),
      scheduleDeadline,
      () =>
        new InstallerTrustStartupTimeoutError(
          "observe",
          timeoutMs,
          latest?.ui?.state ?? "unavailable",
        ),
    );
    if (classifyInstallerTrustStartupObservation(latest, input.expected) === "ready") {
      return latest;
    }
    const remaining = remainingTime(input.now, deadlineAt, timeoutMs);
    await raceStartupOperation(
      input.delay(Math.min(pollIntervalMs, remaining)),
      remaining,
      scheduleDeadline,
      () =>
        new InstallerTrustStartupTimeoutError(
          "delay",
          timeoutMs,
          latest?.ui?.state ?? "unavailable",
        ),
    );
  }
}

function remainingTime(now: () => number, deadlineAt: number, timeoutMs: number): number {
  const current = now();
  if (!Number.isSafeInteger(current))
    throw new Error("Installer startup admission clock is invalid");
  return Math.max(0, Math.min(timeoutMs, deadlineAt - current));
}

function raceStartupOperation<T>(
  operation: Promise<T>,
  remainingMs: number,
  scheduleDeadline: InstallerTrustStartupDeadlineScheduler,
  timeoutError: () => InstallerTrustStartupTimeoutError,
): Promise<T> {
  if (remainingMs <= 0) {
    void operation.catch(() => undefined);
    return Promise.reject(timeoutError());
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let deadline: InstallerTrustStartupScheduledDeadline | null = null;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      deadline?.cancel();
      action();
    };
    void operation.then(
      (value) => {
        settle(() => resolve(value));
      },
      (error: unknown) => {
        settle(() => reject(error));
      },
    );
    deadline = scheduleDeadline(remainingMs, () => {
      settle(() => reject(timeoutError()));
    });
    if (settled) deadline.cancel();
  });
}

const defaultDeadlineScheduler: InstallerTrustStartupDeadlineScheduler = (milliseconds, expire) => {
  const timeout = setTimeout(expire, milliseconds);
  return Object.freeze({
    cancel: () => {
      clearTimeout(timeout);
    },
  });
};
