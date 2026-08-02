import {
  createInstallerService,
  createOfflineShellService,
  createUninstallService,
  type OfflineShellAdmission,
  type OfflineShellService,
  resolveInstallerShellEntrypointPath,
} from "@parallax/engine";
import { createDestructiveLifecycleGate } from "./destructive-lifecycle-gate";
import { createInstallerController } from "./installer-controller";
import { mountInstallerUi } from "./installer-ui";
import { createLaunchLifecycleTracker } from "./launch-lifecycle";
import { bootRuntime } from "./runtime";
import { resolveRuntimeLaunchRoute } from "./runtime-launch-route";
import type { ShellLaunchAuthority } from "./shell-launch-authority";
import { mountUninstallUi } from "./uninstall-ui";

const installerService = createInstallerService({
  shellEntrypointPath: resolveInstallerShellEntrypointPath(import.meta.url, location.href),
});
const launchLifecycle = createLaunchLifecycleTracker();
Object.defineProperty(globalThis, "__parallaxLaunchLifecycleV2", {
  configurable: false,
  enumerable: false,
  value: () => launchLifecycle.snapshot(),
  writable: false,
});
const installerPanel = document.querySelector("#installer-shell");
if (!(installerPanel instanceof HTMLElement)) {
  throw new Error("App shell installer panel is missing");
}

let launchStarted = false;
const launchRuntime = async (
  contentSource:
    | Readonly<{ kind: "installed-release"; releaseDigest: string }>
    | Readonly<{
        buildManifestUrl: string;
        kind: "privileged-legacy-network";
      }>,
  offlineShell: OfflineShellService | null,
  expectedShell: OfflineShellAdmission | null,
  shellAuthority: ShellLaunchAuthority | null = null,
): Promise<void> => {
  if (launchStarted) throw new Error("Parallax runtime launch is already in progress");
  launchStarted = true;
  installerPanel.hidden = true;
  try {
    await bootRuntime(
      installerService,
      offlineShell,
      contentSource,
      expectedShell,
      shellAuthority,
      contentSource.kind === "installed-release" ? launchLifecycle : null,
    );
  } catch (error: unknown) {
    launchLifecycle.fail(error);
    launchStarted = false;
    installerPanel.hidden = false;
    throw error;
  }
};

const launchRoute = resolveRuntimeLaunchRoute(location.href, navigator.webdriver);
if (!launchRoute.requiresOfflineShell) {
  void launchRuntime(launchRoute.contentSource, null, null);
} else {
  const shellEntrypointPath = resolveInstallerShellEntrypointPath(import.meta.url, location.href);
  const offlineShell = createOfflineShellService({ shellEntrypointPath });
  const controller = createInstallerController({
    installer: installerService,
    offlineShell,
    launch: (releaseDigest, shellAdmission, shellAuthority) =>
      launchRuntime(
        {
          kind: "installed-release",
          releaseDigest,
        },
        offlineShell,
        shellAdmission,
        shellAuthority,
      ),
    reload: () => location.reload(),
  });
  const destructiveGate = createDestructiveLifecycleGate();
  const uninstallService = createUninstallService(undefined, () => installerService.dispose());
  Object.defineProperty(globalThis, "__parallaxUninstallDiagnosticsV1", {
    configurable: false,
    enumerable: false,
    value: () => uninstallService.snapshot(),
    writable: false,
  });
  Object.defineProperty(globalThis, "__parallaxInstallerDiagnosticsV1", {
    configurable: false,
    enumerable: false,
    value: () =>
      Object.freeze({
        installer: installerService.snapshot(),
        offlineShell: offlineShell.snapshot(),
        ui: controller.snapshot(),
      }),
    writable: false,
  });
  mountInstallerUi(installerPanel, controller, launchLifecycle, destructiveGate);
  mountUninstallUi(installerPanel, uninstallService, controller, destructiveGate);
  void controller.refreshTarget();
}
