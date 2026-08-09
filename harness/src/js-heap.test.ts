import type { CDPSession } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invalidateJsHeapMetric,
  type JsHeapSample,
  JsHeapValidationError,
  nextJsHeapSamplingDeadlineMs,
  prepareJsHeapSampler,
  summarizeJsHeapSamples,
} from "./js-heap.js";

const workerUrl = "http://127.0.0.1:8000/immutable/render-worker-hash.js";
const secondaryWorkerUrl = "http://127.0.0.1:8000/immutable/secondary-worker-hash.js";

describe("all-realm JS heap sampler", () => {
  afterEach(() => vi.useRealTimers());

  it("sums near-concurrent window and worker isolates and retains their breakdown", async () => {
    const browser = new FakeBrowserSession(workerUrl, [heapUsage(50, 60), heapUsage(45, 70)], {
      pageUrl: "http://127.0.0.1:8000/",
    });
    const page = new FakePageSession([heapUsage(20, 30), heapUsage(15, 25)], {
      pageUrl: "http://127.0.0.1:8000/",
    });
    const sampler = await prepareJsHeapSampler(
      asCdp(browser),
      asCdp(page),
      "http://127.0.0.1:8000/",
      workerUrl,
      60_000,
    );

    sampler.start();
    const evidence = await sampler.finish();

    expect(evidence.highWaterUsedSizeBytes).toBe(70);
    expect(evidence.samples).toHaveLength(2);
    expect(evidence.samples[1]?.realms).toMatchObject([
      {
        kind: "window",
        url: "http://127.0.0.1:8000/",
        usage: {
          backingStorageSizeBytes: 1,
          embedderHeapUsedSizeBytes: 2,
          totalSizeBytes: 25,
          usedSizeBytes: 15,
        },
      },
      {
        kind: "dedicated-worker",
        url: workerUrl,
        usage: {
          backingStorageSizeBytes: 1,
          embedderHeapUsedSizeBytes: 2,
          totalSizeBytes: 70,
          usedSizeBytes: 45,
        },
      },
    ]);
    expect(browser.attachments).toEqual([{ flatten: false, targetId: "worker-0" }]);
    expect(browser.detached).toBe(true);
  });

  it("samples multiple expected workers alongside the window", async () => {
    const browser = new FakeBrowserSession(
      [workerUrl, secondaryWorkerUrl],
      [
        [heapUsage(50, 60), heapUsage(45, 70)],
        [heapUsage(30, 40), heapUsage(35, 50)],
      ],
      { pageUrl: "http://127.0.0.1:8000/" },
    );
    const page = new FakePageSession([heapUsage(20, 30), heapUsage(15, 25)], {
      pageUrl: "http://127.0.0.1:8000/",
    });
    const sampler = await prepareJsHeapSampler(
      asCdp(browser),
      asCdp(page),
      "http://127.0.0.1:8000/",
      [workerUrl, secondaryWorkerUrl],
      60_000,
    );

    sampler.start();
    const evidence = await sampler.finish();

    expect(evidence.highWaterUsedSizeBytes).toBe(100);
    expect(evidence.samples[1]?.realms).toMatchObject([
      { kind: "window", url: "http://127.0.0.1:8000/", usage: { usedSizeBytes: 15 } },
      { kind: "dedicated-worker", url: workerUrl, usage: { usedSizeBytes: 45 } },
      { kind: "dedicated-worker", url: secondaryWorkerUrl, usage: { usedSizeBytes: 35 } },
    ]);
    expect(browser.attachments).toEqual([
      { flatten: false, targetId: "worker-0" },
      { flatten: false, targetId: "worker-1" },
    ]);
    expect(browser.detached).toBe(true);
  });

  it("samples multiple workers that share one artifact URL", async () => {
    const browser = new FakeBrowserSession(
      [workerUrl, secondaryWorkerUrl, secondaryWorkerUrl],
      [
        [heapUsage(50, 60), heapUsage(45, 70)],
        [heapUsage(30, 40), heapUsage(35, 50)],
        [heapUsage(25, 35), heapUsage(40, 55)],
      ],
      { pageUrl: "http://127.0.0.1:8000/" },
    );
    const page = new FakePageSession([heapUsage(20, 30), heapUsage(15, 25)], {
      pageUrl: "http://127.0.0.1:8000/",
    });
    const sampler = await prepareJsHeapSampler(
      asCdp(browser),
      asCdp(page),
      "http://127.0.0.1:8000/",
      [workerUrl, secondaryWorkerUrl, secondaryWorkerUrl],
      60_000,
    );

    sampler.start();
    const evidence = await sampler.finish();

    expect(evidence.highWaterUsedSizeBytes).toBe(135);
    expect(evidence.samples[1]?.realms.map(({ url }) => url)).toEqual([
      "http://127.0.0.1:8000/",
      workerUrl,
      secondaryWorkerUrl,
      secondaryWorkerUrl,
    ]);
  });

  it("ignores targets belonging to a different browser context", async () => {
    const browser = new FakeBrowserSession(workerUrl, [], {
      extraWorkerTargets: [
        { browserContextId: "other-context", type: "worklet", url: "worklet:other-app" },
      ],
    });
    const sampler = await prepareJsHeapSampler(
      asCdp(browser),
      asCdp(new FakePageSession([])),
      "page",
      workerUrl,
      100,
    );

    await sampler.discard();
    expect(browser.detached).toBe(true);
  });

  it("ignores Chrome-owned browser UI targets attributed to the app browser context", async () => {
    const browser = new FakeBrowserSession(workerUrl, [], {
      extraWorkerTargets: [
        { type: "browser_ui", url: "chrome://omnibox-popup.top-chrome/" },
        {
          type: "browser_ui",
          url: "chrome://omnibox-popup.top-chrome/omnibox_popup_aim.html",
        },
      ],
    });
    const sampler = await prepareJsHeapSampler(
      asCdp(browser),
      asCdp(new FakePageSession([])),
      "page",
      workerUrl,
      100,
    );

    await sampler.discard();
    expect(browser.attachments).toEqual([{ flatten: false, targetId: "worker-0" }]);
  });

  it("does not ignore a browser_ui target outside the Chrome-owned scheme", async () => {
    const browser = new FakeBrowserSession(workerUrl, [], {
      extraWorkerTargets: [{ type: "browser_ui", url: "https://example.test/unexpected" }],
    });

    await expect(
      prepareJsHeapSampler(asCdp(browser), asCdp(new FakePageSession([])), "page", workerUrl, 100),
    ).rejects.toThrow("browser_ui:https://example.test/unexpected");
  });

  it("uses fixed deadlines and labels its forced end-boundary sample", async () => {
    vi.useFakeTimers();
    const values = Array.from({ length: 5 }, () => heapUsage(10, 20));
    const browser = new FakeBrowserSession(workerUrl, values);
    const page = new FakePageSession(values);
    const sampler = await prepareJsHeapSampler(asCdp(browser), asCdp(page), "page", workerUrl, 100);

    sampler.start();
    await vi.advanceTimersByTimeAsync(350);
    const evidence = await sampler.finish();

    expect(
      evidence.samples
        .filter((sample) => sample.phase === "periodic")
        .map((sample) => sample.scheduledAfterMeasurementStartMs),
    ).toEqual([0, 100, 200, 300]);
    expect(evidence.samples.at(-1)).toMatchObject({
      capturedAfterMeasurementStartMs: 350,
      phase: "measurement-end",
      scheduledAfterMeasurementStartMs: 350,
    });
    expect(evidence.missedSampleDeadlines).toBe(0);
  });

  it("does not issue the initial capture until its scheduled monotonic deadline", async () => {
    vi.useFakeTimers();
    const values = [heapUsage(10, 20), heapUsage(10, 20)];
    const browser = new FakeBrowserSession(workerUrl, values);
    const page = new FakePageSession(values);
    const sampler = await prepareJsHeapSampler(asCdp(browser), asCdp(page), "page", workerUrl, 100);

    sampler.start();
    expect(browser.workerCommandCount).toBe(0);

    await vi.advanceTimersByTimeAsync(0);
    expect(browser.workerCommandCount).toBe(1);
    const evidence = await sampler.finish();
    expect(evidence.samples[0]).toMatchObject({
      scheduledAfterMeasurementStartMs: 0,
      samplingStartDelayMs: 0,
    });
  });

  it("rejects an absent or ambiguous expected render worker", async () => {
    const page = asCdp(new FakePageSession([]));
    await expect(
      prepareJsHeapSampler(asCdp(new FakeBrowserSession("other", [])), page, "page", workerUrl, 10),
    ).rejects.toThrow("worker:other");
    await expect(
      prepareJsHeapSampler(
        asCdp(new FakeBrowserSession(workerUrl, [], { targetCount: 2 })),
        page,
        "page",
        workerUrl,
        10,
      ),
    ).rejects.toThrow("received 3");
    await expect(
      prepareJsHeapSampler(
        asCdp(
          new FakeBrowserSession(workerUrl, [], {
            extraWorkerTargets: [{ type: "worker", url: "blob:unexpected-worker" }],
          }),
        ),
        page,
        "page",
        workerUrl,
        10,
      ),
    ).rejects.toThrow("blob:unexpected-worker");
    await expect(
      prepareJsHeapSampler(
        asCdp(
          new FakeBrowserSession(workerUrl, [], {
            extraWorkerTargets: [{ type: "service_worker", url: "service-worker.js" }],
          }),
        ),
        page,
        "page",
        workerUrl,
        10,
      ),
    ).rejects.toThrow("service-worker.js");
    for (const type of ["worklet", "other", "iframe"]) {
      await expect(
        prepareJsHeapSampler(
          asCdp(
            new FakeBrowserSession(workerUrl, [], {
              extraWorkerTargets: [{ type, url: `${type}:unexpected-realm` }],
            }),
          ),
          page,
          "page",
          workerUrl,
          10,
        ),
      ).rejects.toThrow(`${type}:unexpected-realm`);
    }
  });

  it("invalidates and retains evidence when a worker appears during sampling", async () => {
    const browser = new FakeBrowserSession(workerUrl, [heapUsage(1, 2), heapUsage(1, 2)], {
      extraWorkerTargetsAfterFirstLookup: [{ type: "worklet", url: "blob:late-worklet" }],
    });
    const page = new FakePageSession([heapUsage(1, 2), heapUsage(1, 2)]);
    const sampler = await prepareJsHeapSampler(
      asCdp(browser),
      asCdp(page),
      "page",
      workerUrl,
      60_000,
    );

    sampler.start();
    try {
      await sampler.finish();
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(JsHeapValidationError);
      expect((error as JsHeapValidationError).message).toContain("blob:late-worklet");
      expect((error as JsHeapValidationError).evidence.samples).toHaveLength(2);
    }
  });

  it("surfaces invalid isolate values and still detaches the worker session", async () => {
    const browser = new FakeBrowserSession(workerUrl, [heapUsage(-1, 10)]);
    const page = new FakePageSession([heapUsage(1, 2)]);
    const sampler = await prepareJsHeapSampler(
      asCdp(browser),
      asCdp(page),
      "page",
      workerUrl,
      60_000,
    );

    sampler.start();
    await expect(sampler.finish()).rejects.toThrow("invalid required sizes");
    expect(browser.detached).toBe(true);
  });

  it("times out a lost worker response and detaches the nested session", async () => {
    vi.useFakeTimers();
    const browser = new FakeBrowserSession(workerUrl, [heapUsage(1, 2)], { respond: false });
    const page = new FakePageSession([heapUsage(1, 2)]);
    const sampler = await prepareJsHeapSampler(asCdp(browser), asCdp(page), "page", workerUrl, 100);

    sampler.start();
    const finish = sampler.finish();
    const rejection = expect(finish).rejects.toThrow("timed out after 1000 ms");
    await vi.advanceTimersByTimeAsync(1_001);
    await rejection;
    expect(browser.detached).toBe(true);
  });

  it("times out a hung nested-session send and detaches the nested session", async () => {
    vi.useFakeTimers();
    const browser = new FakeBrowserSession(workerUrl, [heapUsage(1, 2)], { hangSend: true });
    const page = new FakePageSession([heapUsage(1, 2)]);
    const sampler = await prepareJsHeapSampler(asCdp(browser), asCdp(page), "page", workerUrl, 100);

    sampler.start();
    const finish = sampler.finish();
    const rejection = expect(finish).rejects.toThrow(
      "Target.sendMessageToTarget timed out after 1000 ms",
    );
    await vi.advanceTimersByTimeAsync(1_001);
    await rejection;
    expect(browser.detached).toBe(true);
  });

  it("reports an over-interval collection before its resulting missed deadline", async () => {
    vi.useFakeTimers();
    const values = [heapUsage(1, 2), heapUsage(1, 2)];
    const browser = new FakeBrowserSession(workerUrl, values, { responseDelayMs: 250 });
    const page = new FakePageSession(values, { responseDelayMs: 250 });
    const sampler = await prepareJsHeapSampler(asCdp(browser), asCdp(page), "page", workerUrl, 100);

    sampler.start();
    const finish = sampler.finish();
    const rejection = expect(finish).rejects.toThrow("collection duration 250.0 ms");
    await vi.advanceTimersByTimeAsync(501);
    await rejection;
    expect(browser.detached).toBe(true);
  });

  it("handles a malformed nested response before the send acknowledgement without leaking a rejection", async () => {
    vi.useFakeTimers();
    const browser = new FakeBrowserSession(workerUrl, [heapUsage(1, 2)], {
      malformedResponse: true,
      sendAckDelayMs: 20,
    });
    const page = new FakePageSession([heapUsage(1, 2)]);
    const sampler = await prepareJsHeapSampler(asCdp(browser), asCdp(page), "page", workerUrl, 100);

    sampler.start();
    const finish = sampler.finish();
    const rejection = expect(finish).rejects.toThrow("Worker CDP response was not JSON");
    await vi.advanceTimersByTimeAsync(21);
    await rejection;
    expect(browser.detached).toBe(true);
  });

  it("reports a nested response that omits its result", async () => {
    const browser = new FakeBrowserSession(workerUrl, [heapUsage(1, 2)], { omitResult: true });
    const page = new FakePageSession([heapUsage(1, 2)]);
    const sampler = await prepareJsHeapSampler(
      asCdp(browser),
      asCdp(page),
      "page",
      workerUrl,
      60_000,
    );

    sampler.start();
    await expect(sampler.finish()).rejects.toThrow("response omitted its result");
  });

  it("keeps experimental diagnostic sizes nullable when Chrome omits them", async () => {
    const usage = { totalSize: 2, usedSize: 1 };
    const browser = new FakeBrowserSession(workerUrl, [usage, usage]);
    const page = new FakePageSession([usage, usage]);
    const sampler = await prepareJsHeapSampler(
      asCdp(browser),
      asCdp(page),
      "page",
      workerUrl,
      60_000,
    );

    sampler.start();
    const evidence = await sampler.finish();
    expect(evidence.samples[0]?.realms[0]?.usage).toMatchObject({
      backingStorageSizeBytes: null,
      embedderHeapUsedSizeBytes: null,
      totalSizeBytes: 2,
      usedSizeBytes: 1,
    });
  });

  it("discard stops future captures and detaches the nested session", async () => {
    vi.useFakeTimers();
    const values = Array.from({ length: 4 }, () => heapUsage(1, 2));
    const browser = new FakeBrowserSession(workerUrl, values);
    const page = new FakePageSession(values);
    const sampler = await prepareJsHeapSampler(asCdp(browser), asCdp(page), "page", workerUrl, 100);

    sampler.start();
    await vi.advanceTimersByTimeAsync(0);
    await sampler.discard();
    await vi.advanceTimersByTimeAsync(500);

    expect(browser.workerCommandCount).toBe(1);
    expect(browser.detached).toBe(true);
  });

  it("discard bounds and absorbs an in-flight capture failure", async () => {
    vi.useFakeTimers();
    const browser = new FakeBrowserSession(workerUrl, [heapUsage(1, 2)], { hangSend: true });
    const page = new FakePageSession([heapUsage(1, 2)]);
    const sampler = await prepareJsHeapSampler(asCdp(browser), asCdp(page), "page", workerUrl, 100);

    sampler.start();
    const discard = sampler.discard();
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(discard).resolves.toBeUndefined();
    expect(browser.detached).toBe(true);
  });

  it("lets the forced boundary sample substitute for a timer due at the boundary", () => {
    const evidence = summarizeJsHeapSamples(
      [sample(), sample({ capturedAfterMeasurementStartMs: 100.1, phase: "measurement-end" })],
      100,
      100.1,
    );

    expect(evidence.missedSampleDeadlines).toBe(0);
  });

  it("invalidates response-completion skew at least as long as the sample interval", () => {
    expect(() =>
      summarizeJsHeapSamples(
        [sample({ realmResponseCompletionSkewMs: 100 }), sample({ phase: "measurement-end" })],
        100,
        50,
      ),
    ).toThrow("response-completion skew");
  });

  it("invalidates periodic sampling that starts at least one interval late", () => {
    expect(() =>
      summarizeJsHeapSamples(
        [sample({ samplingStartDelayMs: 100 }), sample({ phase: "measurement-end" })],
        100,
        50,
      ),
    ).toThrow("maximum start delay 100.0 ms");
  });

  it("fails with the exact retained sample when a start delay is negative", () => {
    try {
      summarizeJsHeapSamples(
        [sample({ samplingStartDelayMs: -0.125 }), sample({ phase: "measurement-end" })],
        100,
        50,
      );
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(JsHeapValidationError);
      expect((error as JsHeapValidationError).message).toContain("-0.125 ms");
      expect((error as JsHeapValidationError).evidence.samples[0]?.samplingStartDelayMs).toBe(
        -0.125,
      );
    }
  });

  it("invalidates missed periodic deadlines before the boundary sample", () => {
    try {
      summarizeJsHeapSamples([sample(), sample({ phase: "measurement-end" })], 100, 250);
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(JsHeapValidationError);
      expect((error as JsHeapValidationError).message).toContain("missed deadlines 1");
      expect((error as JsHeapValidationError).evidence.missedSampleDeadlines).toBe(1);
      expect((error as JsHeapValidationError).evidence.samples).toHaveLength(2);
    }
  });

  it("detects a skipped intermediate deadline even when a later periodic sample hides the count", () => {
    try {
      summarizeJsHeapSamples(
        [
          sample(),
          sample({
            capturedAfterMeasurementStartMs: 200,
            scheduledAfterMeasurementStartMs: 200,
          }),
          sample({ capturedAfterMeasurementStartMs: 250, phase: "measurement-end" }),
        ],
        100,
        250,
      );
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(JsHeapValidationError);
      expect((error as JsHeapValidationError).message).toContain("missed deadlines 1");
      expect((error as JsHeapValidationError).evidence.missedSampleDeadlines).toBe(1);
    }
  });

  it("advances beyond the prior deadline when a timer fires slightly early", () => {
    expect(nextJsHeapSamplingDeadlineMs(100, 99.9, 100)).toBe(200);
    expect(nextJsHeapSamplingDeadlineMs(100, 250, 100)).toBe(300);
  });

  it("invalidates a collection that occupies at least one sample interval", () => {
    expect(() =>
      summarizeJsHeapSamples(
        [sample({ collectionDurationMs: 100 }), sample({ phase: "measurement-end" })],
        100,
        50,
      ),
    ).toThrow("collection duration 100.0 ms");
  });

  it("preserves collected evidence when a browser error invalidates the heap window", () => {
    const evidence = summarizeJsHeapSamples(
      [sample(), sample({ phase: "measurement-end" })],
      100,
      50,
    );

    const invalid = invalidateJsHeapMetric({ state: "measured", value: evidence }, "page error");
    expect(invalid).toMatchObject({ evidence, reason: "page error", state: "invalid" });
    expect(invalidateJsHeapMetric(invalid, "console error")).toMatchObject({
      evidence,
      reason: "page error; console error",
      state: "invalid",
    });
  });
});

function sample(overrides: Partial<JsHeapSample> = {}): JsHeapSample {
  return Object.freeze({
    aggregateUsedSizeBytes: 1,
    capturedAfterMeasurementStartMs: 0,
    collectionDurationMs: 1,
    phase: "periodic" as const,
    realmResponseCompletionSkewMs: 1,
    realms: Object.freeze([]),
    scheduledAfterMeasurementStartMs: 0,
    samplingStartDelayMs: 0,
    ...overrides,
  });
}

function heapUsage(usedSize: number, totalSize: number): HeapUsageResponse {
  return { backingStorageSize: 1, embedderHeapUsedSize: 2, totalSize, usedSize };
}

interface HeapUsageResponse {
  readonly backingStorageSize?: number;
  readonly embedderHeapUsedSize?: number;
  readonly totalSize: number;
  readonly usedSize: number;
}

class FakePageSession {
  readonly #pageUrl: string;
  readonly #responseDelayMs: number;
  readonly #values: HeapUsageResponse[];

  constructor(values: HeapUsageResponse[], options: FakePageOptions = {}) {
    this.#pageUrl = options.pageUrl ?? "page";
    this.#responseDelayMs = options.responseDelayMs ?? 0;
    this.#values = [...values];
  }

  async send(method: string): Promise<unknown> {
    if (method === "Target.getTargetInfo") {
      return {
        targetInfo: {
          browserContextId: "app-context",
          targetId: "page-0",
          type: "page",
          url: this.#pageUrl,
        },
      };
    }
    if (method !== "Runtime.getHeapUsage") throw new Error(`Unexpected page command ${method}`);
    const value = this.#values.shift();
    if (value === undefined) throw new Error("No page heap value remains");
    if (this.#responseDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.#responseDelayMs));
    }
    return value;
  }
}

interface FakePageOptions {
  readonly pageUrl?: string;
  readonly responseDelayMs?: number;
}

class FakeBrowserSession {
  readonly attachments: Readonly<Record<string, unknown>>[] = [];
  detached = false;
  readonly #extraWorkerTargets: readonly FakeTarget[];
  readonly #extraWorkerTargetsAfterFirstLookup: readonly FakeTarget[];
  readonly #hangSend: boolean;
  readonly #listeners = new Set<(payload: unknown) => void>();
  readonly #malformedResponse: boolean;
  readonly #omitResult: boolean;
  readonly #pageUrl: string;
  readonly #targetCount: number;
  targetLookupCount = 0;
  readonly #valuesByWorker: HeapUsageResponse[][];
  readonly #workerUrls: readonly string[];
  readonly #respond: boolean;
  readonly #responseDelayMs: number;
  readonly #sendAckDelayMs: number;
  workerCommandCount = 0;

  constructor(
    workerUrls: string | readonly string[],
    values: HeapUsageResponse[] | readonly HeapUsageResponse[][],
    options: FakeBrowserOptions = {},
  ) {
    this.#extraWorkerTargets = options.extraWorkerTargets ?? [];
    this.#extraWorkerTargetsAfterFirstLookup = options.extraWorkerTargetsAfterFirstLookup ?? [];
    this.#hangSend = options.hangSend ?? false;
    this.#malformedResponse = options.malformedResponse ?? false;
    this.#omitResult = options.omitResult ?? false;
    this.#pageUrl = options.pageUrl ?? "page";
    this.#respond = options.respond ?? true;
    this.#responseDelayMs = options.responseDelayMs ?? 0;
    this.#sendAckDelayMs = options.sendAckDelayMs ?? 0;
    this.#workerUrls = typeof workerUrls === "string" ? [workerUrls] : workerUrls;
    this.#targetCount = options.targetCount ?? this.#workerUrls.length;
    this.#valuesByWorker = Array.isArray(values[0])
      ? (values as readonly HeapUsageResponse[][]).map((workerValues) => [...workerValues])
      : [[...(values as HeapUsageResponse[])]];
  }

  on(_event: string, listener: (payload: unknown) => void): void {
    this.#listeners.add(listener);
  }

  off(_event: string, listener: (payload: unknown) => void): void {
    this.#listeners.delete(listener);
  }

  async send(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (method === "Target.getTargets") {
      this.targetLookupCount += 1;
      const extraWorkerTargets = [
        ...this.#extraWorkerTargets,
        ...(this.targetLookupCount > 1 ? this.#extraWorkerTargetsAfterFirstLookup : []),
      ];
      return {
        targetInfos: [
          {
            browserContextId: "app-context",
            targetId: "page-0",
            type: "page",
            url: this.#pageUrl,
          },
          ...Array.from({ length: this.#targetCount }, (_, index) => ({
            browserContextId: "app-context",
            targetId: `worker-${index}`,
            type: "worker",
            url: this.#workerUrls[index] ?? this.#workerUrls[0],
          })),
          ...extraWorkerTargets.map((target, index) => ({
            browserContextId: target.browserContextId ?? "app-context",
            targetId: `extra-worker-${index}`,
            type: target.type,
            url: target.url,
          })),
        ],
      };
    }
    if (method === "Target.attachToTarget") {
      this.attachments.push(Object.freeze({ ...params }));
      const targetId = params?.targetId;
      if (typeof targetId !== "string") throw new Error("Worker target ID was omitted");
      const workerIndex = Number(targetId.replace("worker-", ""));
      return { sessionId: workerIndex === 0 ? "worker-session" : `worker-session-${workerIndex}` };
    }
    if (method === "Target.detachFromTarget") {
      this.detached = true;
      return {};
    }
    if (method === "Target.sendMessageToTarget") {
      const sessionId = params?.sessionId;
      if (typeof sessionId !== "string" || !/^worker-session(?:-\d+)?$/.test(sessionId)) {
        throw new Error(`Unexpected nested session ${String(params?.sessionId)}`);
      }
      const workerIndex = sessionId === "worker-session" ? 0 : Number(sessionId.slice(15));
      this.workerCommandCount += 1;
      if (this.#hangSend) return new Promise(() => undefined);
      const request = JSON.parse(String(params?.message)) as { id: number };
      const value = this.#valuesByWorker[workerIndex]?.shift();
      if (value === undefined) throw new Error("No worker heap value remains");
      if (!this.#respond) return {};
      const emitResponse = (): void => {
        for (const listener of this.#listeners) {
          listener({
            message: this.#malformedResponse
              ? "<not json>"
              : JSON.stringify(
                  this.#omitResult ? { id: request.id } : { id: request.id, result: value },
                ),
            sessionId,
          });
        }
      };
      if (this.#responseDelayMs === 0) queueMicrotask(emitResponse);
      else setTimeout(emitResponse, this.#responseDelayMs);
      if (this.#sendAckDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.#sendAckDelayMs));
      }
      return {};
    }
    throw new Error(`Unexpected browser command ${method}`);
  }
}

interface FakeBrowserOptions {
  readonly extraWorkerTargets?: readonly FakeTarget[];
  readonly extraWorkerTargetsAfterFirstLookup?: readonly FakeTarget[];
  readonly hangSend?: boolean;
  readonly malformedResponse?: boolean;
  readonly omitResult?: boolean;
  readonly pageUrl?: string;
  readonly respond?: boolean;
  readonly responseDelayMs?: number;
  readonly sendAckDelayMs?: number;
  readonly targetCount?: number;
}

interface FakeTarget {
  readonly browserContextId?: string;
  readonly type: string;
  readonly url: string;
}

function asCdp(value: object): CDPSession {
  return value as CDPSession;
}
