import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { serializeInstallStoreRecord } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  assertInstallerRepairProductionReplayCompiledModule,
  deriveProductionReplaySourceReads,
  INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT,
  INSTALLER_REPAIR_PRODUCTION_REPLAY_RETAINED_PASS_IDENTITY,
  INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION,
  INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST,
  INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION,
  type ProductionReplayObservation,
  recomputeProductionReplaySemanticContractDigest,
  validateProductionReplayObservation,
  validateProductionReplayResult,
} from "./installer-repair-production-replay-contract";
import { sanitizeProductionReplayFailure } from "./installer-repair-production-replay-evidence";
import {
  assertExactProductionReplayPublicationMetadata,
  exactProductionReplayRepairEligibilityPath,
  executeAfterProductionReplayIdentityValidation,
  executeReplay,
  INSTALLER_REPAIR_PRODUCTION_REPLAY_COMMAND,
  INSTALLER_REPAIR_PRODUCTION_REPLAY_PROTOCOL_IDENTITY,
  isExactProductionReplayRepairEligibilityPath,
  ProductionReplayPublicationMetadataError,
  INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION as RUNNER_SCHEMA_VERSION,
} from "./installer-repair-production-replay-run";

const DIGEST = INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.identities.releaseDigest;
const RESOURCE = INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.admittedResource.value;

describe("installer Repair production replay required-gate wiring", () => {
  it("rejects compiled replay modules with semantic version, fixed digest, or recomputation drift", () => {
    const validModule = {
      INSTALLER_REPAIR_PRODUCTION_REPLAY_PROTOCOL_IDENTITY:
        INSTALLER_REPAIR_PRODUCTION_REPLAY_PROTOCOL_IDENTITY,
      INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION:
        INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION,
      INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST,
      INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION,
      executeReplay,
      recomputeProductionReplaySemanticContractDigest,
      validateProductionReplayArtifactIdentity: (): void => undefined,
    } as const;
    expect(() => assertInstallerRepairProductionReplayCompiledModule(validModule)).not.toThrow();
    expect(() =>
      assertInstallerRepairProductionReplayCompiledModule({
        ...validModule,
        INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION: 8,
      }),
    ).toThrow();
    expect(() =>
      assertInstallerRepairProductionReplayCompiledModule({
        ...validModule,
        INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST: "f".repeat(64),
      }),
    ).toThrow();
    expect(() =>
      assertInstallerRepairProductionReplayCompiledModule({
        ...validModule,
        recomputeProductionReplaySemanticContractDigest: () => "e".repeat(64),
      }),
    ).toThrow();
  });

  it("parses the named command and binds its importable runner to the semantic contract", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const packageJson = JSON.parse(
      await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const runnerSource = await readFile(
      resolve(repositoryRoot, "harness/src/installer-repair-production-replay-run.ts"),
      "utf8",
    );

    expect(packageJson.scripts["harness:installer-repair-production-replay"]).toBe(
      "pnpm build && node harness/dist/types/installer-repair-production-replay-run.js",
    );
    expect(INSTALLER_REPAIR_PRODUCTION_REPLAY_COMMAND).toBe(
      "pnpm harness:installer-repair-production-replay",
    );
    expect(RUNNER_SCHEMA_VERSION).toBe(INSTALLER_REPAIR_PRODUCTION_REPLAY_SCHEMA_VERSION);
    expect(INSTALLER_REPAIR_PRODUCTION_REPLAY_PROTOCOL_IDENTITY).toBe(
      `installer-repair-production-replay@${RUNNER_SCHEMA_VERSION}`,
    );
    expect(runnerSource).not.toContain("installer-repair-production-replay@2");
    expect(runnerSource).toContain("$" + "{INSTALLER_REPAIR_PRODUCTION_REPLAY_PROTOCOL_IDENTITY}");
    expect(runnerSource).toContain(
      "!isExactProductionReplayRepairEligibilityPath(path, releaseDigest)",
    );
    expect(runnerSource).not.toMatch(/endsWith\(["']\/repair-eligibility\.json["']\)/u);
    expect(runnerSource).not.toContain("PARALLAX_REPAIR_LIFETIME_MODE");
    expect(runnerSource).not.toContain("process.env");
    expect(runnerSource).not.toContain("resolve(process.cwd())");
    expect(runnerSource).toContain(
      'const repositoryRoot = resolve(import.meta.dirname, "../../..");',
    );
    expect(runnerSource).toContain('executeReplayMode(repositoryRoot, "restarted", artifacts)');
    expect(runnerSource).toContain('executeReplayMode(repositoryRoot, "same-worker", artifacts)');
    expect(runnerSource).not.toContain("restarted.worker.publicComposite.installStore");
    expect(runnerSource).not.toContain("restarted.worker.transferTelemetry");
    expect(runnerSource).not.toContain("sameWorker.worker.transferTelemetry");
    expect(runnerSource.indexOf("executeAfterProductionReplayIdentityValidation(")).toBeLessThan(
      runnerSource.indexOf('executeReplayMode(repositoryRoot, "restarted", artifacts)'),
    );
    expect(runnerSource).toContain("createInstallerWorkerSession({");
    expect(runnerSource).toContain("context.completionCredit");
    expect(runnerSource).not.toContain("completionCredit: {");
    expect(runnerSource).toContain("directories: new Set()");
    expect(runnerSource).toContain("retainReplayParentDirectories(state, path)");
    expect(runnerSource).toContain("for (const path of state.directories)");
    expect(runnerSource).toContain("for (const candidate of [...state.directories])");
    expect(INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.result.modes).toEqual([
      "restarted",
      "same-worker",
    ]);
    expect(typeof executeReplay).toBe("function");
    expect(INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION).toBe(10);
    expect(INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST).toBe(
      recomputeProductionReplaySemanticContractDigest(),
    );
  });

  it("pins the retained 01-27 pass to its historical artifact without qualifying the live target", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const retained = INSTALLER_REPAIR_PRODUCTION_REPLAY_RETAINED_PASS_IDENTITY;
    const root = resolve(
      repositoryRoot,
      "harness/results/installer-repair-production-replay",
      retained.stem,
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(retained.jsonSha256);
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(retained.markdownSha256);
    const result = JSON.parse(jsonBytes.toString("utf8")) as {
      canonicalBinding: { payloadSha256: string };
      replay: {
        modes: {
          restarted: { identities: Record<string, unknown> };
          "same-worker": { identities: Record<string, unknown> };
        };
        semanticContractDigest: string;
        semanticContractVersion: number;
      };
      state: string;
    };
    const expectedHistoricalIdentity = {
      appEntrypointPath: retained.appEntrypointPath,
      buildManifestSha256: retained.buildManifestSha256,
      installManifestSha256: retained.installManifestSha256,
      opfsBytes: 2_621_434_134,
      opfsResourceCount: 263,
      releaseDigest: retained.releaseDigest,
      resourceIdentitySha256: retained.resourceIdentitySha256,
    };
    expect(result).toMatchObject({
      canonicalBinding: { payloadSha256: retained.canonicalBindingSha256 },
      replay: {
        modes: {
          restarted: { identities: expectedHistoricalIdentity },
          "same-worker": { identities: expectedHistoricalIdentity },
        },
        semanticContractDigest: retained.semanticContractDigest,
        semanticContractVersion: retained.semanticContractVersion,
      },
      state: "passed",
    });
    expect(retained.buildManifestSha256).not.toBe(
      INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.identities.buildManifestSha256,
    );
    expect(retained.releaseDigest).not.toBe(
      INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.identities.releaseDigest,
    );
    let rejection: unknown = null;
    try {
      validateProductionReplayResult(result.replay);
    } catch (error: unknown) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(Error);
    const rejectionMessage = rejection instanceof Error ? rejection.message : "";
    expect(rejectionMessage).toContain(retained.semanticContractDigest);
    expect(rejectionMessage).toContain(INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST);
  });

  it("rejects stale build, release, and app-derived identities before either mode executes", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const buildBytes = new Uint8Array(
      await readFile(resolve(repositoryRoot, "dist/build-manifest.json")),
    );
    const installBytes = new Uint8Array(
      await readFile(resolve(repositoryRoot, "dist/install-manifest.json")),
    );
    const modeExecutions: string[] = [];
    const executeModes = async () => {
      modeExecutions.push("restarted", "same-worker");
      return "executed";
    };
    await expect(
      executeAfterProductionReplayIdentityValidation(buildBytes, installBytes, executeModes),
    ).resolves.toBe("executed");
    expect(modeExecutions).toEqual(["restarted", "same-worker"]);

    modeExecutions.length = 0;
    const staleBuildBytes = new Uint8Array(buildBytes.byteLength + 1);
    staleBuildBytes.set(buildBytes);
    staleBuildBytes[staleBuildBytes.byteLength - 1] = 0x0a;
    await expect(
      executeAfterProductionReplayIdentityValidation(staleBuildBytes, installBytes, executeModes),
    ).rejects.toThrow(/build manifest SHA/u);
    expect(modeExecutions).toEqual([]);

    const staleInstallBytes = new Uint8Array(installBytes.byteLength + 1);
    staleInstallBytes.set(installBytes);
    staleInstallBytes[staleInstallBytes.byteLength - 1] = 0x0a;
    await expect(
      executeAfterProductionReplayIdentityValidation(buildBytes, staleInstallBytes, executeModes),
    ).rejects.toThrow(/install manifest SHA/u);
    expect(modeExecutions).toEqual([]);

    const staleAppManifest = JSON.parse(new TextDecoder().decode(buildBytes)) as {
      artifacts: Array<{ path: string; sha256: string }>;
    };
    const appArtifact = staleAppManifest.artifacts.find(({ path }) =>
      /^immutable\/app-[a-f0-9]{64}\.js$/u.test(path),
    );
    expect(appArtifact).toBeDefined();
    if (appArtifact === undefined) throw new Error("Current app artifact is absent");
    appArtifact.path = `immutable/app-${"0".repeat(64)}.js`;
    appArtifact.sha256 = "0".repeat(64);
    const staleAppBytes = new TextEncoder().encode(JSON.stringify(staleAppManifest));
    await expect(
      executeAfterProductionReplayIdentityValidation(staleAppBytes, installBytes, executeModes),
    ).rejects.toThrow(/app entrypoint identity/u);
    expect(modeExecutions).toEqual([]);
  });

  it("rederives every current publication path and record hash from the exact release", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const installBytes = new Uint8Array(
      await readFile(resolve(repositoryRoot, "dist/install-manifest.json")),
    );
    const releaseDigest = createHash("sha256").update(installBytes).digest("hex");
    const record = (path: string, value: Parameters<typeof serializeInstallStoreRecord>[0]) => {
      const bytes = serializeInstallStoreRecord(value);
      return {
        bytes: bytes.byteLength,
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    };
    const entries = [
      record(`parallax-install-v1/commits/00000000000000000001-${releaseDigest}.json`, {
        ordinal: 1,
        releaseDigest,
        schemaVersion: 1,
      }),
      {
        bytes: installBytes.byteLength,
        path: `parallax-install-v1/releases/${releaseDigest}/install-manifest.json`,
        sha256: releaseDigest,
      },
      record(`parallax-install-v1/releases/${releaseDigest}/published.json`, {
        releaseDigest,
        schemaVersion: 1,
      }),
      record(`parallax-install-v1/releases/${releaseDigest}/ready.json`, {
        opfsBytes: INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.bytes,
        opfsResourceCount: INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.resources,
        releaseDigest,
        schemaVersion: 1,
      }),
      record(`parallax-install-v1/releases/${releaseDigest}/staged.json`, {
        gameId: "parallax",
        installManifestSchemaVersion: 1,
        releaseDigest,
        schemaVersion: 1,
      }),
    ];
    expect(releaseDigest).toBe(
      INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.identities.releaseDigest,
    );
    expect(entries).toEqual(
      INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.publication.entries,
    );
  });

  it("pins Node-ESM relative imports and the post-build compiled-module probe", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const runtimeSources = await Promise.all(
      [
        "installer-repair-production-replay-contract.ts",
        "installer-repair-production-replay-evidence.ts",
        "installer-repair-production-replay-run.ts",
      ].map(async (name) => ({
        name,
        source: await readFile(resolve(repositoryRoot, "harness/src", name), "utf8"),
      })),
    );
    for (const { name, source } of runtimeSources) {
      const relativeImports = [
        ...source.matchAll(/(?:from\s+|import\s*\()\s*["'](\.[^"']+)["']/gu),
      ].map((match) => match[1]);
      for (const importPath of relativeImports) {
        expect(importPath, `${name} has a bundler-only relative import`).toMatch(/\.js$/u);
      }
    }

    const buildSource = await readFile(
      resolve(repositoryRoot, "harness/scripts/build.mjs"),
      "utf8",
    );
    expect(buildSource).toMatch(
      /runPnpm\(\["verify:repeatable"\]\);\s*await verifyInstallerRepairProductionReplayModuleGraph\(\);/u,
    );
    expect(buildSource).toContain("harness/dist/types/installer-repair-production-replay-run.js");
    expect(buildSource).toContain(
      "assertInstallerRepairProductionReplayCompiledModule(replayModule)",
    );
    expect(buildSource).toContain("replayModule.validateProductionReplayArtifactIdentity(");
    expect(buildSource).toContain('readFile(join(outputRoot, "build-manifest.json"))');
    expect(buildSource).toContain("readFile(join(outputRoot, installManifestPath))");
    expect(buildSource).toContain(
      "Installer Repair production replay compiled module graph: import passed",
    );
  });

  it("reports the retained 760-byte repair-eligibility delta as a typed bounded publication mismatch", () => {
    const digest = "a".repeat(64);
    const baseline = [
      {
        bytes: 156,
        path: `parallax-install-v1/releases/${digest}/staged.json`,
        sha256: "b".repeat(64),
      },
    ] as const;
    const eligibility = {
      bytes: 760,
      path: `parallax-install-v1/releases/${digest}/repair-eligibility.json`,
      sha256: "c".repeat(64),
    } as const;
    let failure: unknown;
    try {
      assertExactProductionReplayPublicationMetadata(baseline, [...baseline, eligibility]);
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ProductionReplayPublicationMetadataError);
    const typed = failure as ProductionReplayPublicationMetadataError;
    expect(typed.delta).toEqual({
      changed: [],
      changedCount: 0,
      extra: [eligibility],
      extraCount: 1,
      missing: [],
      missingCount: 0,
    });
    const sanitized = sanitizeProductionReplayFailure(typed, "publication-boundary");
    expect(sanitized.message).toContain("missing=0 extra=1 changed=0");
    expect(sanitized.causes).toHaveLength(1);
    expect(sanitized.causes[0]?.message).toContain(eligibility.path);
    expect(sanitized.causes[0]?.message).toContain("bytes=760");
    expect(sanitized.causes[0]?.message).toContain(eligibility.sha256);
    expect(sanitized.message.length).toBeLessThanOrEqual(320);
  });

  it("reports exact bounded missing and changed publication entries", () => {
    const digest = "d".repeat(64);
    const missing = {
      bytes: 103,
      path: `parallax-install-v1/releases/${digest}/published.json`,
      sha256: "e".repeat(64),
    } as const;
    const changed = {
      bytes: 150,
      path: `parallax-install-v1/releases/${digest}/ready.json`,
      sha256: "f".repeat(64),
    } as const;
    const changedAfter = { ...changed, bytes: 151, sha256: "0".repeat(64) };
    let failure: unknown;
    try {
      assertExactProductionReplayPublicationMetadata([missing, changed], [changedAfter]);
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ProductionReplayPublicationMetadataError);
    const typed = failure as ProductionReplayPublicationMetadataError;
    expect(typed.delta).toMatchObject({
      changed: [{ after: changedAfter, before: changed, path: changed.path }],
      changedCount: 1,
      extraCount: 0,
      missing: [missing],
      missingCount: 1,
    });
    const sanitized = sanitizeProductionReplayFailure(typed, "publication-boundary");
    expect(sanitized.message).toContain("missing=1 extra=0 changed=1");
    expect(sanitized.causes.map(({ message }) => message)).toEqual([
      expect.stringContaining(`missing:${missing.path},bytes=103,sha256=${missing.sha256}`),
      expect.stringContaining(
        `changed:${changed.path},before=150:${changed.sha256},after=151:${changedAfter.sha256}`,
      ),
    ]);
    expect(() =>
      assertExactProductionReplayPublicationMetadata([missing, changed], [missing, changed]),
    ).not.toThrow();
  });

  it("excludes only the exact canonical target repair-eligibility path", () => {
    const digest = "a".repeat(64);
    const otherDigest = "b".repeat(64);
    const exact = exactProductionReplayRepairEligibilityPath(digest);
    expect(isExactProductionReplayRepairEligibilityPath(exact, digest)).toBe(true);

    const variants = [
      exact.replace("/repair-eligibility.json", "/nested/repair-eligibility.json"),
      exact.replace(`/releases/${digest}/`, `/releases/${digest}-sibling/`),
      exactProductionReplayRepairEligibilityPath(otherDigest),
      exact.replace("repair-eligibility.json", "Repair-Eligibility.json"),
    ] as const;
    const baseline = {
      bytes: 156,
      path: `parallax-install-v1/releases/${digest}/staged.json`,
      sha256: "3".repeat(64),
    } as const;
    for (const [index, path] of variants.entries()) {
      expect(isExactProductionReplayRepairEligibilityPath(path, digest)).toBe(false);
      const extra = { bytes: 700 + index, path, sha256: String(index + 4).repeat(64) };
      let failure: unknown;
      try {
        assertExactProductionReplayPublicationMetadata([baseline], [baseline, extra]);
      } catch (error: unknown) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(ProductionReplayPublicationMetadataError);
      expect((failure as ProductionReplayPublicationMetadataError).delta).toMatchObject({
        extra: [extra],
        extraCount: 1,
      });
    }

    for (const path of [
      exact.replace("parallax-install-v1/", "parallax-install-v1\\"),
      exact.replace("/releases/", "//releases/"),
      `/${exact}`,
    ]) {
      expect(() => isExactProductionReplayRepairEligibilityPath(path, digest)).toThrow(
        /outside the parallax-install-v1 capability/u,
      );
    }
    expect(() => exactProductionReplayRepairEligibilityPath(digest.toUpperCase())).toThrow(
      /release digest is invalid/u,
    );
  });

  it("accepts a bounded exact synthetic observation", () => {
    expect(validateProductionReplayObservation(validObservation())).toMatchObject({
      admittedResource: RESOURCE,
      opfsBytes: INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.bytes,
      opfsResourceCount: INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.resources,
      releaseDigest: DIGEST,
      semanticContractDigest: INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST,
      semanticContractVersion: INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION,
    });
  });

  it("accepts exact same-worker completion credit and rejects an unpaired mode claim", () => {
    const sameWorker = structuredClone(validObservation()) as unknown as MutableObservation;
    sameWorker.lifetimeMode = "same-worker";
    sameWorker.workerResponse.requestId = 2;
    for (const transfer of [
      sameWorker.transferTelemetry,
      sameWorker.publicComposite.installerTransfer,
    ]) {
      transfer.completedResourceCount =
        INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.resources;
      transfer.verifiedBytes = INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.bytes;
    }
    expect(() =>
      validateProductionReplayObservation(sameWorker as unknown as ProductionReplayObservation),
    ).not.toThrow();

    const unpaired = structuredClone(sameWorker) as unknown as MutableObservation;
    unpaired.publicComposite.installerTransfer.verifiedBytes = 0;
    expect(() =>
      validateProductionReplayObservation(unpaired as unknown as ProductionReplayObservation),
    ).toThrow();
  });

  it("allows projected duration differences but rejects deterministic cross-mode drift", () => {
    const restartedObservation = validObservation();
    const sameWorkerObservation = structuredClone(
      restartedObservation,
    ) as unknown as MutableObservation;
    sameWorkerObservation.lifetimeMode = "same-worker";
    sameWorkerObservation.workerResponse.requestId = 2;
    for (const transfer of [
      sameWorkerObservation.transferTelemetry,
      sameWorkerObservation.publicComposite.installerTransfer,
    ]) {
      transfer.completedResourceCount =
        INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.resources;
      transfer.verifiedBytes = INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.bytes;
    }
    const mode = (
      observation: ProductionReplayObservation,
      lifetimeMode: "restarted" | "same-worker",
    ) => {
      const validated = validateProductionReplayObservation(observation);
      return {
        identities: {
          appEntrypointPath:
            INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.identities.appEntrypointPath,
          buildManifestSha256: observation.buildManifestSha256,
          installManifestSha256: observation.installManifestSha256,
          opfsBytes: observation.opfsBytes,
          opfsResourceCount: observation.opfsResourceCount,
          releaseDigest: observation.releaseDigest,
          resourceIdentitySha256: observation.resourceIdentitySha256,
        },
        lifetimeMode,
        postValidation: {
          ...validated.postValidation,
          publication: validated.publication,
        },
        requests: INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.result.requestSequences[
          lifetimeMode
        ].map((request) => ({
          request,
          response: {
            ...INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.workerResponse.value,
            requestId: request.requestId,
          },
        })),
        sourceReads: validated.sourceReads,
        worker: {
          fetch: validated.fetch,
          protocolResponse: validated.workerResponse,
          publicComposite: validated.publicComposite,
          transferTelemetry: validated.transferTelemetry,
        },
      };
    };
    const result = {
      crossMode: INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.result.crossMode.value,
      lifetimeModes: ["restarted", "same-worker"],
      modes: {
        restarted: mode(restartedObservation, "restarted"),
        "same-worker": mode(
          sameWorkerObservation as unknown as ProductionReplayObservation,
          "same-worker",
        ),
      },
      semanticContractDigest: INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST,
      semanticContractVersion: INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION,
    };
    expect(() => validateProductionReplayResult(result)).not.toThrow();
    const variableDurations = structuredClone(result) as unknown as {
      modes: Record<
        "restarted" | "same-worker",
        {
          worker: {
            publicComposite: {
              installStore: Record<string, number>;
              installerTransfer: Record<string, number>;
            };
            transferTelemetry: Record<string, number>;
          };
        }
      >;
    };
    variableDurations.modes.restarted.worker.transferTelemetry.lockWaitDurationMs = 0.125;
    variableDurations.modes.restarted.worker.transferTelemetry.operationDurationMs = 1.25;
    variableDurations.modes.restarted.worker.publicComposite.installerTransfer.lockWaitDurationMs = 0.125;
    variableDurations.modes.restarted.worker.publicComposite.installerTransfer.operationDurationMs = 1.25;
    variableDurations.modes.restarted.worker.publicComposite.installStore.lastOperationDurationMs = 2.5;
    variableDurations.modes["same-worker"].worker.transferTelemetry.lockWaitDurationMs = 0.5;
    variableDurations.modes["same-worker"].worker.transferTelemetry.operationDurationMs = 3.75;
    variableDurations.modes[
      "same-worker"
    ].worker.publicComposite.installerTransfer.lockWaitDurationMs = 0.5;
    variableDurations.modes[
      "same-worker"
    ].worker.publicComposite.installerTransfer.operationDurationMs = 3.75;
    variableDurations.modes[
      "same-worker"
    ].worker.publicComposite.installStore.lastOperationDurationMs = 4.5;
    expect(() => validateProductionReplayResult(variableDurations)).not.toThrow();
    const mismatchedDurations = structuredClone(variableDurations);
    mismatchedDurations.modes.restarted.worker.publicComposite.installerTransfer.operationDurationMs = 1.5;
    expect(() => validateProductionReplayResult(mismatchedDurations)).toThrow();
    const deterministicTransferMismatch = structuredClone(variableDurations);
    deterministicTransferMismatch.modes["same-worker"].worker.transferTelemetry.retryCount = 1;
    deterministicTransferMismatch.modes[
      "same-worker"
    ].worker.publicComposite.installerTransfer.retryCount = 1;
    expect(() => validateProductionReplayResult(deterministicTransferMismatch)).toThrow();
    expect(() =>
      validateProductionReplayResult({
        ...result,
        modes: { restarted: result.modes.restarted },
      }),
    ).toThrow();
    expect(() =>
      validateProductionReplayResult({
        ...result,
        modes: {
          ...result.modes,
          "same-worker": {
            ...result.modes["same-worker"],
            sourceReads: { ...result.modes["same-worker"].sourceReads, totalBytes: 0 },
          },
        },
      }),
    ).toThrow();
  });

  it("accepts an equal finite fractional store duration and rejects invalid or mismatched values", () => {
    const accepted = structuredClone(validObservation()) as unknown as MutableObservation;
    accepted.installStore.lastOperationDurationMs = 0.25;
    accepted.publicComposite.installStore.lastOperationDurationMs = 0.25;
    expect(() =>
      validateProductionReplayObservation(accepted as unknown as ProductionReplayObservation),
    ).not.toThrow();
    for (const [direct, publicValue] of [
      [-1, -1],
      [Number.NaN, Number.NaN],
      [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
      [0.25, 0.5],
    ]) {
      const rejected = structuredClone(validObservation()) as unknown as MutableObservation;
      rejected.installStore.lastOperationDurationMs = direct;
      rejected.publicComposite.installStore.lastOperationDurationMs = publicValue;
      expect(() =>
        validateProductionReplayObservation(rejected as unknown as ProductionReplayObservation),
      ).toThrow();
    }
  });

  it("accepts equal finite fractional transfer durations and rejects invalid or mismatched values", () => {
    for (const field of ["lockWaitDurationMs", "operationDurationMs"] as const) {
      const accepted = structuredClone(validObservation()) as unknown as MutableObservation;
      accepted.transferTelemetry[field] = 0.125;
      accepted.publicComposite.installerTransfer[field] = 0.125;
      expect(() =>
        validateProductionReplayObservation(accepted as unknown as ProductionReplayObservation),
      ).not.toThrow();
      for (const [direct, publicValue] of [
        [-1, -1],
        [Number.NaN, Number.NaN],
        [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
        [0.125, 0.5],
      ]) {
        const rejected = structuredClone(validObservation()) as unknown as MutableObservation;
        rejected.transferTelemetry[field] = direct;
        rejected.publicComposite.installerTransfer[field] = publicValue;
        expect(() =>
          validateProductionReplayObservation(rejected as unknown as ProductionReplayObservation),
        ).toThrow();
      }
    }
  });

  it.each([...MUTATIONS, ...fieldMutations()])("rejects a mutation of %s", (_label, mutate: (
    value: MutableObservation,
  ) => void) => {
    const value = structuredClone(validObservation()) as unknown as MutableObservation;
    mutate(value);
    expect(() =>
      validateProductionReplayObservation(value as unknown as ProductionReplayObservation),
    ).toThrow();
  });
});

interface MutableReadMetrics {
  distinctSourcePaths: number;
  distinctVerifiedMarkerPaths: number;
  sourceReadBytes: number;
  sourceReadOperations: number;
}

interface MutableObservation {
  appEntrypointPath: string;
  buildManifestSha256: string;
  fetches: Array<{
    bodyBytes: number;
    ifRange: string | null;
    range: string | null;
    url: string;
  }>;
  installStore: Record<string, unknown>;
  lifetimeMode: string;
  publicationAfter: Array<{ bytes: number; path: string; sha256: string }>;
  publicationBefore: Array<{ bytes: number; path: string; sha256: string }>;
  publicationCountBefore: number;
  publicComposite: {
    installStore: Record<string, unknown>;
    installerTransfer: Record<string, unknown>;
  };
  sourceReads: {
    admission: MutableReadMetrics;
    initial: MutableReadMetrics;
    repair: MutableReadMetrics;
    totalBytes: number;
  };
  secondCorruption: {
    admissionUnchanged: boolean;
    failureCode: string;
    recoveryAction: string;
    rejected: boolean;
  };
  semanticContractDigest: string;
  semanticContractVersion: number;
  transferTelemetry: Record<string, unknown> & {
    downloadedBytes: number;
    operationRepairedResourceCount: number;
  };
  workerResponse: Record<string, unknown> & {
    readyBytes: number;
    requestId: number;
  };
}

const MUTATIONS: readonly (readonly [string, (value: MutableObservation) => void])[] = [
  ["initial source bytes", (value) => (value.sourceReads.initial.sourceReadBytes -= 1)],
  ["admission operations", (value) => (value.sourceReads.admission.sourceReadOperations -= 1)],
  ["repair marker count", (value) => (value.sourceReads.repair.distinctVerifiedMarkerPaths -= 1)],
  ["total source bytes", (value) => (value.sourceReads.totalBytes -= 1)],
  ["fetch count", (value) => value.fetches.push({ ...firstFetch(value) })],
  ["fetch body", (value) => (firstFetch(value).bodyBytes -= 1)],
  ["fetch URL", (value) => (firstFetch(value).url += "?alternate")],
  ["Range", (value) => (firstFetch(value).range = "bytes=1-")],
  ["If-Range", (value) => (firstFetch(value).ifRange = '"stale"')],
  ["worker ready bytes", (value) => (value.workerResponse.readyBytes -= 1)],
  ["worker request", (value) => (value.workerResponse.requestId = 2)],
  ["transfer download", (value) => (value.transferTelemetry.downloadedBytes -= 1)],
  [
    "transfer repair count",
    (value) => (value.transferTelemetry.operationRepairedResourceCount = 0),
  ],
  ["public transfer mismatch", (value) => (value.publicComposite.installerTransfer.retryCount = 1)],
  ["store readiness", (value) => (value.installStore.readyReleaseCount = 2)],
  ["public store mismatch", (value) => (value.publicComposite.installStore.publicationCount = 2)],
  ["publication count", (value) => (value.publicationCountBefore = 2)],
  ["publication bytes", (value) => (firstPublication(value).sha256 = "b".repeat(64))],
  ["app entrypoint", (value) => (value.appEntrypointPath = "immutable/app-stale.js")],
  ["build identity", (value) => (value.buildManifestSha256 = "b".repeat(63))],
  ["second corruption", (value) => (value.secondCorruption.rejected = false)],
  ["semantic digest", (value) => (value.semanticContractDigest = "f".repeat(64))],
  ["lifetime mode", (value) => (value.lifetimeMode = "historical")],
  [
    "agreeing transfer retry",
    (value) => {
      value.transferTelemetry.retryCount = 1;
      value.publicComposite.installerTransfer.retryCount = 1;
    },
  ],
  [
    "agreeing publication count",
    (value) => {
      value.publicationCountBefore = 2;
      value.installStore.publicationCount = 2;
      value.publicComposite.installStore.publicationCount = 2;
    },
  ],
  [
    "agreeing publication entry bytes",
    (value) => {
      firstPublication(value).bytes += 1;
      const before = value.publicationBefore[0];
      if (before === undefined) throw new Error("Synthetic prior publication is absent");
      before.bytes += 1;
    },
  ],
  [
    "agreeing publication order",
    (value) => {
      value.publicationAfter = [...value.publicationAfter].reverse();
      value.publicationBefore = [...value.publicationBefore].reverse();
    },
  ],
  [
    "agreeing empty publication",
    (value) => {
      value.publicationAfter.length = 0;
      value.publicationBefore.length = 0;
    },
  ],
];

function fieldMutations(): readonly (readonly [string, (value: MutableObservation) => void])[] {
  const result: Array<readonly [string, (value: MutableObservation) => void]> = [];
  for (const field of INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.store.fields) {
    if (field === "lastOperationDurationMs") continue;
    result.push([
      `agreeing store field ${field}`,
      (value) => {
        const alternate = alternateValidValue(field, value.installStore[field]);
        value.installStore[field] = alternate;
        value.publicComposite.installStore[field] = alternate;
      },
    ]);
  }
  for (const field of INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.transfer.fields) {
    if (field === "lockWaitDurationMs" || field === "operationDurationMs") continue;
    result.push([
      `agreeing transfer field ${field}`,
      (value) => {
        const alternate = alternateValidValue(field, value.transferTelemetry[field]);
        value.transferTelemetry[field] = alternate;
        value.publicComposite.installerTransfer[field] = alternate;
      },
    ]);
  }
  for (const field of INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.publicComposite.fields) {
    result.push([
      `public composite field ${field}`,
      (value) => {
        value.publicComposite[field as keyof typeof value.publicComposite] = {
          unsupported: true,
        };
      },
    ]);
  }
  for (const phase of ["admission", "initial", "repair"] as const) {
    for (const field of INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.sourceReads
      .metricFields) {
      result.push([
        `source-read formula ${phase}.${field}`,
        (value) => {
          value.sourceReads[phase][field] += 1;
        },
      ]);
    }
  }
  result.push([
    "semantic descriptor version",
    (value) => {
      value.semanticContractVersion += 1;
    },
  ]);
  return result;
}

function alternateValidValue(field: string, value: unknown): unknown {
  if (typeof value === "number") return value + 1;
  if (typeof value === "boolean") return !value;
  if (typeof value === "string") {
    if (field === "state") return value === "ready" ? "idle" : "ready";
    if (field === "finalVerificationPhase") return value === "complete" ? "idle" : "complete";
    if (field.toLowerCase().includes("digest")) return "b".repeat(64);
    return `${value}-alternate`;
  }
  if (field === "persistedState") return false;
  if (field === "activeRequestId") return 1;
  if (field.toLowerCase().includes("digest")) return "b".repeat(64);
  if (field.endsWith("ResourceId")) return "alternate-resource";
  if (field === "failureCode") return "unknown";
  if (field === "failureMessage") return "alternate failure";
  return 0;
}

function firstFetch(value: MutableObservation): MutableObservation["fetches"][number] {
  const fetch = value.fetches[0];
  if (fetch === undefined) throw new Error("Synthetic replay fetch is absent");
  return fetch;
}

function firstPublication(
  value: MutableObservation,
): MutableObservation["publicationAfter"][number] {
  const publication = value.publicationAfter[0];
  if (publication === undefined) throw new Error("Synthetic publication is absent");
  return publication;
}

function validObservation(): ProductionReplayObservation {
  const store = {
    ...INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.store.exact,
    lastOperationDurationMs: 0,
  };
  const transfer = { ...INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.transfer.value };
  return Object.freeze({
    admittedResource: RESOURCE,
    appEntrypointPath:
      INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.identities.appEntrypointPath,
    buildManifestSha256:
      INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.identities.buildManifestSha256,
    fetches: Object.freeze([
      Object.freeze({
        ...INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.request.value,
      }),
    ]),
    installStore: Object.freeze(store),
    installManifestSha256:
      INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.identities.installManifestSha256,
    lifetimeMode: "restarted",
    opfsBytes: INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.bytes,
    opfsResourceCount: INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.resources,
    publicComposite: Object.freeze({
      installStore: Object.freeze({ ...store }),
      installerTransfer: Object.freeze({ ...transfer }),
    }),
    publicationAfter: INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.publication.entries,
    publicationBefore: INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.publication.entries,
    publicationCountBefore: 1,
    releaseDigest: INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.identities.releaseDigest,
    resourceIdentitySha256:
      INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.identities.resourceIdentitySha256,
    secondCorruption: Object.freeze({
      admissionUnchanged: true,
      failureCode: "integrity",
      recoveryAction: "repair",
      rejected: true,
    }),
    semanticContractDigest: INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_DIGEST,
    semanticContractVersion: INSTALLER_REPAIR_PRODUCTION_REPLAY_SEMANTIC_CONTRACT_VERSION,
    sourceReads: deriveProductionReplaySourceReads(),
    transferTelemetry: Object.freeze(transfer),
    workerResponse: Object.freeze({
      kind: "install-complete",
      readyBytes: INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.bytes,
      readyResourceCount: INSTALLER_REPAIR_PRODUCTION_REPLAY_EXPECTED_CONTRACT.opfs.resources,
      releaseDigest: DIGEST,
      requestId: 1,
    }),
  });
}
