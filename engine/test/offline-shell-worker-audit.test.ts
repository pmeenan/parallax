import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("offline-shell service-worker source boundary", () => {
  it("keeps generation preparation explicit without granting query-string authority", async () => {
    const [source, notification] = await Promise.all([
      readFile(new URL("../src/workers/service-worker.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../src/offline-shell/offline-shell-selection-notification.ts", import.meta.url),
        "utf8",
      ),
    ]);
    const install = source.slice(
      source.indexOf('scope.addEventListener("install"'),
      source.indexOf('scope.addEventListener("activate"'),
    );
    const activate = source.slice(
      source.indexOf('scope.addEventListener("activate"'),
      source.indexOf('scope.addEventListener("message"'),
    );
    const message = source.slice(
      source.indexOf('scope.addEventListener("message"'),
      source.indexOf('scope.addEventListener("fetch"'),
    );

    expect(install).toContain("scope.skipWaiting()");
    expect(install).not.toContain("prepareAndActivateOfflineShellGeneration");
    expect(install).not.toContain("platform.put");
    expect(activate).toContain("scope.clients.claim()");
    expect(activate).not.toContain("prepareAndActivateOfflineShellGeneration");
    expect(message).toContain("prepareAndActivateOfflineShellGeneration");
    expect(message).toContain("admitOfflineShellGeneration");
    const admission = message.slice(
      message.indexOf('request.kind === "admit"'),
      message.indexOf("prepareAndActivateOfflineShellGeneration"),
    );
    expect(admission).toContain("notifySelectionChange");
    expect(message).toContain("{ allowUpdate: true }");
    expect(source).toContain("return fetch(event.request)");
    expect(source).toContain("shouldPassThroughOfflineShellRangeRequest(event.request");
    expect(source).toContain("event.respondWith(fetch(event.request))");
    const fetchHandler = source.slice(source.indexOf('scope.addEventListener("fetch"'));
    expect(fetchHandler.indexOf("shouldPassThroughUninstallRequest")).toBeLessThan(
      fetchHandler.indexOf('event.request.method !== "GET"'),
    );
    const uninstallBranch = fetchHandler.slice(
      fetchHandler.indexOf("shouldPassThroughUninstallRequest"),
      fetchHandler.indexOf('event.request.method !== "GET"'),
    );
    expect(uninstallBranch).not.toContain("event.respondWith(");
    expect(uninstallBranch).toContain("return;");
    expect(uninstallBranch).not.toContain("handleFetch");
    expect(source).toContain("shouldUseNetworkFirstInstallerTargetRequest(event.request");
    expect(source).toContain("event.respondWith(networkFirstInstallerTarget(event))");
    expect(source).toContain("resolveNetworkFirstInstallerTarget(");
    expect(source).toContain("() => handleFetch(event)");
    expect(source).not.toContain("parallaxAutomation");
    expect(source).not.toContain("isPrivilegedAutomationClient");
    expect(source).not.toContain("clients.get");
    expect(notification).toContain('"selection-changed"');
    expect(source).toContain(".matchAll({ includeUncontrolled: true");
    expect(source).toContain("resolveOfflineShellCachePath(event.request");
    expect(source).toContain("resolveOfflineShellRequestFailureTelemetry(");
    expect(source).toContain("notifyOfflineShellSelectionChangeFromDurableRead(");
    expect(source).not.toContain("currentSelection?.telemetry ?? responseTelemetry");
    expect(message).toContain("telemetry: responseTelemetry");
    expect(source).toContain("failedOfflineShellTelemetrySnapshot(code, diagnostic)");
    expect(source).toMatch(/\.runExclusive\(async \(\) =>/u);
    expect(source).not.toContain("async function activeGenerationId");
    expect(source).toContain('"cross-origin-embedder-policy": "require-corp"');
    expect(source).toContain('"cross-origin-opener-policy": "same-origin"');
    expect(source).toContain('"x-content-type-options": "nosniff"');
  });
});
