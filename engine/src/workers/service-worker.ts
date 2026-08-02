import {
  resolveNetworkFirstInstallerTarget,
  resolveOfflineShellCachePath,
  shouldPassThroughOfflineShellRangeRequest,
  shouldPassThroughUninstallRequest,
  shouldUseNetworkFirstInstallerTargetRequest,
} from "../offline-shell/offline-shell-fetch-policy";
import {
  notifyOfflineShellSelectionChangeFromDurableRead,
  postOfflineShellSelectionChange,
} from "../offline-shell/offline-shell-selection-notification";
import { createBrowserOfflineShellStorePlatform } from "../offline-shell/shell-generation-browser-platform";
import {
  failedOfflineShellTelemetrySnapshot,
  OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
  type OfflineShellTelemetrySnapshot,
  parseOfflineShellWorkerRequest,
} from "../offline-shell/shell-generation-contract";
import {
  admitOfflineShellGeneration,
  OfflineShellStoreError,
  prepareAndActivateOfflineShellGeneration,
  resolveOfflineShellRequestFailureTelemetry,
  resolveOfflineShellResource,
} from "../offline-shell/shell-generation-store";

interface ParallaxExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface ParallaxFetchEvent extends ParallaxExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

interface ParallaxMessageEvent extends ParallaxExtendableEvent {
  readonly data: unknown;
  readonly ports: readonly MessagePort[];
}

interface ParallaxClient {
  postMessage(message: unknown): void;
}

interface ParallaxClients {
  claim(): Promise<void>;
  matchAll(
    options: Readonly<{ includeUncontrolled: boolean; type: "window" }>,
  ): Promise<readonly ParallaxClient[]>;
}

interface ParallaxServiceWorkerScope {
  readonly clients: ParallaxClients;
  readonly location: Location;
  addEventListener(type: "activate", listener: (event: ParallaxExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: ParallaxFetchEvent) => void): void;
  addEventListener(type: "install", listener: (event: ParallaxExtendableEvent) => void): void;
  addEventListener(type: "message", listener: (event: ParallaxMessageEvent) => void): void;
  skipWaiting(): Promise<void>;
}

const scope = globalThis as unknown as ParallaxServiceWorkerScope;
const platform = createBrowserOfflineShellStorePlatform();

scope.addEventListener("install", (event) => {
  // The stable worker script may take control, but shell-generation preparation and
  // selection are always explicit messages from an ordinary app-shell controller.
  event.waitUntil(scope.skipWaiting());
});

scope.addEventListener("activate", (event) => {
  event.waitUntil(scope.clients.claim());
});

scope.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (port === undefined) return;
  if (
    typeof event.data === "object" &&
    event.data !== null &&
    (event.data as { readonly kind?: unknown }).kind === "uninstall-client-count" &&
    (event.data as { readonly protocolVersion?: unknown }).protocolVersion ===
      OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION
  ) {
    event.waitUntil(
      scope.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) =>
        port.postMessage({
          clientCount: clients.length,
          kind: "uninstall-client-count",
          protocolVersion: OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
        }),
      ),
    );
    return;
  }
  event.waitUntil(
    (async () => {
      let requestId = 0;
      const previousSelection = await activeSelection();
      try {
        const request = parseOfflineShellWorkerRequest(event.data);
        requestId = request.requestId;
        if (request.kind === "snapshot") {
          const record = await platform.runExclusive(() => platform.readRecord());
          port.postMessage({
            kind: "snapshot",
            protocolVersion: OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
            requestId,
            telemetry: record.telemetry,
          });
          return;
        }
        if (request.kind === "admit") {
          const telemetry = await admitOfflineShellGeneration(platform, request.admission);
          await notifySelectionChange(previousSelection?.generationId ?? null, telemetry);
          port.postMessage({
            admission: request.admission,
            kind: "admitted",
            protocolVersion: OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
            requestId,
            telemetry,
          });
          return;
        }
        const generation = await prepareAndActivateOfflineShellGeneration(
          platform,
          request.shellEntrypointPath,
          { allowUpdate: true },
        );
        const record = await platform.runExclusive(() => platform.readRecord());
        await notifySelectionChange(previousSelection?.generationId ?? null, record.telemetry);
        port.postMessage({
          generation,
          kind: "prepared",
          protocolVersion: OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
          requestId,
          telemetry: record.telemetry,
        });
      } catch (error: unknown) {
        const code = error instanceof OfflineShellStoreError ? error.code : "shell-unavailable";
        const diagnostic = message(error);
        const telemetry = await resolveOfflineShellRequestFailureTelemetry(
          platform,
          error,
          code,
          diagnostic,
        ).catch(() => null);
        const responseTelemetry =
          telemetry ?? failedOfflineShellTelemetrySnapshot(code, diagnostic);
        await notifyOfflineShellSelectionChangeFromDurableRead(
          previousSelection?.generationId ?? null,
          activeSelection,
          notifySelectionChange,
        );
        port.postMessage({
          code,
          kind: "failure",
          message: diagnostic,
          protocolVersion: OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
          requestId,
          telemetry: responseTelemetry,
        });
      }
    })(),
  );
});

scope.addEventListener("fetch", (event) => {
  if (shouldPassThroughUninstallRequest(event.request, scope.location.origin)) {
    // Do not call respondWith here. Clear-Site-Data is ignored for a response
    // mediated by a service worker, and the browser must preserve the original
    // navigation's Fetch Metadata authority on the direct network request.
    return;
  }
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== scope.location.origin
  ) {
    return;
  }
  if (shouldPassThroughOfflineShellRangeRequest(event.request, scope.location.origin)) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (shouldUseNetworkFirstInstallerTargetRequest(event.request, scope.location.origin)) {
    event.respondWith(networkFirstInstallerTarget(event));
    return;
  }
  event.respondWith(handleFetch(event));
});

async function networkFirstInstallerTarget(event: ParallaxFetchEvent): Promise<Response> {
  return resolveNetworkFirstInstallerTarget(
    () => fetch(event.request),
    () => handleFetch(event),
  );
}

async function handleFetch(event: ParallaxFetchEvent): Promise<Response> {
  const path = resolveOfflineShellCachePath(event.request, scope.location.origin);
  if (path === null) return fetch(event.request);
  const previousSelection = await activeSelection();
  try {
    const resolved = await resolveOfflineShellResource(platform, path);
    if (resolved === null) return fetch(event.request);
    const headers = new Headers();
    for (const [name, value] of Object.entries(resolved.response.headers)) {
      headers.set(name, value);
    }
    return new Response(resolved.response.bytes.slice().buffer, {
      headers,
      status: resolved.response.status,
    });
  } catch (error: unknown) {
    return failureResponse(message(error));
  } finally {
    const currentSelection = await activeSelection();
    if (currentSelection !== null) {
      await notifySelectionChange(
        previousSelection?.generationId ?? null,
        currentSelection.telemetry,
      );
    }
  }
}

async function activeSelection(): Promise<Readonly<{
  generationId: string | null;
  telemetry: OfflineShellTelemetrySnapshot;
}> | null> {
  return platform
    .runExclusive(async () => {
      const record = await platform.readRecord();
      return Object.freeze({
        generationId: record.telemetry.activeGenerationId,
        telemetry: record.telemetry,
      });
    })
    .catch(() => null);
}

async function notifySelectionChange(
  previousGenerationId: string | null,
  telemetry: OfflineShellTelemetrySnapshot,
): Promise<void> {
  if (previousGenerationId === telemetry.activeGenerationId) return;
  const clients = await scope.clients
    .matchAll({ includeUncontrolled: true, type: "window" })
    .catch(() => []);
  postOfflineShellSelectionChange(clients, telemetry);
}

function failureResponse(diagnostic: string): Response {
  return new Response(`Offline shell unavailable: ${diagnostic}\n`, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "cross-origin-embedder-policy": "require-corp",
      "cross-origin-opener-policy": "same-origin",
      "x-content-type-options": "nosniff",
    },
    status: 503,
  });
}

function message(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}
