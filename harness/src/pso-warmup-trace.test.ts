import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readAndValidatePsoWarmupTraceIdentity,
  resolveExpectedPsoWarmupTraceIdentity,
  validateExactPsoWarmupTraceBytes,
} from "./pso-warmup-trace";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("independent PSO warmup trace resolver", () => {
  it("derives every full identity field and canonical byte identity independently", () => {
    const identity = resolveExpectedPsoWarmupTraceIdentity();
    expect(identity).toMatchObject({
      entry: {
        id: "babylon-lite.standard-opaque-msaa4",
        state: {
          colorTarget: { blend: null, format: "bgra8unorm", writeMask: 15 },
          depthStencil: {
            depthCompare: "greater-equal",
            depthWriteEnabled: true,
            format: "depth24plus-stencil8",
          },
          multisample: { alphaToCoverageEnabled: false, count: 4, mask: 0xffff_ffff },
          primitive: { cullMode: "back", frontFace: "ccw", topology: "triangle-list" },
          shader: { materialFeatureKey: 0, meshFeatureKey: 0 },
          vertexBuffers: [
            {
              arrayStride: 12,
              attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }],
            },
            {
              arrayStride: 12,
              attributes: [{ format: "float32x3", offset: 0, shaderLocation: 1 }],
            },
          ],
        },
      },
      renderer: "@babylonjs/lite@1.12.0",
      schemaVersion: 1,
    });
    expect(identity.buildCompatibilityDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.entry.stateDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("validates exact build/install resource and trace bytes", async () => {
    const fixture = await traceFixture();
    await expect(
      readAndValidatePsoWarmupTraceIdentity(
        fixture.root,
        { artifacts: [fixture.artifact] },
        { resources: [fixture.resource] },
      ),
    ).resolves.toMatchObject({ sha256: fixture.identity.sha256 });

    await expect(
      readAndValidatePsoWarmupTraceIdentity(
        fixture.root,
        { artifacts: [fixture.artifact] },
        { resources: [{ ...fixture.resource, sha256: "a".repeat(64) }] },
      ),
    ).rejects.toThrow(/exact expected trace identity/);
  });

  it("rejects a canonical-looking trace with an arbitrary recomputed hash", async () => {
    const fixture = await traceFixture();
    const parsed = JSON.parse(fixture.bytes.toString("utf8")) as {
      entries: { state: { multisample: { count: number } }; stateDigest: string }[];
    };
    const entry = parsed.entries[0];
    if (entry === undefined) throw new Error("Trace fixture entry is missing");
    entry.state.multisample.count = 1;
    entry.stateDigest = "d".repeat(64);
    const mutated = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
    expect(createHash("sha256").update(mutated).digest("hex")).toMatch(/^[a-f0-9]{64}$/);
    expect(() => validateExactPsoWarmupTraceBytes(mutated)).toThrow(/exact independent/);
  });
});

async function traceFixture(): Promise<
  Readonly<{
    artifact: Readonly<{ bytes: number; path: string; sha256: string }>;
    bytes: Buffer;
    identity: ReturnType<typeof resolveExpectedPsoWarmupTraceIdentity>;
    resource: Readonly<{
      bytes: number;
      id: string;
      kind: string;
      scope: string;
      sha256: string;
      source: string;
      target: string;
    }>;
    root: string;
  }>
> {
  const identity = resolveExpectedPsoWarmupTraceIdentity();
  const root = await mkdtemp(join(tmpdir(), "parallax-pso-trace-"));
  temporaryRoots.push(root);
  const source = `immutable/pso-warmup-trace-${identity.sha256}.json`;
  const trace = {
    buildCompatibilityDigest: identity.buildCompatibilityDigest,
    entries: [identity.entry],
    renderer: identity.renderer,
    schemaVersion: identity.schemaVersion,
  };
  const bytes = Buffer.from(`${JSON.stringify(trace, null, 2)}\n`);
  await mkdir(join(root, "immutable"));
  await writeFile(join(root, source), bytes);
  const artifact = Object.freeze({
    bytes: identity.bytes,
    path: source,
    sha256: identity.sha256,
  });
  return Object.freeze({
    artifact,
    bytes,
    identity,
    resource: Object.freeze({
      ...artifact,
      id: "game-specific-pso-warmup-trace",
      kind: "asset-pack",
      scope: "game-specific",
      source,
      target: "opfs",
    }),
    root,
  });
}
