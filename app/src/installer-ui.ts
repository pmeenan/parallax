import type { DestructiveLifecycleGate } from "./destructive-lifecycle-gate";
import type {
  InstallerController,
  InstallerUiSnapshot,
  InstallerUiState,
} from "./installer-controller";
import type { LaunchLifecycleTracker } from "./launch-lifecycle";

export interface InstallerViewModel {
  readonly canCancel: boolean;
  readonly canInstall: boolean;
  readonly canLaunch: boolean;
  readonly canRepair: boolean;
  readonly canReload: boolean;
  readonly error: string | null;
  readonly installLabel: string;
  readonly persistenceWarning: string | null;
  readonly progress: number;
  readonly status: string;
}

export function createInstallerDiagnosticSnapshot(snapshot: InstallerUiSnapshot): Readonly<{
  failure: InstallerUiSnapshot["failure"];
  persistence: InstallerUiSnapshot["persistence"];
  state: InstallerUiSnapshot["state"];
  storeState: InstallerUiSnapshot["storeState"];
  transferState: InstallerUiSnapshot["transferState"];
}> {
  return Object.freeze({
    failure: snapshot.failure === null ? null : Object.freeze({ ...snapshot.failure }),
    persistence: snapshot.persistence,
    state: snapshot.state,
    storeState: snapshot.storeState,
    transferState: snapshot.transferState,
  });
}

export function createInstallerViewModel(snapshot: InstallerUiSnapshot): InstallerViewModel {
  const active = snapshot.activeResourceId === null ? "" : ` · ${snapshot.activeResourceId}`;
  const status = statusFor(snapshot.state, active, snapshot.repairedResourceCount);
  const persistenceWarning =
    snapshot.persistence === "denied"
      ? "Persistent storage was not granted. Installation can continue, but Chrome may evict the game under storage pressure."
      : null;
  const completed = Math.min(
    snapshot.totalBytes,
    snapshot.reusedBytes + snapshot.resumedBytes + snapshot.downloadedBytes,
  );
  return Object.freeze({
    canCancel:
      snapshot.state === "installing" ||
      snapshot.state === "repairing" ||
      snapshot.state === "requesting-persistence",
    canInstall:
      snapshot.state === "idle" ||
      snapshot.state === "cancelled" ||
      (snapshot.state === "failed" &&
        (snapshot.failure?.recovery === "retry" ||
          (snapshot.failure?.recovery === "repair" && snapshot.releaseDigest === null))),
    canLaunch: snapshot.state === "ready",
    canRepair:
      snapshot.releaseDigest !== null &&
      snapshot.shellGenerationId !== null &&
      (snapshot.state === "ready" ||
        (snapshot.state === "failed" && snapshot.failure?.recovery === "repair")),
    canReload: snapshot.state === "failed" && snapshot.failure?.recovery === "reload",
    error:
      snapshot.failure === null
        ? null
        : failureCopy(
            snapshot.failure.code,
            snapshot.failure.message,
            snapshot.failure.recovery,
            snapshot.failure.resourceId,
          ),
    installLabel:
      snapshot.state === "failed" && snapshot.failure?.recovery === "reload"
        ? "Installation unavailable"
        : snapshot.state === "failed" || snapshot.state === "cancelled"
          ? "Retry / resume installation"
          : "Install Parallax",
    persistenceWarning,
    progress: snapshot.totalBytes === 0 ? 0 : completed / snapshot.totalBytes,
    status,
  });
}

export function mountInstallerUi(
  root: HTMLElement,
  controller: InstallerController,
  launchLifecycle: LaunchLifecycleTracker | null = null,
  destructiveGate: DestructiveLifecycleGate | null = null,
): void {
  const install = requireButton(root, "#installer-start");
  const cancel = requireButton(root, "#installer-cancel");
  const launch = requireButton(root, "#installer-launch");
  const repair = requireButton(root, "#installer-repair");
  const reload = requireButton(root, "#installer-reload");
  const progress = requireProgress(root, "#installer-progress");
  const status = requireElement(root, "#installer-status");
  const warning = requireElement(root, "#installer-warning");
  const error = requireElement(root, "#installer-error");
  const metrics = Object.freeze({
    current: requireElement(root, "#installer-current-resource"),
    downloaded: requireElement(root, "#installer-downloaded-bytes"),
    planned: requireElement(root, "#installer-planned-download-bytes"),
    resources: requireElement(root, "#installer-completed-resources"),
    resumed: requireElement(root, "#installer-resumed-bytes"),
    reused: requireElement(root, "#installer-reused-bytes"),
    total: requireElement(root, "#installer-total-bytes"),
    verified: requireElement(root, "#installer-verified-bytes"),
  });

  install.addEventListener("click", () => {
    void controller.installOrResume();
  });
  cancel.addEventListener("click", () => {
    void controller.cancel();
  });
  repair.addEventListener("click", () => {
    void controller.repair();
  });
  launch.addEventListener("click", () => {
    const releaseDigest = controller.snapshot().releaseDigest;
    if (launchLifecycle !== null) {
      if (releaseDigest === null) {
        launchLifecycle.fail(new Error("Launch control omitted its admitted release identity"));
      } else {
        launchLifecycle.begin(releaseDigest);
      }
    }
    void controller.launch().then(
      () => {
        const snapshot = controller.snapshot();
        if (snapshot.state === "failed") {
          launchLifecycle?.fail(
            new Error(snapshot.failure?.message ?? "Launch failed without a diagnostic"),
          );
        }
      },
      (error: unknown) => launchLifecycle?.fail(error),
    );
  });
  reload.addEventListener("click", () => {
    controller.reload();
  });
  let latestView: InstallerViewModel | null = null;
  const renderActionAvailability = (): void => {
    const view = latestView;
    if (view === null) return;
    const locked = destructiveGate?.isLocked() ?? false;
    install.disabled = locked || !view.canInstall;
    cancel.disabled = locked || !view.canCancel;
    launch.disabled = locked || !view.canLaunch;
    repair.disabled = locked || !view.canRepair;
    reload.disabled = locked || !view.canReload;
  };
  destructiveGate?.subscribe(renderActionAvailability);
  controller.subscribe((snapshot) => {
    const view = createInstallerViewModel(snapshot);
    latestView = view;
    const diagnostic = createInstallerDiagnosticSnapshot(snapshot);
    root.dataset.state = snapshot.state;
    root.dataset.failureCode = diagnostic.failure?.code ?? "";
    root.dataset.failureClass = diagnostic.failure?.failureClass ?? "";
    root.dataset.failureEvidence = diagnostic.failure?.failureEvidence ?? "";
    root.dataset.failureMessage = diagnostic.failure?.message ?? "";
    root.dataset.failureOperation = diagnostic.failure?.operation ?? "";
    root.dataset.failureRecovery = diagnostic.failure?.recovery ?? "";
    root.dataset.failureResourceId = diagnostic.failure?.resourceId ?? "";
    root.dataset.persistence = diagnostic.persistence;
    root.dataset.releaseDigest = snapshot.releaseDigest ?? "";
    root.dataset.shellGenerationId = snapshot.shellGenerationId ?? "";
    root.dataset.storeState = snapshot.storeState;
    root.dataset.transferState = snapshot.transferState;
    root.dispatchEvent(
      new CustomEvent("parallax-installer-state", {
        detail: diagnostic,
        bubbles: true,
      }),
    );
    install.disabled = !view.canInstall;
    install.textContent = view.installLabel;
    cancel.disabled = !view.canCancel;
    launch.disabled = !view.canLaunch;
    repair.disabled = !view.canRepair;
    reload.hidden = !view.canReload;
    reload.disabled = !view.canReload;
    renderActionAvailability();
    progress.value = view.progress;
    setTextContentIfChanged(status, view.status);
    warning.hidden = view.persistenceWarning === null;
    setTextContentIfChanged(warning, view.persistenceWarning ?? "");
    error.hidden = view.error === null;
    setTextContentIfChanged(error, view.error ?? "");
    metrics.current.textContent = snapshot.activeResourceId ?? "Waiting";
    metrics.downloaded.textContent = formatBytes(snapshot.downloadedBytes);
    metrics.planned.textContent = formatBytes(snapshot.plannedDownloadBytes);
    metrics.resources.textContent = `${snapshot.completedResourceCount.toLocaleString()} / ${snapshot.resourceCount.toLocaleString()}`;
    metrics.resumed.textContent = formatBytes(snapshot.resumedBytes);
    metrics.reused.textContent = formatBytes(snapshot.reusedBytes);
    metrics.total.textContent = formatBytes(snapshot.totalBytes);
    metrics.verified.textContent = formatBytes(snapshot.verifiedBytes);
  });
}

export function setTextContentIfChanged(element: Pick<Node, "textContent">, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

function statusFor(state: InstallerUiState, active: string, repairedResourceCount: number): string {
  switch (state) {
    case "idle":
      return "Ready to install. Parallax downloads game data into private local storage.";
    case "checking":
      return "Checking the installed release…";
    case "requesting-persistence":
      return "Requesting durable storage…";
    case "installing":
      return `Installing and verifying${active}…`;
    case "repairing":
      return `Repairing and re-verifying the complete installation${active}…`;
    case "cancelling":
      return "Finishing the current durable checkpoint before cancelling…";
    case "cancelled":
      return "Installation paused. Verified data and durable partial progress were kept.";
    case "ready":
      return repairedResourceCount > 0
        ? `Installation repaired ${repairedResourceCount.toLocaleString()} corrupted local resource${repairedResourceCount === 1 ? "" : "s"} and verified the complete release. Launch is ready.`
        : "Installation verified. Launch is ready.";
    case "launching":
      return "Starting Parallax…";
    case "launched":
      return "Parallax launched.";
    case "failed":
      return "Installation needs attention.";
  }
}

function failureCopy(
  code: string,
  message: string,
  recovery: "reload" | "repair" | "retry",
  resourceId: string | null,
): string {
  const resource = resourceId === null ? "" : ` Resource: ${resourceId}.`;
  if (recovery === "reload") {
    if (code === "shell-incompatible") {
      return `A newer Parallax shell is available. Reload the page before installing or launching it. ${message}`;
    }
    if (code === "shell-contract" || code === "shell-release-mismatch") {
      return `The offline app shell is not compatible with this installed release. Reload the page before continuing. ${message}`;
    }
    return code === "launch"
      ? `Parallax could not finish starting. Reload the page to try again. ${message}`
      : `The installer can no longer continue safely in this page. Reload the page to restart it.${resource} ${message}`;
  }
  if (recovery === "repair") {
    return `Stored or downloaded data did not match the release manifest.${resource} Choose Repair installation to start one new bounded repair operation. ${message}`;
  }
  switch (code) {
    case "quota":
      return `There is not enough writable storage for this installation.${resource} Free disk space, then retry. ${message}`;
    case "integrity":
      return `Stored or downloaded data did not match the release manifest.${resource} The installer permits one automatic repair cycle per resource in each operation. ${message}`;
    case "transport":
      return `The download was interrupted.${resource} Check the connection, then retry to resume. ${message}`;
    case "validator":
    case "install-manifest-invalid":
      return `The release source did not satisfy the installer contract.${resource} ${message}`;
    case "shell-release-mismatch":
      return `The offline app shell and installed asset release do not match. Retry installation to select the shell's exact release. ${message}`;
    case "shell-contract":
      return `The offline app shell failed its integrity or compatibility checks. Reload before trying again. ${message}`;
    case "shell-unavailable":
      return `The offline app shell could not be prepared. Check the connection, then retry. ${message}`;
    case "persistence":
      return `Chrome could not complete the persistent-storage request. ${message}`;
    default:
      return `${message}${resource}`;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"] as const;
  let value = bytes / 1024;
  let unit: (typeof units)[number] = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index] ?? unit;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${unit}`;
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`Installer UI is missing ${selector}`);
  return element;
}

function requireButton(root: HTMLElement, selector: string): HTMLButtonElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Installer UI is missing button ${selector}`);
  }
  return element;
}

function requireProgress(root: HTMLElement, selector: string): HTMLProgressElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLProgressElement)) {
    throw new Error(`Installer UI is missing progress ${selector}`);
  }
  return element;
}
