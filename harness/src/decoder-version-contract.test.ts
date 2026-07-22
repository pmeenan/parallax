import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface EnginePackageManifest {
  readonly dependencies: Readonly<Record<string, string>>;
}

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("decoder version telemetry contract", () => {
  it("keeps every typed and runtime telemetry literal aligned with the exact package pins", async () => {
    const enginePackage = JSON.parse(
      await readFile(join(repositoryRoot, "engine/package.json"), "utf8"),
    ) as EnginePackageManifest;
    const bootstrapSource = await readFile(
      join(repositoryRoot, "engine/src/render/decoder-bootstrap.ts"),
      "utf8",
    );
    const expectedVersions = {
      draco: enginePackage.dependencies.draco3dgltf,
      ktx2: enginePackage.dependencies["@babylonjs/ktx2decoder"],
      meshopt: enginePackage.dependencies.meshoptimizer,
    } as const;

    for (const [telemetryField, packageVersion] of Object.entries(expectedVersions)) {
      expect(packageVersion, `${telemetryField} dependency pin`).toBeDefined();
      const telemetryLiterals = [
        ...bootstrapSource.matchAll(new RegExp(`${telemetryField}: "(\\d+\\.\\d+\\.\\d+)"`, "g")),
      ].map((match) => match[1]);
      expect(telemetryLiterals, `${telemetryField} telemetry literals`).toEqual([
        packageVersion,
        packageVersion,
      ]);
    }
  });
});
