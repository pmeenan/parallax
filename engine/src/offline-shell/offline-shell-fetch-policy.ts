export function shouldPassThroughOfflineShellRangeRequest(
  request: Pick<Request, "headers" | "method" | "url">,
  scopeOrigin: string,
): boolean {
  return (
    request.method === "GET" &&
    new URL(request.url).origin === scopeOrigin &&
    request.headers.has("range")
  );
}

export function shouldUseNetworkFirstInstallerTargetRequest(
  request: Pick<Request, "headers" | "method" | "url">,
  scopeOrigin: string,
): boolean {
  const url = new URL(request.url);
  return (
    request.method === "GET" &&
    url.origin === scopeOrigin &&
    (url.pathname === `/${INSTALLER_BUILD_MANIFEST_PATH}` ||
      url.pathname === `/${INSTALL_MANIFEST_PATH}`) &&
    url.search === "" &&
    request.headers.get(INSTALLER_TARGET_REQUEST_HEADER) === INSTALLER_TARGET_REQUEST_VALUE
  );
}

export async function resolveNetworkFirstInstallerTarget<T>(
  network: () => Promise<T>,
  verifiedOfflineFallback: () => Promise<T>,
): Promise<T> {
  try {
    return await network();
  } catch (error: unknown) {
    if (!(error instanceof TypeError)) throw error;
    return verifiedOfflineFallback();
  }
}

import {
  INSTALLER_BUILD_MANIFEST_PATH,
  INSTALLER_TARGET_REQUEST_HEADER,
  INSTALLER_TARGET_REQUEST_VALUE,
} from "../install/installer-build-manifest";
import { INSTALL_MANIFEST_PATH } from "../storage/install-manifest";

export const OFFLINE_SHELL_UNINSTALL_PATH = "/uninstall" as const;

export function resolveOfflineShellCachePath(
  request: Pick<Request, "method" | "mode" | "url">,
  scopeOrigin: string,
): string | null {
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== scopeOrigin ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  return request.mode === "navigate" ? "index.html" : url.pathname.slice(1);
}

export function shouldPassThroughUninstallRequest(
  request: Pick<Request, "method" | "mode" | "url">,
  scopeOrigin: string,
): boolean {
  const url = new URL(request.url);
  return (
    request.method === "POST" &&
    request.mode === "navigate" &&
    url.origin === scopeOrigin &&
    url.pathname === OFFLINE_SHELL_UNINSTALL_PATH &&
    url.search === ""
  );
}
