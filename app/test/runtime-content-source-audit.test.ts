import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { resolveRuntimeLaunchRoute } from "../src/runtime-launch-route";

describe("runtime content-source boundary", () => {
  it("keeps legacy network startup behind exact WebDriver-attested authorization", () => {
    const base = "https://parallax-web.com/";
    expect(resolveRuntimeLaunchRoute(`${base}?parallaxAutomation=runtime`, false)).toEqual({
      requiresOfflineShell: true,
    });
    expect(resolveRuntimeLaunchRoute(`${base}?parallaxAutomation=installer`, true)).toEqual({
      requiresOfflineShell: true,
    });
    expect(resolveRuntimeLaunchRoute(base, true)).toEqual({ requiresOfflineShell: true });

    expect(resolveRuntimeLaunchRoute(`${base}?parallaxAutomation=runtime`, true)).toEqual({
      contentSource: {
        buildManifestUrl: `${base}build-manifest.json`,
        kind: "privileged-legacy-network",
      },
      requiresOfflineShell: false,
    });
  });

  it("releases the runtime start latch when later boot setup throws", async () => {
    const { bootRuntime } = await import("../src/runtime");
    const failures: string[] = [];
    const attempt = async (): Promise<void> => {
      try {
        await bootRuntime(
          {} as Parameters<typeof bootRuntime>[0],
          null,
          {
            buildManifestUrl: "https://parallax-web.com/build-manifest.json",
            kind: "privileged-legacy-network",
          },
          null,
        );
      } catch (error: unknown) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    };

    await attempt();
    await attempt();

    expect(failures).toEqual([
      expect.stringMatching(/document is not defined/),
      expect.stringMatching(/document is not defined/),
    ]);
  });

  it("preflights both installed consumer sets before starting runtime services", async () => {
    const source = await readFile(new URL("../src/runtime.ts", import.meta.url), "utf8");
    const controllerSource = await readFile(
      new URL("../src/installer-controller.ts", import.meta.url),
      "utf8",
    );
    const preflightSource = await readFile(
      new URL("../src/installed-runtime-preflight.ts", import.meta.url),
      "utf8",
    );
    const shellAuthoritySource = await readFile(
      new URL("../src/shell-launch-authority.ts", import.meta.url),
      "utf8",
    );
    const modelPreflight = preflightSource.indexOf("await modelSource.initialize()");
    const streamingPreflight = source.indexOf("resolveInstalledStreamingRelease(");
    const admissionBoundary = source.indexOf("await completeInstalledRuntimeShellAdmission(");
    const preflightCall = source.indexOf("preflightInstalledRuntime(", admissionBoundary);
    const shellAdmission = shellAuthoritySource.indexOf("await offlineShell.admit(expectedShell)");
    const markAdmitted = shellAuthoritySource.indexOf("authority.markAdmitted()");
    const runtimeServices = source.indexOf(
      'for (const id of ["render-canvas", "runtime-status", "streaming-dashboard", "benchmark-mode"])',
    );

    expect(modelPreflight).toBeGreaterThan(0);
    expect(streamingPreflight).toBeGreaterThan(0);
    expect(preflightCall).toBeGreaterThan(0);
    expect(runtimeServices).toBeGreaterThan(preflightCall);
    expect(runtimeServices).toBeGreaterThan(streamingPreflight);
    expect(admissionBoundary).toBeGreaterThan(0);
    expect(shellAdmission).toBeGreaterThan(0);
    expect(markAdmitted).toBeGreaterThan(shellAdmission);
    expect(shellAuthoritySource.match(/offlineShell\.admit\(expectedShell\)/g)).toHaveLength(1);
    expect(shellAuthoritySource).toContain("requireCurrentShellAuthority(authority.signal)");
    const controllerLaunchStart = controllerSource.indexOf("async launch(): Promise<void>");
    const controllerLaunch = controllerSource.slice(
      controllerLaunchStart,
      controllerSource.indexOf("reload(): void", controllerLaunchStart),
    );
    expect(controllerLaunch).toContain("input.installer.targetStatus()");
    expect(controllerLaunch).not.toContain("offlineShell.prepare");
    expect(controllerLaunch).not.toContain("offlineShell.admit");
    expect(preflightSource.indexOf("await dependencies.resolveStreaming(binding)")).toBeGreaterThan(
      modelPreflight,
    );
    expect(source).toContain("const releaseStore = createOpfsReleaseStore(platform)");
    expect(source).toContain("bindActiveInstalledRelease(releaseDigest, releaseStore)");
    expect(source).toContain("await releaseStore.admitActiveRelease(releaseDigest)");
    expect(preflightSource.match(/dependencies\.admit\(releaseDigest\)/g)).toHaveLength(1);
    expect(preflightSource.match(/dependencies\.readmit\(releaseDigest\)/g)).toHaveLength(1);
    expect(preflightSource.indexOf("await dependencies.readmit(releaseDigest)")).toBeGreaterThan(
      preflightSource.indexOf("await dependencies.loadPsoWarmupTrace(binding)"),
    );
    expect(preflightSource).not.toContain("Promise.all");
    expect(source).toContain(
      'appOwnedLlmMode !== null && contentSource.kind !== "privileged-legacy-network"',
    );
  });
});
