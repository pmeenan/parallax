import { describe, expect, it } from "vitest";
import {
  assembleFlythroughAttempt,
  measuredFlythroughEnvironmentFailures,
} from "./flythrough-run-result.js";
import { JsHeapValidationError } from "./js-heap.js";

const traceDrain = Object.freeze({
  categories: Object.freeze(["dawn"]),
  completionAfterEndCommandMs: 5_020,
  completionDeadlineExceeded: true,
  completionObservationTimeoutMs: 20_000,
  completionTimeoutMs: 10_000,
  dataChunkCount: 7,
  dataLossOccurred: false,
  endCommandMs: 4,
  endWaitMs: 5_024,
  eventCount: 123,
  recordingDurationBeforeEndMs: 600_000,
  serializedEventBytes: 456_789,
});

const heapEvidence = Object.freeze({
  highWaterUsedSizeBytes: 123,
  maximumCollectionDurationMs: 101,
  maximumRealmResponseCompletionSkewMs: 4,
  maximumSamplingStartDelayMs: 2,
  missedSampleDeadlines: 1,
  periodicSamplingDurationMs: 600_000,
  sampleIntervalMs: 100,
  samples: Object.freeze([]),
});

describe("flythrough attempt assembly", () => {
  it("retains late trace diagnostics on an invalid attempt", () => {
    const attempt = assembleFlythroughAttempt({
      browserErrors: [],
      environment: null,
      error: new Error("trace completed after validity deadline"),
      jsHeap: null,
      repeat: 1,
      result: null,
      traceDrain,
    });

    expect(attempt).toMatchObject({
      state: "invalid",
      traceDrain: {
        completionDeadlineExceeded: true,
        dataChunkCount: 7,
        eventCount: 123,
        serializedEventBytes: 456_789,
      },
    });
  });

  it("retains JsHeapValidationError evidence instead of reducing it to text", () => {
    const attempt = assembleFlythroughAttempt({
      browserErrors: [],
      environment: null,
      error: new JsHeapValidationError("heap cadence failed", heapEvidence),
      jsHeap: null,
      repeat: 2,
      result: null,
      traceDrain: null,
    });

    expect(attempt.jsHeap).toEqual({
      evidence: heapEvidence,
      reason: "heap cadence failed",
      state: "invalid",
    });
  });

  it("rejects Node drift and per-repeat measured browser drift", () => {
    const reference = {
      adapter: { backend: "d3d12" },
      browserDisplay: { refreshRatesHz: [60] },
      browserProduct: "Chrome/151.0.7922.34",
      browserRevision: "r1",
      browserUserAgent: "ua",
      gpuDevices: [{ deviceId: 1 }],
      host: { power: { guid: "p" } },
      jsVersion: "v8",
    };
    const failures = measuredFlythroughEnvironmentFailures({
      attempts: [
        {
          browserErrors: [],
          environment: {
            ...reference,
            adapter: reference.adapter as never,
            browserCommandLine: "chrome --start-fullscreen --user-data-dir=x",
            browserDisplayAfter: { refreshRatesHz: [120] } as never,
            browserDisplayBefore: reference.browserDisplay as never,
            hostAfter: reference.host as never,
            hostBefore: reference.host as never,
            sandboxVerified: true,
          } as never,
          failureMessage: null,
          jsHeap: null,
          profileLineage: { history: ["fresh"], id: "independent-fresh-1" },
          repeat: 1,
          result: null,
          state: "invalid",
          traceDrain: null,
        },
      ],
      chromePinVersion: "151.0.7922.34",
      expectedNodeVersion: "24.18.0",
      nodeVersion: "v24.17.0",
      reference: reference as never,
    });

    expect(failures.join(" | ")).toContain("Node collector version");
    expect(failures.join(" | ")).toContain("Repeat 1 measured browser environment drifted");
  });

  it("accepts the physically observed standard adapter redactions against a developer-enriched reference", () => {
    const stableAdapter = {
      architecture: "lovelace",
      isFallbackAdapter: false,
      vendor: "nvidia",
    };
    const browserDisplay = { refreshRatesHz: [60] };
    const host = { power: { guid: "p" } };
    const reference = {
      adapter: {
        ...stableAdapter,
        backend: "d3d12",
        description: "NVIDIA GeForce RTX 4080 SUPER",
        device: "0x2702",
        driver: "32.0.16.1074",
        type: "discrete-gpu",
      },
      browserDisplay,
      browserProduct: "Chrome/151.0.7922.34",
      browserRevision: "r1",
      browserUserAgent: "ua",
      gpuDevices: [{ deviceId: 1 }],
      host,
      jsVersion: "v8",
    };
    const failures = measuredFlythroughEnvironmentFailures({
      attempts: [
        {
          browserErrors: [],
          environment: {
            adapter: {
              ...stableAdapter,
              backend: null,
              description: "",
              device: "",
              driver: null,
              type: null,
            },
            browserCommandLine: "chrome --start-fullscreen --user-data-dir=x",
            browserDisplayAfter: browserDisplay,
            browserDisplayBefore: browserDisplay,
            browserProduct: reference.browserProduct,
            browserRevision: reference.browserRevision,
            browserUserAgent: reference.browserUserAgent,
            gpuDevices: reference.gpuDevices,
            hostAfter: host,
            hostBefore: host,
            jsVersion: reference.jsVersion,
            sandboxVerified: true,
          } as never,
          failureMessage: null,
          jsHeap: null,
          profileLineage: { history: ["fresh"], id: "independent-fresh-1" },
          repeat: 1,
          result: null,
          state: "invalid",
          traceDrain: null,
        },
      ],
      chromePinVersion: "151.0.7922.34",
      expectedNodeVersion: "24.18.0",
      nodeVersion: "v24.18.0",
      reference: reference as never,
    });

    expect(failures).toEqual([]);
  });

  it("fails environment eligibility when a started repeat has no measured browser identity", () => {
    const failures = measuredFlythroughEnvironmentFailures({
      attempts: [
        assembleFlythroughAttempt({
          browserErrors: [],
          environment: null,
          error: new Error("Browser.getVersion failed"),
          jsHeap: null,
          repeat: 1,
          result: null,
          traceDrain: null,
        }),
      ],
      chromePinVersion: "151.0.7922.34",
      expectedNodeVersion: "24.18.0",
      nodeVersion: "v24.18.0",
      reference: {
        adapter: null,
        browserDisplay: null,
        browserProduct: "Chrome/151.0.7922.34",
        browserRevision: "",
        browserUserAgent: "",
        gpuDevices: [],
        host: null,
        jsVersion: "",
      },
    });

    expect(failures).toContain("Repeat 1 measured browser environment is unavailable");
  });
});
