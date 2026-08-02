import {
  OFFLINE_SHELL_SERVICE_WORKER_PATH,
  OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
  type OfflineShellAdmission,
  type OfflineShellFailureCode,
  type OfflineShellGeneration,
  type OfflineShellTelemetrySnapshot,
  type OfflineShellWorkerRequest,
  type OfflineShellWorkerResponse,
  parseOfflineShellAdmission,
  parseOfflineShellWorkerNotification,
  parseOfflineShellWorkerResponse,
  unavailableOfflineShellTelemetrySnapshot,
} from "./shell-generation-contract";

const REQUEST_TIMEOUT_MS = 30_000;

export interface OfflineShellMessageEndpoint {
  assertCurrent(): void;
  dispose(): void;
  postMessage(message: OfflineShellWorkerRequest, transfer: readonly Transferable[]): void;
}

export interface OfflineShellRegistrationInput {
  readonly onInvalidate: (error: OfflineShellServiceError) => void;
  readonly onNotification: (message: unknown) => void;
  readonly signal: AbortSignal;
}

export interface OfflineShellServicePlatform {
  createMessageChannel(): MessageChannel;
  register(input: OfflineShellRegistrationInput): Promise<OfflineShellMessageEndpoint>;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof globalThis.setTimeout>;
  clearTimeout(id: ReturnType<typeof globalThis.setTimeout>): void;
}

export interface OfflineShellService {
  admit(expected: OfflineShellAdmission): Promise<void>;
  prepare(): Promise<OfflineShellGeneration>;
  snapshot(): OfflineShellTelemetrySnapshot;
  subscribe(listener: (snapshot: OfflineShellTelemetrySnapshot) => void): () => void;
}

export interface OfflineShellServiceInput {
  readonly platform?: OfflineShellServicePlatform;
  readonly shellEntrypointPath: string;
}

export class OfflineShellServiceError extends Error {
  public readonly code: OfflineShellFailureCode;
  public readonly recovery: "reload" | "retry";

  public constructor(
    code: OfflineShellFailureCode,
    message: string,
    recovery: "reload" | "retry" = code === "shell-unavailable" ? "retry" : "reload",
  ) {
    super(message);
    this.name = "OfflineShellServiceError";
    this.code = code;
    this.recovery = recovery;
  }
}

interface RegistrationAttempt {
  readonly controller: AbortController;
  readonly promise: Promise<OfflineShellMessageEndpoint>;
  readonly token: number;
  waiters: number;
}

export function createOfflineShellService(input: OfflineShellServiceInput): OfflineShellService {
  const platform = input.platform ?? createBrowserOfflineShellServicePlatform();
  const listeners = new Set<(snapshot: OfflineShellTelemetrySnapshot) => void>();
  let telemetry = unavailableOfflineShellTelemetrySnapshot();
  let nextRequestId = 0;
  let endpoint: OfflineShellMessageEndpoint | null = null;
  let attempt: RegistrationAttempt | null = null;
  let registrationToken = 0;
  let authorityEpoch = 0;

  const publish = (next: OfflineShellTelemetrySnapshot): void => {
    telemetry = next;
    for (const listener of listeners) {
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("Offline-shell telemetry listener failed", error);
      }
    }
  };

  const invalidate = (token: number, error: OfflineShellServiceError): void => {
    if (token !== registrationToken) return;
    authorityEpoch += 1;
    registrationToken += 1;
    endpoint?.dispose();
    endpoint = null;
    attempt?.controller.abort();
    attempt = null;
    publish(
      Object.freeze({
        ...telemetry,
        failureCode: error.code,
        failureCount: telemetry.failureCount + 1,
        failureMessage: error.message,
        state: "failed",
      }),
    );
  };

  const createAttempt = (): RegistrationAttempt => {
    const token = ++registrationToken;
    const controller = new AbortController();
    const next = {} as RegistrationAttempt;
    const promise = platform
      .register({
        onInvalidate: (error) => invalidate(token, error),
        onNotification: (value) => {
          if (token !== registrationToken) return;
          try {
            publish(parseOfflineShellWorkerNotification(value).telemetry);
          } catch (error: unknown) {
            console.error("Offline-shell service-worker notification was invalid", error);
            invalidate(
              token,
              new OfflineShellServiceError(
                "shell-contract",
                `Offline-shell service-worker notification was invalid: ${message(error)}`,
              ),
            );
          }
        },
        signal: controller.signal,
      })
      .then((registered) => {
        if (attempt !== next || token !== registrationToken) {
          registered.dispose();
          throw new OfflineShellServiceError(
            "shell-unavailable",
            "Offline-shell service-worker registration was replaced",
          );
        }
        endpoint = registered;
        attempt = null;
        return registered;
      })
      .catch((error: unknown) => {
        if (attempt === next) attempt = null;
        throw error;
      });
    Object.assign(next, { controller, promise, token, waiters: 0 });
    attempt = next;
    return next;
  };

  const acquireEndpoint = async (signal: AbortSignal): Promise<OfflineShellMessageEndpoint> => {
    if (endpoint !== null) return endpoint;
    const current = attempt ?? createAttempt();
    current.waiters += 1;
    try {
      return await waitForPromise(current.promise, signal);
    } finally {
      current.waiters -= 1;
      if (current.waiters === 0 && attempt === current && endpoint === null) {
        attempt = null;
        current.controller.abort();
      }
    }
  };

  const request = async (
    createRequest: (requestId: number) => OfflineShellWorkerRequest,
  ): Promise<OfflineShellWorkerResponse> => {
    const requestId = ++nextRequestId;
    const requestAuthorityEpoch = authorityEpoch;
    if (!Number.isSafeInteger(requestId)) throw new Error("Offline-shell request ID exhausted");
    const channel = platform.createMessageChannel();
    const controller = new AbortController();
    let requestEndpoint: OfflineShellMessageEndpoint | null = null;
    const response = new Promise<OfflineShellWorkerResponse>((resolve, reject) => {
      let settled = false;
      const closePorts = (): void => {
        channel.port1.onmessage = null;
        channel.port1.onmessageerror = null;
        channel.port1.close();
        try {
          channel.port2.close();
        } catch {
          // A transferred port may already be detached.
        }
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        controller.abort();
        platform.clearTimeout(timer);
        closePorts();
        reject(error);
      };
      const timer = platform.setTimeout(() => {
        fail(
          new OfflineShellServiceError(
            "shell-unavailable",
            "Offline-shell registration and request exceeded 30 seconds",
          ),
        );
      }, REQUEST_TIMEOUT_MS);
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        if (settled) return;
        try {
          requestEndpoint?.assertCurrent();
        } catch (error: unknown) {
          fail(error);
          return;
        }
        settled = true;
        controller.abort();
        platform.clearTimeout(timer);
        closePorts();
        try {
          resolve(parseOfflineShellWorkerResponse(event.data));
        } catch (error: unknown) {
          reject(
            new OfflineShellServiceError(
              "shell-contract",
              `Service worker violated the offline-shell protocol: ${message(error)}`,
            ),
          );
        }
      };
      channel.port1.onmessageerror = () => {
        fail(
          new OfflineShellServiceError(
            "shell-contract",
            "Service-worker offline-shell response was unreadable",
          ),
        );
      };
      void acquireEndpoint(controller.signal)
        .then((worker) => {
          if (settled) return;
          requestEndpoint = worker;
          worker.postMessage(createRequest(requestId), [channel.port2]);
        })
        .catch((error: unknown) => {
          fail(
            error instanceof OfflineShellServiceError
              ? error
              : new OfflineShellServiceError(
                  "shell-unavailable",
                  `Offline-shell service-worker registration failed: ${message(error)}`,
                ),
          );
        });
    });
    const parsed = await response;
    if (requestAuthorityEpoch !== authorityEpoch) {
      throw new OfflineShellServiceError(
        "shell-release-mismatch",
        "Offline-shell page control changed during the request",
      );
    }
    if (parsed.requestId !== requestId) {
      throw new OfflineShellServiceError(
        "shell-contract",
        "Service worker returned a stale offline-shell response",
      );
    }
    publish(parsed.telemetry);
    if (parsed.kind === "failure") {
      throw new OfflineShellServiceError(parsed.code, parsed.message);
    }
    return parsed;
  };

  return Object.freeze({
    async admit(inputAdmission: OfflineShellAdmission): Promise<void> {
      const expected = parseOfflineShellAdmission(inputAdmission);
      const response = await request((requestId) => ({
        admission: expected,
        kind: "admit",
        protocolVersion: OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
        requestId,
      }));
      if (
        response.kind !== "admitted" ||
        response.admission.generationId !== expected.generationId ||
        response.admission.releaseDigest !== expected.releaseDigest ||
        response.telemetry.activeGenerationId !== expected.generationId ||
        response.telemetry.activeReleaseDigest !== expected.releaseDigest ||
        response.telemetry.state !== "active"
      ) {
        throw new OfflineShellServiceError(
          "shell-release-mismatch",
          "Offline-shell launch admission does not match the expected selection",
        );
      }
    },
    async prepare(): Promise<OfflineShellGeneration> {
      const response = await request((requestId) => ({
        kind: "prepare",
        protocolVersion: OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
        requestId,
        shellEntrypointPath: input.shellEntrypointPath,
      }));
      if (
        response.kind !== "prepared" ||
        response.generation.appEntrypoint.path !== input.shellEntrypointPath ||
        response.telemetry.activeGenerationId !== response.generation.generationId ||
        response.telemetry.activeArtifactDigest !== response.generation.artifactDigest ||
        response.telemetry.activeReleaseDigest !== response.generation.releaseDigest ||
        response.telemetry.state !== "active"
      ) {
        throw new OfflineShellServiceError(
          "shell-release-mismatch",
          "Prepared offline-shell selection does not match the loaded app entrypoint",
        );
      }
      return response.generation;
    },
    snapshot: () => telemetry,
    subscribe(listener: (snapshot: OfflineShellTelemetrySnapshot) => void): () => void {
      listeners.add(listener);
      listener(telemetry);
      return () => listeners.delete(listener);
    },
  });
}

export interface OfflineShellWorkerLike {
  readonly scriptURL: string;
  readonly state: ServiceWorkerState;
  addEventListener(type: "statechange", listener: () => void): void;
  postMessage(message: unknown, transfer: readonly Transferable[]): void;
  removeEventListener(type: "statechange", listener: () => void): void;
}

export interface OfflineShellRegistrationLike {
  readonly active: OfflineShellWorkerLike | null;
  readonly installing: OfflineShellWorkerLike | null;
  readonly scope: string;
  readonly waiting: OfflineShellWorkerLike | null;
  update(): Promise<OfflineShellRegistrationLike>;
}

export interface OfflineShellWorkerContainerLike {
  readonly controller: OfflineShellWorkerLike | null;
  addEventListener(type: "controllerchange" | "message", listener: (event: Event) => void): void;
  register(
    scriptURL: string,
    options: Readonly<{ scope: string; type: "module"; updateViaCache: "none" }>,
  ): Promise<OfflineShellRegistrationLike>;
  removeEventListener(type: "controllerchange" | "message", listener: (event: Event) => void): void;
}

export interface OfflineShellBrowserEnvironment {
  readonly locationHref: string;
  readonly online: () => boolean;
  readonly serviceWorker: OfflineShellWorkerContainerLike | null;
}

export function createBrowserOfflineShellServicePlatform(
  environment: OfflineShellBrowserEnvironment = browserEnvironment(),
): OfflineShellServicePlatform {
  return Object.freeze({
    clearTimeout: (id: ReturnType<typeof globalThis.setTimeout>) => globalThis.clearTimeout(id),
    createMessageChannel: () => new MessageChannel(),
    async register(input: OfflineShellRegistrationInput): Promise<OfflineShellMessageEndpoint> {
      const container = environment.serviceWorker;
      if (container === null) {
        throw new OfflineShellServiceError(
          "shell-unavailable",
          "Chrome service-worker registration is unavailable",
          "reload",
        );
      }
      const registered = await waitForPromise(
        container.register(`/${OFFLINE_SHELL_SERVICE_WORKER_PATH}`, {
          scope: "/",
          type: "module",
          updateViaCache: "none",
        }),
        input.signal,
      );
      const rootUrl = new URL("/", environment.locationHref).href;
      const expectedScriptUrl = new URL(
        `/${OFFLINE_SHELL_SERVICE_WORKER_PATH}`,
        environment.locationHref,
      ).href;
      let registration: OfflineShellRegistrationLike;
      try {
        registration = await waitForPromise(registered.update(), input.signal);
      } catch (error: unknown) {
        if (!isOfflineUpdateNetworkFailure(error, environment.online)) throw error;
        if (
          registered.scope !== rootUrl ||
          registered.installing !== null ||
          registered.waiting !== null ||
          registered.active === null ||
          registered.active !== container.controller ||
          registered.active.state !== "activated" ||
          registered.active.scriptURL !== expectedScriptUrl
        ) {
          throw new OfflineShellServiceError(
            "shell-release-mismatch",
            "Offline worker update failed without an exact active controlling worker",
          );
        }
        registration = registered;
      }
      if (registration.scope !== rootUrl) {
        throw new OfflineShellServiceError(
          "shell-contract",
          "Service worker did not acquire the exact root scope",
        );
      }
      const worker = registration.installing ?? registration.waiting ?? registration.active;
      if (worker === null) {
        throw new OfflineShellServiceError(
          "shell-unavailable",
          "Registered service worker has no activation candidate",
        );
      }
      if (worker.scriptURL !== expectedScriptUrl) {
        throw new OfflineShellServiceError(
          "shell-contract",
          "Service worker activation candidate has the wrong script URL",
        );
      }
      let disposed = false;
      let invalidated = false;
      let endpointReady = false;
      let settleController: Readonly<{
        reject: (error: OfflineShellServiceError) => void;
        resolve: () => void;
      }> | null = null;
      const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        input.signal.removeEventListener("abort", aborted);
        container.removeEventListener("controllerchange", invalidate);
        container.removeEventListener("message", notification);
        worker.removeEventListener("statechange", stateChanged);
      };
      const invalidateEndpoint = (error: OfflineShellServiceError): void => {
        if (disposed) return;
        invalidated = true;
        input.onInvalidate(error);
      };
      const checkController = (): void => {
        if (settleController === null) return;
        if (worker.state === "redundant") {
          const current = settleController;
          settleController = null;
          current.reject(
            new OfflineShellServiceError(
              "shell-unavailable",
              "Newest service worker became redundant before controlling the page",
            ),
          );
          return;
        }
        if (worker.state === "activated" && container.controller === worker) {
          const current = settleController;
          settleController = null;
          current.resolve();
        }
      };
      const invalidate = (): void => {
        if (!endpointReady) {
          checkController();
          return;
        }
        if (container.controller !== worker) {
          invalidateEndpoint(
            new OfflineShellServiceError(
              "shell-release-mismatch",
              "Offline-shell page lost control by the exact activated service worker",
            ),
          );
        }
      };
      const stateChanged = (): void => {
        if (!endpointReady) {
          checkController();
          return;
        }
        if (worker.state !== "activated") {
          invalidateEndpoint(
            new OfflineShellServiceError(
              "shell-unavailable",
              "Offline-shell controlling service worker left the activated state",
            ),
          );
        }
      };
      const notification = (event: Event): void => {
        const messageEvent = event as MessageEvent<unknown>;
        if (messageEvent.source !== (worker as unknown as MessageEventSource)) return;
        input.onNotification(messageEvent.data);
      };
      const aborted = (): void => {
        const current = settleController;
        if (current === null) return;
        settleController = null;
        current.reject(
          new OfflineShellServiceError(
            "shell-unavailable",
            "Service-worker control acquisition timed out",
          ),
        );
      };
      container.addEventListener("controllerchange", invalidate);
      container.addEventListener("message", notification);
      worker.addEventListener("statechange", stateChanged);
      try {
        await new Promise<void>((resolve, reject) => {
          settleController = { reject, resolve };
          input.signal.addEventListener("abort", aborted, { once: true });
          if (input.signal.aborted) aborted();
          else checkController();
        });
      } catch (error: unknown) {
        dispose();
        throw error;
      }
      input.signal.removeEventListener("abort", aborted);
      if (worker.state !== "activated" || container.controller !== worker || invalidated) {
        dispose();
        throw new OfflineShellServiceError(
          "shell-unavailable",
          "Newest service worker changed before exact page control was established",
        );
      }
      endpointReady = true;
      const assertCurrent = (): void => {
        if (disposed) {
          throw new OfflineShellServiceError(
            "shell-unavailable",
            "Offline-shell service-worker endpoint was disposed",
          );
        }
        if (worker.state !== "activated" || container.controller !== worker) {
          const error = new OfflineShellServiceError(
            "shell-release-mismatch",
            "Offline-shell endpoint no longer has exact activated page control",
          );
          invalidateEndpoint(error);
          throw error;
        }
      };
      return Object.freeze({
        assertCurrent,
        dispose,
        postMessage(messageValue: OfflineShellWorkerRequest, transfer: readonly Transferable[]) {
          assertCurrent();
          worker.postMessage(messageValue, transfer);
        },
      });
    },
    setTimeout: (callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs),
  });
}

function waitForPromise<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      new OfflineShellServiceError("shell-unavailable", "Offline-shell request was cancelled"),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => {
      cleanup();
      reject(
        new OfflineShellServiceError("shell-unavailable", "Offline-shell request was cancelled"),
      );
    };
    const cleanup = (): void => signal.removeEventListener("abort", aborted);
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function browserEnvironment(): OfflineShellBrowserEnvironment {
  return Object.freeze({
    locationHref: location.href,
    online: () => navigator.onLine,
    serviceWorker:
      "serviceWorker" in navigator
        ? (navigator.serviceWorker as unknown as OfflineShellWorkerContainerLike)
        : null,
  });
}

function isOfflineUpdateNetworkFailure(error: unknown, online: () => boolean): boolean {
  return error instanceof TypeError && !online();
}

function message(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}
