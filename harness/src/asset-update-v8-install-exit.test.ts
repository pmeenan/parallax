import { describe, expect, it } from "vitest";
import {
  buildInitialInstallExitEvidence,
  createInstallCdpNetworkCapture,
  type InstallControlIdentity,
  mergeIntervalUnionMs,
  validatedInitialInstallExitBreakdown,
} from "./asset-update-v8-install-exit.js";
import type { InstallManifest } from "./install-manifest.js";

const ORIGIN = "http://127.0.0.1:4173/";
const WORKER = "immutable/installer-worker.js";
const SHA = "a".repeat(64);
const CONTROLS: readonly InstallControlIdentity[] = [
  { bodyBytes: 50, etag: `"sha256-${"b".repeat(64)}"`, source: "build-manifest.json" },
  { bodyBytes: 60, etag: `"sha256-${"c".repeat(64)}"`, source: "install-manifest.json" },
];
const MANIFEST: InstallManifest = {
  gameId: "parallax",
  resources: [
    {
      bytes: 100,
      id: "game-asset",
      kind: "asset-pack",
      scope: "game-specific",
      sha256: SHA,
      source: "immutable/game.bin",
      target: "opfs",
    },
  ],
  schemaVersion: 1,
};

describe("asset-update V8 initial-install exit evidence", () => {
  it("captures exact control documents before OPFS transfer and merges active intervals", () => {
    expect(
      mergeIntervalUnionMs([
        { endedAtMs: 30, startedAtMs: 10 },
        { endedAtMs: 40, startedAtMs: 20 },
        { endedAtMs: 70, startedAtMs: 50 },
      ]),
    ).toBe(50);
    const capture = createInstallCdpNetworkCapture(ORIGIN, MANIFEST, CONTROLS);
    completeControl(capture, "build", CONTROLS[0] as InstallControlIdentity, 0.01, 0.02);
    completeControl(capture, "install", CONTROLS[1] as InstallControlIdentity, 0.03, 0.04);
    capture.requestWillBeSent({
      request: {
        headers: { Range: "bytes=0-" },
        method: "GET",
        url: `${ORIGIN}immutable/game.bin`,
      },
      requestId: "resource",
      timestamp: 0.05,
    });
    capture.responseReceived({
      requestId: "resource",
      response: {
        headers: {
          "Content-Length": "100",
          "Content-Range": "bytes 0-99/100",
          ETag: `"sha256-${SHA}"`,
        },
        status: 206,
        url: `${ORIGIN}immutable/game.bin`,
      },
    });
    capture.loadingFinished({ requestId: "resource", timestamp: 0.11 });
    const requests = capture.finish();
    const evidence = buildInitialInstallExitEvidence({
      controlRequests: requests.controlRequests,
      controls: CONTROLS,
      finalVerificationFirstObservedCompleteAtMs: 95,
      finalVerificationFirstObservedVerifyingAtMs: 80,
      installReadyAtMs: 100,
      installStartedAtMs: 0,
      installerWorkerSource: WORKER,
      manifest: MANIFEST,
      resourceRequests: requests.resourceRequests,
    });

    expect(evidence.network.activeIntervalUnionMs).toBe(80);
    expect(evidence.network.controlRequestCount).toBe(2);
    expect(evidence.network.resourceBodyBytes).toBe(100);
    expect(evidence.networkIdleLocalCriticalPathMs).toBe(20);
    expect(validatedInitialInstallExitBreakdown(evidence, MANIFEST, WORKER, CONTROLS)).toEqual({
      contract: "installed-lifecycle-exit@1",
      finalVerificationObservation: evidence.finalVerificationObservation,
      installWall: evidence.installWall,
      network: {
        activeIntervalUnionMs: 80,
        controlBodyBytes: 110,
        controlRequestCount: 2,
        resourceBodyBytes: 100,
        resourceCount: 1,
        resourceRequestCount: 1,
        source: "cdp-installer-worker-network@1",
        workerSource: WORKER,
      },
      networkIdleLocalCriticalPathBudgetMs: 90_000,
      networkIdleLocalCriticalPathMs: 20,
      state: "independently-validated",
    });
  });

  it("fails closed on unknown worker traffic and incomplete manifest coverage", () => {
    const capture = createInstallCdpNetworkCapture(ORIGIN, MANIFEST, CONTROLS);
    capture.requestWillBeSent({
      request: { headers: { Range: "bytes=0-" }, method: "GET", url: `${ORIGIN}unknown` },
      requestId: "unknown",
      timestamp: 1,
    });
    expect(() => capture.finish()).toThrow("unknown or redirected");
  });

  it("rejects an empty OPFS resource set instead of vacuously passing transfer ordering", () => {
    const emptyManifest: InstallManifest = { ...MANIFEST, resources: [] };
    const capture = createInstallCdpNetworkCapture(ORIGIN, emptyManifest, CONTROLS);
    completeControl(capture, "build", CONTROLS[0] as InstallControlIdentity, 0.01, 0.02);
    completeControl(capture, "install", CONTROLS[1] as InstallControlIdentity, 0.03, 0.04);
    const requests = capture.finish();

    expect(() =>
      buildInitialInstallExitEvidence({
        controlRequests: requests.controlRequests,
        controls: CONTROLS,
        finalVerificationFirstObservedCompleteAtMs: 95,
        finalVerificationFirstObservedVerifyingAtMs: 80,
        installReadyAtMs: 100,
        installStartedAtMs: 0,
        installerWorkerSource: WORKER,
        manifest: emptyManifest,
        resourceRequests: requests.resourceRequests,
      }),
    ).toThrow("contains no OPFS transfer resources");
  });
});

function completeControl(
  capture: ReturnType<typeof createInstallCdpNetworkCapture>,
  requestId: string,
  identity: InstallControlIdentity,
  startedAt: number,
  endedAt: number,
): void {
  const url = `${ORIGIN}${identity.source}`;
  capture.requestWillBeSent({
    request: { headers: {}, method: "GET", url },
    requestId,
    timestamp: startedAt,
  });
  capture.responseReceived({
    requestId,
    response: {
      headers: { "Content-Length": String(identity.bodyBytes), ETag: identity.etag },
      status: 200,
      url,
    },
  });
  capture.loadingFinished({ requestId, timestamp: endedAt });
}
