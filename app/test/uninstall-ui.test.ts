import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { UninstallService, UninstallTelemetrySnapshot } from "@parallax/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDestructiveLifecycleGate } from "../src/destructive-lifecycle-gate";
import type { InstallerController, InstallerUiSnapshot } from "../src/installer-controller";
import { mountInstallerUi } from "../src/installer-ui";
import { mountUninstallUi, UNINSTALL_ENDPOINT } from "../src/uninstall-ui";

afterEach(() => vi.unstubAllGlobals());

describe("uninstall UI contract", () => {
  it("uses one fixed endpoint and truthful confirmation/save wording", async () => {
    expect(UNINSTALL_ENDPOINT).toBe("/uninstall");
    const html = await readFile(resolve(import.meta.dirname, "../index.html"), "utf8");
    expect(html).toContain("Remove Parallax data from this Chrome profile?");
    expect(html).toContain("app-owned model");
    expect(html).toContain("no save-game subsystem and therefore no saved progress to export");
    expect(html).toContain("Page code cannot observe or promise removal of Chrome's HTTP cache");
    expect(html).toContain('id="uninstall-export-saves" type="button" disabled');
    expect(html).toContain("Confirm client-side uninstall");
    expect(html).toContain("Confirm and use Chrome site-data removal");
    const dialogStart = html.indexOf('id="uninstall-confirmation"');
    const dialogEnd = html.indexOf("</dialog>", dialogStart);
    expect(html.indexOf('id="uninstall-status"')).toBeGreaterThan(dialogStart);
    expect(html.indexOf('id="uninstall-alert"')).toBeLessThan(dialogEnd);
    expect(html).toContain(
      '<form id="uninstall-site-data-form" action="/uninstall" method="post">',
    );
    const dialog = html.slice(dialogStart, dialogEnd);
    expect(dialog).toContain('id="uninstall-cancel" type="button" autofocus');
    expect(dialog).not.toMatch(/id="uninstall-(?:client|site-data)-confirm"[^>]*autofocus/u);
  });

  it("explicitly focuses Keep installation when the confirmation dialog opens", () => {
    const dom = fakeDom();
    const service = fakeUninstallService();
    const installer = fakeInstallerController();
    mountUninstallUi(
      dom.root as unknown as HTMLElement,
      service.service,
      installer.controller,
      createDestructiveLifecycleGate(),
    );

    dom.open.dispatchEvent(new Event("click"));

    expect(dom.dialog.open).toBe(true);
    expect(dom.cancel.focused).toBe(true);
    expect(dom.client.focused).toBe(false);
    expect(dom.siteData.focused).toBe(false);
  });

  it("renders restored denied persistence as an exact warning while Launch stays available", () => {
    const dom = fakeDom();
    const installer = fakeInstallerController();
    mountInstallerUi(dom.root as unknown as HTMLElement, installer.controller);

    installer.emit({
      ...installerSnapshot("ready"),
      persistence: "denied",
      releaseDigest: "a".repeat(64),
    });

    expect(dom.root.dataset.persistence).toBe("denied");
    expect(dom.root.dataset.state).toBe("ready");
    expect(dom.warning.hidden).toBe(false);
    expect(dom.warning.textContent).toMatch(/may evict/);
    expect(dom.launch.disabled).toBe(false);
  });

  it.each([
    "client",
    "site-data",
  ])("locks every lifecycle control synchronously for a %s destructive attempt", (mechanism) => {
    const dom = fakeDom();
    const service = fakeUninstallService();
    const installer = fakeInstallerController();
    const gate = createDestructiveLifecycleGate();
    mountInstallerUi(dom.root as unknown as HTMLElement, installer.controller, null, gate);
    mountUninstallUi(
      dom.root as unknown as HTMLElement,
      service.service,
      installer.controller,
      gate,
    );
    dom.open.dispatchEvent(new Event("click"));
    expect(dom.dialog.open).toBe(true);

    (mechanism === "client" ? dom.client : dom.form).dispatchEvent(
      new Event(mechanism === "client" ? "click" : "submit", { cancelable: true }),
    );
    for (const control of dom.destructiveControls) expect(control.disabled).toBe(true);
    const cancel = new Event("cancel", { cancelable: true });
    dom.dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(dom.dialog.open).toBe(true);

    service.emit(failedSnapshot());
    expect(dom.reload.hidden).toBe(false);
    expect(dom.reload.focused).toBe(true);
    expect(dom.alert.hidden).toBe(false);
    installer.emit(installerSnapshot("ready"));
    expect(dom.open.disabled).toBe(true);
    for (const control of dom.installerControls) expect(control.disabled).toBe(true);
    expect(gate.isLocked()).toBe(true);
  });
});

class FakeElement extends EventTarget {
  public disabled = false;
  public focused = false;
  public hidden = false;
  public readonly dataset: Record<string, string> = {};
  public textContent = "";
  readonly #attributes = new Map<string, string>();
  public focus(): void {
    this.focused = true;
  }
  public setAttribute(name: string, value: string): void {
    this.#attributes.set(name, value);
  }
}
class FakeButton extends FakeElement {}
class FakeForm extends FakeElement {}
class FakeDialog extends FakeElement {
  public open = false;
  public close(): void {
    this.open = false;
  }
  public showModal(): void {
    this.open = true;
  }
}
class FakeProgress extends FakeElement {}
class FakeRoot extends FakeElement {
  public constructor(private readonly elements: ReadonlyMap<string, FakeElement>) {
    super();
  }
  public querySelector(selector: string): FakeElement | null {
    return this.elements.get(selector) ?? null;
  }
}

function fakeDom() {
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("HTMLButtonElement", FakeButton);
  vi.stubGlobal("HTMLDialogElement", FakeDialog);
  vi.stubGlobal("HTMLFormElement", FakeForm);
  vi.stubGlobal("HTMLProgressElement", FakeProgress);
  const button = () => new FakeButton();
  const open = button();
  const client = button();
  const siteData = button();
  const cancel = button();
  const reload = button();
  const exportSaves = button();
  const installer = [button(), button(), button(), button(), button()];
  const launch = installer[3] as FakeButton;
  const dialog = new FakeDialog();
  const form = new FakeForm();
  const status = new FakeElement();
  const alert = new FakeElement();
  const warning = new FakeElement();
  const entries = new Map<string, FakeElement>([
    ["#uninstall-open", open],
    ["#uninstall-client-confirm", client],
    ["#uninstall-site-data-confirm", siteData],
    ["#uninstall-cancel", cancel],
    ["#uninstall-reload", reload],
    ["#uninstall-export-saves", exportSaves],
    ["#uninstall-confirmation", dialog],
    ["#uninstall-site-data-form", form],
    ["#uninstall-status", status],
    ["#uninstall-alert", alert],
  ]);
  [
    "#installer-start",
    "#installer-cancel",
    "#installer-repair",
    "#installer-launch",
    "#installer-reload",
  ].forEach((selector, index) => {
    entries.set(selector, installer[index] ?? button());
  });
  entries.set("#installer-progress", new FakeProgress());
  for (const selector of [
    "#installer-status",
    "#installer-error",
    "#installer-current-resource",
    "#installer-downloaded-bytes",
    "#installer-planned-download-bytes",
    "#installer-completed-resources",
    "#installer-resumed-bytes",
    "#installer-reused-bytes",
    "#installer-total-bytes",
    "#installer-verified-bytes",
  ])
    entries.set(selector, new FakeElement());
  entries.set("#installer-warning", warning);
  const root = new FakeRoot(entries);
  return {
    alert,
    cancel,
    client,
    destructiveControls: [...installer, open, cancel, client, siteData, exportSaves],
    dialog,
    form,
    installerControls: installer,
    launch,
    open,
    reload,
    root,
    siteData,
    warning,
  };
}

function fakeUninstallService() {
  let snapshot = idleSnapshot();
  let listener: ((snapshot: UninstallTelemetrySnapshot) => void) | null = null;
  return {
    emit(next: UninstallTelemetrySnapshot) {
      snapshot = next;
      listener?.(next);
    },
    service: {
      snapshot: () => snapshot,
      subscribe(next) {
        listener = next;
        next(snapshot);
        return () => undefined;
      },
      async uninstall() {
        snapshot = { ...snapshot, state: "running" };
        listener?.(snapshot);
        return snapshot;
      },
    } satisfies UninstallService,
  };
}

function fakeInstallerController() {
  let listener: ((snapshot: InstallerUiSnapshot) => void) | null = null;
  return {
    controller: {
      subscribe(next) {
        listener = next;
        next(installerSnapshot("idle"));
        return () => undefined;
      },
    } as InstallerController,
    emit(snapshot: InstallerUiSnapshot) {
      listener?.(snapshot);
    },
  };
}

function installerSnapshot(state: InstallerUiSnapshot["state"]): InstallerUiSnapshot {
  return {
    activeResourceId: null,
    checkpointedBytes: 0,
    completedResourceCount: 0,
    downloadedBytes: 0,
    failure: null,
    finalVerificationBytes: 0,
    finalVerificationPhase: "idle",
    finalVerificationResourceCount: 0,
    finalVerificationTotalBytes: 0,
    finalVerificationTotalResourceCount: 0,
    persistence: "not-requested",
    plannedDownloadBytes: 0,
    repairAttemptCount: 0,
    repairedBytes: 0,
    repairedResourceCount: 0,
    releaseDigest: state === "ready" ? "a".repeat(64) : null,
    resourceCount: 0,
    resumedBytes: 0,
    reusedBytes: 0,
    shellGenerationId: null,
    state,
    storeState: "idle",
    totalBytes: 0,
    transferState: "idle",
    verifiedBytes: 0,
  };
}

function idleSnapshot(): UninstallTelemetrySnapshot {
  return {
    attempt: 0,
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
      afterQuota: null,
      afterUsage: null,
      beforeQuota: null,
      beforeUsage: null,
      releasedBytes: null,
      teardownKind: "unverified",
    },
    quiescence: { clientCount: null, exclusiveLocksHeld: false, stableInventoryPasses: 0 },
    schemaVersion: 1,
    state: "idle",
    surfaces: [],
  };
}
function failedSnapshot(): UninstallTelemetrySnapshot {
  return {
    ...idleSnapshot(),
    attempt: 1,
    failures: [{ message: "another tab exists", phase: "quiescence", surface: "runtime" }],
    state: "failed",
  };
}
