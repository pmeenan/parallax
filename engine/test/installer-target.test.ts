import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import {
  INSTALLER_TARGET_REQUEST_HEADER,
  INSTALLER_TARGET_REQUEST_VALUE,
} from "../src/install/installer-build-manifest";
import {
  assertInstallerRepairExpectedRelease,
  InstallerRepairTargetMismatchError,
  type InstallerTargetPlatform,
  installerTargetFailureCode,
  loadInstallerTargetIdentity,
} from "../src/install/installer-target";
import { InstallerTransferError } from "../src/install/installer-transfer";

const origin = "https://parallax-web.com";
const buildUrl = `${origin}/build-manifest.json`;
const installUrl = `${origin}/install-manifest.json`;
const shellDigest = "a".repeat(64);
const shellEntrypointPath = `immutable/app-${shellDigest}.js`;

describe("installer target identity", () => {
  it("binds contradictory Repair discovery to both exact release identities", () => {
    const expectedReleaseDigest = "a".repeat(64);
    const discoveredReleaseDigest = "b".repeat(64);
    const failure = new InstallerRepairTargetMismatchError(
      expectedReleaseDigest,
      discoveredReleaseDigest,
    );

    expect(failure).toMatchObject({ discoveredReleaseDigest, expectedReleaseDigest });
    expect(installerTargetFailureCode(failure)).toBe("repair-target-mismatch");
    expect(() =>
      assertInstallerRepairExpectedRelease(expectedReleaseDigest, discoveredReleaseDigest),
    ).toThrow(InstallerRepairTargetMismatchError);
    expect(() =>
      assertInstallerRepairExpectedRelease(expectedReleaseDigest, expectedReleaseDigest),
    ).not.toThrow();
  });

  it("classifies fetch rejection and HTTP failure as transport", async () => {
    const rejected: InstallerTargetPlatform = {
      fetch: () => Promise.reject(new TypeError("network down")),
    };
    const rejection = await load(rejected).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(InstallerTransferError);
    expect(rejection).toMatchObject({ category: "transport", resourceId: null });

    const unavailable = queuePlatform([response(buildUrl, "unavailable", 503)]);
    const httpFailure = await load(unavailable).catch((error: unknown) => error);
    expect(httpFailure).toMatchObject({ category: "transport", resourceId: null });
  });

  it("classifies structural documents, shell mismatch, and byte mismatch distinctly", async () => {
    const malformed = await load(queuePlatform([response(buildUrl, "{")])).catch(
      (error: unknown) => error,
    );
    expect(installerTargetFailureCode(malformed)).toBe("install-manifest-invalid");

    const fixture = targetFixture();
    const staleShell = await load(
      queuePlatform([response(buildUrl, JSON.stringify(fixture.build))]),
      `immutable/app-${"b".repeat(64)}.js`,
    ).catch((error: unknown) => error);
    expect(installerTargetFailureCode(staleShell)).toBe("shell-incompatible");

    const corruptBytes = await load(
      queuePlatform([
        response(buildUrl, JSON.stringify(fixture.build)),
        response(installUrl, "corrupt"),
      ]),
    ).catch((error: unknown) => error);
    expect(corruptBytes).toMatchObject({ category: "integrity", resourceId: null });
  });

  it("rejects an inexact response URL as a validator failure", async () => {
    const failure = await load(queuePlatform([response(`${origin}/redirected.json`, "{}")])).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ category: "validator", resourceId: null });
  });

  it("returns the exact release and canonical build root for valid documents", async () => {
    const fixture = targetFixture();
    await expect(
      load(
        queuePlatform([
          response(buildUrl, JSON.stringify(fixture.build)),
          response(installUrl, fixture.installBytes),
        ]),
      ),
    ).resolves.toMatchObject({
      buildRootUrl: `${origin}/`,
      identity: { releaseDigest: fixture.installDigest },
    });
  });

  it("marks only target-document fetches for service-worker network-first resolution", async () => {
    const fixture = targetFixture();
    const responses = [
      response(buildUrl, JSON.stringify(fixture.build)),
      response(installUrl, fixture.installBytes),
    ];
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const platform: InstallerTargetPlatform = {
      fetch: async (input, init) => {
        calls.push({ input, init });
        const next = responses.shift();
        if (next === undefined) throw new Error("Unexpected target fetch");
        return next;
      },
    };

    await load(platform);

    expect(calls.map(({ input }) => input)).toEqual([buildUrl, installUrl]);
    for (const { init } of calls) {
      expect(new Headers(init.headers).get(INSTALLER_TARGET_REQUEST_HEADER)).toBe(
        INSTALLER_TARGET_REQUEST_VALUE,
      );
      expect(init.cache).toBe("no-store");
    }
  });
});

function load(platform: InstallerTargetPlatform, shellPath = shellEntrypointPath) {
  return loadInstallerTargetIdentity({
    locationUrl: `${origin}/`,
    platform,
    shellEntrypointPath: shellPath,
  });
}

function queuePlatform(responses: readonly Response[]): InstallerTargetPlatform {
  let index = 0;
  return {
    fetch: async () => {
      const value = responses[index];
      index += 1;
      if (value === undefined) throw new Error("Unexpected target fetch");
      return value;
    },
  };
}

function response(url: string, body: BodyInit, status = 200): Response {
  const value = new Response(body, { status });
  Object.defineProperty(value, "url", { value: url });
  return value;
}

function targetFixture() {
  const installBytes = new TextEncoder().encode(
    `${JSON.stringify({
      gameId: "parallax",
      resources: [
        {
          bytes: 1,
          id: "game-cell",
          kind: "world-cell",
          scope: "game-specific",
          sha256: "1".repeat(64),
          source: "immutable/cell.json",
          target: "opfs",
        },
      ],
      schemaVersion: 1,
    })}\n`,
  );
  const installDigest = bytesToHex(sha256(installBytes));
  const workers = ["decode", "installer", "render", "sim", "streaming", "wasm-thread"].map(
    (role, index) => ({
      path: `immutable/${role}-${String(index).repeat(64)}.js`,
      role,
      targetType: "worker",
    }),
  );
  return {
    build: {
      artifacts: [
        {
          bytes: installBytes.byteLength,
          path: "install-manifest.json",
          sha256: installDigest,
        },
        { bytes: 1, path: shellEntrypointPath, sha256: shellDigest },
        { bytes: 1, path: "service-worker.js", sha256: "9".repeat(64) },
        ...workers.map((worker, index) => ({
          bytes: 1,
          path: worker.path,
          sha256: String(index + 2).repeat(64),
        })),
      ],
      gameContentEntrypoints: [],
      installManifestEntrypoint: { path: "install-manifest.json", schemaVersion: 1 },
      offlineShell: {
        generationSchemaVersion: 1,
        saveSchemaVersion: 1,
        serviceWorkerPath: "service-worker.js",
      },
      schemaVersion: 16,
      workerEntrypoints: workers,
    },
    installBytes,
    installDigest,
  };
}
