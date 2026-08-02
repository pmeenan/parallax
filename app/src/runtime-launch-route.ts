import { isAutomationRuntimeLaunch } from "@parallax/engine";

export type RuntimeLaunchRoute =
  | Readonly<{
      readonly contentSource: Readonly<{
        readonly buildManifestUrl: string;
        readonly kind: "privileged-legacy-network";
      }>;
      readonly requiresOfflineShell: false;
    }>
  | Readonly<{
      readonly requiresOfflineShell: true;
    }>;

export function resolveRuntimeLaunchRoute(url: string, webdriver: boolean): RuntimeLaunchRoute {
  if (isAutomationRuntimeLaunch(url, webdriver)) {
    return Object.freeze({
      contentSource: Object.freeze({
        buildManifestUrl: new URL("/build-manifest.json", url).href,
        kind: "privileged-legacy-network" as const,
      }),
      requiresOfflineShell: false,
    });
  }
  return Object.freeze({
    requiresOfflineShell: true,
  });
}
