import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  createInstallerFailureDiagnostic,
  INSTALLER_FAILURE_RULES,
  type InstallerFailureCode,
  type InstallerSnapshot,
  type InstallStoreTelemetrySnapshot,
  idleInstallerTransferTelemetrySnapshot,
} from "@parallax/engine";
import type { Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import {
  createInstallerTrustTransitionBoundaryError,
  INSTALLER_TRUST_TRANSITION_BINDING_FAILURE_MESSAGE,
  INSTALLER_TRUST_TRANSITION_REJECTION_MESSAGE,
  readTrustedInstallerTrustTransitionBindingDiagnostic,
} from "./installer-trust-faults-binding-diagnostic.js";
import {
  finishInstallerTrustFaultBrowserCell,
  INSTALLER_TRUST_FAULT_READY_TIMEOUT_MS,
  runInstallerTrustTransitionBarrier,
} from "./installer-trust-faults-browser.js";
import {
  createInstallerTrustFaultOwnership,
  InstallerTrustFaultLifecycleAggregateError,
  InstallerTrustFaultOperationError,
} from "./installer-trust-faults-lifecycle.js";
import type { InstallerTrustFaultAuthority } from "./installer-trust-faults-result.js";
import {
  INSTALLER_TRUST_FAULT_CELL_IDS,
  INSTALLER_TRUST_FAULT_CHECKPOINT_BYTES,
  INSTALLER_TRUST_FAULTS_PREVIOUS_SCHEMA_VERSION,
  INSTALLER_TRUST_FAULTS_PROOF_SCHEMA_VERSION,
  parseInstallerTrustFaultAuthority,
  parseInstallerTrustFaultManifestResources,
  selectInstallerTrustFaultResource,
} from "./installer-trust-faults-result.js";
import {
  INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION,
  INSTALLER_TRUST_FAULT_LEGACY_RUN_SCHEMA_VERSION,
  INSTALLER_TRUST_FAULT_MAX_CANONICAL_PAYLOAD_BYTES,
  INSTALLER_TRUST_FAULT_MAX_SERIALIZED_JSON_REPORT_BYTES,
  INSTALLER_TRUST_FAULT_MAX_SERIALIZED_MARKDOWN_REPORT_BYTES,
  INSTALLER_TRUST_FAULT_PREVIOUS_RUN_SCHEMA_VERSION,
  INSTALLER_TRUST_FAULT_PROGRESS_STALL_MS,
  INSTALLER_TRUST_FAULT_PROOF_RUN_SCHEMA_VERSION,
  type InstallerTrustFaultRunDependencies,
  type InstallerTrustFaultRunOutcome,
  InstallerTrustFaultRunTimeoutError,
  type InstallerTrustFaultRuntimeDependencies,
  runInstallerTrustFaultQualification as runInstallerTrustFaultQualificationImpl,
  validateInstallerTrustFaultFailedCellRunBinding,
  validateInstallerTrustFaultRunEvidence,
  validateInstallerTrustFaultTerminalPair,
  validateRetainedInstallerTrustFaultAsynchronousHandoffFailure,
} from "./installer-trust-faults-run.js";
import {
  INSTALLER_TRUST_FAULT_CORRECTNESS_CEILING_MS,
  InstallerTrustFaultCellTerminalEvidenceError,
} from "./installer-trust-faults-terminal-evidence.js";
import {
  createInstallerTrustFaultTransitionProofRecorder,
  findTrustedInstallerTrustFaultRawObservationEvidence,
  INSTALLER_TRUST_FAULT_MAX_RAW_ARTIFACT_BYTES,
  INSTALLER_TRUST_FAULT_MAX_REJECTED_RAW_SAMPLE_BYTES,
  validateInstallerTrustFaultRawObservationEvidence,
  validateInstallerTrustFaultTransitionProof,
} from "./installer-trust-faults-transition-proof.js";
import type { InstallerTrustFaultTransition } from "./installer-trust-faults-transitions.js";
import { type ResultPairReservation, reserveResultPair } from "./result-pair.js";

type InstallerTrustFaultEagerTestDependencies = InstallerTrustFaultRuntimeDependencies &
  Pick<InstallerTrustFaultRunDependencies, "now" | "reserve">;

function runInstallerTrustFaultQualification(
  resultRoot: string,
  dependencies: InstallerTrustFaultRunDependencies | InstallerTrustFaultEagerTestDependencies,
): Promise<InstallerTrustFaultRunOutcome> {
  if ("createRuntimeDependencies" in dependencies) {
    return runInstallerTrustFaultQualificationImpl(resultRoot, dependencies);
  }
  const { executeCell, now, postValidate, preflight, reserve } = dependencies;
  return runInstallerTrustFaultQualificationImpl(resultRoot, {
    createRuntimeDependencies: async () => ({ executeCell, postValidate, preflight }),
    now,
    reserve,
  });
}

describe("installer trust-fault result lifecycle", () => {
  it("keeps per-Ready waits below the absolute run ceiling", () => {
    expect(INSTALLER_TRUST_FAULT_READY_TIMEOUT_MS).toBe(10 * 60_000);
    expect(INSTALLER_TRUST_FAULT_READY_TIMEOUT_MS).toBeLessThan(
      INSTALLER_TRUST_FAULT_CORRECTNESS_CEILING_MS,
    );
  });

  it("pins the retained v9 final-verification failure and canonical pair", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v9-2026-07-31T05-06-01-875Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "ae5e9a68e01a186b5a4471e05cacdfeb4901aac3383813fd801c3e585e9553e0",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "d1e775e7da358a0280a5b5a6bf156daca594c5474fc1ab30f4741259e3950a8e",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      canonicalBinding: {
        sha256: "d4326b9905f30c6adce783581db73989fad29498626317b989c13764fb39085e",
      },
      failedCell: {
        id: "final-verification-corruption",
        kind: "cell-validation",
        violatedPredicates: [
          "selected-request-count",
          "repaired-resource-count",
          "repaired-bytes",
          "downloaded-bytes",
        ],
      },
      resultSchemaVersion: 5,
      schemaVersion: 9,
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("pins the retained second v9 transition-proof collection failure and completed prefix", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v9-2026-07-31T05-44-09-738Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "eda85bf172deba39fadc91a9fa36257d4b91b427394f5e2975701c738c4f825e",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "a9f2331b58de6c393954bcee7b32fbb860f7023669f07d831e5194ce685ad06b",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      authority: {
        artifactDigest: "e5c9060ec5cb59430b9d4d8a1f5f310769442bf0e29c189fb39566d8543472dc",
        releaseDigest: "ff9f1f810ed3679ef547cd253d62a8880265d13085879b78d94e47ef7a4d9254",
      },
      canonicalBinding: {
        sha256: "6a75f90d939dd643fe89af49518a6aac11011a6b39024bffd90bca7080e2cc27",
      },
      cells: [{ id: "reused-object-corruption" }, { id: "final-verification-corruption" }],
      failedCell: null,
      failure: {
        phase: "cell",
        primary: {
          operation: "read-terminal-evidence",
        },
      },
      resultSchemaVersion: 5,
      schemaVersion: 9,
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("pins the retained v9 setup-arming failure and completed prefix", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v9-2026-07-31T06-42-31-467Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "7da1a533cd231848442f1ebb66da4f8ad7404b510750fadfef331115324afb82",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "b54d7ae71a31571a7452d0936f5049bb762e73621538bd43f69a11fd948f66fe",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      authority: {
        artifactDigest: "e5c9060ec5cb59430b9d4d8a1f5f310769442bf0e29c189fb39566d8543472dc",
        releaseDigest: "ff9f1f810ed3679ef547cd253d62a8880265d13085879b78d94e47ef7a4d9254",
      },
      canonicalBinding: {
        sha256: "cbcf59e69711911c1188077b9a18272c78a4eee466495c070ad1fd84f59664ba",
      },
      cells: [{ id: "reused-object-corruption" }, { id: "final-verification-corruption" }],
      failedCell: null,
      failure: {
        phase: "cell",
        primary: {
          operation: "establish-startup-transition-baseline",
        },
      },
      resultSchemaVersion: 5,
      schemaVersion: 9,
      state: "failed",
    });
    expect((json.cells as readonly Readonly<{ id: string }>[]).map((cell) => cell.id)).toEqual([
      "reused-object-corruption",
      "final-verification-corruption",
    ]);
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("pins the retained v9 nested-repair failure and completed prefix", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v9-2026-07-31T07-08-01-127Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "b764bae45837d5d720cd02a34e00ef8651c4d97be61fcc74886615b159445fcd",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "1db9d4583c61059d1136c69091220118d73cfea798d0df321dfeb74047824725",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      authority: {
        artifactDigest: "e5c9060ec5cb59430b9d4d8a1f5f310769442bf0e29c189fb39566d8543472dc",
        releaseDigest: "ff9f1f810ed3679ef547cd253d62a8880265d13085879b78d94e47ef7a4d9254",
      },
      canonicalBinding: {
        sha256: "0bc1657dd604164a729baa4e74a17fd02c474ac6ec9d2fbabe6a5a917eae6855",
      },
      cells: [{ id: "reused-object-corruption" }, { id: "final-verification-corruption" }],
      failedCell: null,
      failure: {
        phase: "cell",
        primary: {
          operation: "wait-for-attempt-1-failed",
        },
      },
      resultSchemaVersion: 5,
      schemaVersion: 9,
      state: "failed",
    });
    expect((json.cells as readonly Readonly<{ id: string }>[]).map((cell) => cell.id)).toEqual([
      "reused-object-corruption",
      "final-verification-corruption",
    ]);
    expect(json.failedCell).toBeNull();
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("pins the retained v9 A0-finalization failure and completed prefix", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v9-2026-07-31T07-44-09-563Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "62f707cdee29f438a0236397db1201396db39e73250492ab8f8ca970378f431d",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "1c5f4a37a98a08665992224a4904aa5bf6d53440988784d8c89ebf66396f2503",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      authority: {
        artifactDigest: "e5c9060ec5cb59430b9d4d8a1f5f310769442bf0e29c189fb39566d8543472dc",
        releaseDigest: "ff9f1f810ed3679ef547cd253d62a8880265d13085879b78d94e47ef7a4d9254",
      },
      canonicalBinding: {
        sha256: "ba57b95b5ee4d734177383be423b2020f196788413610ccbf8ce6e876986d39e",
      },
      cells: [{ id: "reused-object-corruption" }, { id: "final-verification-corruption" }],
      failedCell: null,
      failure: {
        phase: "cell",
        primary: {
          operation: "wait-for-attempt-1-failed",
        },
      },
      resultSchemaVersion: 5,
      schemaVersion: 9,
      state: "failed",
    });
    expect((json.cells as readonly Readonly<{ id: string }>[]).map((cell) => cell.id)).toEqual([
      "reused-object-corruption",
      "final-verification-corruption",
    ]);
    expect(json.failedCell).toBeNull();
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("pins the retained v9 precursor-ingress failure and completed prefix", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v9-2026-07-31T08-19-24-077Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "54597a5d861d0c32d8665ec7e179df605f3e815ac0115a812ccb4fcd9d988cfa",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "14a404fe75756f27f790885f03299a1f33b1e3ba6ca71e775222f0ad83c3fd92",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      authority: {
        artifactDigest: "e5c9060ec5cb59430b9d4d8a1f5f310769442bf0e29c189fb39566d8543472dc",
        releaseDigest: "ff9f1f810ed3679ef547cd253d62a8880265d13085879b78d94e47ef7a4d9254",
      },
      canonicalBinding: {
        sha256: "c9a05a149c320a46671003638a51d69cf523c2a985c9f498d3e910bbe47dbafe",
      },
      cells: [{ id: "reused-object-corruption" }, { id: "final-verification-corruption" }],
      failedCell: null,
      failure: {
        phase: "cell",
        primary: {
          operation: "wait-for-attempt-1-failed",
        },
      },
      resultSchemaVersion: 5,
      schemaVersion: 9,
      state: "failed",
    });
    expect((json.cells as readonly Readonly<{ id: string }>[]).map((cell) => cell.id)).toEqual([
      "reused-object-corruption",
      "final-verification-corruption",
    ]);
    expect(json.failedCell).toBeNull();
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("pins the authentic 08:50 v9 Repair-edge failure and completed prefix", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v9-2026-07-31T08-50-17-040Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "6b8a6288b9e7821c90f75d5676dadcb4e22113f0940ee755045f74cd31593e5e",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "793b889aae37ede45d66de748ce2a472b24690a34dcdc41f2aeb3e164fdf3b24",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      canonicalBinding: {
        sha256: "6d408af1431372aad8940f8c00c4054086ac2c29e56b4c14eb47de1aaaf98bae",
      },
      cells: [{ id: "reused-object-corruption" }, { id: "final-verification-corruption" }],
      failedCell: null,
      failure: {
        phase: "cell",
        primary: {
          operation: "wait-for-attempt-1-failed",
        },
      },
      resultSchemaVersion: 5,
      schemaVersion: 9,
      state: "failed",
    });
    expect((json.cells as readonly Readonly<{ id: string }>[]).map((cell) => cell.id)).toEqual([
      "reused-object-corruption",
      "final-verification-corruption",
    ]);
    expect(json.failedCell).toBeNull();
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("pins the authentic 09:35 v9 precursor-repeat diagnostic and completed prefix", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v9-2026-07-31T09-35-01-419Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "f1802c4b2f01d88df0a49c5d80752cb2befc02a865f0101df2a2bd1add39ce9b",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "5d297adaa40dbeafaf9eb52de038666a04084fc1173ab7fa382eb3dc3c961302",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      canonicalBinding: {
        sha256: "890a974bbd03b34e55143a28da45cac38a9f016b99763f828ec87f8e163d99e4",
      },
      cells: [{ id: "reused-object-corruption" }, { id: "final-verification-corruption" }],
      failedCell: null,
      failure: {
        phase: "cell",
        primary: {
          cause: {
            transitionBindingDiagnostic: {
              failedPredicate: "previous-not-revoked-finalization",
              previousRelationalState: {
                active: false,
                failure: null,
                order: 6955,
                phase: "attempt-1",
                release: true,
                resource: false,
                shell: true,
                store: "failed",
                transfer: "verifying",
                ui: "repairing",
              },
            },
          },
          operation: "wait-for-attempt-1-failed",
        },
      },
      resultSchemaVersion: 5,
      schemaVersion: 9,
      state: "failed",
    });
    expect((json.cells as readonly Readonly<{ id: string }>[]).map((cell) => cell.id)).toEqual([
      "reused-object-corruption",
      "final-verification-corruption",
    ]);
    expect(json.failedCell).toBeNull();
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("preserves the immutable 10:09 v9 boundary-validation failure pair", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v9-2026-07-31T10-09-00-375Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "566d428939e6d862ed7c0208ab9c59c40b2ba54164b5e6ad9ac519707ed5acbb",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "b9b09eef4982f7298d982092e54af6139758757670d5ab9dac1667b7f5a4400d",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      canonicalBinding: {
        sha256: "d735bf1cdd94d1aa69a701eda32ae32bdb9a5590f4725b88ae9e67e3d13f782b",
      },
      cells: [{ id: "reused-object-corruption" }, { id: "final-verification-corruption" }],
      failedCell: null,
      failure: {
        phase: "cell",
        primary: {
          cause: {
            message: "Installer transition binding current relational state is invalid",
          },
          operation: "wait-for-attempt-1-failed",
        },
      },
      resultSchemaVersion: 5,
      schemaVersion: 9,
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("preserves the immutable 10:48 v9 non-Repair binding failure pair", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v9-2026-07-31T10-48-09-207Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "d709bfc5f7058e8be610b034a2d10cdf633046b1284ea9a650e2c4a5af932ec3",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "03238198eb382ed16152f3b7a78b4212a9e2f833dbc6b625d0de95168ff03200",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      canonicalBinding: {
        sha256: "482d2c7e88e4bf189bec98f36654b7e1a8ef091bc30fe7ed3d902f1ccf49f4f8",
      },
      cells: [
        { id: "reused-object-corruption" },
        { id: "final-verification-corruption" },
        { id: "repeated-server-corruption" },
      ],
      failedCell: null,
      resultSchemaVersion: 5,
      schemaVersion: 9,
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("preserves immutable 11:33 evidence under its original schema", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v10-2026-07-31T11-33-48-953Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "62e0a4b2f9b95e77217657656a5c5f4381fefb0afdebc63e6874ac8db0d5610c",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "8f7db251b9cbbeb1e275b9378dc2cf5e80c4ef57efb5878de23e8fca09c478aa",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      canonicalBinding: {
        sha256: "9decba63778f11bba59ba126c3b1b642fc7b54a308497e55ee7c3bae07a40c30",
      },
      failedCell: null,
      resultSchemaVersion: 5,
      schemaVersion: 10,
      state: "failed",
    });
    const retainedDiagnostic = transitionDiagnostic(json);
    expect(retainedDiagnostic).toMatchObject({
      currentRelationalState: {
        active: false,
        failure: "quota",
        order: 17,
        phase: "attempt-1",
        release: false,
        resource: false,
        shell: false,
        store: "idle",
        transfer: "failed",
        ui: "failed",
      },
      predicate: "transition-model-rejected",
      previousRelationalState: {
        active: false,
        failure: null,
        order: 16,
        phase: "attempt-1",
        release: false,
        resource: false,
        shell: false,
        store: "idle",
        transfer: "probing-quota",
        ui: "installing",
      },
      proofPrefix: {
        acknowledgedThrough: 16,
        observationCount: 16,
        sha256: "f1f04c55580023dbf58799234adc7902a7ccdf8c63c440349f88b6adea71e0cb",
      },
      repairFailedPredicate: null,
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("preserves immutable 12:09 evidence under its original schema", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v10-2026-07-31T12-09-17-268Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "7eff3a66e3183e2e09b4edd126e66d197784034e5ec3e46eeb47792ca310fdba",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "12e184a833e900847a5d2913cf21f154bf422be8c986f52ba3a6a4c4e4f1cf3a",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      canonicalBinding: {
        sha256: "1cc9afecc09f06dbdd0d43367a17b8be0ae6d8c1b49cf0275c3faf362e69f270",
      },
      failedCell: null,
      resultSchemaVersion: 5,
      schemaVersion: 10,
      state: "failed",
    });
    expect(transitionDiagnostic(json)).toMatchObject({
      currentRelationalState: {
        active: false,
        failure: "quota",
        order: 18,
        phase: "attempt-1",
        release: false,
        resource: false,
        shell: false,
        store: "idle",
        transfer: "failed",
        ui: "failed",
      },
      predicate: "transition-model-rejected",
      previousRelationalState: {
        active: false,
        failure: "quota",
        order: 17,
        phase: "attempt-1",
        release: false,
        resource: false,
        shell: false,
        store: "idle",
        transfer: "failed",
        ui: "failed",
      },
      proofPrefix: {
        acknowledgedThrough: 17,
        observationCount: 17,
        sha256: "5a171d9454c83b6fdd4e51268f53ce881da774fdb979ac05d3e4c8835e31015b",
      },
      repairFailedPredicate: null,
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("preserves immutable 12:42 finish-time proof-rejection evidence under schema v10", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v10-2026-07-31T12-42-10-582Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "b119cd6b8d5df2c22b7151468c84e5ec1dfbdfe70afe80b1a4e489254120418e",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "80e9a3eb4a4cfb5697719316acc96b230db832ae4bb9399f02898d34920ace64",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      canonicalBinding: {
        sha256: "48d30bb92c18ebbb00896f98070b56e9c14c7a22390bf66e98c77cf6e7a543fe",
      },
      cells: [
        { id: "reused-object-corruption" },
        { id: "final-verification-corruption" },
        { id: "repeated-server-corruption" },
      ],
      failedCell: null,
      resultSchemaVersion: 5,
      schemaVersion: 10,
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("pins the retained schema-v11 pair and canonical binding", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v11-2026-07-31T13-30-01-201Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "df4b0eec4bffca1a8c5df7090950bc497b8fc0a01ada1129bc1f148b019ecb98",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "1cd11af1a69a5c1140fd076172d3a7bc2488fd9a0512079a8b0915e42a157697",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      canonicalBinding: {
        sha256: "6c8d1421623dd1e042c58ea9facdb5b79546217bae08db16e67f159c4acf34d6",
      },
      resultSchemaVersion: 5,
      schemaVersion: 11,
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("keeps the retained schema-v12 asynchronous handoff failure backward-valid", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v12-2026-07-31T18-44-29-502Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "dc62c17f9f5eb3cf1e7d4ce220c0493bed190243615929628c75c5706b64875c",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "084c6d19ec362def7d53528f33e252ab9cfb84677a2cc6a53b75cf0d0a5a1402",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      canonicalBinding: {
        sha256: "1b426e3a3aab2d9c47890f94058c37715ac28fc463d7190d48b6e385140006df",
      },
      cells: expect.arrayContaining([expect.any(Object)]),
      failedCell: {
        evidence: {
          acceptedObservationCount: 32,
          failedPredicate: "observation-consistency",
        },
        kind: "raw-observations",
      },
      schemaVersion: 12,
      state: "failed",
    });
    expect((json.cells as unknown[]).length).toBe(6);
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).toThrow(/transition proof fields/u);
    expect(() =>
      (validateInstallerTrustFaultTerminalPair as unknown as (...args: unknown[]) => void)(
        json,
        markdownBytes.toString("utf8"),
        {
          expectedRunId: "84ac6b44-8877-41d4-b08a-e136edaf1a89",
          expectedSource: {
            commit: "7fdc5465b5903751301a4e319a160848eacefac6",
            dirtyTreeDigest: "ab0b35788706093d242119e6c0c9913c2371e81c41e1d5848cfdbeb61b74f67e",
          },
          transitionProofSchemaVersion: 2,
        },
      ),
    ).toThrow(/transition proof fields/u);
    expect(() =>
      validateRetainedInstallerTrustFaultAsynchronousHandoffFailure(jsonBytes, markdownBytes),
    ).not.toThrow();

    const rejectedPairs: Record<string, unknown>[] = [];
    const spoofedRun = structuredClone(json);
    spoofedRun.runId = "00000000-0000-4000-8000-000000000000";
    rejectedPairs.push(spoofedRun);
    const reboundRun = structuredClone(json);
    reboundRun.completedAt = "2026-07-31T18:58:07.000Z";
    rejectedPairs.push(reboundRun);
    const changedAuthority = structuredClone(json);
    nestedRecord(changedAuthority.authority, "retained authority").artifactDigest = "f".repeat(64);
    rejectedPairs.push(changedAuthority);
    const changedCell = structuredClone(json);
    nestedRecord((changedCell.cells as unknown[])[0], "retained cell").id =
      "final-verification-corruption";
    rejectedPairs.push(changedCell);
    rejectedPairs.push(
      rebindTerminal(json, (selfRehashed) => {
        nestedRecord((selfRehashed.cells as unknown[])[0], "self-rehashed cell").profileId =
          "self-rehashed-profile";
      }),
    );
    for (const rejected of rejectedPairs) {
      expect(() =>
        validateRetainedInstallerTrustFaultAsynchronousHandoffFailure(
          Buffer.from(JSON.stringify(rejected, null, 2), "utf8"),
          markdownBytes,
        ),
      ).toThrow(/retained asynchronous handoff pair identity/u);
    }

    const changedMarkdown = Buffer.from(markdownBytes);
    changedMarkdown[0] = changedMarkdown[0] === 35 ? 36 : 35;
    expect(() =>
      validateRetainedInstallerTrustFaultAsynchronousHandoffFailure(jsonBytes, changedMarkdown),
    ).toThrow(/retained asynchronous handoff pair identity/u);
  });

  it.each([
    "parse",
    "order",
    "consistency",
    "bounds",
    "cell-invariant",
  ] as const)("publishes caught schema-12 %s failure as a validated JSON and Markdown pair", async (failureClass) => {
    const retained = JSON.parse(
      await readFile(
        join(
          process.cwd(),
          "harness/results/installer-trust-faults",
          "installer-trust-faults-v11-2026-07-31T13-30-01-201Z.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const authority = parseInstallerTrustFaultAuthority(retained.authority);
    const trustedError = await productionBrowserRejectedCellFailure(authority, failureClass);
    expect(findTrustedInstallerTrustFaultRawObservationEvidence(trustedError)).toMatchObject({
      acceptedObservationCount: expect.any(Number),
      failedPredicate:
        failureClass === "parse"
          ? "observation-parse"
          : failureClass === "order"
            ? "observation-order"
            : failureClass === "consistency"
              ? "observation-consistency"
              : failureClass === "bounds"
                ? "observation-bound"
                : "cell-invariant",
    });
    const completedCells = upgradeCompletedCellsToActiveProofV3(
      retained.cells as unknown[],
      authority.releaseDigest,
    );
    const reservation = fakeReservation([]);
    await runInstallerTrustFaultQualification("results", {
      executeCell: async () => {
        const completed = completedCells.shift();
        if (completed !== undefined) return completed as never;
        throw trustedError;
      },
      now: () => new Date("2026-07-31T14:00:00.000Z"),
      postValidate: vi.fn(),
      preflight: async () => authority,
      reserve: async () => reservation,
    });
    const terminal = reservation.published.at(-1);
    if (terminal === undefined) throw new Error("Missing schema-12 raw failure pair");
    expect(terminal.json).toMatchObject({
      failedCell: {
        evidence: { failedPredicate: expect.any(String) },
        kind: "raw-observations",
      },
      schemaVersion: 12,
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal.json, terminal.markdown),
    ).not.toThrow();
  }, 30_000);

  it("rebinds schema-12 raw evidence to outer authority, selected resource, and cell position", async () => {
    const retained = JSON.parse(
      await readFile(
        join(
          process.cwd(),
          "harness/results/installer-trust-faults",
          "installer-trust-faults-v11-2026-07-31T13-30-01-201Z.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const authority = parseInstallerTrustFaultAuthority(retained.authority);
    const trustedError = await productionBrowserRejectedCellFailure(authority, "cell-invariant");
    const completedCells = upgradeCompletedCellsToActiveProofV3(
      retained.cells as unknown[],
      authority.releaseDigest,
    );
    const reservation = fakeReservation([]);
    await runInstallerTrustFaultQualification("results", {
      executeCell: async () => {
        const completed = completedCells.shift();
        if (completed !== undefined) return completed as never;
        throw trustedError;
      },
      now: () => new Date("2026-07-31T14:02:00.000Z"),
      postValidate: vi.fn(),
      preflight: async () => authority,
      reserve: async () => reservation,
    });
    const terminal = reservation.published.at(-1);
    if (terminal === undefined) throw new Error("Missing schema-12 binding terminal");
    const evidence = nestedRecord(
      nestedRecord(terminal.json.failedCell, "raw failed cell").evidence,
      "raw evidence",
    );
    expect(evidence.rawArtifactBytes).toBeLessThanOrEqual(
      INSTALLER_TRUST_FAULT_MAX_RAW_ARTIFACT_BYTES,
    );
    expect(
      Buffer.byteLength(
        JSON.stringify(nestedRecord(evidence.rejectedSample, "rejected sample")),
        "utf8",
      ),
    ).toBeLessThanOrEqual(INSTALLER_TRUST_FAULT_MAX_REJECTED_RAW_SAMPLE_BYTES);
    expect(
      Buffer.byteLength(
        Buffer.from(
          nestedRecord(terminal.json.canonicalBinding, "canonical binding")
            .payloadBase64url as string,
          "base64url",
        ),
      ),
    ).toBeLessThanOrEqual(INSTALLER_TRUST_FAULT_MAX_CANONICAL_PAYLOAD_BYTES);
    expect(Buffer.byteLength(JSON.stringify(terminal.json, null, 2), "utf8")).toBeLessThanOrEqual(
      INSTALLER_TRUST_FAULT_MAX_SERIALIZED_JSON_REPORT_BYTES,
    );
    expect(Buffer.byteLength(terminal.markdown, "utf8")).toBeLessThanOrEqual(
      INSTALLER_TRUST_FAULT_MAX_SERIALIZED_MARKDOWN_REPORT_BYTES,
    );

    for (const mutate of [
      (raw: Record<string, unknown>) => {
        nestedRecord(nestedRecord(raw.failedCell, "failed cell").evidence, "evidence").authority = {
          artifactDigest: "f".repeat(64),
          releaseDigest: authority.releaseDigest,
        };
      },
      (raw: Record<string, unknown>) => {
        nestedRecord(
          nestedRecord(raw.failedCell, "failed cell").evidence,
          "evidence",
        ).faultResourceId =
          parseInstallerTrustFaultManifestResources(authority).find(
            (resource) =>
              resource.id !==
              selectInstallerTrustFaultResource(authority, "estimate-clearly-insufficient").id,
          )?.id ?? "different-resource";
      },
      (raw: Record<string, unknown>) => {
        nestedRecord(nestedRecord(raw.failedCell, "failed cell").evidence, "evidence").cellId =
          "quota-probe-exceeded";
      },
    ]) {
      expect(() =>
        validateInstallerTrustFaultRunEvidence(rebindTerminal(terminal.json, mutate)),
      ).toThrow(/outer cell authority|wrong partial cell/u);
    }

    const oversizedCanonical = structuredClone(terminal.json);
    nestedRecord(oversizedCanonical.canonicalBinding, "canonical binding").payloadBase64url =
      "a".repeat(Math.ceil((INSTALLER_TRUST_FAULT_MAX_CANONICAL_PAYLOAD_BYTES * 4) / 3) + 1);
    expect(() => validateInstallerTrustFaultRunEvidence(oversizedCanonical)).toThrow(/byte bound/u);
    expect(() =>
      validateInstallerTrustFaultTerminalPair(
        terminal.json,
        `${terminal.markdown}${" ".repeat(INSTALLER_TRUST_FAULT_MAX_SERIALIZED_MARKDOWN_REPORT_BYTES)}`,
      ),
    ).toThrow(/byte bound/u);
  });

  it.each([
    "setup",
    "intermediate",
    "terminal",
  ] as const)("allows repeated %s publications while retaining an unrelated schema-12 semantic rejection", async (repeatAt) => {
    const retained = JSON.parse(
      await readFile(
        join(
          process.cwd(),
          "harness/results/installer-trust-faults",
          "installer-trust-faults-v11-2026-07-31T13-30-01-201Z.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const authority = parseInstallerTrustFaultAuthority(retained.authority);
    const resource = selectInstallerTrustFaultResource(authority, "estimate-clearly-insufficient");
    const states: InstallerTrustFaultTransition[] = [
      rawEstimateState(0, "setup", "idle", "idle", "idle"),
      rawEstimateState(0, "attempt-1", "idle", "idle", "requesting-persistence"),
      rawEstimateState(0, "attempt-1", "idle", "idle", "installing"),
      rawEstimateState(0, "attempt-1", "waiting-lock", "idle", "installing"),
      rawEstimateState(0, "attempt-1", "planning", "idle", "installing"),
      rawEstimateState(0, "attempt-1", "probing-quota", "idle", "installing"),
      {
        ...rawEstimateState(0, "attempt-1", "failed", "idle", "failed"),
        failureCode: "quota",
      },
    ];
    const repeatedIndex = repeatAt === "setup" ? 0 : repeatAt === "intermediate" ? 4 : 6;
    states.splice(repeatedIndex, 0, {
      ...(states[repeatedIndex] as InstallerTrustFaultTransition),
    });
    const ordered = states.map((state, index) => ({ ...state, order: index + 1 }));
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "estimate-clearly-insufficient",
      authority,
      resource.id,
    );
    ordered.forEach((state) => {
      recorder.observe(rawEstimateObservation(state));
    });
    const rejected = {
      ...(ordered.at(-1) as InstallerTrustFaultTransition),
      failureResourceId: resource.id,
      order: ordered.length + 1,
    };
    let trustedError: Error | null = null;
    try {
      recorder.observe(rawEstimateObservation(rejected), "barrier");
    } catch (error: unknown) {
      trustedError = error as Error;
    }
    expect(findTrustedInstallerTrustFaultRawObservationEvidence(trustedError)).toMatchObject({
      acceptedObservationCount: ordered.length,
      failedPredicate: "cell-invariant",
    });
    expect(() =>
      validateInstallerTrustFaultRawObservationEvidence(
        findTrustedInstallerTrustFaultRawObservationEvidence(trustedError),
      ),
    ).not.toThrow();
  });

  it("pins the retained v8 cell-validation failure and canonical pair", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v8-2026-07-31T04-29-39-450Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "7da79413d648cdfc37cd2b8a93662ef9c9ef09544caed8b5bef55439d8eb7418",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "375e046f83826110194a4139a97dc607fac6507d6d8bea6324d15e5cc4d669b5",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      authority: {
        artifactDigest: "e9f8bc29932187b48b4851fb36d4e71682a997dcd231c5cf12b6a90ce15c1394",
        releaseDigest: "793f7331f7f39d365a463ee4b15b60a9987bbc36445c64ea127d0f40c898ab7d",
      },
      canonicalBinding: {
        sha256: "44e56a6b1d051a4e3042da48182cd58e3db9fad6a36f66c83e3e4d49878673c1",
      },
      failedCell: {
        faultResourceId: "game-specific-world-cell-district-1-surface-15-07",
        id: "final-verification-corruption",
        kind: "cell-validation",
        violatedPredicates: ["cell-contract"],
      },
      resultSchemaVersion: 5,
      schemaVersion: INSTALLER_TRUST_FAULT_CELL_VALIDATION_RUN_SCHEMA_VERSION,
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("pins the retained v7 real-OPFS directory-parity failure and transition proof", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v7-2026-07-31T03-22-18-633Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "6fd6a0bb6253720fac78a4a35db2a26a5498b9fe7ec11ca019afc03aaa0aaa29",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "1a4900ac79272017b000c04540f3b332d13d056ac91f7bb0bf29cbeb7939ab42",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      authority: {
        artifactDigest: "a2ef1907bd5ba52b3356d02be4d35825b0ea7850ace50677115199cd9766c6f5",
        releaseDigest: "4ff870f5a356a3521110407c6e3c1c22e0f2b1bd8c3a8029132888f7f35da098",
      },
      canonicalBinding: {
        sha256: "79a5800222a32a5b0e84c10e4512a7ddc416e1199420af77c1c9b3c79f863c14",
      },
      failedCell: {
        faultResourceId: "game-specific-world-cell-district-1-surface-15-07",
        id: "reused-object-corruption",
        terminal: {
          expected: "ready",
          observed: "failed",
          store: {
            failureMessage: "Repair admission rejects unrelated partial or checkpoint residue",
            state: "failed",
          },
        },
        transitions: {
          finalStateId: 37,
          streamSha256: "459c73abba5fa67ca3210c4261b05b27baaa808f0a8f4bf437abe2acc1c74839",
        },
      },
      failure: {
        cleanupFailures: [],
        phase: "cell",
        primary: {
          cause: {
            cause: {
              name: "InstallerTrustProductTerminalError",
            },
            name: "InstallerTrustFaultCellTerminalEvidenceError",
          },
          name: "InstallerTrustFaultOperationError",
          operation: "wait-for-attempt-1-ready",
          stage: "primary",
        },
      },
      resultSchemaVersion: 5,
      schemaVersion: 7,
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("pins the retained v7 operation-publication adjudication failure and canonical pair", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v7-2026-07-31T03-58-10-387Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "91973aaa15e3ddd47685b49e0bc86447adc8651407accac6b5f4bd6d06402867",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "e8ff61a76b35c9cba61b2aadc81b56193610931beb65d3a5a47b15ea0ad87e47",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      authority: {
        artifactDigest: "e9f8bc29932187b48b4851fb36d4e71682a997dcd231c5cf12b6a90ce15c1394",
        releaseDigest: "793f7331f7f39d365a463ee4b15b60a9987bbc36445c64ea127d0f40c898ab7d",
      },
      canonicalBinding: {
        sha256: "2dde0d7b65401dda6b977d0a652136bfa497cf15de54fab25dc074ca232341c3",
      },
      cells: [],
      failedCell: null,
      failure: {
        cleanupFailures: [],
        phase: "cell",
        primary: {
          message: "Installer trust-fault UI/store/transfer terminal authority is contradictory",
          name: "Error",
        },
      },
      resultSchemaVersion: 5,
      schemaVersion: 7,
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("pins the retained failed schema-v6 physical-observer pair and canonical binding", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v6-2026-07-31T01-32-28-701Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "90406b114fa18ff3213ce02837dc77144a0870313b228ff81974333e24c079c9",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "6617073c15057a6873c4487e16e0f6bda8ffc2a0864a8172ac823c7b014e525a",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      canonicalBinding: {
        sha256: "6eb25db1d0686ef8ee4520042aa9639bcf2ace1bd42da76b78b18923909b4de3",
      },
      resultSchemaVersion: 5,
      schemaVersion: 6,
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("pins the corrected retained failed schema-v6 product-cause pair and canonical binding", async () => {
    const root = join(
      process.cwd(),
      "harness/results/installer-trust-faults",
      "installer-trust-faults-v6-2026-07-31T01-51-12-846Z",
    );
    const [jsonBytes, markdownBytes] = await Promise.all([
      readFile(`${root}.json`),
      readFile(`${root}.md`),
    ]);
    expect(createHash("sha256").update(jsonBytes).digest("hex")).toBe(
      "669afaf1d6d906dec584aec9ef4d37e0ee113080a44e001417110dc0672a502e",
    );
    expect(createHash("sha256").update(markdownBytes).digest("hex")).toBe(
      "7ceef9ca3778c0f13f58578e8402a7a6f1de19127294f7770eae4f611c9fbe0b",
    );
    const json = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    expect(json).toMatchObject({
      canonicalBinding: {
        sha256: "6dbac3eed05b2408ff0b82820a8ad583f3486b4a8a9ba49656d3d2f9f73d9db3",
      },
      cells: [],
      failure: {
        phase: "cell",
        primary: {
          cause: {
            name: "InstallerTrustProductTerminalError",
          },
        },
      },
      resultSchemaVersion: 5,
      schemaVersion: 6,
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(json, markdownBytes.toString("utf8")),
    ).not.toThrow();
  });

  it("retains an exact current product-terminal projection and final transition proof", async () => {
    const retained = JSON.parse(
      await readFile(
        join(
          process.cwd(),
          "harness/results/installer-trust-faults",
          "installer-trust-faults-v6-2026-07-31T01-51-12-846Z.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const authority = retained.authority as InstallerTrustFaultAuthority;
    const faultResourceId = "game-specific-world-cell-district-1-surface-15-07";
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "reused-object-corruption",
      authority,
      faultResourceId,
      "allow-unexpected-terminal",
    );
    for (const transition of unexpectedRepairStoreFailureTransitions(authority)) {
      recorder.observe(transition);
    }
    const failedProof = recorder.finish();
    expect(() =>
      validateInstallerTrustFaultTransitionProof(
        failedProof,
        "reused-object-corruption",
        authority,
        faultResourceId,
      ),
    ).toThrow(/outcome automaton|phase verdict/u);
    const terminal = {
      expected: "ready",
      observed: "failed",
      store: {
        activeReleaseDigest: null,
        currentReleaseDigest: authority.releaseDigest,
        currentResourceId: null,
        failureMessage: "Installer Repair store verify-release failed",
        state: "failed",
      },
      transfer: {
        activeReleaseDigest: authority.releaseDigest,
        failureClass: "installer-store",
        failureCode: "store",
        failureEvidence: "store-verify-release",
        failureMessage: "Installer Repair store verify-release failed",
        failureOperation: "repair",
        failureResourceId: null,
        state: "failed",
      },
      ui: {
        action: "retry",
        failureCode: "store",
        failureOperation: "repair",
        failureResourceId: null,
        releaseDigest: null,
        shellGenerationId: null,
        state: "failed",
      },
    } as const;
    const events: string[] = [];
    const reservation = fakeReservation(events);

    await expect(
      runInstallerTrustFaultQualification("results", {
        executeCell: async () => {
          throw new InstallerTrustFaultCellTerminalEvidenceError(
            "reused-object-corruption",
            faultResourceId,
            terminal,
            failedProof,
            new Error("unexpected terminal"),
          );
        },
        now: () => new Date("2026-07-31T02:00:00.000Z"),
        postValidate: async () => undefined,
        preflight: async () => authority,
        reserve: async () => reservation,
      }),
    ).resolves.toMatchObject({ state: "failed" });

    const failed = reservation.published.at(-1);
    expect(failed?.json).toMatchObject({
      failedCell: {
        evidence: {
          faultResourceId,
          id: "reused-object-corruption",
          terminal,
          transitions: {
            finalStateId: expect.any(Number),
            streamSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
        },
        kind: "product-terminal",
      },
      resultSchemaVersion: 5,
      schemaVersion: 12,
      state: "failed",
    });
    expect(failed?.json.failedCell).not.toBeNull();
    expect(() =>
      validateInstallerTrustFaultTerminalPair(failed?.json ?? {}, failed?.markdown ?? ""),
    ).not.toThrow();
    const terminalJson = failed?.json ?? {};
    expect(() =>
      validateInstallerTrustFaultRunEvidence(
        rebindTerminal(terminalJson, (json) => {
          json.failedCell = null;
        }),
      ),
    ).toThrow(/product-terminal failure lacks failed-cell evidence/u);
    expect(() =>
      validateInstallerTrustFaultRunEvidence(
        rebindTerminal(terminalJson, (json) => {
          const failedCell = productTerminalFailedCell(json);
          failedCell.id = INSTALLER_TRUST_FAULT_CELL_IDS[1];
        }),
      ),
    ).toThrow(/exact next cell/u);
    for (const mutate of [
      (json: Record<string, unknown>) => {
        const failedCell = productTerminalFailedCell(json);
        const terminalValue = failedCell.terminal as Record<string, unknown>;
        const store = terminalValue.store as Record<string, unknown>;
        store.failureMessage = "C:\\private\\profile token=do-not-retain";
      },
      (json: Record<string, unknown>) => {
        const failedCell = productTerminalFailedCell(json);
        const terminalValue = failedCell.terminal as Record<string, unknown>;
        terminalValue.maliciousResidual = "<script>";
      },
      (json: Record<string, unknown>) => {
        const failedCell = productTerminalFailedCell(json);
        const terminalValue = failedCell.terminal as Record<string, unknown>;
        const store = terminalValue.store as Record<string, unknown>;
        store.state = "idle";
      },
    ]) {
      expect(() =>
        validateInstallerTrustFaultRunEvidence(rebindTerminal(terminalJson, mutate)),
      ).toThrow();
    }

    const manifestResources = parseInstallerTrustFaultManifestResources(authority);
    const shellResource = manifestResources.find((resource) => resource.target === "shell");
    const otherOpfsResource = manifestResources.find(
      (resource) => resource.target === "opfs" && resource.id !== faultResourceId,
    );
    if (shellResource === undefined || otherOpfsResource === undefined) {
      throw new Error("Trust-fault manifest adversarial fixtures are absent");
    }
    for (const mutate of [
      (json: Record<string, unknown>) => {
        const failedCell = productTerminalFailedCell(json);
        failedCell.faultResourceId = otherOpfsResource.id;
      },
      (json: Record<string, unknown>) => {
        const failedCell = productTerminalFailedCell(json);
        const terminalValue = failedCell.terminal as Record<string, unknown>;
        const store = terminalValue.store as Record<string, unknown>;
        store.currentReleaseDigest = null;
        store.currentResourceId = faultResourceId;
      },
      (json: Record<string, unknown>) => {
        const failedCell = productTerminalFailedCell(json);
        const terminalValue = failedCell.terminal as Record<string, unknown>;
        const store = terminalValue.store as Record<string, unknown>;
        store.currentReleaseDigest = authority.releaseDigest;
        store.currentResourceId = shellResource.id;
      },
      (json: Record<string, unknown>) => {
        const failedCell = productTerminalFailedCell(json);
        const terminalValue = failedCell.terminal as Record<string, unknown>;
        const store = terminalValue.store as Record<string, unknown>;
        store.currentReleaseDigest = "0".repeat(64);
        store.currentResourceId = faultResourceId;
      },
      (json: Record<string, unknown>) => {
        const failedCell = productTerminalFailedCell(json);
        const terminalValue = failedCell.terminal as Record<string, unknown>;
        const store = terminalValue.store as Record<string, unknown>;
        store.failureMessage = null;
      },
      (json: Record<string, unknown>) => {
        const failedCell = productTerminalFailedCell(json);
        const terminalValue = failedCell.terminal as Record<string, unknown>;
        const store = terminalValue.store as Record<string, unknown>;
        store.state = "writing";
      },
      (json: Record<string, unknown>) => {
        const failedCell = productTerminalFailedCell(json);
        const terminalValue = failedCell.terminal as Record<string, unknown>;
        const transfer = terminalValue.transfer as Record<string, unknown>;
        const ui = terminalValue.ui as Record<string, unknown>;
        transfer.failureResourceId = shellResource.id;
        ui.failureResourceId = shellResource.id;
      },
      (json: Record<string, unknown>) => {
        const failedCell = productTerminalFailedCell(json);
        const terminalValue = failedCell.terminal as Record<string, unknown>;
        const transfer = terminalValue.transfer as Record<string, unknown>;
        const ui = terminalValue.ui as Record<string, unknown>;
        transfer.failureResourceId = otherOpfsResource.id;
        ui.failureResourceId = otherOpfsResource.id;
      },
    ]) {
      expect(() =>
        validateInstallerTrustFaultRunEvidence(rebindTerminal(terminalJson, mutate)),
      ).toThrow();
    }

    const noStoreFailureRecorder = createInstallerTrustFaultTransitionProofRecorder(
      "reused-object-corruption",
      authority,
      faultResourceId,
      "allow-unexpected-terminal",
    );
    expect(() => {
      for (const transition of unexpectedRepairStoreFailureTransitions(authority, {
        failureCode: "transport",
        failureResourceId: faultResourceId,
        storeState: "writing",
      })) {
        noStoreFailureRecorder.observe(transition);
      }
    }).toThrow(/contradictory transfer failure/u);

    const boundedReservation = fakeReservation([]);
    await expect(
      runInstallerTrustFaultQualification("results", {
        executeCell: async () => {
          throw new AggregateError([
            ...Array.from({ length: 7 }, (_, index) => new Error(`decoy ${index}`)),
            new InstallerTrustFaultCellTerminalEvidenceError(
              "reused-object-corruption",
              faultResourceId,
              terminal,
              failedProof,
              new Error("bounded terminal"),
            ),
            new Error("forces aggregate truncation"),
          ]);
        },
        now: () => new Date("2026-07-31T02:00:01.000Z"),
        postValidate: async () => undefined,
        preflight: async () => authority,
        reserve: async () => boundedReservation,
      }),
    ).resolves.toMatchObject({ state: "failed" });
    const boundedFailure = boundedReservation.published.at(-1);
    expect(boundedFailure?.json.failedCell).toBeNull();
    expect(() =>
      validateInstallerTrustFaultTerminalPair(
        boundedFailure?.json ?? {},
        boundedFailure?.markdown ?? "",
      ),
    ).not.toThrow();

    const agreeingReservation = fakeReservation([]);
    await expect(
      runInstallerTrustFaultQualification("results", {
        executeCell: async () => {
          throw new AggregateError([
            new InstallerTrustFaultCellTerminalEvidenceError(
              "reused-object-corruption",
              faultResourceId,
              terminal,
              failedProof,
              new Error("first agreeing terminal"),
            ),
            new InstallerTrustFaultCellTerminalEvidenceError(
              "reused-object-corruption",
              faultResourceId,
              structuredClone(terminal),
              structuredClone(failedProof),
              new Error("second agreeing terminal"),
            ),
          ]);
        },
        now: () => new Date("2026-07-31T02:00:02.000Z"),
        postValidate: async () => undefined,
        preflight: async () => authority,
        reserve: async () => agreeingReservation,
      }),
    ).resolves.toMatchObject({ state: "failed" });
    const agreeingFailure = agreeingReservation.published.at(-1);
    expect(agreeingFailure?.json.failedCell).toMatchObject({ kind: "product-terminal" });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(
        agreeingFailure?.json ?? {},
        agreeingFailure?.markdown ?? "",
      ),
    ).not.toThrow();

    const conflictingReservation = fakeReservation([]);
    await expect(
      runInstallerTrustFaultQualification("results", {
        executeCell: async () => {
          throw new InstallerTrustFaultLifecycleAggregateError([
            new InstallerTrustFaultOperationError(
              "cell-primary",
              "primary",
              new InstallerTrustFaultCellTerminalEvidenceError(
                "reused-object-corruption",
                faultResourceId,
                terminal,
                failedProof,
                new Error("primary terminal"),
              ),
            ),
            new InstallerTrustFaultOperationError(
              "cell-cleanup",
              "cleanup",
              new InstallerTrustFaultCellTerminalEvidenceError(
                "reused-object-corruption",
                faultResourceId,
                { ...terminal, observed: "ready" },
                failedProof,
                new Error("conflicting cleanup terminal"),
              ),
            ),
          ]);
        },
        now: () => new Date("2026-07-31T02:00:03.000Z"),
        postValidate: async () => undefined,
        preflight: async () => authority,
        reserve: async () => conflictingReservation,
      }),
    ).resolves.toMatchObject({ state: "failed" });
    const conflictingFailure = conflictingReservation.published.at(-1);
    expect(conflictingFailure?.json.failedCell).toBeNull();
    expect(JSON.stringify(conflictingFailure?.json.failure)).toContain(
      "TerminalEvidenceCollectionConflict",
    );
    expect(JSON.stringify(conflictingFailure?.json.failure)).not.toContain(
      "InstallerTrustFaultCellTerminalEvidenceError",
    );
    expect(() =>
      validateInstallerTrustFaultTerminalPair(
        conflictingFailure?.json ?? {},
        conflictingFailure?.markdown ?? "",
      ),
    ).not.toThrow();

    const cyclicValue: Record<string, unknown> = {};
    cyclicValue.self = cyclicValue;
    const uncomparableTerminals = [
      ["lone-surrogate", { ...terminal, uncomparable: "\ud800" }],
      ["bigint", { ...terminal, uncomparable: 1n }],
      ["cyclic", { ...terminal, uncomparable: cyclicValue }],
      ["unsupported", { ...terminal, uncomparable: undefined }],
    ] as const;
    for (const [label, uncomparableTerminal] of uncomparableTerminals) {
      const uncomparableReservation = fakeReservation([]);
      await expect(
        runInstallerTrustFaultQualification("results", {
          executeCell: async () => {
            throw new InstallerTrustFaultCellTerminalEvidenceError(
              "reused-object-corruption",
              faultResourceId,
              uncomparableTerminal,
              failedProof,
              new Error(`single ${label} terminal`),
            );
          },
          now: () => new Date("2026-07-31T02:00:04.000Z"),
          postValidate: async () => undefined,
          preflight: async () => authority,
          reserve: async () => uncomparableReservation,
        }),
        label,
      ).resolves.toMatchObject({ state: "failed" });
      const uncomparableFailure = uncomparableReservation.published.at(-1);
      expect(uncomparableFailure?.json.failedCell, label).toBeNull();
      expect(JSON.stringify(uncomparableFailure?.json.failure), label).toContain(
        "TerminalEvidenceCollectionConflict",
      );
      expect(JSON.stringify(uncomparableFailure?.json.failure), label).not.toContain(
        "InstallerTrustFaultCellTerminalEvidenceError",
      );
      expect(
        () =>
          validateInstallerTrustFaultTerminalPair(
            uncomparableFailure?.json ?? {},
            uncomparableFailure?.markdown ?? "",
          ),
        label,
      ).not.toThrow();
    }

    const cleanupUncomparableReservation = fakeReservation([]);
    await expect(
      runInstallerTrustFaultQualification("results", {
        executeCell: async () => {
          throw new InstallerTrustFaultLifecycleAggregateError([
            new InstallerTrustFaultOperationError(
              "cleanup-uncomparable",
              "cleanup",
              new InstallerTrustFaultCellTerminalEvidenceError(
                "reused-object-corruption",
                faultResourceId,
                { ...terminal, uncomparable: 1n },
                failedProof,
                new Error("cleanup-only uncomparable terminal"),
              ),
            ),
          ]);
        },
        now: () => new Date("2026-07-31T02:00:05.000Z"),
        postValidate: async () => undefined,
        preflight: async () => authority,
        reserve: async () => cleanupUncomparableReservation,
      }),
    ).resolves.toMatchObject({ state: "failed" });
    const cleanupUncomparableFailure = cleanupUncomparableReservation.published.at(-1);
    expect(cleanupUncomparableFailure?.json.failedCell).toBeNull();
    expect(JSON.stringify(cleanupUncomparableFailure?.json.failure)).toContain(
      "TerminalEvidenceCollectionConflict",
    );
    expect(JSON.stringify(cleanupUncomparableFailure?.json.failure)).not.toContain(
      "InstallerTrustFaultCellTerminalEvidenceError",
    );
    expect(() =>
      validateInstallerTrustFaultTerminalPair(
        cleanupUncomparableFailure?.json ?? {},
        cleanupUncomparableFailure?.markdown ?? "",
      ),
    ).not.toThrow();
  });

  it.each([
    "selected-request-count",
    "selected-range-classification",
    "selected-status",
    "selected-if-range",
    "operation-range-request-count",
    "repaired-resource-count",
    "repaired-bytes",
    "downloaded-bytes",
    "attempt",
    "cell-id",
    "manifest-resource",
    "operation",
    "phase",
    "post-validation",
    "proof",
    "publication",
    "terminal-store",
    "terminal-transfer",
    "terminal-ui",
  ] as const)("publishes bounded schema-v9 cell-validation evidence for the %s predicate", async (predicate) => {
    const { authority, rawCell } = await retainedRawRepairCell();
    const raw = structuredClone(rawCell);
    mutateRawCellPredicate(raw, predicate, authority);
    const terminalSnapshot = nestedRecord((raw.snapshots as unknown[]).at(-1), "terminal snapshot");
    nestedRecord(terminalSnapshot.installerTransfer, "terminal transfer").failureMessage =
      "C:\\private\\profile token=do-not-retain";
    nestedRecord(terminalSnapshot.installStore, "terminal store").failureMessage =
      "file:///home/user/private secret=do-not-retain";
    const reservation = fakeReservation([]);

    await expect(
      runInstallerTrustFaultQualification("results", {
        executeCell: async () => raw as never,
        now: () => new Date("2026-07-31T04:30:00.000Z"),
        postValidate: vi.fn(),
        preflight: async () => authority,
        reserve: async () => reservation,
      }),
    ).resolves.toMatchObject({ state: "failed" });

    const terminal = reservation.published.at(-1);
    const branch = terminal?.json.failedCell as Record<string, unknown>;
    expect(branch).toMatchObject({
      attempt: 1,
      faultResourceId: selectInstallerTrustFaultResource(authority, "reused-object-corruption").id,
      id: "reused-object-corruption",
      kind: "cell-validation",
      operation: "repair",
      phase: "attempt-1",
      violatedPredicates: expect.arrayContaining([predicate]),
    });
    if (
      (
        [
          "selected-request-count",
          "selected-range-classification",
          "selected-status",
          "selected-if-range",
          "operation-range-request-count",
          "repaired-resource-count",
          "repaired-bytes",
          "downloaded-bytes",
        ] as readonly string[]
      ).includes(predicate)
    ) {
      expect(branch.violatedPredicates).toEqual([predicate]);
    }
    expect(terminal?.json.failure).toMatchObject({
      phase: "cell",
      primary: {
        cause: expect.any(Object),
        name: "InstallerTrustFaultCellValidationError",
      },
    });
    expect(JSON.stringify(branch)).not.toContain("do-not-retain");
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal?.json ?? {}, terminal?.markdown ?? ""),
    ).not.toThrow();
  });

  it("projects exact bounded HTTP/accounting facts without retaining request authority bytes", async () => {
    const { authority, rawCell } = await retainedRawRepairCell();
    const raw = structuredClone(rawCell);
    const expected = selectInstallerTrustFaultResource(authority, "reused-object-corruption");
    const requests = raw.http as Record<string, unknown>[];
    const request = requests.find(
      (candidate) =>
        candidate.path === expected.path &&
        candidate.range !== null &&
        candidate.phase === "attempt-1",
    );
    if (request === undefined) throw new Error("Repair request fixture is absent");
    const bodyBytes = request.bodyBytes as number;
    request.ifRange = request.etag;
    const reservation = fakeReservation([]);
    await runInstallerTrustFaultQualification("results", {
      executeCell: async () => raw as never,
      now: () => new Date("2026-07-31T04:30:15.000Z"),
      postValidate: vi.fn(),
      preflight: async () => authority,
      reserve: async () => reservation,
    });
    const terminal = reservation.published.at(-1);
    const branch = terminal?.json.failedCell as Record<string, unknown>;
    expect(branch).toMatchObject({
      accounting: {
        baseline: {
          completedResourceCount: 263,
          repairedBytes: 0,
          repairedResourceCount: 0,
        },
        declaredDownloadedBytes: bodyBytes,
        declaredRepairedBytes: bodyBytes,
        declaredRepairedResourceCount: 1,
        delta: {
          completedResourceCount: 0,
          downloadedBytes: bodyBytes,
          repairedBytes: bodyBytes,
          repairedResourceCount: 1,
        },
        terminal: {
          completedResourceCount: 263,
          repairedBytes: bodyBytes,
          repairedResourceCount: 1,
        },
      },
      http: {
        operationRangeRequestCount: 1,
        selected: {
          bodyBytes,
          etagMatchesManifest: true,
          ifRangeMatchesEtag: true,
          ifRangePresent: true,
          manifestPathMatch: true,
          pathSha256: createHash("sha256").update(expected.path).digest("hex"),
          rangeClassification: "exact-zero-offset",
          responseKind: "range",
          sameOriginPath: true,
          status: 206,
        },
        selectedRequestCount: 1,
      },
      violatedPredicates: ["selected-if-range"],
    });
    const serialized = JSON.stringify(branch);
    expect(serialized).not.toContain(String(request.etag));
    expect(serialized).not.toContain(expected.path);
    expect(serialized).not.toContain("bytes=0-");
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal?.json ?? {}, terminal?.markdown ?? ""),
    ).not.toThrow();
  });

  it("retains only bounded authority booleans for a wholly unsafe HTTP journal entry", async () => {
    const { authority, rawCell } = await retainedRawRepairCell();
    const raw = structuredClone(rawCell);
    const request = (raw.http as Record<string, unknown>[]).find(
      (candidate) => candidate.phase === "attempt-1" && candidate.range !== null,
    );
    if (request === undefined) throw new Error("Repair request fixture is absent");
    request.path = "https://secret.invalid/private?token=do-not-retain";
    request.etag = '"private-etag-token-do-not-retain"';
    request.ifRange = request.etag;
    const reservation = fakeReservation([]);
    await runInstallerTrustFaultQualification("results", {
      executeCell: async () => raw as never,
      now: () => new Date("2026-07-31T04:30:20.000Z"),
      postValidate: vi.fn(),
      preflight: async () => authority,
      reserve: async () => reservation,
    });
    const terminal = reservation.published.at(-1);
    const branch = terminal?.json.failedCell as Record<string, unknown>;
    expect(branch).toMatchObject({
      http: {
        operationRangeRequestCount: 1,
        selected: null,
        selectedRequestCount: 0,
      },
      violatedPredicates: expect.arrayContaining([
        "selected-request-count",
        "operation-range-request-count",
      ]),
    });
    const serialized = JSON.stringify(branch);
    expect(serialized).not.toContain("secret.invalid");
    expect(serialized).not.toContain("do-not-retain");
    expect(serialized).not.toContain("private-etag");
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal?.json ?? {}, terminal?.markdown ?? ""),
    ).not.toThrow();
  });

  it("keeps the exact target projection when a separate unknown Range response is present", async () => {
    const { authority, rawCell } = await retainedRawRepairCell();
    const raw = structuredClone(rawCell);
    const expected = selectInstallerTrustFaultResource(authority, "reused-object-corruption");
    const requests = raw.http as Record<string, unknown>[];
    const selected = requests.find(
      (request) =>
        request.path === expected.path && request.phase === "attempt-1" && request.range !== null,
    );
    if (selected === undefined) throw new Error("Selected Repair response is absent");
    requests.push({
      ...selected,
      bodyBytes: Number.MAX_SAFE_INTEGER + 1,
      etag: '"private-extra-etag-do-not-retain"',
      ifRange: '"private-extra-if-range-do-not-retain"',
      order: requests.length + 1,
      path: "https://private.invalid/resource?token=do-not-retain",
      range: { unsafe: "bytes=0-" },
      status: -1,
    });
    const reservation = fakeReservation([]);
    await runInstallerTrustFaultQualification("results", {
      executeCell: async () => raw as never,
      now: () => new Date("2026-07-31T04:30:25.000Z"),
      postValidate: vi.fn(),
      preflight: async () => authority,
      reserve: async () => reservation,
    });
    const terminal = reservation.published.at(-1);
    const branch = terminal?.json.failedCell as Record<string, unknown>;
    expect(branch).toMatchObject({
      http: {
        operationRangeRequestCount: 2,
        selected: {
          bodyBytes: expected.bytes,
          manifestPathMatch: true,
          pathSha256: createHash("sha256").update(expected.path).digest("hex"),
          sameOriginPath: true,
          status: 206,
        },
        selectedRequestCount: 1,
      },
      violatedPredicates: ["operation-range-request-count"],
    });
    const serialized = JSON.stringify(branch);
    expect(serialized).not.toContain("private.invalid");
    expect(serialized).not.toContain("private-extra");
    expect(serialized).not.toContain("do-not-retain");
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal?.json ?? {}, terminal?.markdown ?? ""),
    ).not.toThrow();
  });

  it("isolates duplicate exact-target responses to selected request count", async () => {
    const { authority, rawCell } = await retainedRawRepairCell();
    const raw = structuredClone(rawCell);
    const expected = selectInstallerTrustFaultResource(authority, "reused-object-corruption");
    const requests = raw.http as Record<string, unknown>[];
    const selected = requests.find(
      (request) =>
        request.path === expected.path && request.phase === "attempt-1" && request.range !== null,
    );
    if (selected === undefined) throw new Error("Selected Repair response is absent");
    requests.push({ ...selected, order: requests.length + 1 });
    const reservation = fakeReservation([]);
    await runInstallerTrustFaultQualification("results", {
      executeCell: async () => raw as never,
      now: () => new Date("2026-07-31T04:30:26.000Z"),
      postValidate: vi.fn(),
      preflight: async () => authority,
      reserve: async () => reservation,
    });
    const terminal = reservation.published.at(-1);
    expect(terminal?.json.failedCell).toMatchObject({
      http: {
        operationRangeRequestCount: 2,
        selected: null,
        selectedRequestCount: 2,
      },
      violatedPredicates: ["selected-request-count"],
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal?.json ?? {}, terminal?.markdown ?? ""),
    ).not.toThrow();
  });

  it("rejects obsolete completion-credit accumulation while proving one current Repair", async () => {
    const { authority, rawCell } = await retainedRawRepairCell();
    const raw = structuredClone(rawCell);
    const snapshots = raw.snapshots as unknown[];
    const terminalSnapshot = nestedRecord(snapshots.at(-1), "terminal snapshot");
    const transfer = nestedRecord(terminalSnapshot.installerTransfer, "terminal transfer");
    transfer.completedResourceCount = 526;
    const reservation = fakeReservation([]);
    await runInstallerTrustFaultQualification("results", {
      executeCell: async () => raw as never,
      now: () => new Date("2026-07-31T04:30:27.000Z"),
      postValidate: vi.fn(),
      preflight: async () => authority,
      reserve: async () => reservation,
    });
    const terminal = reservation.published.at(-1);
    expect(terminal?.json.failedCell).toMatchObject({
      accounting: {
        baseline: {
          completedResourceCount: 263,
          repairedResourceCount: 0,
        },
        delta: {
          completedResourceCount: 263,
          repairedResourceCount: 1,
        },
        terminal: {
          completedResourceCount: 526,
          repairedResourceCount: 1,
        },
      },
      violatedPredicates: ["repaired-resource-count"],
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal?.json ?? {}, terminal?.markdown ?? ""),
    ).not.toThrow();
  });

  it("publishes a typed bounded cell-validation terminal when the returned raw cell is wholly unsafe", async () => {
    const { authority } = await retainedRawRepairCell();
    const reservation = fakeReservation([]);
    await expect(
      runInstallerTrustFaultQualification("results", {
        executeCell: async () => "C:\\private\\profile token=do-not-retain" as never,
        now: () => new Date("2026-07-31T04:30:30.000Z"),
        postValidate: vi.fn(),
        preflight: async () => authority,
        reserve: async () => reservation,
      }),
    ).resolves.toMatchObject({ state: "failed" });
    const terminal = reservation.published.at(-1);
    const serialized = JSON.stringify(terminal?.json);
    expect(serialized).not.toContain("do-not-retain");
    expect(terminal?.json.failedCell).toMatchObject({
      kind: "cell-validation",
      observed: {
        attempt: null,
        cellId: null,
        faultOperation: null,
        faultResourceId: null,
        outcome: null,
        phase: null,
      },
      violatedPredicates: expect.arrayContaining([
        "selected-request-count",
        "operation-range-request-count",
        "repaired-resource-count",
        "repaired-bytes",
        "downloaded-bytes",
        "attempt",
        "cell-id",
        "manifest-resource",
        "operation",
        "phase",
        "post-validation",
        "proof",
        "publication",
        "terminal-store",
        "terminal-transfer",
        "terminal-ui",
      ]),
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal?.json ?? {}, terminal?.markdown ?? ""),
    ).not.toThrow();
  });

  it("fails closed on adversarial cell-validation branch fields and predicate claims", async () => {
    const { authority, rawCell } = await retainedRawRepairCell();
    const raw = structuredClone(rawCell);
    mutateRawCellPredicate(raw, "publication", authority);
    const reservation = fakeReservation([]);
    await runInstallerTrustFaultQualification("results", {
      executeCell: async () => raw as never,
      now: () => new Date("2026-07-31T04:31:00.000Z"),
      postValidate: vi.fn(),
      preflight: async () => authority,
      reserve: async () => reservation,
    });
    const terminal = reservation.published.at(-1);
    if (terminal === undefined) throw new Error("Cell-validation terminal fixture is absent");
    for (const mutate of [
      (branch: Record<string, unknown>) => {
        branch.operation = "install";
      },
      (branch: Record<string, unknown>) => {
        branch.attempt = 2;
      },
      (branch: Record<string, unknown>) => {
        branch.phase = "attempt-2";
      },
      (branch: Record<string, unknown>) => {
        branch.faultResourceId = "not-in-manifest";
      },
      (branch: Record<string, unknown>) => {
        branch.violatedPredicates = [];
      },
      (branch: Record<string, unknown>) => {
        branch.violatedPredicates = ["publication", "unknown"];
      },
      (branch: Record<string, unknown>) => {
        const post = nestedRecord(branch.post, "cell-validation post");
        post.uiShellGenerationId = "unsafe-generation";
      },
      (branch: Record<string, unknown>) => {
        const terminalProjection = nestedRecord(branch.terminal, "cell-validation terminal");
        const transfer = nestedRecord(terminalProjection.transfer, "cell-validation transfer");
        transfer.failureMessageSha256 = "secret";
      },
      (branch: Record<string, unknown>) => {
        const proof = nestedRecord(branch.proof, "cell-validation proof");
        proof.terminalStateSha256 = "0".repeat(64);
      },
      (branch: Record<string, unknown>) => {
        const http = nestedRecord(branch.http, "cell-validation HTTP");
        http.selectedRequestCount = 0;
      },
      (branch: Record<string, unknown>) => {
        const http = nestedRecord(branch.http, "cell-validation HTTP");
        http.operationRangeRequestCount = 0;
      },
      (branch: Record<string, unknown>) => {
        const http = nestedRecord(branch.http, "cell-validation HTTP");
        http.operationRangeRequestCount = Number.MAX_SAFE_INTEGER + 1;
      },
      (branch: Record<string, unknown>) => {
        const http = nestedRecord(branch.http, "cell-validation HTTP");
        const selected = nestedRecord(http.selected, "selected HTTP");
        selected.rangeClassification = "other";
      },
      (branch: Record<string, unknown>) => {
        const http = nestedRecord(branch.http, "cell-validation HTTP");
        const selected = nestedRecord(http.selected, "selected HTTP");
        selected.ifRangePresent = true;
      },
      (branch: Record<string, unknown>) => {
        const http = nestedRecord(branch.http, "cell-validation HTTP");
        const selected = nestedRecord(http.selected, "selected HTTP");
        selected.status = 200;
      },
      (branch: Record<string, unknown>) => {
        const http = nestedRecord(branch.http, "cell-validation HTTP");
        const selected = nestedRecord(http.selected, "selected HTTP");
        selected.status = -1;
      },
      (branch: Record<string, unknown>) => {
        const http = nestedRecord(branch.http, "cell-validation HTTP");
        const selected = nestedRecord(http.selected, "selected HTTP");
        selected.etagMatchesManifest = false;
      },
      (branch: Record<string, unknown>) => {
        const http = nestedRecord(branch.http, "cell-validation HTTP");
        const selected = nestedRecord(http.selected, "selected HTTP");
        selected.bodyBytes = (selected.bodyBytes as number) + 1;
      },
      (branch: Record<string, unknown>) => {
        const http = nestedRecord(branch.http, "cell-validation HTTP");
        const selected = nestedRecord(http.selected, "selected HTTP");
        selected.bodyBytes = Number.POSITIVE_INFINITY;
      },
      (branch: Record<string, unknown>) => {
        const http = nestedRecord(branch.http, "cell-validation HTTP");
        const selected = nestedRecord(http.selected, "selected HTTP");
        selected.pathSha256 = "0".repeat(64);
      },
      (branch: Record<string, unknown>) => {
        const accounting = nestedRecord(branch.accounting, "cell-validation accounting");
        accounting.declaredDownloadedBytes = (accounting.declaredDownloadedBytes as number) + 1;
      },
      (branch: Record<string, unknown>) => {
        const accounting = nestedRecord(branch.accounting, "cell-validation accounting");
        accounting.declaredRepairedBytes = (accounting.declaredRepairedBytes as number) + 1;
      },
      (branch: Record<string, unknown>) => {
        const accounting = nestedRecord(branch.accounting, "cell-validation accounting");
        accounting.declaredRepairedResourceCount =
          (accounting.declaredRepairedResourceCount as number) + 1;
      },
      (branch: Record<string, unknown>) => {
        const accounting = nestedRecord(branch.accounting, "cell-validation accounting");
        const delta = nestedRecord(accounting.delta, "cell-validation accounting delta");
        delta.completedResourceCount = (delta.completedResourceCount as number) + 1;
      },
      (branch: Record<string, unknown>) => {
        const accounting = nestedRecord(branch.accounting, "cell-validation accounting");
        const terminal = nestedRecord(accounting.terminal, "cell-validation accounting terminal");
        terminal.downloadedBytes = (terminal.downloadedBytes as number) + 1;
      },
    ]) {
      expect(() =>
        validateInstallerTrustFaultRunEvidence(
          rebindTerminal(terminal.json, (json) => {
            mutate(json.failedCell as Record<string, unknown>);
          }),
        ),
      ).toThrow();
    }
    expect(() =>
      validateInstallerTrustFaultRunEvidence(
        rebindTerminal(terminal.json, (json) => {
          const branch = json.failedCell as Record<string, unknown>;
          const http = nestedRecord(branch.http, "cell-validation HTTP");
          const selected = nestedRecord(http.selected, "selected HTTP");
          const forgedBytes = (selected.bodyBytes as number) + 1;
          selected.bodyBytes = forgedBytes;
          const accounting = nestedRecord(branch.accounting, "cell-validation accounting");
          accounting.declaredDownloadedBytes = forgedBytes;
          accounting.declaredRepairedBytes = forgedBytes;
          const baseline = nestedRecord(accounting.baseline, "cell-validation accounting baseline");
          const delta = nestedRecord(accounting.delta, "cell-validation accounting delta");
          const projectedTerminal = nestedRecord(
            accounting.terminal,
            "cell-validation accounting terminal",
          );
          delta.downloadedBytes = forgedBytes;
          delta.repairedBytes = forgedBytes;
          projectedTerminal.downloadedBytes = (baseline.downloadedBytes as number) + forgedBytes;
          projectedTerminal.repairedBytes = forgedBytes;
          branch.violatedPredicates = ["publication"];
        }),
      ),
    ).toThrow(/predicate evidence/u);
    expect(() =>
      validateInstallerTrustFaultRunEvidence(
        rebindTerminal(terminal.json, (json) => {
          const failure = json.failure as Record<string, unknown>;
          const primary = failure.primary as Record<string, unknown>;
          primary.name = "Error";
        }),
      ),
    ).toThrow(/typed provenance/u);
  });

  it("still surfaces companion failure and closes after cell-validation terminal publication", async () => {
    const { authority, rawCell } = await retainedRawRepairCell();
    const raw = structuredClone(rawCell);
    mutateRawCellPredicate(raw, "publication", authority);
    const events: string[] = [];
    const reservation = fakeReservation(events, { failPublish: true });
    await expect(
      runInstallerTrustFaultQualification("results", {
        executeCell: async () => raw as never,
        now: () => new Date("2026-07-31T04:32:00.000Z"),
        postValidate: vi.fn(),
        preflight: async () => authority,
        reserve: async () => reservation,
      }),
    ).rejects.toThrow(/companion/);
    expect(events).toEqual(["publish-failed", "close"]);
  });

  it("publishes a valid generic cell failure without failed-cell product evidence", async () => {
    const retained = JSON.parse(
      await readFile(
        join(
          process.cwd(),
          "harness/results/installer-trust-faults",
          "installer-trust-faults-v6-2026-07-31T01-51-12-846Z.json",
        ),
        "utf8",
      ),
    ) as { authority: InstallerTrustFaultAuthority };
    const reservation = fakeReservation([]);

    await expect(
      runInstallerTrustFaultQualification("results", {
        executeCell: async () => {
          throw new Error("raw executeCell failure");
        },
        now: () => new Date("2026-07-31T02:10:00.000Z"),
        postValidate: vi.fn(),
        preflight: async () => retained.authority,
        reserve: async () => reservation,
      }),
    ).resolves.toMatchObject({ state: "failed" });

    const terminal = reservation.published.at(-1);
    expect(terminal?.json).toMatchObject({
      cells: [],
      failedCell: null,
      failure: {
        cleanupFailures: [],
        phase: "cell",
        primary: { message: "raw executeCell failure", name: "Error" },
      },
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal?.json ?? {}, terminal?.markdown ?? ""),
    ).not.toThrow();
  });

  it("retains the completed cell prefix and no failedCell when third-cell proof collection fails", async () => {
    const retained = JSON.parse(
      await readFile(
        join(
          process.cwd(),
          "harness/results/installer-trust-faults",
          "installer-trust-faults-v9-2026-07-31T05-44-09-738Z.json",
        ),
        "utf8",
      ),
    ) as {
      authority: InstallerTrustFaultAuthority;
      cells: readonly unknown[];
    };
    const reservation = fakeReservation([]);
    let executionIndex = 0;

    await expect(
      runInstallerTrustFaultQualification("results", {
        executeCell: async () => {
          const completed = upgradeCompletedCellsToActiveProofV3(
            retained.cells,
            retained.authority.releaseDigest,
          )[executionIndex];
          executionIndex += 1;
          if (completed !== undefined) return completed as never;
          throw new InstallerTrustFaultOperationError(
            "read-terminal-evidence",
            "primary",
            new Error("transition proof failure progression is invalid"),
          );
        },
        now: () => new Date("2026-07-31T05:44:09.738Z"),
        postValidate: vi.fn(),
        preflight: async () => retained.authority,
        reserve: async () => reservation,
      }),
    ).resolves.toMatchObject({ state: "failed" });

    const terminal = reservation.published.at(-1);
    expect(terminal?.json).toMatchObject({
      cells: [{ id: "reused-object-corruption" }, { id: "final-verification-corruption" }],
      failedCell: null,
      failure: {
        phase: "cell",
        primary: {
          operation: "read-terminal-evidence",
        },
      },
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal?.json ?? {}, terminal?.markdown ?? ""),
    ).not.toThrow();
  });

  it("publishes a valid cleanup-only cell failure without failed-cell product evidence", async () => {
    const retained = JSON.parse(
      await readFile(
        join(
          process.cwd(),
          "harness/results/installer-trust-faults",
          "installer-trust-faults-v6-2026-07-31T01-51-12-846Z.json",
        ),
        "utf8",
      ),
    ) as { authority: InstallerTrustFaultAuthority };
    const reservation = fakeReservation([]);

    await expect(
      runInstallerTrustFaultQualification("results", {
        executeCell: async () => {
          const ownership = createInstallerTrustFaultOwnership();
          ownership.add({
            operation: "remove-profile",
            run: async () => {
              throw new Error("executeCell cleanup failure");
            },
          });
          await ownership.finish(null);
          throw new Error("unreachable");
        },
        now: () => new Date("2026-07-31T02:20:00.000Z"),
        postValidate: vi.fn(),
        preflight: async () => retained.authority,
        reserve: async () => reservation,
      }),
    ).resolves.toMatchObject({ state: "failed" });

    const terminal = reservation.published.at(-1);
    expect(terminal?.json).toMatchObject({
      cells: [],
      failedCell: null,
      failure: {
        cleanupFailures: [
          {
            cause: { message: "executeCell cleanup failure" },
            operation: "remove-profile",
            stage: "cleanup",
          },
        ],
        phase: "cell",
        primary: null,
      },
      state: "failed",
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal?.json ?? {}, terminal?.markdown ?? ""),
    ).not.toThrow();
  });

  it("binds failed-cell presence and identity to every exact completed-cell prefix", () => {
    for (let index = 0; index < INSTALLER_TRUST_FAULT_CELL_IDS.length; index += 1) {
      const prefix = INSTALLER_TRUST_FAULT_CELL_IDS.slice(0, index);
      const expected = INSTALLER_TRUST_FAULT_CELL_IDS[index];
      if (expected === undefined) throw new Error("Missing trust-fault cell fixture");
      expect(
        validateInstallerTrustFaultFailedCellRunBinding({ id: expected }, prefix, "cell", true),
      ).toBe(expected);
      for (const wrong of INSTALLER_TRUST_FAULT_CELL_IDS.filter((id) => id !== expected)) {
        expect(() =>
          validateInstallerTrustFaultFailedCellRunBinding({ id: wrong }, prefix, "cell", true),
        ).toThrow(/exact next cell/u);
      }
    }
    expect(() =>
      validateInstallerTrustFaultFailedCellRunBinding(
        { id: INSTALLER_TRUST_FAULT_CELL_IDS[0] },
        [INSTALLER_TRUST_FAULT_CELL_IDS[1] as (typeof INSTALLER_TRUST_FAULT_CELL_IDS)[number]],
        "cell",
        true,
      ),
    ).toThrow(/prefix/u);
    expect(() =>
      validateInstallerTrustFaultFailedCellRunBinding(
        { id: INSTALLER_TRUST_FAULT_CELL_IDS[0] },
        INSTALLER_TRUST_FAULT_CELL_IDS,
        "post-validation",
        true,
      ),
    ).toThrow(/non-cell/u);
    expect(validateInstallerTrustFaultFailedCellRunBinding(null, [], "cell")).toBeNull();
    expect(() => validateInstallerTrustFaultFailedCellRunBinding(null, [], "cell", true)).toThrow(
      /product-terminal failure lacks/u,
    );
    expect(() =>
      validateInstallerTrustFaultFailedCellRunBinding(
        { id: INSTALLER_TRUST_FAULT_CELL_IDS[0] },
        [],
        "cell",
      ),
    ).toThrow(/typed product terminal/u);
    expect(validateInstallerTrustFaultFailedCellRunBinding(null, [], "preflight")).toBeNull();
    expect(() =>
      validateInstallerTrustFaultFailedCellRunBinding(
        null,
        [INSTALLER_TRUST_FAULT_CELL_IDS[0]],
        "preflight",
      ),
    ).toThrow(/phase/u);
    expect(() =>
      validateInstallerTrustFaultFailedCellRunBinding(null, [], "post-validation"),
    ).toThrow(/phase/u);
    expect(
      validateInstallerTrustFaultFailedCellRunBinding(
        null,
        INSTALLER_TRUST_FAULT_CELL_IDS,
        "post-validation",
      ),
    ).toBeNull();
    expect(() =>
      validateInstallerTrustFaultFailedCellRunBinding(
        { id: INSTALLER_TRUST_FAULT_CELL_IDS.at(-1) },
        INSTALLER_TRUST_FAULT_CELL_IDS,
        "cell",
        true,
      ),
    ).toThrow(/complete cell run/u);
  });

  it("selects the exact manifest OPFS fault resource for every cell without browser drift", async () => {
    const retained = JSON.parse(
      await readFile(
        join(
          process.cwd(),
          "harness/results/installer-trust-faults",
          "installer-trust-faults-v6-2026-07-31T01-51-12-846Z.json",
        ),
        "utf8",
      ),
    ) as { authority: InstallerTrustFaultAuthority };
    const opfs = parseInstallerTrustFaultManifestResources(retained.authority).filter(
      (resource) => resource.target === "opfs",
    );
    const smallest = [...opfs].sort((left, right) => left.bytes - right.bytes)[0];
    const checkpoint = opfs.find(
      (resource) => resource.bytes > INSTALLER_TRUST_FAULT_CHECKPOINT_BYTES,
    );
    if (smallest === undefined || checkpoint === undefined) {
      throw new Error("Trust-fault selection fixtures are absent");
    }
    for (const id of INSTALLER_TRUST_FAULT_CELL_IDS) {
      expect(selectInstallerTrustFaultResource(retained.authority, id)).toEqual(
        id === "mid-append-quota-resume" ? checkpoint : smallest,
      );
    }
  });

  it("continues to validate retained schema-v2 failed evidence", () => {
    const base = {
      authority: null,
      cells: [],
      completedAt: "2026-07-30T12:00:00.000Z",
      contract: "installer-trust-faults@1",
      failure: {
        cleanupFailures: [],
        phase: "preflight",
        primary: {
          cause: null,
          errors: [],
          kind: "error",
          message: "retained failure",
          name: "Error",
          operation: null,
          stage: null,
        },
      },
      resultSchemaVersion: 1,
      runId: "11111111-1111-4111-8111-111111111111",
      schemaVersion: INSTALLER_TRUST_FAULT_LEGACY_RUN_SCHEMA_VERSION,
      startedAt: "2026-07-30T12:00:00.000Z",
      state: "failed",
    };
    const payload = canonicalJson(base);
    const retained = {
      ...base,
      canonicalBinding: {
        payloadBase64url: Buffer.from(payload).toString("base64url"),
        sha256: createHash("sha256").update(payload).digest("hex"),
      },
    };

    expect(() => validateInstallerTrustFaultRunEvidence(retained)).not.toThrow();
  });

  it("continues to route schema-v3 runs to schema-v2 proof evidence", () => {
    const base = {
      authority: null,
      cells: [],
      completedAt: "2026-07-30T12:00:00.000Z",
      contract: "installer-trust-faults@1",
      failure: {
        cleanupFailures: [],
        phase: "preflight",
        primary: {
          cause: null,
          errors: [],
          kind: "error",
          message: "retained proof-v1 failure",
          name: "Error",
          operation: null,
          stage: null,
        },
      },
      resultSchemaVersion: INSTALLER_TRUST_FAULTS_PREVIOUS_SCHEMA_VERSION,
      runId: "22222222-2222-4222-8222-222222222222",
      schemaVersion: INSTALLER_TRUST_FAULT_PREVIOUS_RUN_SCHEMA_VERSION,
      startedAt: "2026-07-30T12:00:00.000Z",
      state: "failed",
    };
    const payload = canonicalJson(base);
    const retained = {
      ...base,
      canonicalBinding: {
        payloadBase64url: Buffer.from(payload).toString("base64url"),
        sha256: createHash("sha256").update(payload).digest("hex"),
      },
    };

    expect(() => validateInstallerTrustFaultRunEvidence(retained)).not.toThrow();
  });

  it("continues to route retained schema-v4 runs to schema-v3 proof evidence", () => {
    const base = {
      authority: null,
      cells: [],
      completedAt: "2026-07-30T12:00:00.000Z",
      contract: "installer-trust-faults@1",
      failure: {
        cleanupFailures: [],
        phase: "cell",
        primary: {
          cause: null,
          errors: [],
          kind: "error",
          message: "retained persistence warning failure",
          name: "Error",
          operation: null,
          stage: null,
        },
      },
      resultSchemaVersion: INSTALLER_TRUST_FAULTS_PROOF_SCHEMA_VERSION,
      runId: "33333333-3333-4333-8333-333333333333",
      schemaVersion: INSTALLER_TRUST_FAULT_PROOF_RUN_SCHEMA_VERSION,
      startedAt: "2026-07-30T12:00:00.000Z",
      state: "failed",
    };
    const payload = canonicalJson(base);
    const retained = {
      ...base,
      canonicalBinding: {
        payloadBase64url: Buffer.from(payload).toString("base64url"),
        sha256: createHash("sha256").update(payload).digest("hex"),
      },
    };

    expect(() => validateInstallerTrustFaultRunEvidence(retained)).not.toThrow();
  });

  it("reserves pending evidence before preflight and retains sanitized failure", async () => {
    const events: string[] = [];
    const reservation = fakeReservation(events);
    const outcome = await runInstallerTrustFaultQualification("results", {
      executeCell: vi.fn(),
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      postValidate: vi.fn(),
      preflight: async () => {
        events.push("preflight");
        throw new Error(
          [
            "C:\\secret\\profile D:/forward/private file:///C:/url/private \\\\server\\share\\secret //server/share/secret /home/user/private",
            "Authorization: Basic basic-secret trailing-basic-material",
            'Authorization: Digest username="digest-user", realm="digest-realm", response="digest-secret"',
            "Authorization: Custom custom-part-one custom-part-two",
            "Authorization: Multi first-token",
            " folded-second-token folded-third-token",
            "Bearer standalone-token ?access_token=query-secret&api_key=query-key token=do-not-retain",
          ].join("\n"),
        );
      },
      reserve: async (_root, _startedAt, pending) => {
        expect(pending).toMatchObject({ cells: [], state: "pending" });
        events.push("reserve");
        return reservation;
      },
    });

    expect(outcome.state).toBe("failed");
    expect(events).toEqual(["reserve", "preflight", "publish-failed", "close"]);
    const failure = reservation.published.at(-1)?.json.failure as
      | { primary?: { message?: string } }
      | undefined;
    expect(failure?.primary?.message).toContain("<local-path>");
    expect(failure?.primary?.message).toContain("<url-redacted>");
    expect(failure?.primary?.message?.match(/authorization=<redacted>/gu)).toHaveLength(4);
    expect(failure?.primary?.message).toContain("Bearer <redacted>");
    expect(failure?.primary?.message).toContain("token=<redacted>");
    expect(failure?.primary?.message).not.toMatch(
      /secret|private|basic|digest|custom|folded|standalone-token|query-key|query-secret/iu,
    );
  });

  it("reserves the owned pending pair before a throwing lazy runtime startup", async () => {
    const resultRoot = await mkdtemp(join(tmpdir(), "parallax-trust-startup-throw-"));
    const events: string[] = [];
    try {
      const outcome = await runInstallerTrustFaultQualification(resultRoot, {
        createRuntimeDependencies: async () => {
          events.push("startup");
          throw new Error("lazy browser dependency import failed");
        },
        now: () => new Date("2026-07-31T03:10:00.000Z"),
        reserve: async (root, startedAt, pending) => {
          const reservation = await reserveResultPair(
            root,
            startedAt,
            pending,
            {},
            "installer-trust-faults",
            "Installer trust + fault qualification",
          );
          const [pendingJson, pendingMarkdown] = await Promise.all([
            readFile(reservation.jsonPath, "utf8"),
            readFile(reservation.markdownPath, "utf8"),
          ]);
          expect(JSON.parse(pendingJson)).toMatchObject({
            resultOwnership: { publicationState: "reserved" },
            state: "pending",
          });
          expect(pendingMarkdown).toContain("- State: `pending`");
          events.push("reserved");
          return reservation;
        },
      });

      expect(events).toEqual(["reserved", "startup"]);
      expect(outcome.state).toBe("failed");
      const [failedJsonText, failedMarkdown] = await Promise.all([
        readFile(outcome.jsonPath, "utf8"),
        readFile(outcome.markdownPath, "utf8"),
      ]);
      const failedJson = JSON.parse(failedJsonText) as Record<string, unknown>;
      expect(failedJson).toMatchObject({
        authority: null,
        cells: [],
        failedCell: null,
        failure: {
          cleanupFailures: [],
          phase: "preflight",
          primary: {
            message: "lazy browser dependency import failed",
            name: "Error",
          },
        },
        resultOwnership: { publicationState: "failed" },
        state: "failed",
      });
      expect(() =>
        validateInstallerTrustFaultTerminalPair(failedJson, failedMarkdown),
      ).not.toThrow();
    } finally {
      await rm(resultRoot, { force: true, recursive: true });
    }
  });

  it("deadline-owns a never-settling lazy startup and finalizes failure evidence", async () => {
    const resultRoot = await mkdtemp(join(tmpdir(), "parallax-trust-startup-timeout-"));
    const startupEntered = Promise.withResolvers<void>();
    const deadlines: Array<{ cancelled: boolean; expire: () => void; milliseconds: number }> = [];
    try {
      const outcomePromise = runInstallerTrustFaultQualification(resultRoot, {
        createRuntimeDependencies: () => {
          startupEntered.resolve();
          return new Promise(() => undefined);
        },
        now: () => new Date("2026-07-31T03:20:00.000Z"),
        reserve: (root, startedAt, pending) =>
          reserveResultPair(
            root,
            startedAt,
            pending,
            {},
            "installer-trust-faults",
            "Installer trust + fault qualification",
          ),
        scheduleDeadline: (milliseconds, expire) => {
          const deadline = { cancelled: false, expire, milliseconds };
          deadlines.push(deadline);
          return Object.freeze({
            cancel: () => {
              deadline.cancelled = true;
            },
          });
        },
      });
      await startupEntered.promise;
      expect(deadlines.map(({ milliseconds }) => milliseconds)).toEqual([
        INSTALLER_TRUST_FAULT_CORRECTNESS_CEILING_MS,
        INSTALLER_TRUST_FAULT_PROGRESS_STALL_MS,
        INSTALLER_TRUST_FAULT_PROGRESS_STALL_MS,
      ]);
      const absolute = deadlines.find(
        ({ milliseconds }) => milliseconds === INSTALLER_TRUST_FAULT_CORRECTNESS_CEILING_MS,
      );
      if (absolute === undefined) throw new Error("Missing run deadline fixture");
      absolute.expire();
      const outcome = await outcomePromise;

      expect(deadlines.every(({ cancelled }) => cancelled)).toBe(true);
      expect(outcome.state).toBe("failed");
      const [failedJsonText, failedMarkdown] = await Promise.all([
        readFile(outcome.jsonPath, "utf8"),
        readFile(outcome.markdownPath, "utf8"),
      ]);
      const failedJson = JSON.parse(failedJsonText) as Record<string, unknown>;
      expect(failedJson).toMatchObject({
        authority: null,
        cells: [],
        failedCell: null,
        failure: {
          cleanupFailures: [],
          phase: "preflight",
          primary: {
            message: expect.stringContaining(
              `absolute deadline expired after ${INSTALLER_TRUST_FAULT_CORRECTNESS_CEILING_MS} ms during runtime-startup`,
            ),
            name: "InstallerTrustFaultRunTimeoutError",
          },
        },
        state: "failed",
      });
      expect(() =>
        validateInstallerTrustFaultTerminalPair(failedJson, failedMarkdown),
      ).not.toThrow();
      expect(
        new InstallerTrustFaultRunTimeoutError(
          "absolute",
          "runtime-startup",
          INSTALLER_TRUST_FAULT_CORRECTNESS_CEILING_MS,
        ),
      ).toMatchObject({
        classification: "absolute",
        phase: "runtime-startup",
        timeoutMs: INSTALLER_TRUST_FAULT_CORRECTNESS_CEILING_MS,
      });
    } finally {
      await rm(resultRoot, { force: true, recursive: true });
    }
  });

  it("stall-owns a never-settling cell observation and finalizes typed failure evidence", async () => {
    const resultRoot = await mkdtemp(join(tmpdir(), "parallax-trust-cell-stall-"));
    const cellEntered = Promise.withResolvers<void>();
    const { authority } = await retainedRawRepairCell();
    const deadlines: Array<{ cancelled: boolean; expire: () => void; milliseconds: number }> = [];
    try {
      const outcomePromise = runInstallerTrustFaultQualification(resultRoot, {
        createRuntimeDependencies: async () => ({
          executeCell: async () => {
            cellEntered.resolve();
            return new Promise(() => undefined);
          },
          postValidate: async () => undefined,
          preflight: async () => authority,
        }),
        now: () => new Date("2026-07-31T03:25:00.000Z"),
        reserve: (root, startedAt, pending) =>
          reserveResultPair(
            root,
            startedAt,
            pending,
            {},
            "installer-trust-faults",
            "Installer trust + fault qualification",
          ),
        scheduleDeadline: (milliseconds, expire) => {
          const deadline = { cancelled: false, expire, milliseconds };
          deadlines.push(deadline);
          return Object.freeze({
            cancel: () => {
              deadline.cancelled = true;
            },
          });
        },
      });
      await cellEntered.promise;
      const stall = deadlines.findLast(
        ({ cancelled, milliseconds }) =>
          !cancelled && milliseconds === INSTALLER_TRUST_FAULT_PROGRESS_STALL_MS,
      );
      if (stall === undefined) throw new Error("Missing active cell stall deadline fixture");
      stall.expire();
      const outcome = await outcomePromise;

      expect(outcome.state).toBe("failed");
      const failedJson = JSON.parse(await readFile(outcome.jsonPath, "utf8")) as Record<
        string,
        unknown
      >;
      expect(failedJson).toMatchObject({
        authority,
        cells: [],
        failure: {
          phase: "cell",
          primary: {
            message: expect.stringContaining(
              `stall deadline expired after ${INSTALLER_TRUST_FAULT_PROGRESS_STALL_MS} ms during cell:`,
            ),
            name: "InstallerTrustFaultRunTimeoutError",
          },
        },
        state: "failed",
      });
    } finally {
      await rm(resultRoot, { force: true, recursive: true });
    }
  });

  it("preserves create-only suffix collision and owned-pair validation for startup failures", async () => {
    const resultRoot = await mkdtemp(join(tmpdir(), "parallax-trust-startup-collision-"));
    const now = () => new Date("2026-07-31T03:30:00.000Z");
    const dependencies = (): InstallerTrustFaultRunDependencies => ({
      createRuntimeDependencies: async () => {
        throw new Error("bounded startup collision fixture");
      },
      now,
      reserve: (root, startedAt, pending) =>
        reserveResultPair(
          root,
          startedAt,
          pending,
          {},
          "installer-trust-faults",
          "Installer trust + fault qualification",
        ),
    });
    try {
      const first = await runInstallerTrustFaultQualification(resultRoot, dependencies());
      const firstBytes = await Promise.all([
        readFile(first.jsonPath, "utf8"),
        readFile(first.markdownPath, "utf8"),
      ]);
      const second = await runInstallerTrustFaultQualification(resultRoot, dependencies());
      expect(second.jsonPath).not.toBe(first.jsonPath);
      expect(second.markdownPath).not.toBe(first.markdownPath);
      await expect(
        Promise.all([readFile(first.jsonPath, "utf8"), readFile(first.markdownPath, "utf8")]),
      ).resolves.toEqual(firstBytes);
      for (const outcome of [first, second]) {
        const [jsonText, markdown] = await Promise.all([
          readFile(outcome.jsonPath, "utf8"),
          readFile(outcome.markdownPath, "utf8"),
        ]);
        expect(() =>
          validateInstallerTrustFaultTerminalPair(
            JSON.parse(jsonText) as Record<string, unknown>,
            markdown,
          ),
        ).not.toThrow();
      }
    } finally {
      await rm(resultRoot, { force: true, recursive: true });
    }
  });

  it("preserves create-only collision failure without beginning preflight", async () => {
    const preflight = vi.fn();
    const createRuntimeDependencies = vi.fn(async () => ({
      executeCell: vi.fn(),
      postValidate: vi.fn(),
      preflight,
    }));
    await expect(
      runInstallerTrustFaultQualification("results", {
        createRuntimeDependencies,
        now: () => new Date(),
        reserve: async () => {
          const error = new Error("exists") as Error & { code: string };
          error.code = "EEXIST";
          throw error;
        },
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(createRuntimeDependencies).not.toHaveBeenCalled();
    expect(preflight).not.toHaveBeenCalled();
  });

  it("fails closed on unknown pending and failed evidence fields", async () => {
    let pending: Record<string, unknown> | null = null;
    const reservation = fakeReservation([]);
    await runInstallerTrustFaultQualification("results", {
      executeCell: vi.fn(),
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      postValidate: vi.fn(),
      preflight: async () => {
        throw new InstallerTrustFaultOperationError(
          "read-build-manifest",
          "primary",
          new Error("primary"),
        );
      },
      reserve: async (_root, _startedAt, value) => {
        pending = { ...value };
        return reservation;
      },
    });
    expect(pending).not.toBeNull();
    expect(() => validateInstallerTrustFaultRunEvidence({ ...pending, unknown: true })).toThrow(
      /unknown/,
    );
    const failed = reservation.published.at(-1)?.json;
    expect(failed).toBeDefined();
    expect(() => validateInstallerTrustFaultRunEvidence({ ...failed, unknown: true })).toThrow(
      /unknown/,
    );
  });

  it("retains bounded cleanup failures separately from the primary cause", async () => {
    const reservation = fakeReservation([]);
    const outcome = await runInstallerTrustFaultQualification("results", {
      executeCell: vi.fn(),
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      postValidate: vi.fn(),
      preflight: async () => {
        const ownership = createInstallerTrustFaultOwnership();
        ownership.add({
          operation: "remove-profile",
          run: async () => {
            throw new Error("cleanup two");
          },
        });
        ownership.add({
          operation: "close-browser",
          run: async () => {
            throw new Error("cleanup one");
          },
        });
        await ownership.finish({
          error: new Error("primary"),
          operation: "browser-qualification",
        });
        throw new Error("unreachable");
      },
      reserve: async () => reservation,
    });

    expect(outcome.state).toBe("failed");
    expect(reservation.published.at(-1)?.json.failure).toMatchObject({
      cleanupFailures: [
        {
          cause: { message: "cleanup one" },
          operation: "close-browser",
          stage: "cleanup",
        },
        {
          cause: { message: "cleanup two" },
          operation: "remove-profile",
          stage: "cleanup",
        },
      ],
      primary: {
        cause: { message: "primary" },
        operation: "browser-qualification",
        stage: "primary",
      },
    });
  });

  it("retains cleanup-only lifecycle aggregates without inventing a primary failure", async () => {
    const reservation = fakeReservation([]);
    await runInstallerTrustFaultQualification("results", {
      executeCell: vi.fn(),
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      postValidate: vi.fn(),
      preflight: async () => {
        const ownership = createInstallerTrustFaultOwnership();
        ownership.add({
          operation: "remove-profile",
          run: async () => {
            throw new Error("cleanup only");
          },
        });
        await ownership.finish(null);
        throw new Error("unreachable");
      },
      reserve: async () => reservation,
    });
    expect(reservation.published.at(-1)?.json.failure).toMatchObject({
      cleanupFailures: [
        {
          cause: { message: "cleanup only" },
          operation: "remove-profile",
          stage: "cleanup",
        },
      ],
      primary: null,
    });
    expect(reservation.published.at(-1)?.markdown).toContain("- Primary failure: `null`");
    const terminal = reservation.published.at(-1);
    if (terminal === undefined) throw new Error("Missing cleanup-only terminal fixture");
    const wrongCleanupStage = rebindTerminal(terminal.json, (json) => {
      const failure = json.failure as Record<string, unknown>;
      const cleanup = failure.cleanupFailures as Record<string, unknown>[];
      const first = cleanup[0];
      if (first === undefined) throw new Error("Missing cleanup fixture");
      first.stage = "primary";
    });
    expect(() => validateInstallerTrustFaultRunEvidence(wrongCleanupStage)).toThrow(
      /primary stage/,
    );
  });

  it("retains typed operation wrappers and their ordered cause chains without message inference", async () => {
    const reservation = fakeReservation([]);
    await runInstallerTrustFaultQualification("results", {
      executeCell: vi.fn(),
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      postValidate: vi.fn(),
      preflight: async () => {
        throw new InstallerTrustFaultOperationError(
          "seed-install-ready",
          "primary",
          new Error("inner transfer failure"),
        );
      },
      reserve: async () => reservation,
    });
    expect(reservation.published.at(-1)?.json.failure).toMatchObject({
      primary: {
        cause: { message: "inner transfer failure", operation: null },
        message: "Installer trust-fault seed-install-ready failed",
        operation: "seed-install-ready",
        stage: "primary",
      },
    });
  });

  it("derives every trusted transition failure code from exact canonical rule values", () => {
    const codes = [...new Set(INSTALLER_FAILURE_RULES.map((rule) => rule.code))];
    expect(codes).toEqual([
      "cancelled",
      "cancel-target-invalid",
      "concurrent-install",
      "disposed",
      "install-manifest-invalid",
      "shell-incompatible",
      "integrity",
      "protocol",
      "quota",
      "repair-target-mismatch",
      "store",
      "transport",
      "validator",
      "unknown",
    ]);
    for (const code of codes) {
      const error = createInstallerTrustTransitionBoundaryError(
        transitionBindingQueueFailure(code, "absent"),
      );
      expect(readTrustedInstallerTrustTransitionBindingDiagnostic(error)).toMatchObject({
        failedPredicate: "current-not-precursor",
        previousRelationalState: {
          failure: null,
          resource: false,
          store: "failed",
          transfer: "verifying",
        },
      });
    }

    const retainedIntegrityTerminal = createInstallerTrustTransitionBoundaryError(
      transitionBindingQueueFailure("integrity", "present"),
    );
    expect(readTrustedInstallerTrustTransitionBindingDiagnostic(retainedIntegrityTerminal)).toEqual(
      {
        failedPredicate: "current-not-precursor",
        previousRelationalState: {
          active: false,
          failure: null,
          order: 2,
          phase: "attempt-1",
          release: true,
          resource: false,
          shell: true,
          store: "failed",
          transfer: "verifying",
          ui: "repairing",
        },
      },
    );

    for (const index of INSTALLER_FAILURE_RULES.keys()) {
      expect(() =>
        createInstallerTrustTransitionBoundaryError(
          transitionBindingQueueFailure(String(index), "absent"),
        ),
      ).toThrow(/current relational state is invalid/u);
    }
    expect(() =>
      createInstallerTrustTransitionBoundaryError(
        transitionBindingQueueFailure("not-a-rule", "absent"),
      ),
    ).toThrow(/current relational state is invalid/u);
    expect(() =>
      createInstallerTrustTransitionBoundaryError(transitionBindingQueueFailure(null, "present")),
    ).toThrow(/current relational state is invalid/u);
    const nullWithoutResource = createInstallerTrustTransitionBoundaryError(
      transitionBindingQueueFailure(null, "absent"),
    );
    expect(readTrustedInstallerTrustTransitionBindingDiagnostic(nullWithoutResource)).toMatchObject(
      { failedPredicate: "current-not-precursor" },
    );
  });

  it("round-trips every canonical prior failure tuple through sanitized terminal evidence", async () => {
    const codes = [...new Set(INSTALLER_FAILURE_RULES.map((rule) => rule.code))];
    let integrityTerminal:
      | Readonly<{
          json: Record<string, unknown>;
          markdown: string;
        }>
      | undefined;
    for (const code of codes) {
      const rule = INSTALLER_FAILURE_RULES.find((candidate) => candidate.code === code);
      if (rule === undefined) throw new Error(`Missing canonical failure rule for ${code}`);
      const resource = code === "integrity" || rule.resourcePresence === "required";
      const trusted = createInstallerTrustTransitionBoundaryError(
        transitionBindingQueueFailure(null, "absent", code, resource ? "present" : "absent"),
      );
      const reservation = fakeReservation([]);
      await runInstallerTrustFaultQualification("results", {
        executeCell: vi.fn(),
        now: () => new Date("2026-07-31T12:02:00.000Z"),
        postValidate: vi.fn(),
        preflight: async () => {
          throw new InstallerTrustFaultOperationError(
            "wait-for-attempt-1-failed",
            "primary",
            trusted,
          );
        },
        reserve: async () => reservation,
      });
      const terminal = reservation.published.at(-1);
      if (terminal === undefined) throw new Error(`Missing terminal evidence for ${code}`);
      expect(terminal.json.failure).toMatchObject({
        primary: {
          cause: {
            transitionBindingDiagnostic: {
              failedPredicate: "current-not-precursor",
              previousRelationalState: {
                failure: code,
                resource,
              },
            },
          },
        },
      });
      expect(() =>
        validateInstallerTrustFaultTerminalPair(terminal.json, terminal.markdown),
      ).not.toThrow();
      if (code === "integrity") integrityTerminal = terminal;
    }
    if (integrityTerminal === undefined)
      throw new Error("Missing prior integrity terminal fixture");

    for (const failure of [...Array.from(INSTALLER_FAILURE_RULES.keys(), String), "not-a-rule"]) {
      const rebound = rebindTerminal(integrityTerminal.json, (json) => {
        const state = transitionPreviousState(json);
        state.failure = failure;
        state.resource = false;
      });
      expect(() => validateInstallerTrustFaultRunEvidence(rebound)).toThrow(
        /transition binding previous state is invalid/u,
      );
    }
    for (const [failure, resource] of [
      [null, true],
      ["cancelled", true],
      ["cancel-target-invalid", true],
      ["concurrent-install", true],
      ["disposed", true],
      ["install-manifest-invalid", true],
      ["protocol", true],
      ["shell-incompatible", true],
      ["unknown", true],
    ] as const) {
      const rebound = rebindTerminal(integrityTerminal.json, (json) => {
        const state = transitionPreviousState(json);
        state.failure = failure;
        state.resource = resource;
      });
      expect(() => validateInstallerTrustFaultRunEvidence(rebound)).toThrow(
        /transition binding previous state is invalid/u,
      );
    }
    const legitimateIntegrity = rebindTerminal(integrityTerminal.json, (json) => {
      const state = transitionPreviousState(json);
      state.failure = "integrity";
      state.resource = true;
    });
    expect(() => validateInstallerTrustFaultRunEvidence(legitimateIntegrity)).not.toThrow();
  });

  it("retains an explicitly impossible synthetic model rejection through terminal evidence", async () => {
    const queueFailure = impossibleSyntheticTransitionQueueFailure();
    const trusted = createInstallerTrustTransitionBoundaryError(queueFailure);
    expect(readTrustedInstallerTrustTransitionBindingDiagnostic(trusted)).toEqual({
      currentRelationalState: {
        active: false,
        failure: "quota",
        order: 3,
        phase: "attempt-1",
        release: false,
        resource: false,
        shell: false,
        store: "idle",
        transfer: "failed",
        ui: "failed",
      },
      predicate: "transition-model-rejected",
      previousRelationalState: {
        active: false,
        failure: null,
        order: 2,
        phase: "attempt-1",
        release: false,
        resource: false,
        shell: false,
        store: "idle",
        transfer: "planning",
        ui: "installing",
      },
      proofPrefix: {
        acknowledgedThrough: 2,
        observationCount: 2,
        sha256: "9".repeat(64),
      },
      repairFailedPredicate: null,
    });
    const absentFailure = structuredClone(queueFailure);
    const absentDiagnostic = nestedRecord(absentFailure.bindingDiagnostic, "absent diagnostic");
    absentDiagnostic.predicate = "binding-absent";
    const absentPrefix = nestedRecord(absentDiagnostic.proofPrefix, "absent proof prefix");
    absentPrefix.observationCount = null;
    absentPrefix.sha256 = null;
    expect(
      readTrustedInstallerTrustTransitionBindingDiagnostic(
        createInstallerTrustTransitionBoundaryError(absentFailure),
      ),
    ).toMatchObject({
      predicate: "binding-absent",
      proofPrefix: { acknowledgedThrough: 2, observationCount: null, sha256: null },
    });
    const modelRepairFailure = structuredClone(queueFailure);
    nestedRecord(
      modelRepairFailure.bindingDiagnostic,
      "model Repair diagnostic",
    ).repairFailedPredicate = "current-not-precursor";
    const modelRepairTrusted = createInstallerTrustTransitionBoundaryError(modelRepairFailure);
    expect(readTrustedInstallerTrustTransitionBindingDiagnostic(modelRepairTrusted)).toMatchObject({
      predicate: "transition-model-rejected",
      repairFailedPredicate: "current-not-precursor",
    });
    for (const predicate of [
      "binding-absent",
      "binding-outcome-invalid",
      "binding-transport-rejected",
    ] as const) {
      const impossible = structuredClone(queueFailure);
      const diagnostic = nestedRecord(impossible.bindingDiagnostic, "impossible diagnostic");
      diagnostic.predicate = predicate;
      diagnostic.repairFailedPredicate = "current-not-precursor";
      const prefix = nestedRecord(diagnostic.proofPrefix, "impossible proof prefix");
      prefix.observationCount = null;
      prefix.sha256 = null;
      expect(() => createInstallerTrustTransitionBoundaryError(impossible)).toThrow(
        /cannot carry a Repair predicate/u,
      );
    }

    const reservation = fakeReservation([]);
    await runInstallerTrustFaultQualification("results", {
      executeCell: vi.fn(),
      now: () => new Date("2026-07-31T12:03:00.000Z"),
      postValidate: vi.fn(),
      preflight: async () => {
        throw new InstallerTrustFaultOperationError(
          "wait-for-attempt-1-failed",
          "primary",
          trusted,
        );
      },
      reserve: async () => reservation,
    });
    const terminal = reservation.published.at(-1);
    if (terminal === undefined) throw new Error("Missing quota transition terminal fixture");
    expect(terminal.json).toMatchObject({
      resultSchemaVersion: 5,
      schemaVersion: 12,
      failure: {
        primary: {
          cause: {
            message: INSTALLER_TRUST_TRANSITION_REJECTION_MESSAGE,
            transitionBindingDiagnostic:
              readTrustedInstallerTrustTransitionBindingDiagnostic(trusted),
          },
        },
      },
    });
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal.json, terminal.markdown),
    ).not.toThrow();
    expect(() =>
      validateInstallerTrustFaultRunEvidence(
        rebindTerminal(terminal.json, (json) => {
          json.schemaVersion = 9;
        }),
      ),
    ).toThrow(/requires run schema 10/u);

    const mutations: readonly ((json: Record<string, unknown>) => void)[] = [
      (json) => {
        transitionDiagnostic(json).unknown = true;
      },
      (json) => {
        transitionDiagnostic(json).predicate = "x".repeat(2_001);
      },
      (json) => {
        const current = nestedRecord(
          transitionDiagnostic(json).currentRelationalState,
          "current relational state",
        );
        current.failure = null;
        current.resource = true;
      },
      (json) => {
        const previous = transitionPreviousState(json);
        previous.order = 1;
      },
      (json) => {
        const prefix = nestedRecord(transitionDiagnostic(json).proofPrefix, "proof prefix");
        prefix.observationCount = 1;
      },
      (json) => {
        const prefix = nestedRecord(transitionDiagnostic(json).proofPrefix, "proof prefix");
        prefix.sha256 = "not-a-digest";
      },
      (json) => {
        transitionDiagnostic(json).repairFailedPredicate = "previous-not-revoked-finalization";
      },
      (json) => {
        const diagnostic = transitionDiagnostic(json);
        diagnostic.predicate = "binding-absent";
        diagnostic.repairFailedPredicate = "current-not-precursor";
        const prefix = nestedRecord(diagnostic.proofPrefix, "proof prefix");
        prefix.observationCount = null;
        prefix.sha256 = null;
      },
      (json) => {
        const diagnostic = transitionDiagnostic(json);
        diagnostic.predicate = "binding-outcome-invalid";
        diagnostic.repairFailedPredicate = "current-not-precursor";
        const prefix = nestedRecord(diagnostic.proofPrefix, "proof prefix");
        prefix.observationCount = null;
        prefix.sha256 = null;
      },
      (json) => {
        const diagnostic = transitionDiagnostic(json);
        diagnostic.predicate = "binding-transport-rejected";
        diagnostic.repairFailedPredicate = "current-not-precursor";
        const prefix = nestedRecord(diagnostic.proofPrefix, "proof prefix");
        prefix.observationCount = null;
        prefix.sha256 = null;
      },
    ];
    for (const mutate of mutations) {
      expect(() =>
        validateInstallerTrustFaultRunEvidence(rebindTerminal(terminal.json, mutate)),
      ).toThrow(/transition|unknown|repair diagnostic|binding predicate/u);
    }

    const boundaryMutations: readonly ((failure: Record<string, unknown>) => void)[] = [
      (failure) => {
        failure.message = "x".repeat(2_001);
      },
      (failure) => {
        nestedRecord(failure.bindingDiagnostic, "diagnostic").predicate = "model";
      },
      (failure) => {
        nestedRecord(
          nestedRecord(failure.bindingDiagnostic, "diagnostic").proofPrefix,
          "proof prefix",
        ).acknowledgedThrough = 1;
      },
      (failure) => {
        nestedRecord(failure.bindingDiagnostic, "diagnostic").previousRelationalState = null;
      },
    ];
    for (const mutate of boundaryMutations) {
      const malformed = structuredClone(queueFailure);
      mutate(malformed);
      expect(() => createInstallerTrustTransitionBoundaryError(malformed)).toThrow();
    }
  });

  it("retains only closed Repair-edge diagnostics and rejects malformed result evidence", async () => {
    const reservation = fakeReservation([]);
    const previous = {
      active: false,
      failure: null,
      order: 2,
      phase: "attempt-1",
      release: true,
      resource: false,
      shell: true,
      store: "writing",
      transfer: "verifying",
      ui: "repairing",
    };
    const binding = createInstallerTrustTransitionBoundaryError({
      bindingDiagnostic: {
        failedPredicate: "previous-revoked-store-not-idle-or-verifying",
        previousRelationalState: {
          activeAuthority: "absent",
          failureCode: null,
          failureResource: "absent",
          order: 2,
          phase: "attempt-1",
          releaseAuthority: "present",
          shellAuthority: "present",
          storeState: "writing",
          transferState: "verifying",
          uiState: "repairing",
        },
      },
      message: INSTALLER_TRUST_TRANSITION_BINDING_FAILURE_MESSAGE,
      name: "InstallerTrustTransitionBindingError",
      order: 3,
      relationalState: {
        activeAuthority: "absent",
        failureCode: null,
        failureResource: "absent",
        order: 3,
        phase: "attempt-1",
        releaseAuthority: "present",
        shellAuthority: "present",
        storeState: "failed",
        transferState: "verifying",
        uiState: "repairing",
      },
    });
    await runInstallerTrustFaultQualification("results", {
      executeCell: vi.fn(),
      now: () => new Date("2026-07-31T12:00:00.000Z"),
      postValidate: vi.fn(),
      preflight: async () => {
        throw new InstallerTrustFaultOperationError(
          "wait-for-attempt-1-failed",
          "primary",
          binding,
        );
      },
      reserve: async () => reservation,
    });
    const terminal = reservation.published.at(-1);
    if (terminal === undefined) throw new Error("Missing transition diagnostic terminal fixture");
    expect(terminal.json.failure).toMatchObject({
      primary: {
        cause: {
          message:
            "Installer trust-fault transition proof crossed its repair failure edge automaton",
          transitionBindingDiagnostic: {
            failedPredicate: "previous-revoked-store-not-idle-or-verifying",
            previousRelationalState: previous,
          },
        },
      },
    });
    const serialized = JSON.stringify(terminal.json.failure);
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("raw-digest");
    expect(serialized).not.toContain("a".repeat(64));
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal.json, terminal.markdown),
    ).not.toThrow();

    const mutations: readonly ((json: Record<string, unknown>) => void)[] = [
      (json) => {
        transitionDiagnostic(json).unknown = true;
      },
      (json) => {
        transitionDiagnostic(json).failedPredicate = "x".repeat(1_000);
      },
      (json) => {
        const diagnostic = transitionDiagnostic(json);
        const state = diagnostic.previousRelationalState as Record<string, unknown>;
        state.unknown = true;
      },
      (json) => {
        transitionDiagnostic(json).failedPredicate = "previous-not-revoked-finalization";
      },
      (json) => {
        const diagnostic = transitionDiagnostic(json);
        const state = diagnostic.previousRelationalState as Record<string, unknown>;
        state.store = "idle";
      },
    ];
    for (const mutate of mutations) {
      const rebound = rebindTerminal(terminal.json, mutate);
      expect(() => validateInstallerTrustFaultRunEvidence(rebound)).toThrow(
        /transition binding|unknown/u,
      );
    }
  });

  it("never promotes forged transition diagnostics from text, names, objects, or prototypes", async () => {
    const reservation = fakeReservation([]);
    const forgedText = [
      `page.evaluate: InstallerTrustTransitionBindingError: ${INSTALLER_TRUST_TRANSITION_REJECTION_MESSAGE}`,
      'predicate=transition-model-rejected; proofPrefix={"observationCount":2}',
      'currentRelationalState={"failure":"quota"}',
    ].join("; ");
    const exactText = new Error(forgedText);
    const named = new Error(forgedText);
    named.name = "InstallerTrustTransitionBindingError";
    named.stack = `InstallerTrustTransitionBindingError: ${forgedText}\n at C:\\private\\profile\\${"a".repeat(64)}\n at https://secret.invalid/path`;
    class ForgedTransitionBindingError extends Error {}
    const subclass = new ForgedTransitionBindingError(forgedText);
    const authentic = createInstallerTrustTransitionBoundaryError(
      impossibleSyntheticTransitionQueueFailure(),
    );
    const prototypeForgery = new Error(forgedText);
    Object.setPrototypeOf(prototypeForgery, Object.getPrototypeOf(authentic));
    const hiddenConstructor = authentic.constructor as new () => Error;
    class HiddenConstructorSubclassForgery extends hiddenConstructor {}
    const hiddenConstructorSubclass = new HiddenConstructorSubclassForgery();
    Object.setPrototypeOf(authentic, Error.prototype);
    const plainObject = {
      message: forgedText,
      name: "InstallerTrustTransitionBindingError",
      transitionBindingDiagnostic: {
        failedPredicate: "current-not-precursor",
        previousRelationalState: {},
      },
    };
    const crossRealmJson = JSON.parse(
      JSON.stringify({
        message: forgedText,
        name: "InstallerTrustTransitionBindingError",
        transitionBindingDiagnostic: {
          failedPredicate: "current-not-precursor",
          previousRelationalState: {},
        },
      }),
    );
    const crossRealmError = runInNewContext(
      `new Error(${JSON.stringify(forgedText)})`,
      Object.create(null) as object,
    ) as Error;
    crossRealmError.name = "InstallerTrustTransitionBindingError";
    await runInstallerTrustFaultQualification("results", {
      executeCell: vi.fn(),
      now: () => new Date("2026-07-31T12:01:00.000Z"),
      postValidate: vi.fn(),
      preflight: async () => {
        throw new InstallerTrustFaultOperationError(
          "wait-for-attempt-1-failed",
          "primary",
          new AggregateError([
            exactText,
            named,
            subclass,
            prototypeForgery,
            hiddenConstructorSubclass,
            authentic,
            plainObject,
            crossRealmJson,
            crossRealmError,
          ]),
        );
      },
      reserve: async () => reservation,
    });
    const terminal = reservation.published.at(-1);
    if (terminal === undefined) throw new Error("Missing forged diagnostic terminal fixture");
    const serialized = JSON.stringify(terminal.json.failure);
    expect(serialized).not.toContain("transitionBindingDiagnostic");
    expect(serialized).not.toContain("C:\\private");
    expect(serialized).not.toContain("secret.invalid");
    expect(serialized).not.toContain("a".repeat(64));
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal.json, terminal.markdown),
    ).not.toThrow();
  });

  it("bounds nested aggregates, cycles, unknown values, and oversized secret-bearing messages", async () => {
    const reservation = fakeReservation([]);
    const cycle = new Error("cycle");
    cycle.cause = cycle;
    const nested = new AggregateError(
      [
        cycle,
        { unsupported: true },
        new InstallerTrustFaultOperationError(
          "nested-cleanup",
          "cleanup",
          new InstallerTrustFaultOperationError(
            "nested-primary",
            "primary",
            new Error("nested mixed"),
          ),
        ),
        new Error(`C:\\private\\file token=hunter2 ${"x".repeat(700)}`),
        ...Array.from({ length: 20 }, (_, index) => new Error(`extra ${index}`)),
      ],
      "nested",
      { cause: new Error("aggregate cause") },
    );
    await runInstallerTrustFaultQualification("results", {
      executeCell: vi.fn(),
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      postValidate: vi.fn(),
      preflight: async () => {
        throw new InstallerTrustFaultOperationError("observe-worker", "primary", nested);
      },
      reserve: async () => reservation,
    });
    const terminal = reservation.published.at(-1);
    expect(terminal).toBeDefined();
    if (terminal === undefined) throw new Error("Missing terminal fixture");
    const serialized = JSON.stringify(terminal.json.failure);
    expect(serialized).toContain('"kind":"aggregate"');
    expect(serialized).toContain('"kind":"cycle"');
    expect(serialized).toContain('"kind":"redacted"');
    expect(serialized).toContain('"kind":"truncated"');
    expect(serialized).toContain('"stage":"cleanup"');
    expect(serialized).toContain('"stage":"primary"');
    expect(serialized).toContain("<oversized unspecified failure redacted>");
    expect(serialized).not.toContain("hunter2");
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal.json, terminal.markdown),
    ).not.toThrow();
  });

  it("shares one deterministic failure-node budget across primary and cleanup roots", async () => {
    const reservation = fakeReservation([]);
    const deep = (label: string): Error => {
      let cause: Error = new Error(`${label}-leaf`);
      for (let index = 0; index < 20; index += 1) {
        cause = new Error(`${label}-${index}`, { cause });
      }
      return cause;
    };
    await runInstallerTrustFaultQualification("results", {
      executeCell: vi.fn(),
      now: () => new Date("2026-07-30T12:00:01.000Z"),
      postValidate: vi.fn(),
      preflight: async () => {
        throw new InstallerTrustFaultLifecycleAggregateError([
          new InstallerTrustFaultOperationError("primary-deep", "primary", deep("primary")),
          ...Array.from(
            { length: 6 },
            (_, index) =>
              new InstallerTrustFaultOperationError(
                `cleanup-${index}`,
                "cleanup",
                deep(`cleanup-${index}`),
              ),
          ),
        ]);
      },
      reserve: async () => reservation,
    });
    const terminal = reservation.published.at(-1);
    if (terminal === undefined) throw new Error("Missing shared-budget terminal fixture");
    const failure = terminal.json.failure as {
      cleanupFailures: readonly unknown[];
      primary: unknown;
    };
    expect(
      countSanitizedFailureNodes(failure.primary) +
        failure.cleanupFailures.reduce<number>(
          (count, cleanup) => count + countSanitizedFailureNodes(cleanup),
          0,
        ),
    ).toBe(32);
    expect(failure.cleanupFailures.length).toBeLessThan(6);
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal.json, terminal.markdown),
    ).not.toThrow();
  });

  it("cross-validates the canonical terminal JSON and Markdown companion both ways", async () => {
    const reservation = fakeReservation([]);
    await runInstallerTrustFaultQualification("results", {
      executeCell: vi.fn(),
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      postValidate: vi.fn(),
      preflight: async () => {
        throw new InstallerTrustFaultOperationError(
          "read-build-manifest",
          "primary",
          new Error("primary"),
        );
      },
      reserve: async () => reservation,
    });
    const terminal = reservation.published.at(-1);
    expect(terminal).toBeDefined();
    if (terminal === undefined) throw new Error("Missing terminal fixture");
    expect(() =>
      validateInstallerTrustFaultTerminalPair(terminal.json, terminal.markdown),
    ).not.toThrow();
    expect(() =>
      validateInstallerTrustFaultTerminalPair(
        terminal.json,
        terminal.markdown.replace(
          /Canonical payload SHA-256: `[a-f0-9]{64}`/u,
          `Canonical payload SHA-256: \`${"0".repeat(64)}\``,
        ),
      ),
    ).toThrow(/binding/);
    expect(() =>
      validateInstallerTrustFaultTerminalPair(
        { ...terminal.json, completedAt: "2026-07-30T12:00:01.000Z" },
        terminal.markdown,
      ),
    ).toThrow(/canonical/);
    expect(() =>
      validateInstallerTrustFaultTerminalPair(
        terminal.json,
        terminal.markdown.replace('"primary"', '"tampered"'),
      ),
    ).toThrow(/Markdown/);
    for (const sensitive of [
      "C:\\private\\file",
      "D:/private/file",
      "file:///C:/private/file",
      "\\\\server\\share\\file",
      "//server/share/file",
      "/home/user/file",
      "Authorization: Bearer credential",
      "Authorization: Basic basic-credential trailing-material",
      'Authorization: Digest username="user", response="digest-credential"',
      "Authorization: Custom first-token second-token",
      "Authorization: Multi first-token\r\n folded-secret folded-tail",
      "authorization=<redacted> leaked-tail",
      "Bearer credential",
      "?access_token=credential",
    ]) {
      const rebound = rebindTerminal(terminal.json, (json) => {
        const failure = json.failure as Record<string, unknown>;
        const primary = failure.primary as Record<string, unknown>;
        primary.message = sensitive;
      });
      expect(() => validateInstallerTrustFaultRunEvidence(rebound)).toThrow(/failure node/);
    }
    const wrongStage = rebindTerminal(terminal.json, (json) => {
      const failure = json.failure as Record<string, unknown>;
      const primary = failure.primary as Record<string, unknown>;
      primary.stage = "cleanup";
    });
    expect(() => validateInstallerTrustFaultRunEvidence(wrongStage)).toThrow(/cleanup stage/);
    const strippedMetadata = rebindTerminal(terminal.json, (json) => {
      const failure = json.failure as Record<string, unknown>;
      const primary = failure.primary as Record<string, unknown>;
      primary.operation = null;
      primary.stage = null;
    });
    expect(() => validateInstallerTrustFaultRunEvidence(strippedMetadata)).toThrow(
      /operation failure node/,
    );
    const partialMetadata = rebindTerminal(terminal.json, (json) => {
      const failure = json.failure as Record<string, unknown>;
      const primary = failure.primary as Record<string, unknown>;
      primary.operation = null;
    });
    expect(() => validateInstallerTrustFaultRunEvidence(partialMetadata)).toThrow(/failure node/);
    const renamedOperation = rebindTerminal(terminal.json, (json) => {
      const failure = json.failure as Record<string, unknown>;
      const primary = failure.primary as Record<string, unknown>;
      primary.name = "Error";
    });
    expect(() => validateInstallerTrustFaultRunEvidence(renamedOperation)).toThrow(
      /operation failure node/,
    );
    const reservationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ownedJson = {
      resultReservationId: reservationId,
      ...terminal.json,
      resultOwnership: {
        publicationState: terminal.state,
        reservationId,
      },
    };
    const ownedMarkdown = [
      `<!-- parallax-result-reservation:${reservationId} -->`,
      terminal.markdown.trimEnd(),
      `- Result reservation: \`${reservationId}\``,
      `- Publication state: \`${terminal.state}\``,
      "",
    ].join("\n");
    expect(() => validateInstallerTrustFaultTerminalPair(ownedJson, ownedMarkdown)).not.toThrow();
    expect(() =>
      validateInstallerTrustFaultTerminalPair(
        ownedJson,
        ownedMarkdown.replace("Publication state: `failed`", "Publication state: `passed`"),
      ),
    ).toThrow(/ownership/);
  });

  it("surfaces companion publication failure and still closes the reservation", async () => {
    const events: string[] = [];
    const reservation = fakeReservation(events, { failPublish: true });
    await expect(
      runInstallerTrustFaultQualification("results", {
        executeCell: vi.fn(),
        now: () => new Date(),
        postValidate: vi.fn(),
        preflight: async () => {
          throw new Error("primary");
        },
        reserve: async () => reservation,
      }),
    ).rejects.toThrow(/companion/);
    expect(events).toEqual(["publish-failed", "close"]);
  });

  it("surfaces cleanup-close failure after retaining the primary failure", async () => {
    const events: string[] = [];
    const reservation = fakeReservation(events, { failClose: true });
    await expect(
      runInstallerTrustFaultQualification("results", {
        executeCell: vi.fn(),
        now: () => new Date(),
        postValidate: vi.fn(),
        preflight: async () => {
          throw new Error("primary");
        },
        reserve: async () => reservation,
      }),
    ).rejects.toThrow(/cleanup close/);
    expect(events).toEqual(["publish-failed", "close"]);
  });
});

function unexpectedRepairStoreFailureTransitions(
  authority: InstallerTrustFaultAuthority,
  options: Readonly<{
    failureCode?: InstallerTrustFaultTransition["failureCode"];
    failureResourceId?: string | null;
    storeState?: InstallerTrustFaultTransition["storeState"];
  }> = {},
): readonly InstallerTrustFaultTransition[] {
  const transitions: InstallerTrustFaultTransition[] = [];
  const generationId = `${authority.artifactDigest}:${authority.releaseDigest}`;
  const push = (
    phase: InstallerTrustFaultTransition["phase"],
    transferState: InstallerTrustFaultTransition["transferState"],
    storeState: InstallerTrustFaultTransition["storeState"],
    uiState: InstallerTrustFaultTransition["uiState"],
    authorityMode: "full" | "none" | "store",
    failureCode: InstallerTrustFaultTransition["failureCode"] = null,
    failureResourceId: string | null = null,
  ): void => {
    transitions.push({
      activeReleaseDigest: authorityMode === "none" ? null : authority.releaseDigest,
      failureCode,
      failureResourceId,
      order: transitions.length + 1,
      phase,
      releaseDigest: authorityMode === "full" ? authority.releaseDigest : null,
      shellGenerationId: authorityMode === "full" ? generationId : null,
      storeState,
      transferState,
      uiState,
    });
  };
  push("setup", "idle", "idle", "idle", "none");
  push("seed", "waiting-lock", "idle", "installing", "none");
  push("seed", "planning", "idle", "installing", "none");
  push("seed", "probing-quota", "writing", "installing", "none");
  push("seed", "transferring", "writing", "installing", "none");
  push("seed", "verifying", "verifying", "installing", "none");
  push("seed", "ready", "ready", "installing", "store");
  push("seed", "ready", "ready", "ready", "full");
  push("attempt-1", "ready", "ready", "requesting-persistence", "full");
  push("attempt-1", "ready", "ready", "repairing", "full");
  push("attempt-1", "waiting-lock", "ready", "repairing", "full");
  push("attempt-1", "planning", "ready", "repairing", "full");
  push("attempt-1", "probing-quota", "writing", "repairing", "full");
  push("attempt-1", "transferring", "writing", "repairing", "full");
  push("attempt-1", "verifying", "verifying", "repairing", "full");
  push(
    "attempt-1",
    "failed",
    options.storeState ?? "failed",
    "failed",
    "none",
    options.failureCode ?? "store",
    options.failureResourceId ?? null,
  );
  return transitions;
}

function rawEstimateState(
  order: number,
  phase: InstallerTrustFaultTransition["phase"],
  transferState: InstallerTrustFaultTransition["transferState"],
  storeState: InstallerTrustFaultTransition["storeState"],
  uiState: InstallerTrustFaultTransition["uiState"],
): InstallerTrustFaultTransition {
  return {
    activeReleaseDigest: null,
    failureCode: null,
    failureResourceId: null,
    order,
    phase,
    releaseDigest: null,
    shellGenerationId: null,
    storeState,
    transferState,
    uiState,
  };
}

function rawEstimateObservation(transition: InstallerTrustFaultTransition): Readonly<{
  degradedDurabilityWarning: boolean;
  persistence: "denied" | "not-requested";
  telemetry: InstallerSnapshot;
  transition: InstallerTrustFaultTransition;
}> {
  const failure =
    transition.failureCode === "quota"
      ? createInstallerFailureDiagnostic(
          "quota",
          "quota",
          "quota-exceeded",
          "Installer storage quota was exceeded",
          transition.failureResourceId,
          "install",
        )
      : null;
  const installStore: InstallStoreTelemetrySnapshot = {
    activeReleaseDigest: transition.activeReleaseDigest,
    checkpointWriteCount: 0,
    currentCheckpointCount: 0,
    currentReleaseDigest: null,
    currentResourceId: null,
    etagBoundPartialCount: 0,
    failureMessage: null,
    finalVerificationBytes: 0,
    finalVerificationPhase: "idle",
    finalVerificationResourceCount: 0,
    finalVerificationTotalBytes: 0,
    finalVerificationTotalResourceCount: 0,
    garbageCollectedBytes: 0,
    garbageCollectedEntries: 0,
    garbageCollectionRemaining: false,
    hashedBytes: 0,
    integrityFailures: 0,
    lastOperationDurationMs: 0,
    partialBytes: 0,
    partialResourceCount: 0,
    previousReleaseDigest: null,
    publicationCount: 0,
    quotaExceededCount: 0,
    readyReleaseCount: 0,
    reconciliationCount: 0,
    recoveryCount: 0,
    resumedBytes: 0,
    reusedBytes: 0,
    rollbackCount: 0,
    schemaVersion: 3,
    stagedReleaseCount: 0,
    state: transition.storeState,
    verifiedObjectBytes: 0,
    verifiedObjectCount: 0,
    writtenBytes: 0,
  };
  return {
    degradedDurabilityWarning: transition.phase !== "setup",
    persistence: transition.phase === "setup" ? "not-requested" : "denied",
    telemetry: {
      installStore,
      installerTransfer: {
        ...idleInstallerTransferTelemetrySnapshot(),
        activeReleaseDigest: transition.activeReleaseDigest,
        failureCode: failure?.code ?? null,
        failureClass: failure?.failureClass ?? null,
        failureEvidence: failure?.failureEvidence ?? null,
        failureExpectedReleaseDigest:
          failure?.operation === "repair" ? transition.activeReleaseDigest : null,
        failureMessage: failure?.message ?? null,
        failureOperation: failure?.operation ?? null,
        failureResourceId: failure?.resourceId ?? null,
        failureSource: failure === null ? null : "operation",
        quotaFailureCount: failure === null ? 0 : 1,
        state: transition.transferState,
      },
    },
    transition,
  };
}

async function productionBrowserRejectedCellFailure(
  authority: InstallerTrustFaultAuthority,
  failureClass: "bounds" | "cell-invariant" | "consistency" | "order" | "parse",
): Promise<Error> {
  const resource = selectInstallerTrustFaultResource(authority, "estimate-clearly-insufficient");
  const recorder = createInstallerTrustFaultTransitionProofRecorder(
    "estimate-clearly-insufficient",
    authority,
    resource.id,
  );
  const setup = rawEstimateState(1, "setup", "idle", "idle", "idle");
  recorder.observe(rawEstimateObservation(setup));

  let rawObservations: unknown[];
  if (failureClass === "bounds") {
    rawObservations = Array.from({ length: 16_384 }, (_, index) => {
      const transition = rawEstimateState(
        index + 2,
        "attempt-1",
        "idle",
        "idle",
        "requesting-persistence",
      );
      const observation = rawEstimateObservation(transition);
      return {
        ...observation,
        telemetry: {
          installStore: {
            activeReleaseDigest: observation.telemetry.installStore.activeReleaseDigest,
            state: observation.telemetry.installStore.state,
          },
          installerTransfer: {
            activeReleaseDigest: observation.telemetry.installerTransfer.activeReleaseDigest,
            failureCode: observation.telemetry.installerTransfer.failureCode,
            failureClass: observation.telemetry.installerTransfer.failureClass,
            failureEvidence: observation.telemetry.installerTransfer.failureEvidence,
            failureExpectedReleaseDigest:
              observation.telemetry.installerTransfer.failureExpectedReleaseDigest,
            failureMessage: observation.telemetry.installerTransfer.failureMessage,
            failureOperation: observation.telemetry.installerTransfer.failureOperation,
            failureResourceId: observation.telemetry.installerTransfer.failureResourceId,
            failureSource: observation.telemetry.installerTransfer.failureSource,
            state: observation.telemetry.installerTransfer.state,
          },
        },
      };
    });
  } else {
    const transition = {
      ...rawEstimateState(2, "attempt-1", "idle", "idle", "requesting-persistence"),
      ...(failureClass === "cell-invariant"
        ? { activeReleaseDigest: authority.releaseDigest }
        : {}),
    };
    const observation = rawEstimateObservation(transition);
    if (failureClass === "order") recorder.observe(observation);
    rawObservations = [
      failureClass === "parse"
        ? { ...observation, telemetry: { ...observation.telemetry, unexpected: true } }
        : failureClass === "consistency"
          ? {
              ...observation,
              telemetry: {
                ...observation.telemetry,
                installStore: { ...observation.telemetry.installStore, state: "writing" },
              },
            }
          : observation,
    ];
  }

  const page = {
    evaluate: async () => ({
      rawObservations,
      transitions: rawObservations.map(
        (observation) =>
          (observation as { readonly transition: InstallerTrustFaultTransition }).transition,
      ),
    }),
  } as unknown as Page;
  let barrierError: Error | null = null;
  try {
    await runInstallerTrustTransitionBarrier(page, recorder, "clear");
  } catch (error: unknown) {
    barrierError = error as Error;
  }
  if (barrierError === null) throw new Error("Production observation barrier did not reject");
  const ownership = createInstallerTrustFaultOwnership();
  try {
    await finishInstallerTrustFaultBrowserCell(
      ownership,
      barrierError,
      "wait-for-attempt-1-failed",
      recorder,
    );
  } catch (error: unknown) {
    return error as Error;
  }
  throw new Error("Production browser-cell ownership did not retain the rejected observation");
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function upgradeCompletedCellsToActiveProofV3(
  cells: readonly unknown[],
  releaseDigest: string,
): unknown[] {
  return structuredClone(cells).map((candidate) => {
    const cell = nestedRecord(candidate, "completed cell");
    for (const rawSnapshot of cell.snapshots as unknown[]) {
      const snapshot = nestedRecord(rawSnapshot, "completed installer snapshot");
      const transfer = nestedRecord(
        snapshot.installerTransfer,
        "completed installer-transfer snapshot",
      );
      if (transfer.schemaVersion === 6) {
        const oldRequiredPeakBytes = transfer.quotaRequiredPeakBytes as number;
        const plannedDownloadBytes = transfer.plannedDownloadBytes as number;
        const largestUnverifiedResourceBytes =
          oldRequiredPeakBytes === 0
            ? 0
            : oldRequiredPeakBytes - plannedDownloadBytes - 16 * 1024 * 1024;
        transfer.schemaVersion = 7;
        transfer.quotaRequiredPeakBytes =
          oldRequiredPeakBytes === 0
            ? 0
            : Math.max(largestUnverifiedResourceBytes, 1024 * 1024) + 16 * 1024 * 1024;
      }
      if (transfer.schemaVersion === 7) transfer.schemaVersion = 8;
      if (transfer.schemaVersion === 8) {
        transfer.failureSource = transfer.failureCode === null ? null : "operation";
        transfer.failureExpectedReleaseDigest =
          transfer.failureSource === "operation" && transfer.failureOperation === "repair"
            ? releaseDigest
            : null;
        transfer.schemaVersion = 9;
      }
    }
    const proof = nestedRecord(cell.transitions, "completed transition proof");
    if (proof.schemaVersion !== 2) return cell;
    const phases = proof.phases as Array<{ lastOrder: number; phase: string }>;
    const barrierWitnesses = phases.map((phase) => ({
      barrierCount: 1,
      finalBarrierOrder: phase.lastOrder,
      phase: phase.phase,
    }));
    cell.transitions = {
      ...proof,
      barrierWitnesses,
      barrierWitnessesSha256: createHash("sha256")
        .update(JSON.stringify(barrierWitnesses))
        .digest("hex"),
      schemaVersion: 3,
    };
    return cell;
  });
}

interface FakeReservation extends ResultPairReservation {
  readonly published: Array<{
    json: Record<string, unknown>;
    markdown: string;
    state: "failed" | "passed";
  }>;
}

function fakeReservation(
  events: string[],
  options: { failClose?: boolean; failPublish?: boolean } = {},
): FakeReservation {
  const published: FakeReservation["published"] = [];
  const close = async () => {
    events.push("close");
    if (options.failClose) throw new Error("cleanup close failed");
  };
  return {
    abort: () => undefined,
    close,
    forceClose: close,
    handleState: () => ({ jsonClosed: false, markdownClosed: false }),
    jsonPath: "result.json",
    markdownPath: "result.md",
    ownership: { publicationState: "pending", reservationId: "reservation" },
    publicationState: () => "pending",
    publishPair: async (json, markdown, state) => {
      events.push(`publish-${state}`);
      if (options.failPublish) throw new Error("companion publication failed");
      published.push({
        json: { ...json },
        markdown: typeof markdown === "function" ? markdown() : markdown,
        state,
      });
    },
    publishPendingJson: async () => undefined,
    published,
    stem: "result",
  };
}

const _authorityTypeCheck: InstallerTrustFaultAuthority | null = null;
const _dependenciesTypeCheck: InstallerTrustFaultRunDependencies | null = null;
void _authorityTypeCheck;
void _dependenciesTypeCheck;

function rebindTerminal(
  input: Record<string, unknown>,
  mutate: (json: Record<string, unknown>) => void,
): Record<string, unknown> {
  const json = structuredClone(input);
  delete json.canonicalBinding;
  mutate(json);
  const payload = canonicalJsonForTest(json);
  return {
    ...json,
    canonicalBinding: {
      payloadBase64url: Buffer.from(payload, "utf8").toString("base64url"),
      sha256: createHash("sha256").update(payload).digest("hex"),
    },
  };
}

function productTerminalFailedCell(json: Record<string, unknown>): Record<string, unknown> {
  const branch = json.failedCell as Record<string, unknown>;
  return branch.evidence as Record<string, unknown>;
}

async function retainedRawRepairCell(): Promise<{
  authority: InstallerTrustFaultAuthority;
  rawCell: Record<string, unknown>;
}> {
  const retained = JSON.parse(
    await readFile(
      join(
        process.cwd(),
        "harness/results/installer-trust-faults",
        "installer-trust-faults-v8-2026-07-31T04-29-39-450Z.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const authority = retained.authority as InstallerTrustFaultAuthority;
  const cells = retained.cells as Record<string, unknown>[];
  const original = cells.find((cell) => cell.id === "reused-object-corruption");
  if (original === undefined) throw new Error("Retained raw Repair cell is absent");
  return { authority, rawCell: structuredClone(original) };
}

function mutateRawCellPredicate(
  raw: Record<string, unknown>,
  predicate:
    | "selected-request-count"
    | "selected-range-classification"
    | "selected-status"
    | "selected-if-range"
    | "operation-range-request-count"
    | "repaired-resource-count"
    | "repaired-bytes"
    | "downloaded-bytes"
    | "attempt"
    | "cell-id"
    | "manifest-resource"
    | "operation"
    | "phase"
    | "post-validation"
    | "proof"
    | "publication"
    | "terminal-store"
    | "terminal-transfer"
    | "terminal-ui",
  authority: InstallerTrustFaultAuthority,
): void {
  const fault = nestedRecord(raw.fault, "raw fault");
  const event = nestedRecord((fault.events as unknown[])[0], "raw fault event");
  const attempts = raw.attempts as unknown[];
  const attempt = nestedRecord(attempts.at(-1), "raw attempt");
  const proof = nestedRecord(raw.transitions, "raw proof");
  const states = proof.states as unknown[];
  const finalState = nestedRecord(
    states.find((state) => nestedRecord(state, "raw proof state").id === proof.finalStateId),
    "raw final state",
  );
  const post = nestedRecord(raw.postValidation, "raw post-validation");
  const snapshots = raw.snapshots as unknown[];
  const terminal = nestedRecord(snapshots.at(-1), "raw terminal snapshot");
  const store = nestedRecord(terminal.installStore, "raw terminal store");
  const transfer = nestedRecord(terminal.installerTransfer, "raw terminal transfer");
  const accounting = nestedRecord(raw.accounting, "raw accounting");
  const http = raw.http as Record<string, unknown>[];
  const expected = selectInstallerTrustFaultResource(authority, "reused-object-corruption");
  const selectedRequest = http.find(
    (request) =>
      (request.phase === "attempt-1" || request.phase === "attempt-2") &&
      request.range !== null &&
      request.path === expected.path,
  );
  if (selectedRequest === undefined) throw new Error("Selected Repair request is absent");
  switch (predicate) {
    case "selected-request-count": {
      http.push({ ...selectedRequest, order: http.length + 1 });
      return;
    }
    case "selected-range-classification":
      selectedRequest.range = "bytes=1-";
      return;
    case "selected-status":
      selectedRequest.status = 200;
      return;
    case "selected-if-range":
      selectedRequest.ifRange = selectedRequest.etag;
      return;
    case "operation-range-request-count": {
      const other = parseInstallerTrustFaultManifestResources(authority).find(
        (resource) => resource.target === "opfs" && resource.id !== expected.id,
      );
      if (other === undefined) throw new Error("Other operation resource is absent");
      http.push({
        ...selectedRequest,
        bodyBytes: other.bytes,
        order: http.length + 1,
        path: other.path,
      });
      return;
    }
    case "repaired-resource-count":
      accounting.repairedResourceCount = 0;
      return;
    case "repaired-bytes":
      accounting.repairedBytes = (accounting.repairedBytes as number) + 1;
      return;
    case "downloaded-bytes":
      accounting.downloadedBytes = (accounting.downloadedBytes as number) + 1;
      return;
    case "attempt":
      attempt.index = 2;
      return;
    case "cell-id":
      raw.id = "final-verification-corruption";
      return;
    case "manifest-resource": {
      const expected = selectInstallerTrustFaultResource(authority, "reused-object-corruption");
      const other = parseInstallerTrustFaultManifestResources(authority).find(
        (resource) => resource.target === "opfs" && resource.id !== expected.id,
      );
      if (other === undefined) throw new Error("Manifest mutation resource is absent");
      fault.resourceId = other.id;
      return;
    }
    case "operation":
      event.operation = "install";
      return;
    case "phase":
      finalState.phase = "attempt-2";
      return;
    case "post-validation":
      post.targetReleaseDigest = null;
      return;
    case "proof":
      proof.streamSha256 = "invalid";
      return;
    case "publication":
      post.publicationOccurred = true;
      post.terminalPublicationCount = 2;
      store.publicationCount = 2;
      return;
    case "terminal-store":
      store.state = "writing";
      return;
    case "terminal-transfer":
      transfer.state = "idle";
      return;
    case "terminal-ui":
      finalState.uiState = "failed";
      return;
  }
}

function nestedRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

function countSanitizedFailureNodes(input: unknown): number {
  if (typeof input !== "object" || input === null) return 0;
  const node = input as { cause?: unknown; errors?: unknown };
  const errors = Array.isArray(node.errors) ? node.errors : [];
  return (
    1 +
    countSanitizedFailureNodes(node.cause) +
    errors.reduce((count, member) => count + countSanitizedFailureNodes(member), 0)
  );
}

function transitionDiagnostic(json: Record<string, unknown>): Record<string, unknown> {
  const failure = nestedRecord(json.failure, "failure");
  const primary = nestedRecord(failure.primary, "primary failure");
  const cause = nestedRecord(primary.cause, "primary cause");
  return nestedRecord(cause.transitionBindingDiagnostic, "transition binding diagnostic");
}

function transitionPreviousState(json: Record<string, unknown>): Record<string, unknown> {
  return nestedRecord(
    transitionDiagnostic(json).previousRelationalState,
    "transition previous relational state",
  );
}

function transitionBindingQueueFailure(
  failureCode: InstallerFailureCode | string | null,
  failureResource: "absent" | "present",
  previousFailureCode: InstallerFailureCode | string | null = null,
  previousFailureResource: "absent" | "present" = "absent",
): Record<string, unknown> {
  return {
    bindingDiagnostic: {
      failedPredicate: "current-not-precursor",
      previousRelationalState: {
        activeAuthority: "absent",
        failureCode: previousFailureCode,
        failureResource: previousFailureResource,
        order: 2,
        phase: "attempt-1",
        releaseAuthority: "present",
        shellAuthority: "present",
        storeState: "failed",
        transferState: "verifying",
        uiState: "repairing",
      },
    },
    message: INSTALLER_TRUST_TRANSITION_BINDING_FAILURE_MESSAGE,
    name: "InstallerTrustTransitionBindingError",
    order: 3,
    relationalState: {
      activeAuthority: "absent",
      failureCode,
      failureResource,
      order: 3,
      phase: "attempt-1",
      releaseAuthority: "absent",
      shellAuthority: "absent",
      storeState: "failed",
      transferState: "failed",
      uiState: "failed",
    },
  };
}

function impossibleSyntheticTransitionQueueFailure(): Record<string, unknown> {
  const current = {
    activeAuthority: "absent",
    failureCode: "quota",
    failureResource: "absent",
    order: 3,
    phase: "attempt-1",
    releaseAuthority: "absent",
    shellAuthority: "absent",
    storeState: "idle",
    transferState: "failed",
    uiState: "failed",
  };
  const previous = {
    activeAuthority: "absent",
    failureCode: null,
    failureResource: "absent",
    order: 2,
    phase: "attempt-1",
    releaseAuthority: "absent",
    shellAuthority: "absent",
    storeState: "idle",
    transferState: "planning",
    uiState: "installing",
  };
  return {
    bindingDiagnostic: {
      currentRelationalState: current,
      predicate: "transition-model-rejected",
      previousRelationalState: previous,
      proofPrefix: {
        acknowledgedThrough: 2,
        observationCount: 2,
        sha256: "9".repeat(64),
      },
      repairFailedPredicate: null,
    },
    message: INSTALLER_TRUST_TRANSITION_REJECTION_MESSAGE,
    name: "InstallerTrustTransitionBindingError",
    order: 3,
    relationalState: current,
  };
}

function canonicalJsonForTest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonForTest).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJsonForTest(entry)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Unsupported test canonical value");
  return serialized;
}
