import type { UninstallService, UninstallTelemetrySnapshot } from "@parallax/engine";
import type { DestructiveLifecycleGate } from "./destructive-lifecycle-gate";
import type { InstallerController } from "./installer-controller";

export const UNINSTALL_ENDPOINT = "/uninstall" as const;

export function mountUninstallUi(
  root: HTMLElement,
  uninstall: UninstallService,
  installer: InstallerController,
  destructiveGate: DestructiveLifecycleGate,
  reload: () => void = () => location.reload(),
): void {
  const open = requireButton(root, "#uninstall-open");
  const dialog = requireDialog(root, "#uninstall-confirmation");
  const cancel = requireButton(root, "#uninstall-cancel");
  const client = requireButton(root, "#uninstall-client-confirm");
  const siteData = requireButton(root, "#uninstall-site-data-confirm");
  const reloadAction = requireButton(root, "#uninstall-reload");
  const status = requireElement(root, "#uninstall-status");
  const alert = requireElement(root, "#uninstall-alert");
  const exportButton = requireButton(root, "#uninstall-export-saves");
  const siteDataForm = requireForm(root, "#uninstall-site-data-form");
  let destructiveStarted = false;
  const installerActions = [
    "#installer-start",
    "#installer-cancel",
    "#installer-repair",
    "#installer-launch",
    "#installer-reload",
  ].map((selector) => requireButton(root, selector));

  exportButton.disabled = true;
  exportButton.setAttribute("aria-disabled", "true");
  open.addEventListener("click", () => {
    dialog.showModal();
    cancel.focus();
  });
  cancel.addEventListener("click", () => {
    if (!destructiveStarted) dialog.close();
  });
  dialog.addEventListener("cancel", (event) => {
    if (destructiveStarted) event.preventDefault();
  });
  const lockDestructiveUi = (message: string): void => {
    destructiveStarted = true;
    destructiveGate.lock();
    for (const action of [...installerActions, open, cancel, client, siteData, exportButton]) {
      action.disabled = true;
    }
    dialog.setAttribute("data-destructive-started", "true");
    status.textContent = message;
    alert.hidden = true;
  };
  client.addEventListener("click", () => {
    lockDestructiveUi("Stopping Parallax services before removing local data…");
    void uninstall.uninstall();
  });
  siteDataForm.addEventListener("submit", () => {
    lockDestructiveUi("Submitting the confirmed same-origin site-data removal request…");
  });
  reloadAction.addEventListener("click", reload);

  installer.subscribe((snapshot) => {
    const busy =
      snapshot.state === "checking" ||
      snapshot.state === "installing" ||
      snapshot.state === "repairing" ||
      snapshot.state === "requesting-persistence" ||
      snapshot.state === "cancelling" ||
      snapshot.state === "launching";
    open.disabled = destructiveGate.isLocked() || busy || uninstall.snapshot().state === "running";
  });
  uninstall.subscribe((snapshot) =>
    renderSnapshot(
      snapshot,
      root,
      dialog,
      open,
      client,
      siteData,
      installerActions,
      reloadAction,
      status,
      alert,
    ),
  );
}

function renderSnapshot(
  snapshot: UninstallTelemetrySnapshot,
  root: HTMLElement,
  dialog: HTMLDialogElement,
  open: HTMLButtonElement,
  client: HTMLButtonElement,
  siteData: HTMLButtonElement,
  installerActions: readonly HTMLButtonElement[],
  reloadAction: HTMLButtonElement,
  status: HTMLElement,
  alert: HTMLElement,
): void {
  root.dataset.uninstallState = snapshot.state;
  root.dataset.uninstallAttempt = snapshot.attempt.toString();
  root.dispatchEvent(
    new CustomEvent("parallax-uninstall-state", {
      bubbles: true,
      detail: snapshot,
    }),
  );
  if (snapshot.state === "running") {
    open.disabled = true;
    client.disabled = true;
    siteData.disabled = true;
    status.textContent = "Removing origin storage…";
    return;
  }
  if (snapshot.state === "succeeded") {
    open.disabled = true;
    for (const action of installerActions) action.disabled = true;
    status.textContent = quotaSummary(snapshot);
    client.disabled = true;
    siteData.disabled = true;
    reloadAction.hidden = false;
    reloadAction.disabled = false;
    reloadAction.focus();
    return;
  }
  if (snapshot.state === "failed") {
    status.textContent = "Uninstall stopped without claiming complete removal.";
    alert.hidden = false;
    alert.textContent = `Reload or close this tab before any further lifecycle action. ${snapshot.failures.map(({ message }) => message).join(" ")}`;
    client.disabled = true;
    siteData.disabled = true;
    reloadAction.hidden = false;
    reloadAction.disabled = false;
    if (!dialog.open) dialog.showModal();
    reloadAction.focus();
    return;
  }
  status.textContent = "No uninstall has run in this page.";
  client.disabled = false;
  siteData.disabled = false;
}

function quotaSummary(snapshot: UninstallTelemetrySnapshot): string {
  const released = snapshot.quota.releasedBytes;
  if (snapshot.quota.teardownKind === "idempotent-empty") {
    return "The verified client-visible storage surfaces were already empty. Reload before reinstalling.";
  }
  return released === null
    ? "The verified client-visible storage surfaces were cleared, but Chrome did not expose quota-release bytes. Reload before reinstalling."
    : `The verified client-visible storage surfaces stayed empty across two checks. Chrome reported ${released.toLocaleString()} released bytes. Reload before reinstalling.`;
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const value = root.querySelector(selector);
  if (!(value instanceof HTMLElement)) throw new Error(`Uninstall UI is missing ${selector}`);
  return value;
}

function requireButton(root: HTMLElement, selector: string): HTMLButtonElement {
  const value = root.querySelector(selector);
  if (!(value instanceof HTMLButtonElement)) throw new Error(`Uninstall UI is missing ${selector}`);
  return value;
}

function requireDialog(root: HTMLElement, selector: string): HTMLDialogElement {
  const value = root.querySelector(selector);
  if (!(value instanceof HTMLDialogElement)) throw new Error(`Uninstall UI is missing ${selector}`);
  return value;
}

function requireForm(root: HTMLElement, selector: string): HTMLFormElement {
  const value = root.querySelector(selector);
  if (!(value instanceof HTMLFormElement)) throw new Error(`Uninstall UI is missing ${selector}`);
  return value;
}
