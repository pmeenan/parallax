import { describe, expect, it } from "vitest";
import {
  STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
  validateStreamingBuildManifest,
} from "../src/index";

describe("streaming build-manifest validation", () => {
  it("accepts the exact v14 shape consumed during provisioning", () => {
    expect(validateStreamingBuildManifest(fixture())).toMatchObject({
      gameContentEntrypoints: [{ districtId: "district-1-surface" }],
      schemaVersion: 16,
    });
  });

  it.each([
    ["an empty district ID", (value: Fixture) => (firstEntrypoint(value).districtId = "")],
    [
      "an unsafe district ID",
      (value: Fixture) => (firstEntrypoint(value).districtId = "../district"),
    ],
    ["an empty district path", (value: Fixture) => (firstEntrypoint(value).path = "")],
    [
      "an unsafe district path",
      (value: Fixture) => (firstEntrypoint(value).path = "../district.json"),
    ],
    [
      "a duplicate district ID",
      (value: Fixture) =>
        value.gameContentEntrypoints.push({
          ...firstEntrypoint(value),
          path: "immutable/district-2.json",
        }),
    ],
    [
      "a duplicate district path",
      (value: Fixture) =>
        value.gameContentEntrypoints.push({
          ...firstEntrypoint(value),
          districtId: "district-2",
        }),
    ],
    [
      "a district path absent from artifacts",
      (value: Fixture) => (firstEntrypoint(value).path = "immutable/unlisted-district.json"),
    ],
  ])("rejects %s", (_label, mutate) => {
    const value = fixture();
    if (_label === "a duplicate district ID") {
      value.artifacts.push(artifact("immutable/district-2.json", "2"));
    }
    mutate(value);
    expect(() => validateStreamingBuildManifest(value)).toThrow(/invalid district entrypoint/);
  });

  it("rejects an empty district-entrypoint set and duplicate artifact paths", () => {
    const empty = fixture();
    empty.gameContentEntrypoints = [];
    expect(() => validateStreamingBuildManifest(empty)).toThrow(/at least one district/);

    const duplicateArtifact = fixture();
    duplicateArtifact.artifacts.push({ ...firstArtifact(duplicateArtifact) });
    expect(() => validateStreamingBuildManifest(duplicateArtifact)).toThrow(
      /invalid or duplicate artifact/,
    );
  });

  it("rejects duplicate artifact hashes and an unrepresented install entrypoint", () => {
    const duplicateHash = fixture();
    duplicateHash.artifacts.push(
      artifact("immutable/other.json", duplicateHash.artifacts[0]?.sha256[0] ?? "1"),
    );
    expect(() => validateStreamingBuildManifest(duplicateHash)).toThrow(
      /invalid or duplicate artifact/,
    );

    const missingInstallArtifact = fixture();
    missingInstallArtifact.artifacts = missingInstallArtifact.artifacts.filter(
      (entry) => entry.path !== "install-manifest.json",
    );
    expect(() => validateStreamingBuildManifest(missingInstallArtifact)).toThrow(
      /omits its install-manifest entrypoint artifact/,
    );
  });

  it("intentionally treats worker-entrypoint records as opaque to the streaming consumer", () => {
    const value = fixture();
    value.workerEntrypoints = [{ ownerValidatedShape: "not consumed by streaming provisioning" }];
    expect(() => validateStreamingBuildManifest(value)).not.toThrow();
  });
});

interface Fixture {
  artifacts: Array<{ bytes: number; path: string; sha256: string }>;
  gameContentEntrypoints: Array<{
    districtId: string;
    path: string;
    schemaVersion: number;
    scope: string;
    targetType: string;
  }>;
  installManifestEntrypoint: { path: string; schemaVersion: number };
  offlineShell: {
    generationSchemaVersion: number;
    saveSchemaVersion: number;
    serviceWorkerPath: string;
  };
  schemaVersion: number;
  workerEntrypoints: unknown[];
}

function fixture(): Fixture {
  return {
    artifacts: [
      artifact("immutable/district-1.json", "1"),
      artifact("install-manifest.json", "f"),
      artifact("service-worker.js", "e"),
    ],
    gameContentEntrypoints: [
      {
        districtId: "district-1-surface",
        path: "immutable/district-1.json",
        schemaVersion: STREAMING_DISTRICT_INDEX_SCHEMA_VERSION,
        scope: "game-specific",
        targetType: "district",
      },
    ],
    installManifestEntrypoint: { path: "install-manifest.json", schemaVersion: 1 },
    offlineShell: {
      generationSchemaVersion: 1,
      saveSchemaVersion: 1,
      serviceWorkerPath: "service-worker.js",
    },
    schemaVersion: 16,
    workerEntrypoints: [],
  };
}

function artifact(path: string, hashCharacter: string) {
  return { bytes: 17, path, sha256: hashCharacter.repeat(64) };
}

function firstEntrypoint(value: Fixture): Fixture["gameContentEntrypoints"][number] {
  const entrypoint = value.gameContentEntrypoints[0];
  if (entrypoint === undefined) throw new Error("Fixture omitted its district entrypoint");
  return entrypoint;
}

function firstArtifact(value: Fixture): Fixture["artifacts"][number] {
  const entrypoint = value.artifacts[0];
  if (entrypoint === undefined) throw new Error("Fixture omitted its first artifact");
  return entrypoint;
}
