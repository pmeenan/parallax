import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserOfflineShellServicePlatform,
  createOfflineShellService,
  type OfflineShellBrowserEnvironment,
  type OfflineShellGeneration,
  type OfflineShellMessageEndpoint,
  type OfflineShellRegistrationInput,
  type OfflineShellRegistrationLike,
  OfflineShellServiceError,
  type OfflineShellServicePlatform,
  type OfflineShellTelemetrySnapshot,
  type OfflineShellWorkerContainerLike,
  type OfflineShellWorkerLike,
  type OfflineShellWorkerRequest,
} from "../src/index";

const ARTIFACT_DIGEST = "a".repeat(64);
const RELEASE_DIGEST = "b".repeat(64);
const RESOURCE_DIGEST = "c".repeat(64);
const APP_PATH = "immutable/app-entry.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("offline shell service", () => {
  it("registers once and validates every prepared generation response", async () => {
    let registerCount = 0;
    const endpoint = responseEndpoint();
    const service = createOfflineShellService({
      platform: testPlatform(async () => {
        registerCount += 1;
        return endpoint;
      }),
      shellEntrypointPath: APP_PATH,
    });

    await expect(service.prepare()).resolves.toEqual(generation());
    await expect(service.prepare()).resolves.toEqual(generation());
    expect(registerCount).toBe(1);
    expect(service.snapshot()).toEqual(telemetry());
  });

  it("admits only the exact active generation and release", async () => {
    const service = createOfflineShellService({
      platform: testPlatform(async () =>
        responseEndpoint((request) =>
          request.kind === "admit"
            ? {
                admission: request.admission,
                kind: "admitted",
                protocolVersion: 1,
                requestId: request.requestId,
                telemetry: telemetry(),
              }
            : {
                generation: generation(),
                kind: "prepared",
                protocolVersion: 1,
                requestId: request.requestId,
                telemetry: telemetry(),
              },
        ),
      ),
      shellEntrypointPath: APP_PATH,
    });

    await expect(
      service.admit({
        generationId: `${ARTIFACT_DIGEST}:${RELEASE_DIGEST}`,
        releaseDigest: RELEASE_DIGEST,
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.admit({
        generationId: `${"d".repeat(64)}:${RELEASE_DIGEST}`,
        releaseDigest: RELEASE_DIGEST,
      }),
    ).rejects.toMatchObject({ code: "shell-release-mismatch" });
  });

  it("bounds registration and preparation together to 30 seconds", async () => {
    vi.useFakeTimers();
    const service = createOfflineShellService({
      platform: testPlatform(() => new Promise(() => undefined)),
      shellEntrypointPath: APP_PATH,
    });

    const preparing = service.prepare();
    const rejected = expect(preparing).rejects.toMatchObject({
      code: "shell-unavailable",
      message: "Offline-shell registration and request exceeded 30 seconds",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
  });

  it("allows retry after a transient registration failure", async () => {
    let registerCount = 0;
    const service = createOfflineShellService({
      platform: testPlatform(() => {
        registerCount += 1;
        return registerCount === 1
          ? Promise.reject(new Error("registration unavailable"))
          : Promise.resolve(responseEndpoint());
      }),
      shellEntrypointPath: APP_PATH,
    });

    await expect(service.prepare()).rejects.toMatchObject({
      code: "shell-unavailable",
    });
    await expect(service.prepare()).resolves.toEqual(generation());
    expect(registerCount).toBe(2);
  });

  it("rejects a stale service-worker response", async () => {
    const service = createOfflineShellService({
      platform: testPlatform(async () =>
        responseEndpoint((request) => ({
          generation: generation(),
          kind: "prepared",
          protocolVersion: 1,
          requestId: request.requestId + 1,
          telemetry: telemetry(),
        })),
      ),
      shellEntrypointPath: APP_PATH,
    });

    await expect(service.prepare()).rejects.toMatchObject({
      code: "shell-contract",
      message: "Service worker returned a stale offline-shell response",
    });
  });

  it("requires failure responses to match durable failed telemetry exactly", async () => {
    const diagnostic = "selection changed";
    const service = createOfflineShellService({
      platform: testPlatform(async () =>
        responseEndpoint((request) => ({
          code: "shell-release-mismatch",
          kind: "failure",
          message: diagnostic,
          protocolVersion: 1,
          requestId: request.requestId,
          telemetry: {
            ...failedTelemetry("shell-release-mismatch", diagnostic),
            failureMessage: "different diagnostic",
          },
        })),
      ),
      shellEntrypointPath: APP_PATH,
    });

    await expect(service.prepare()).rejects.toMatchObject({
      code: "shell-contract",
      message: expect.stringMatching(/does not match its telemetry/),
    });
  });

  it("correlates overlapping prepares when responses arrive in reverse order", async () => {
    const requestIds: number[] = [];
    const endpoint: OfflineShellMessageEndpoint = Object.freeze({
      assertCurrent() {},
      dispose() {},
      postMessage(message: OfflineShellWorkerRequest, transfer: readonly Transferable[]) {
        const port = transfer[0];
        if (!(port instanceof MessagePort)) throw new Error("response port is missing");
        requestIds.push(message.requestId);
        globalThis.setTimeout(
          () =>
            port.postMessage({
              generation: generation(),
              kind: "prepared",
              protocolVersion: 1,
              requestId: message.requestId,
              telemetry: telemetry(),
            }),
          message.requestId === 1 ? 10 : 0,
        );
      },
    });
    const service = createOfflineShellService({
      platform: testPlatform(async () => endpoint),
      shellEntrypointPath: APP_PATH,
    });

    const first = service.prepare();
    const second = service.prepare();

    await expect(second).resolves.toEqual(generation());
    await expect(first).resolves.toEqual(generation());
    expect(requestIds).toEqual([1, 2]);
  });

  it("isolates an overlapping timeout from a later successful request", async () => {
    vi.useFakeTimers();
    const endpoint: OfflineShellMessageEndpoint = Object.freeze({
      assertCurrent() {},
      dispose() {},
      postMessage(message: OfflineShellWorkerRequest, transfer: readonly Transferable[]) {
        if (message.requestId === 1) return;
        const port = transfer[0];
        if (!(port instanceof MessagePort)) throw new Error("response port is missing");
        port.postMessage({
          generation: generation(),
          kind: "prepared",
          protocolVersion: 1,
          requestId: message.requestId,
          telemetry: telemetry(),
        });
      },
    });
    const service = createOfflineShellService({
      platform: testPlatform(async () => endpoint),
      shellEntrypointPath: APP_PATH,
    });

    const first = service.prepare();
    const firstRejected = expect(first).rejects.toMatchObject({
      code: "shell-unavailable",
      message: "Offline-shell registration and request exceeded 30 seconds",
    });
    await expect(service.prepare()).resolves.toEqual(generation());
    await vi.advanceTimersByTimeAsync(30_000);
    await firstRejected;
    await expect(service.prepare()).resolves.toEqual(generation());
  });

  it("publishes selection changes and reacquires an invalidated endpoint", async () => {
    const registrations: OfflineShellRegistrationInput[] = [];
    let registerCount = 0;
    const service = createOfflineShellService({
      platform: testPlatform(async (input) => {
        registerCount += 1;
        registrations.push(input);
        return responseEndpoint();
      }),
      shellEntrypointPath: APP_PATH,
    });
    const observed: OfflineShellTelemetrySnapshot[] = [];
    service.subscribe((snapshot) => observed.push(snapshot));

    await service.prepare();
    registrations[0]?.onNotification({
      kind: "selection-changed",
      protocolVersion: 1,
      telemetry: telemetry("d".repeat(64), "e".repeat(64)),
    });
    expect(observed.at(-1)).toMatchObject({
      activeGenerationId: `${"d".repeat(64)}:${"e".repeat(64)}`,
      activeReleaseDigest: "e".repeat(64),
    });

    registrations[0]?.onInvalidate(
      new OfflineShellServiceError("shell-release-mismatch", "controller changed"),
    );
    await service.prepare();
    expect(registerCount).toBe(2);
    expect(service.snapshot()).toMatchObject({
      failureCode: null,
      state: "active",
    });
  });

  it("accepts notifications only from the exact activated endpoint worker", async () => {
    const worker = new FakeWorker("activated", respondToOfflineShellRequest);
    const unrelated = new FakeWorker("activated");
    const container = new FakeContainer(
      fakeRegistration({ active: worker, installing: null, waiting: null }),
    );
    const service = createOfflineShellService({
      platform: createBrowserOfflineShellServicePlatform(browserTestEnvironment(container)),
      shellEntrypointPath: APP_PATH,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await service.prepare();
    const original = service.snapshot();
    const validLooking = {
      kind: "selection-changed",
      protocolVersion: 1,
      telemetry: telemetry("d".repeat(64), "e".repeat(64)),
    };

    container.emit("message", workerMessage(unrelated, validLooking));
    container.emit("message", workerMessage(unrelated, { malformed: true }));
    expect(service.snapshot()).toEqual(original);
    expect(consoleError).not.toHaveBeenCalled();
    expect(container.registerCount).toBe(1);

    container.emit("message", workerMessage(worker, { malformed: true }));
    expect(consoleError).toHaveBeenCalledOnce();
    await service.prepare();
    expect(container.registerCount).toBe(2);
    consoleError.mockRestore();
  });

  it("rejects an initially null controller at the existing request bound and cleans listeners", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker("activated");
    const container = new FakeContainer(
      fakeRegistration({ active: worker, installing: null, waiting: null }),
      null,
    );
    const service = createOfflineShellService({
      platform: createBrowserOfflineShellServicePlatform(browserTestEnvironment(container)),
      shellEntrypointPath: APP_PATH,
    });

    const preparing = service.prepare();
    const rejected = expect(preparing).rejects.toMatchObject({
      code: "shell-unavailable",
      message: "Offline-shell registration and request exceeded 30 seconds",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    await Promise.resolve();

    expect(container.listenerCount()).toBe(0);
    expect(worker.listenerCount()).toBe(0);
  });

  it("waits for an old controller to be replaced by the exact activated candidate", async () => {
    const oldWorker = new FakeWorker("activated");
    const candidate = new FakeWorker("activated");
    const container = new FakeContainer(
      fakeRegistration({ active: candidate, installing: null, waiting: null }),
      oldWorker,
    );
    const platform = createBrowserOfflineShellServicePlatform(browserTestEnvironment(container));
    const hooks = registrationInput();
    const registering = platform.register(hooks);
    let settled = false;
    void registering.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    container.setController(candidate);
    const endpoint = await registering;
    expect(hooks.onInvalidate).not.toHaveBeenCalled();
    endpoint.dispose();
    expect(container.listenerCount()).toBe(0);
    expect(candidate.listenerCount()).toBe(0);
  });

  it.each([
    ["null", null],
    ["different", new FakeWorker("activated")],
  ] as const)("invalidates exact authority when the controller becomes %s", async (_label, next) => {
    const worker = new FakeWorker("activated");
    const container = new FakeContainer(
      fakeRegistration({ active: worker, installing: null, waiting: null }),
    );
    const hooks = registrationInput();
    const endpoint = await createBrowserOfflineShellServicePlatform(
      browserTestEnvironment(container),
    ).register(hooks);

    container.setController(next);

    expect(hooks.onInvalidate).toHaveBeenCalledOnce();
    expect(hooks.onInvalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "shell-release-mismatch",
        message: expect.stringMatching(/lost control/),
      }),
    );
    endpoint.dispose();
    expect(container.listenerCount()).toBe(0);
    expect(worker.listenerCount()).toBe(0);
  });

  it("rejects a response that races exact-controller invalidation", async () => {
    let responsePort: MessagePort | null = null;
    let request: OfflineShellWorkerRequest | null = null;
    const worker = new FakeWorker("activated", (message, transfer) => {
      request = message as OfflineShellWorkerRequest;
      const candidate = transfer[0];
      if (!(candidate instanceof MessagePort)) throw new Error("response port is missing");
      responsePort = candidate;
    });
    const container = new FakeContainer(
      fakeRegistration({ active: worker, installing: null, waiting: null }),
    );
    const service = createOfflineShellService({
      platform: createBrowserOfflineShellServicePlatform(browserTestEnvironment(container)),
      shellEntrypointPath: APP_PATH,
    });
    const preparing = service.prepare();
    await vi.waitFor(() => expect(responsePort).not.toBeNull());

    container.controller = null;
    if ((request as unknown) === null || (responsePort as unknown) === null) {
      throw new Error("request was not captured");
    }
    const capturedRequest = request as unknown as OfflineShellWorkerRequest;
    const capturedPort = responsePort as unknown as MessagePort;
    capturedPort.postMessage({
      generation: generation(),
      kind: "prepared",
      protocolVersion: 1,
      requestId: capturedRequest.requestId,
      telemetry: telemetry(),
    });

    await expect(preparing).rejects.toMatchObject({
      code: "shell-release-mismatch",
      message: "Offline-shell endpoint no longer has exact activated page control",
    });
    expect(service.snapshot()).toMatchObject({
      failureCode: "shell-release-mismatch",
      state: "failed",
    });
    expect(container.listenerCount()).toBe(0);
    expect(worker.listenerCount()).toBe(0);
  });

  it.each([
    "installing",
    "waiting",
  ] as const)("waits for the newest %s worker instead of messaging an old active worker", async (slot) => {
    const oldWorker = new FakeWorker("activated");
    const newest = new FakeWorker(slot === "installing" ? "installing" : "installed");
    const registration = fakeRegistration({
      active: oldWorker,
      installing: slot === "installing" ? newest : null,
      waiting: slot === "waiting" ? newest : null,
    });
    const container = new FakeContainer(registration);
    const platform = createBrowserOfflineShellServicePlatform(browserTestEnvironment(container));
    const hooks = registrationInput();
    const registered = platform.register(hooks);
    await Promise.resolve();

    expect(oldWorker.messages).toHaveLength(0);
    newest.transition("activated");
    container.setController(newest);
    const endpoint = await registered;
    endpoint.postMessage(
      {
        kind: "snapshot",
        protocolVersion: 1,
        requestId: 1,
      },
      [],
    );
    expect(newest.messages).toHaveLength(1);
    expect(oldWorker.messages).toHaveLength(0);
    container.setController(null);
    expect(hooks.onInvalidate).toHaveBeenCalledTimes(1);
    endpoint.dispose();
    expect(container.listenerCount()).toBe(0);
    expect(newest.listenerCount()).toBe(0);
  });

  it("runs the stable worker update algorithm before choosing the newest worker", async () => {
    const oldWorker = new FakeWorker("activated");
    const newest = new FakeWorker("installing");
    const updated = fakeRegistration({
      active: oldWorker,
      installing: newest,
      waiting: null,
    });
    let updateCount = 0;
    const registered = fakeRegistration(
      {
        active: oldWorker,
        installing: null,
        waiting: null,
      },
      async () => {
        updateCount += 1;
        return updated;
      },
    );
    const container = new FakeContainer(registered);
    const platform = createBrowserOfflineShellServicePlatform(browserTestEnvironment(container));
    const endpointPromise = platform.register(registrationInput());

    await vi.waitFor(() => expect(updateCount).toBe(1));
    expect(oldWorker.messages).toHaveLength(0);
    newest.transition("activated");
    container.setController(newest);
    const endpoint = await endpointPromise;
    endpoint.postMessage({ kind: "snapshot", protocolVersion: 1, requestId: 1 }, []);
    expect(newest.messages).toHaveLength(1);
    expect(oldWorker.messages).toHaveLength(0);
    endpoint.dispose();
  });

  it("uses live online state at update failure and reuses an exact active controller", async () => {
    let online = true;
    const readOnline = vi.fn(() => online);
    const worker = new FakeWorker("activated", respondToOfflineShellRequest);
    const container = new FakeContainer(
      fakeRegistration({ active: worker, installing: null, waiting: null }, () => {
        online = false;
        return Promise.reject(new TypeError("offline"));
      }),
    );
    const service = createOfflineShellService({
      platform: createBrowserOfflineShellServicePlatform(
        browserTestEnvironment(container, readOnline),
      ),
      shellEntrypointPath: APP_PATH,
    });

    await expect(service.prepare()).resolves.toEqual(generation());
    expect(readOnline).toHaveBeenCalledOnce();
    expect(service.snapshot()).toEqual(telemetry());
    expect(worker.messages).toHaveLength(1);
  });

  it("does not reuse an active controller when live online state changes before update failure", async () => {
    let online = false;
    const readOnline = vi.fn(() => online);
    const updateError = new TypeError("network failed");
    const worker = new FakeWorker("activated");
    const container = new FakeContainer(
      fakeRegistration({ active: worker, installing: null, waiting: null }, () => {
        online = true;
        return Promise.reject(updateError);
      }),
    );

    await expect(
      createBrowserOfflineShellServicePlatform(
        browserTestEnvironment(container, readOnline),
      ).register(registrationInput()),
    ).rejects.toBe(updateError);
    expect(readOnline).toHaveBeenCalledOnce();
    expect(container.listenerCount()).toBe(0);
    expect(worker.listenerCount()).toBe(0);
  });

  it.each([
    ["null", null],
    ["different", new FakeWorker("activated")],
  ] as const)("rejects offline update fallback when the existing controller is %s", async (_label, controller) => {
    const worker = new FakeWorker("activated");
    const container = new FakeContainer(
      fakeRegistration({ active: worker, installing: null, waiting: null }, () =>
        Promise.reject(new TypeError("offline")),
      ),
      controller,
    );

    await expect(
      createBrowserOfflineShellServicePlatform(browserTestEnvironment(container, false)).register(
        registrationInput(),
      ),
    ).rejects.toMatchObject({
      code: "shell-release-mismatch",
      message: "Offline worker update failed without an exact active controlling worker",
    });
    expect(container.listenerCount()).toBe(0);
    expect(worker.listenerCount()).toBe(0);
  });

  it.each([
    ["offline non-network error", false, new Error("update contract failed")],
    ["online network-shaped error", true, new TypeError("network failed")],
  ] as const)("does not suppress an %s", async (_label, online, updateError) => {
    const worker = new FakeWorker("activated");
    const container = new FakeContainer(
      fakeRegistration({ active: worker, installing: null, waiting: null }, () =>
        Promise.reject(updateError),
      ),
    );

    await expect(
      createBrowserOfflineShellServicePlatform(browserTestEnvironment(container, online)).register(
        registrationInput(),
      ),
    ).rejects.toBe(updateError);
  });

  it("does not read online state or suppress a non-TypeError update failure", async () => {
    const updateError = new Error("update contract failed");
    const readOnline = vi.fn(() => false);
    const worker = new FakeWorker("activated");
    const container = new FakeContainer(
      fakeRegistration({ active: worker, installing: null, waiting: null }, () =>
        Promise.reject(updateError),
      ),
    );

    await expect(
      createBrowserOfflineShellServicePlatform(
        browserTestEnvironment(container, readOnline),
      ).register(registrationInput()),
    ).rejects.toBe(updateError);
    expect(readOnline).not.toHaveBeenCalled();
  });

  it("fails closed when the explicit stable-worker update rejects", async () => {
    const worker = new FakeWorker("activated");
    const container = new FakeContainer(
      fakeRegistration({ active: worker, installing: null, waiting: null }, () =>
        Promise.reject(new Error("update failed")),
      ),
    );
    const platform = createBrowserOfflineShellServicePlatform(browserTestEnvironment(container));

    await expect(platform.register(registrationInput())).rejects.toThrow(/update failed/);
    expect(container.listenerCount()).toBe(0);
    expect(worker.listenerCount()).toBe(0);
  });

  it("applies the outer request timeout while the stable-worker update is pending", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker("activated");
    const container = new FakeContainer(
      fakeRegistration(
        { active: worker, installing: null, waiting: null },
        () => new Promise(() => undefined),
      ),
    );
    const service = createOfflineShellService({
      platform: createBrowserOfflineShellServicePlatform(browserTestEnvironment(container)),
      shellEntrypointPath: APP_PATH,
    });

    const preparing = service.prepare();
    const rejected = expect(preparing).rejects.toMatchObject({
      code: "shell-unavailable",
      message: "Offline-shell registration and request exceeded 30 seconds",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(container.listenerCount()).toBe(0);
    expect(worker.listenerCount()).toBe(0);
  });

  it("rejects a redundant replacement, cleans activation listeners, and succeeds on retry", async () => {
    const oldWorker = new FakeWorker("activated");
    const failed = new FakeWorker("installing");
    const container = new FakeContainer(
      fakeRegistration({
        active: oldWorker,
        installing: failed,
        waiting: null,
      }),
    );
    const platform = createBrowserOfflineShellServicePlatform(browserTestEnvironment(container));
    const first = platform.register(registrationInput());
    await vi.waitFor(() => expect(failed.listenerCount()).toBe(1));
    failed.transition("redundant");
    await expect(first).rejects.toMatchObject({
      code: "shell-unavailable",
    });
    expect(failed.listenerCount()).toBe(0);

    const replacement = new FakeWorker("activated");
    container.registration = fakeRegistration({
      active: replacement,
      installing: null,
      waiting: null,
    });
    container.setController(replacement);
    const endpoint = await platform.register(registrationInput());
    expect(container.registerCount).toBe(2);
    endpoint.dispose();
    expect(container.listenerCount()).toBe(0);
    expect(replacement.listenerCount()).toBe(0);
  });

  it("catches redundancy after permanent listener install and before final state recheck", async () => {
    const worker = new FakeWorker("activated");
    worker.onStateListenerAdded = () => {
      worker.onStateListenerAdded = null;
      worker.transition("redundant");
    };
    const container = new FakeContainer(
      fakeRegistration({ active: worker, installing: null, waiting: null }),
    );
    const platform = createBrowserOfflineShellServicePlatform(browserTestEnvironment(container));

    await expect(platform.register(registrationInput())).rejects.toMatchObject({
      code: "shell-unavailable",
      message: "Newest service worker became redundant before controlling the page",
    });
    expect(container.listenerCount()).toBe(0);
    expect(worker.listenerCount()).toBe(0);
  });

  it("catches an abort racing permanent listener installation and cleans every listener", async () => {
    const worker = new FakeWorker("activated");
    const container = new FakeContainer(
      fakeRegistration({ active: worker, installing: null, waiting: null }),
    );
    const controller = new AbortController();
    worker.onStateListenerAdded = () => {
      worker.onStateListenerAdded = null;
      controller.abort();
    };
    const hooks = {
      ...registrationInput(),
      signal: controller.signal,
    };

    await expect(
      createBrowserOfflineShellServicePlatform(browserTestEnvironment(container)).register(hooks),
    ).rejects.toMatchObject({
      code: "shell-unavailable",
      message: "Service-worker control acquisition timed out",
    });
    expect(container.listenerCount()).toBe(0);
    expect(worker.listenerCount()).toBe(0);
  });

  it("synchronously rejects endpoint use after silent controller replacement or disposal", async () => {
    const worker = new FakeWorker("activated");
    const replacement = new FakeWorker("activated");
    const container = new FakeContainer(
      fakeRegistration({ active: worker, installing: null, waiting: null }),
    );
    const hooks = registrationInput();
    const endpoint = await createBrowserOfflineShellServicePlatform(
      browserTestEnvironment(container),
    ).register(hooks);

    container.controller = replacement;
    expect(() =>
      endpoint.postMessage({ kind: "snapshot", protocolVersion: 1, requestId: 1 }, []),
    ).toThrow(/no longer has exact activated page control/);
    expect(worker.messages).toHaveLength(0);
    expect(hooks.onInvalidate).toHaveBeenCalledOnce();

    endpoint.dispose();
    expect(() =>
      endpoint.postMessage({ kind: "snapshot", protocolVersion: 1, requestId: 2 }, []),
    ).toThrow(/endpoint was disposed/);
  });

  it("applies the outer request timeout to activation and removes activation listeners", async () => {
    vi.useFakeTimers();
    const newest = new FakeWorker("installing");
    const container = new FakeContainer(
      fakeRegistration({
        active: new FakeWorker("activated"),
        installing: newest,
        waiting: null,
      }),
    );
    const service = createOfflineShellService({
      platform: createBrowserOfflineShellServicePlatform(browserTestEnvironment(container)),
      shellEntrypointPath: APP_PATH,
    });

    const preparing = service.prepare();
    const rejected = expect(preparing).rejects.toMatchObject({
      code: "shell-unavailable",
      message: "Offline-shell registration and request exceeded 30 seconds",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    await Promise.resolve();

    expect(newest.listenerCount()).toBe(0);
    expect(container.listenerCount()).toBe(0);
  });
});

function testPlatform(
  register: (input: OfflineShellRegistrationInput) => Promise<OfflineShellMessageEndpoint>,
): OfflineShellServicePlatform {
  return Object.freeze({
    clearTimeout: (id: ReturnType<typeof globalThis.setTimeout>) => globalThis.clearTimeout(id),
    createMessageChannel: () => new MessageChannel(),
    register,
    setTimeout: (callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs),
  });
}

function responseEndpoint(
  createResponse: (request: OfflineShellWorkerRequest) => unknown = (request) => ({
    generation: generation(),
    kind: "prepared",
    protocolVersion: 1,
    requestId: request.requestId,
    telemetry: telemetry(),
  }),
): OfflineShellMessageEndpoint {
  return Object.freeze({
    assertCurrent() {},
    dispose() {},
    postMessage(message: OfflineShellWorkerRequest, transfer: readonly Transferable[]): void {
      const port = transfer[0];
      if (!(port instanceof MessagePort)) throw new Error("response port is missing");
      port.postMessage(createResponse(message));
    },
  });
}

function respondToOfflineShellRequest(message: unknown, transfer: readonly Transferable[]): void {
  const request = message as OfflineShellWorkerRequest;
  const port = transfer[0];
  if (!(port instanceof MessagePort)) throw new Error("response port is missing");
  port.postMessage(
    request.kind === "admit"
      ? {
          admission: request.admission,
          kind: "admitted",
          protocolVersion: 1,
          requestId: request.requestId,
          telemetry: telemetry(),
        }
      : {
          generation: generation(),
          kind: "prepared",
          protocolVersion: 1,
          requestId: request.requestId,
          telemetry: telemetry(),
        },
  );
}

function workerMessage(source: OfflineShellWorkerLike, data: unknown): Event {
  return { data, source } as unknown as Event;
}

function generation(): OfflineShellGeneration {
  const resources = [
    resource("index.html", "text/html"),
    resource("build-manifest.json", "application/json"),
    resource("install-manifest.json", "application/json"),
    resource(APP_PATH, "application/javascript"),
    resource("immutable/engine-entry.js", "application/javascript"),
    resource("service-worker.js", "application/javascript"),
  ];
  return Object.freeze({
    appEntrypoint: identity(APP_PATH),
    artifactDigest: ARTIFACT_DIGEST,
    buildManifestSchemaVersion: 14,
    engineArtifact: identity("immutable/engine-entry.js"),
    generationId: `${ARTIFACT_DIGEST}:${RELEASE_DIGEST}`,
    installManifestSchemaVersion: 1,
    releaseDigest: RELEASE_DIGEST,
    resources: Object.freeze(resources),
    saveSchemaVersion: 1,
    schemaVersion: 1,
    serviceWorker: Object.freeze({
      ...identity("service-worker.js"),
      path: "service-worker.js",
    }),
  });
}

function identity(path: string): Readonly<{ bytes: number; path: string; sha256: string }> {
  return Object.freeze({ bytes: 1, path, sha256: RESOURCE_DIGEST });
}

function resource(path: string, mimeType: string) {
  return Object.freeze({ ...identity(path), mimeType });
}

function telemetry(
  artifactDigest = ARTIFACT_DIGEST,
  releaseDigest = RELEASE_DIGEST,
): OfflineShellTelemetrySnapshot {
  return Object.freeze({
    activateCount: 1,
    activeArtifactDigest: artifactDigest,
    activeGenerationId: `${artifactDigest}:${releaseDigest}`,
    activeReleaseDigest: releaseDigest,
    cacheHitCount: 0,
    cacheMissCount: 0,
    candidateGenerationId: null,
    failureCode: null,
    failureCount: 0,
    failureMessage: null,
    mixedGenerationCount: 0,
    prepareCount: 1,
    previousGenerationId: null,
    rollbackCount: 0,
    schemaVersion: 2,
    state: "active",
    verifiedBytes: 1,
    verifyCount: 1,
    verifyDurationMs: 1,
    verifyHighWaterMs: 1,
  });
}

function failedTelemetry(
  code: "shell-contract" | "shell-release-mismatch" | "shell-unavailable",
  diagnostic: string,
): OfflineShellTelemetrySnapshot {
  return Object.freeze({
    ...telemetry(),
    failureCode: code,
    failureCount: 1,
    failureMessage: diagnostic,
    state: "failed",
  });
}

class FakeWorker implements OfflineShellWorkerLike {
  public readonly messages: unknown[] = [];
  public readonly transfers: (readonly Transferable[])[] = [];
  public readonly scriptURL = "https://parallax.test/service-worker.js";
  public onStateListenerAdded: (() => void) | null = null;
  public state: ServiceWorkerState;
  private readonly listeners = new Set<() => void>();
  private readonly responder: (message: unknown, transfer: readonly Transferable[]) => void;

  public constructor(
    state: ServiceWorkerState,
    responder: (message: unknown, transfer: readonly Transferable[]) => void = () => undefined,
  ) {
    this.state = state;
    this.responder = responder;
  }

  public addEventListener(_type: "statechange", listener: () => void): void {
    this.listeners.add(listener);
    this.onStateListenerAdded?.();
  }

  public listenerCount(): number {
    return this.listeners.size;
  }

  public postMessage(message: unknown, _transfer: readonly Transferable[]): void {
    this.messages.push(message);
    this.transfers.push(_transfer);
    this.responder(message, _transfer);
  }

  public removeEventListener(_type: "statechange", listener: () => void): void {
    this.listeners.delete(listener);
  }

  public transition(state: ServiceWorkerState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeContainer implements OfflineShellWorkerContainerLike {
  public controller: OfflineShellWorkerLike | null;
  public registerCount = 0;
  public registration: OfflineShellRegistrationLike;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  public constructor(
    registration: OfflineShellRegistrationLike,
    controller: OfflineShellWorkerLike | null | undefined = undefined,
  ) {
    this.registration = registration;
    this.controller = controller === undefined ? registration.active : controller;
  }

  public addEventListener(
    type: "controllerchange" | "message",
    listener: (event: Event) => void,
  ): void {
    let listeners = this.listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  public listenerCount(): number {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }

  public emit(type: "controllerchange" | "message", event: Event = new Event(type)): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  public register(): Promise<OfflineShellRegistrationLike> {
    this.registerCount += 1;
    return Promise.resolve(this.registration);
  }

  public removeEventListener(
    type: "controllerchange" | "message",
    listener: (event: Event) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  public setController(controller: OfflineShellWorkerLike | null): void {
    this.controller = controller;
    this.emit("controllerchange");
  }
}

function fakeRegistration(
  input: Readonly<{
    active: OfflineShellWorkerLike | null;
    installing: OfflineShellWorkerLike | null;
    waiting: OfflineShellWorkerLike | null;
  }>,
  update?: () => Promise<OfflineShellRegistrationLike>,
): OfflineShellRegistrationLike {
  let registration!: OfflineShellRegistrationLike;
  registration = {
    ...input,
    scope: "https://parallax.test/",
    update: update ?? (() => Promise.resolve(registration)),
  };
  return registration;
}

function browserTestEnvironment(
  serviceWorker: OfflineShellWorkerContainerLike,
  online: boolean | (() => boolean) = true,
): OfflineShellBrowserEnvironment {
  return Object.freeze({
    locationHref: "https://parallax.test/index.html",
    online: typeof online === "boolean" ? () => online : online,
    serviceWorker,
  });
}

function registrationInput(): OfflineShellRegistrationInput {
  return Object.freeze({
    onInvalidate: vi.fn(),
    onNotification: vi.fn(),
    signal: new AbortController().signal,
  });
}
