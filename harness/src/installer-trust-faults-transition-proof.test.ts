import { createHash } from "node:crypto";
import {
  createInstallerFailureDiagnostic,
  type InstallerSnapshot,
  type InstallStoreTelemetrySnapshot,
  idleInstallerTransferTelemetrySnapshot,
} from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  INSTALLER_TRUST_FAULT_CELL_IDS,
  type InstallerTrustFaultAuthority,
  type InstallerTrustFaultCellId,
} from "./installer-trust-faults-result.js";
import {
  createInstallerTrustFaultTransitionProofRecorder,
  findTrustedInstallerTrustFaultRawObservationEvidence,
  validateInstallerTrustFaultCellPhaseOutcome,
  validateInstallerTrustFaultRawObservationEvidence,
  validateInstallerTrustFaultRawTransitionProof,
  validateInstallerTrustFaultTransitionProof,
} from "./installer-trust-faults-transition-proof.js";
import type {
  InstallerTrustFaultStoreState,
  InstallerTrustFaultTransferState,
  InstallerTrustFaultTransition,
  InstallerTrustFaultUiState,
} from "./installer-trust-faults-transitions.js";

const artifactDigest = "a".repeat(64);
const releaseDigest = "b".repeat(64);
const resourceId = "resource-a";
const authority = { artifactDigest, releaseDigest } as InstallerTrustFaultAuthority;

describe("installer trust-fault product transition evidence", () => {
  it("requires an independently replayable phase-final barrier witness", () => {
    const withoutBarriers = createInstallerTrustFaultTransitionProofRecorder(
      "mid-append-quota-resume",
      authority,
      resourceId,
    );
    for (const transition of validResumeStream()) {
      withoutBarriers.observe(compactRawObservation(transition));
    }
    expect(() => withoutBarriers.finish()).toThrow(/lacks its final raw barrier/u);

    const proof = validResumeProof();
    expect(proof.schemaVersion).toBe(3);
    if (proof.schemaVersion !== 3) throw new Error("Active raw proof did not emit schema v3");
    expect(() =>
      validateInstallerTrustFaultRawTransitionProof(
        proof,
        "mid-append-quota-resume",
        authority,
        resourceId,
      ),
    ).not.toThrow();
    const [setupWitness, ...remainingWitnesses] = proof.barrierWitnesses;
    if (setupWitness === undefined) throw new Error("Setup barrier witness is absent");
    const omitted = { ...proof, barrierWitnesses: remainingWitnesses };
    expect(() =>
      validateInstallerTrustFaultRawTransitionProof(
        omitted,
        "mid-append-quota-resume",
        authority,
        resourceId,
      ),
    ).toThrow(/barrier witnesses are incomplete/u);
    const repositionedWitnesses = proof.barrierWitnesses.map((witness, index) =>
      index === 0 ? { ...witness, finalBarrierOrder: witness.finalBarrierOrder + 1 } : witness,
    );
    expect(() =>
      validateInstallerTrustFaultRawTransitionProof(
        { ...proof, barrierWitnesses: repositionedWitnesses },
        "mid-append-quota-resume",
        authority,
        resourceId,
      ),
    ).toThrow(/phase-final barrier/u);
    const mutatedWitnesses = proof.barrierWitnesses.map((witness, index) =>
      index === 0 ? { ...witness, barrierCount: witness.barrierCount + 1 } : witness,
    );
    expect(() =>
      validateInstallerTrustFaultRawTransitionProof(
        { ...proof, barrierWitnesses: mutatedWitnesses },
        "mid-append-quota-resume",
        authority,
        resourceId,
      ),
    ).toThrow(/barrier binding/u);
  });

  it("keeps schema-v2 raw transition proofs backward-valid", () => {
    const current = validResumeProof();
    if (current.schemaVersion !== 3) throw new Error("Active raw proof did not emit schema v3");
    const { barrierWitnesses: _barriers, barrierWitnessesSha256: _binding, ...common } = current;
    const historical = { ...common, schemaVersion: 2 };
    expect(() =>
      validateInstallerTrustFaultRawTransitionProof(
        historical,
        "mid-append-quota-resume",
        authority,
        resourceId,
        2,
      ),
    ).not.toThrow();
  });

  it("enforces same-source persistence warning consistency before a barrier", () => {
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "mid-append-quota-resume",
      authority,
      resourceId,
    );
    const observation = compactRawObservation(
      validResumeStream()[0] as InstallerTrustFaultTransition,
    );
    expect(() =>
      recorder.observe({
        ...observation,
        degradedDurabilityWarning: false,
        persistence: "denied",
      }),
    ).toThrow(/UI persistence is contradictory/u);
  });

  it.each([
    ["active transfer digest", { activeReleaseDigest: "c".repeat(64) }],
    ["failure code", { failureCode: "integrity" }],
    ["failure class", { failureClass: "terminal" }],
    ["failure evidence", { failureEvidence: "terminal-unclassified" }],
    ["failure message", { failureMessage: "noncanonical secret token=private" }],
    ["failure operation", { failureOperation: "session" }],
    ["failure resource", { failureResourceId: "resource-b" }],
  ] as const)("rejects compact telemetry with mutated %s", (_label, mutation) => {
    const transition = validResumeStream()[1] as InstallerTrustFaultTransition;
    const observation = compactRawObservation(transition);
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "mid-append-quota-resume",
      authority,
      resourceId,
    );
    recorder.observe(
      compactRawObservation(validResumeStream()[0] as InstallerTrustFaultTransition),
      "barrier",
    );
    expect(() =>
      recorder.observe({
        ...observation,
        telemetry: {
          ...observation.telemetry,
          installerTransfer: {
            ...observation.telemetry.installerTransfer,
            ...mutation,
          },
        },
      }),
    ).toThrow();
  });

  it.each([
    {
      alternate: {
        failureCode: "quota" as const,
        failureClass: "quota" as const,
        failureEvidence: "quota-exceeded" as const,
        failureExpectedReleaseDigest: releaseDigest,
        failureMessage: "Installer storage quota was exceeded",
        failureOperation: "repair" as const,
      },
      code: "integrity" as const,
      id: "repeated-server-corruption" as const,
      resource: resourceId,
    },
    {
      alternate: {
        failureCode: "integrity" as const,
        failureClass: "installer-transfer" as const,
        failureEvidence: "transfer-integrity" as const,
        failureMessage: "Partial object failed exact <local-path> verification",
        failureOperation: "install" as const,
      },
      code: "quota" as const,
      id: "estimate-clearly-insufficient" as const,
      resource: null,
    },
    {
      alternate: {
        failureCode: "quota" as const,
        failureClass: "quota" as const,
        failureEvidence: "quota-exceeded" as const,
        failureExpectedReleaseDigest: releaseDigest,
        failureMessage: "Installer storage quota was exceeded",
        failureOperation: "repair" as const,
      },
      code: "quota" as const,
      id: "quota-probe-exceeded" as const,
      resource: null,
    },
    {
      alternate: {
        failureCode: "integrity" as const,
        failureClass: "installer-transfer" as const,
        failureEvidence: "transfer-integrity" as const,
        failureMessage: "Partial object failed exact <local-path> verification",
        failureOperation: "install" as const,
      },
      code: "quota" as const,
      id: "mid-append-quota-resume" as const,
      resource: resourceId,
    },
  ])("rejects the globally canonical alternate failure tuple for $id attempt-1", ({
    alternate,
    code,
    id,
    resource,
  }) => {
    const recorder = createInstallerTrustFaultTransitionProofRecorder(id, authority, resourceId);
    recorder.observe(
      compactRawObservation({ ...state("setup", "idle", "idle", "idle"), order: 1 }),
      "barrier",
    );
    if (id === "repeated-server-corruption") {
      recorder.observe(
        compactRawObservation({
          ...state("seed", "ready", "ready", "ready"),
          activeReleaseDigest: releaseDigest,
          releaseDigest,
          shellGenerationId: `${artifactDigest}:${releaseDigest}`,
          order: 2,
        }),
        "barrier",
      );
    }
    const transition = {
      ...state("attempt-1", "failed", "failed", "failed"),
      failureCode: code,
      failureResourceId: resource,
      order: id === "repeated-server-corruption" ? 3 : 2,
    };
    const observation = compactRawObservation(transition);
    expect(() =>
      recorder.observe({
        ...observation,
        telemetry: {
          ...observation.telemetry,
          installerTransfer: {
            ...observation.telemetry.installerTransfer,
            ...alternate,
          },
        },
      }),
    ).toThrow(/exact cell-phase contract/u);
  });

  it("requires every structured failure field to remain null in a no-failure phase", () => {
    const transition = { ...state("attempt-1", "transferring", "writing", "installing"), order: 2 };
    const observation = compactRawObservation(transition);
    const valid = createInstallerTrustFaultTransitionProofRecorder(
      "estimate-incomplete-probe-success",
      authority,
      resourceId,
    );
    valid.observe(
      compactRawObservation({ ...state("setup", "idle", "idle", "idle"), order: 1 }),
      "barrier",
    );
    expect(() => valid.observe(observation)).not.toThrow();
    const invalid = createInstallerTrustFaultTransitionProofRecorder(
      "estimate-incomplete-probe-success",
      authority,
      resourceId,
    );
    invalid.observe(
      compactRawObservation({ ...state("setup", "idle", "idle", "idle"), order: 1 }),
      "barrier",
    );
    expect(() =>
      invalid.observe({
        ...observation,
        telemetry: {
          ...observation.telemetry,
          installerTransfer: {
            ...observation.telemetry.installerTransfer,
            failureClass: "quota",
          },
        },
      }),
    ).toThrow(/contradictory fault authority/u);
  });

  it("retains an asynchronous UI/worker handoff diagnostically and requires coherence at the barrier", () => {
    const setup = { ...state("setup", "idle", "idle", "idle"), order: 1 };
    const failedAttempt = {
      ...state("attempt-1", "failed", "failed", "failed"),
      failureCode: "quota" as const,
      failureResourceId: resourceId,
      order: 2,
    };
    const handoffTransition = {
      ...state("attempt-2", "failed", "failed", "requesting-persistence"),
      order: 3,
    };
    const priorAttemptTelemetry = {
      installStore: { activeReleaseDigest: null, state: "failed" as const },
      installerTransfer: {
        activeReleaseDigest: releaseDigest,
        failureCode: "quota" as const,
        failureClass: "quota" as const,
        failureEvidence: "quota-exceeded" as const,
        failureExpectedReleaseDigest: null,
        failureMessage: "Installer storage quota was exceeded",
        failureOperation: "install" as const,
        failureResourceId: resourceId,
        failureSource: "operation" as const,
        state: "failed" as const,
      },
    };
    const handoff = {
      ...compactRawObservation(handoffTransition),
      telemetry: priorAttemptTelemetry,
    };
    const installingHandoff = {
      ...compactRawObservation({
        ...state("attempt-2", "transferring", "writing", "installing"),
        order: 4,
      }),
      telemetry: priorAttemptTelemetry,
    };
    const ready = {
      ...state("attempt-2", "ready", "ready", "ready"),
      activeReleaseDigest: releaseDigest,
      releaseDigest,
      shellGenerationId: `${artifactDigest}:${releaseDigest}`,
      order: 5,
    };
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "mid-append-quota-resume",
      authority,
      resourceId,
    );
    recorder.observe(compactRawObservation(setup), "barrier");
    recorder.observe(compactRawObservation(failedAttempt), "barrier");
    expect(() => recorder.observe(handoff)).not.toThrow();
    expect(() => recorder.observe(installingHandoff)).not.toThrow();
    recorder.observe(compactRawObservation(ready), "barrier");
    expect(() => recorder.finish()).not.toThrow();

    const contradictory = createInstallerTrustFaultTransitionProofRecorder(
      "mid-append-quota-resume",
      authority,
      resourceId,
    );
    contradictory.observe(compactRawObservation(setup), "barrier");
    contradictory.observe(compactRawObservation(failedAttempt), "barrier");
    let failure: Error | null = null;
    try {
      contradictory.observe(handoff, "barrier");
    } catch (error: unknown) {
      failure = error as Error;
    }
    const evidence = findTrustedInstallerTrustFaultRawObservationEvidence(failure);
    expect(evidence).toMatchObject({
      acceptedObservationCount: 2,
      failedPredicate: "observation-consistency",
      phase: "attempt-1",
    });
    expect(() => validateInstallerTrustFaultRawObservationEvidence(evidence)).not.toThrow();

    const staleReady = createInstallerTrustFaultTransitionProofRecorder(
      "mid-append-quota-resume",
      authority,
      resourceId,
    );
    staleReady.observe(compactRawObservation(setup), "barrier");
    staleReady.observe(compactRawObservation(failedAttempt), "barrier");
    staleReady.observe(handoff);
    staleReady.observe(installingHandoff);
    expect(() =>
      staleReady.observe(
        {
          ...compactRawObservation(ready),
          telemetry: priorAttemptTelemetry,
        },
        "barrier",
      ),
    ).toThrow(/contradicts full telemetry/u);
  });

  const attempt2HandoffMutations: readonly (readonly [
    string,
    (raw: Record<string, unknown>) => void,
  ])[] = [
    [
      "store active release",
      (raw: Record<string, unknown>) => {
        testRecord(
          testRecord(raw.telemetry, "telemetry").installStore,
          "store",
        ).activeReleaseDigest = releaseDigest;
      },
    ],
    [
      "store idle",
      (raw: Record<string, unknown>) => {
        testRecord(testRecord(raw.telemetry, "telemetry").installStore, "store").state = "idle";
      },
    ],
    [
      "transfer null release",
      (raw: Record<string, unknown>) => {
        testRecord(
          testRecord(raw.telemetry, "telemetry").installerTransfer,
          "transfer",
        ).activeReleaseDigest = null;
      },
    ],
    [
      "transfer wrong release",
      (raw: Record<string, unknown>) => {
        testRecord(
          testRecord(raw.telemetry, "telemetry").installerTransfer,
          "transfer",
        ).activeReleaseDigest = "c".repeat(64);
      },
    ],
    [
      "transfer cancelled",
      (raw: Record<string, unknown>) => {
        testRecord(testRecord(raw.telemetry, "telemetry").installerTransfer, "transfer").state =
          "cancelled";
      },
    ],
    ...(
      [
        ["failure code", "failureCode", "integrity"],
        ["failure class", "failureClass", "installer-transfer"],
        ["failure evidence", "failureEvidence", "transfer-integrity"],
        ["failure message", "failureMessage", "different failure"],
        ["failure operation", "failureOperation", "repair"],
        ["failure resource", "failureResourceId", "resource-b"],
      ] as const
    ).map(
      ([label, field, value]) =>
        [
          label,
          (raw: Record<string, unknown>) => {
            testRecord(testRecord(raw.telemetry, "telemetry").installerTransfer, "transfer")[
              field
            ] = value;
          },
        ] as const,
    ),
  ];

  it.each(
    attempt2HandoffMutations,
  )("rejects attempt-2 installing handoff mutation: %s", (_label, mutate) => {
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "mid-append-quota-resume",
      authority,
      resourceId,
    );
    recorder.observe(
      compactRawObservation({ ...state("setup", "idle", "idle", "idle"), order: 1 }),
      "barrier",
    );
    recorder.observe(
      compactRawObservation({
        ...state("attempt-1", "failed", "failed", "failed"),
        failureCode: "quota",
        failureResourceId: resourceId,
        order: 2,
      }),
      "barrier",
    );
    const observation = {
      ...compactRawObservation({
        ...state("attempt-2", "transferring", "writing", "installing"),
        order: 3,
      }),
      telemetry: {
        installStore: { activeReleaseDigest: null, state: "failed" },
        installerTransfer: {
          activeReleaseDigest: releaseDigest,
          failureClass: "quota",
          failureCode: "quota",
          failureEvidence: "quota-exceeded",
          failureExpectedReleaseDigest: null,
          failureMessage: "Installer storage quota was exceeded",
          failureOperation: "install",
          failureResourceId: resourceId,
          failureSource: "operation",
          state: "failed",
        },
      },
    };
    mutate(observation as unknown as Record<string, unknown>);
    expect(() => recorder.observe(observation)).toThrow();
  });

  it("rejects transient non-barrier publication authority before an exact Ready snapshot", () => {
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "mid-append-quota-resume",
      authority,
      resourceId,
    );
    recorder.observe(
      compactRawObservation({ ...state("setup", "idle", "idle", "idle"), order: 1 }),
      "barrier",
    );
    const transient = {
      ...state("attempt-1", "transferring", "writing", "installing"),
      activeReleaseDigest: releaseDigest,
      order: 2,
    };
    let transientFailure: Error | null = null;
    try {
      recorder.observe(compactRawObservation(transient));
    } catch (error: unknown) {
      transientFailure = error as Error;
    }
    expect(transientFailure?.message).toMatch(/contradictory publication authority/u);
    const transientEvidence =
      findTrustedInstallerTrustFaultRawObservationEvidence(transientFailure);
    expect(transientEvidence).toMatchObject({
      acceptedObservationCount: 1,
      failedPredicate: "cell-invariant",
      phase: "setup",
    });
    expect(() =>
      validateInstallerTrustFaultRawObservationEvidence(transientEvidence),
    ).not.toThrow();

    const clean = createInstallerTrustFaultTransitionProofRecorder(
      "mid-append-quota-resume",
      authority,
      resourceId,
    );
    clean.observe(
      compactRawObservation({ ...state("setup", "idle", "idle", "idle"), order: 1 }),
      "barrier",
    );
    clean.observe(
      compactRawObservation({
        ...state("attempt-1", "failed", "failed", "failed"),
        failureCode: "quota",
        failureResourceId: resourceId,
        order: 2,
      }),
      "barrier",
    );
    clean.observe({
      ...compactRawObservation({
        ...state("attempt-2", "failed", "failed", "requesting-persistence"),
        order: 3,
      }),
      telemetry: {
        installStore: { activeReleaseDigest: null, state: "failed" },
        installerTransfer: {
          activeReleaseDigest: releaseDigest,
          failureCode: "quota",
          failureClass: "quota",
          failureEvidence: "quota-exceeded",
          failureExpectedReleaseDigest: null,
          failureMessage: "Installer storage quota was exceeded",
          failureOperation: "install",
          failureResourceId: resourceId,
          failureSource: "operation",
          state: "failed",
        },
      },
    });
    clean.observe(
      compactRawObservation({
        ...state("attempt-2", "ready", "ready", "ready"),
        activeReleaseDigest: releaseDigest,
        releaseDigest,
        shellGenerationId: `${artifactDigest}:${releaseDigest}`,
        order: 4,
      }),
      "barrier",
    );
    expect(() => clean.finish()).not.toThrow();
  });

  it.each([
    ["missing failure", { failureCode: null, failureResourceId: null }],
    ["failure outside failed", { failureCode: "quota" as const, failureResourceId: resourceId }],
    ["wrong failure resource", { failureCode: "quota" as const, failureResourceId: "resource-b" }],
  ])("rejects non-barrier telemetry with %s", (_label, fault) => {
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "mid-append-quota-resume",
      authority,
      resourceId,
    );
    recorder.observe(
      compactRawObservation({ ...state("setup", "idle", "idle", "idle"), order: 1 }),
      "barrier",
    );
    const transferState = _label === "failure outside failed" ? "transferring" : "failed";
    const transition = {
      ...state(
        "attempt-1",
        transferState,
        transferState === "failed" ? "failed" : "writing",
        "installing",
      ),
      order: 2,
    } as InstallerTrustFaultTransition;
    const observation = {
      ...compactRawObservation(transition),
      telemetry: {
        installStore: {
          activeReleaseDigest: null,
          state: transition.storeState,
        },
        installerTransfer:
          fault.failureCode === null
            ? {
                activeReleaseDigest: null,
                failureClass: null,
                failureCode: null,
                failureEvidence: null,
                failureExpectedReleaseDigest: null,
                failureMessage: null,
                failureOperation: null,
                failureResourceId: null,
                failureSource: null,
                state: transferState,
              }
            : {
                activeReleaseDigest: null,
                failureClass: "quota",
                failureCode: fault.failureCode,
                failureEvidence: "quota-exceeded",
                failureExpectedReleaseDigest: null,
                failureMessage: "Installer storage quota was exceeded",
                failureOperation: "install",
                failureResourceId: fault.failureResourceId,
                failureSource: "operation",
                state: transferState,
              },
      },
    };
    expect(() => recorder.observe(observation)).toThrow(/contradictory fault authority/u);
  });

  it.each([
    ["authority", { activeReleaseDigest: "c".repeat(64) }],
    ["fault", { failureCode: "integrity" as const }],
    ["resource", { failureResourceId: "resource-b" }],
  ])("rejects wrong terminal %s at the raw barrier", (_label, mutation) => {
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "mid-append-quota-resume",
      authority,
      resourceId,
    );
    recorder.observe(
      compactRawObservation({ ...state("setup", "idle", "idle", "idle"), order: 1 }),
      "barrier",
    );
    const terminal = {
      ...state("attempt-1", "failed", "failed", "failed"),
      failureCode: "quota" as const,
      failureResourceId: resourceId,
      order: 2,
      ...mutation,
    };
    expect(() => recorder.observe(compactRawObservation(terminal), "barrier")).toThrow();
  });

  it("decouples active raw proof acceptance from the historical closed-world store failure rule", () => {
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "quota-probe-exceeded",
      authority,
      resourceId,
    );
    const raw = reindex([
      state("setup", "idle", "idle", "idle"),
      state("attempt-1", "idle", "idle", "requesting-persistence"),
      state("attempt-1", "planning", "idle", "installing"),
      state("attempt-1", "probing-quota", "idle", "installing"),
      {
        ...state("attempt-1", "failed", "idle", "failed"),
        failureCode: "quota" as const,
      },
    ]);
    for (const [index, transition] of raw.entries()) {
      recorder.observe(
        rawObservation(transition),
        raw[index + 1]?.phase !== transition.phase ? "barrier" : undefined,
      );
    }
    const proof = recorder.finish();

    expect(() =>
      validateInstallerTrustFaultRawTransitionProof(
        proof,
        "quota-probe-exceeded",
        authority,
        resourceId,
      ),
    ).not.toThrow();
    expect(() =>
      validateInstallerTrustFaultTransitionProof(
        proof,
        "quota-probe-exceeded",
        authority,
        resourceId,
      ),
    ).toThrow(/contradictory transfer failure/u);

    const structuralTamper = {
      ...proof,
      edges: proof.edges.map((edge, index) =>
        index === 0 ? { ...edge, count: edge.count + 1 } : edge,
      ),
    };
    expect(() =>
      validateInstallerTrustFaultRawTransitionProof(
        structuralTamper,
        "quota-probe-exceeded",
        authority,
        resourceId,
      ),
    ).toThrow(/accounting|trail|gap/u);

    const authorityTamper = {
      ...proof,
      states: proof.states.map((proofState, index) =>
        index === proof.states.length - 1
          ? { ...proofState, activeReleaseDigest: "c".repeat(64) }
          : proofState,
      ),
    };
    expect(() =>
      validateInstallerTrustFaultRawTransitionProof(
        authorityTamper,
        "quota-probe-exceeded",
        authority,
        resourceId,
      ),
    ).toThrow(/authority/u);

    const outcomeTamper = {
      ...proof,
      states: proof.states.map((proofState, index) =>
        index === proof.states.length - 1 ? { ...proofState, failureCode: null } : proofState,
      ),
    };
    expect(() =>
      validateInstallerTrustFaultRawTransitionProof(
        outcomeTamper,
        "quota-probe-exceeded",
        authority,
        resourceId,
      ),
    ).toThrow(/failure authority|terminal fault|phase verdict/u);
  });

  it.each([
    0, 1, 4,
  ])("accepts %i equivalent planning/probing/terminal publications and optional store pulses", (repeatCount) => {
    const base = estimateStream();
    const planning = base.find((event) => event.transferState === "planning");
    const probing = base.find((event) => event.transferState === "probing-quota");
    const terminal = base.at(-1);
    if (planning === undefined || probing === undefined || terminal === undefined) {
      throw new Error("Estimate fixture is incomplete");
    }
    const raw = reindex([
      ...base.slice(0, 5),
      ...Array.from({ length: repeatCount }, () => planning),
      ...(repeatCount === 0
        ? []
        : [
            { ...planning, storeState: "staging" as const },
            { ...planning, storeState: "reconciling" as const },
          ]),
      probing,
      ...Array.from({ length: repeatCount }, () => probing),
      terminal,
      ...Array.from({ length: repeatCount }, () => terminal),
    ]);
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "estimate-clearly-insufficient",
      authority,
      resourceId,
    );
    raw.forEach((event) => {
      recorder.observe(event);
    });
    const proof = recorder.finish();
    expect(proof.rawObservationCount).toBe(raw.length);
    expect(proof.phases.find((phase) => phase.phase === "attempt-1")?.attemptMilestones).toEqual([
      "idle",
      "waiting-lock",
      "planning",
      "probing-quota",
      "failed",
    ]);
    expect(() =>
      validateInstallerTrustFaultTransitionProof(
        proof,
        "estimate-clearly-insufficient",
        authority,
        resourceId,
      ),
    ).not.toThrow();
  });

  it.each([
    [
      "missing waiting-lock",
      (raw: InstallerTrustFaultTransition[]) =>
        raw.filter((e) => e.transferState !== "waiting-lock"),
    ],
    [
      "phase reversal",
      (raw: InstallerTrustFaultTransition[]) => [
        ...raw.slice(0, 6),
        raw[1] as InstallerTrustFaultTransition,
        ...raw.slice(6),
      ],
    ],
    [
      "forbidden transfer",
      (raw: InstallerTrustFaultTransition[]) =>
        raw.map((e, i) =>
          i === raw.length - 2 ? { ...e, transferState: "transferring" as const } : e,
        ),
    ],
    [
      "wrong quota resource",
      (raw: InstallerTrustFaultTransition[]) =>
        raw.map((e, i) => (i === raw.length - 1 ? { ...e, failureResourceId: resourceId } : e)),
    ],
    [
      "authority leak",
      (raw: InstallerTrustFaultTransition[]) =>
        raw.map((e, i) =>
          i === raw.length - 1 ? { ...e, activeReleaseDigest: releaseDigest } : e,
        ),
    ],
  ] as const)("rejects %s", (_name, mutate) => {
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "estimate-clearly-insufficient",
      authority,
      resourceId,
    );
    expect(() => {
      reindex(mutate(estimateStream())).forEach((event) => {
        recorder.observe(event);
      });
      recorder.finish();
    }).toThrow();
  });

  it("retains full ordered telemetry with trusted provenance and rejects truncation/tamper", () => {
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "estimate-clearly-insufficient",
      authority,
      resourceId,
    );
    const raw = estimateStream();
    for (const transition of raw.slice(0, -1)) {
      recorder.observe(rawObservation(transition));
    }
    const invalidTerminal = {
      ...(raw.at(-1) as InstallerTrustFaultTransition),
      failureResourceId: resourceId,
    };
    let retainedError: Error | null = null;
    try {
      recorder.observe(rawObservation(invalidTerminal), "barrier");
      recorder.finish();
    } catch (error: unknown) {
      retainedError = error as Error;
    }
    const evidence = findTrustedInstallerTrustFaultRawObservationEvidence(retainedError);
    expect(evidence).toMatchObject({
      acceptedObservationCount: raw.length - 1,
      cellId: "estimate-clearly-insufficient",
      failedPredicate: "cell-invariant",
      phase: "attempt-1",
    });
    expect(evidence?.rejectedSample.observation?.telemetry.installerTransfer).toMatchObject({
      failureCode: "quota",
      failureResourceId: resourceId,
      state: "failed",
    });
    expect(() => validateInstallerTrustFaultRawObservationEvidence(evidence)).not.toThrow();
    expect(() =>
      validateInstallerTrustFaultRawObservationEvidence({
        ...evidence,
        acceptedObservationCount: (evidence?.acceptedObservationCount ?? 0) - 1,
      }),
    ).toThrow();
    expect(() =>
      validateInstallerTrustFaultRawObservationEvidence({ ...evidence, sha256: "0".repeat(64) }),
    ).toThrow();
    expect(findTrustedInstallerTrustFaultRawObservationEvidence(new Error("forged"))).toBeNull();
  });

  it("continues full validation and hashing after bounded prefix retention fills", () => {
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "estimate-clearly-insufficient",
      authority,
      resourceId,
    );
    const accepted = reindex([
      ...Array.from({ length: 1_200 }, () => state("setup", "idle", "idle", "idle")),
      ...Array.from({ length: 20 }, () =>
        state("attempt-1", "idle", "idle", "requesting-persistence"),
      ),
    ]);
    for (const transition of accepted) recorder.observe(compactRawObservation(transition));
    expect(recorder.prefix().observationCount).toBe(1_220);

    let failure: Error | null = null;
    try {
      recorder.observe(
        compactRawObservation({
          ...state("setup", "idle", "idle", "idle"),
          order: accepted.length + 1,
        }),
      );
    } catch (error: unknown) {
      failure = error as Error;
    }
    const evidence = findTrustedInstallerTrustFaultRawObservationEvidence(failure);
    expect(evidence).toMatchObject({
      acceptedObservationCount: 1_220,
      failedPredicate: "cell-invariant",
      schemaVersion: 3,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    if (evidence?.schemaVersion !== 3) throw new Error("Missing raw evidence v3");
    expect(evidence.acceptedObservationPrefix.length).toBeLessThan(1_220);
    expect(evidence.acceptedObservationTail.at(-1)?.transition.order).toBe(1_220);
    expect(() => validateInstallerTrustFaultRawObservationEvidence(evidence)).not.toThrow();

    const forgedTail = evidence.acceptedObservationTail.map((observation) =>
      compactRawObservation({
        ...state("setup", "idle", "idle", "idle"),
        order: observation.transition.order,
      }),
    );
    const forged = {
      ...evidence,
      acceptedObservationTail: forgedTail,
      phase: "setup",
      rawArtifactBytes: Buffer.byteLength(
        JSON.stringify({
          acceptedObservationPrefix: evidence.acceptedObservationPrefix,
          acceptedObservationTail: forgedTail,
          rejectedSample: evidence.rejectedSample,
        }),
        "utf8",
      ),
      retainedSha256: createHash("sha256")
        .update(
          JSON.stringify({
            prefix: evidence.acceptedObservationPrefix,
            tail: forgedTail,
          }),
        )
        .digest("hex"),
    };
    expect(() => validateInstallerTrustFaultRawObservationEvidence(forged)).toThrow(
      /satisfies all invariants/u,
    );
  });

  it("keeps historical raw observation evidence v2 backward-valid", () => {
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "estimate-clearly-insufficient",
      authority,
      resourceId,
    );
    const raw = estimateStream();
    for (const transition of raw.slice(0, -1)) recorder.observe(rawObservation(transition));
    let failure: Error | null = null;
    try {
      recorder.observe(
        rawObservation({
          ...(raw.at(-1) as InstallerTrustFaultTransition),
          failureResourceId: resourceId,
        }),
        "barrier",
      );
    } catch (error: unknown) {
      failure = error as Error;
    }
    const current = findTrustedInstallerTrustFaultRawObservationEvidence(failure);
    if (current?.schemaVersion !== 3) throw new Error("Missing raw evidence v3 fixture");
    const acceptedObservations = [
      ...current.acceptedObservationPrefix,
      ...current.acceptedObservationTail,
    ];
    const legacy = {
      acceptedObservationCount: acceptedObservations.length,
      acceptedObservations,
      authority: current.authority,
      cellId: current.cellId,
      contract: current.contract,
      failedPredicate: current.failedPredicate,
      faultResourceId: current.faultResourceId,
      phase: current.phase,
      rawArtifactBytes: Buffer.byteLength(
        JSON.stringify({ accepted: acceptedObservations, rejected: current.rejectedSample }),
        "utf8",
      ),
      rejectedSample: current.rejectedSample,
      schemaVersion: 2,
      sha256: createHash("sha256").update(JSON.stringify(acceptedObservations)).digest("hex"),
    };
    expect(() => validateInstallerTrustFaultRawObservationEvidence(legacy)).not.toThrow();
  });

  it("keeps the accepted prefix stable after structural corruption", () => {
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "estimate-clearly-insufficient",
      authority,
      resourceId,
    );
    recorder.observe(estimateStream()[0]);
    const prefix = recorder.prefix();
    expect(() => recorder.observe({ ...estimateStream()[1], order: 99 })).toThrow(/order/u);
    expect(recorder.prefix()).toEqual(prefix);
  });

  it.each([
    ["active authority", { activeReleaseDigest: releaseDigest }],
    ["shell authority", { releaseDigest, shellGenerationId: `${artifactDigest}:${releaseDigest}` }],
    ["phase reversal", { phase: "setup" }],
    [
      "wrong fault resource",
      {
        failureCode: "quota",
        failureResourceId: resourceId,
        transferState: "failed",
        uiState: "failed",
      },
    ],
  ] as const)("rejects raw estimate %s without contaminating its accepted prefix", (_name, mutation) => {
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "estimate-clearly-insufficient",
      authority,
      resourceId,
    );
    const prefix = estimateStream().slice(0, -1);
    prefix.forEach((transition) => {
      recorder.observe(rawObservation(transition));
    });
    const rejected = {
      ...(prefix.at(-1) as InstallerTrustFaultTransition),
      ...mutation,
      order: prefix.length + 1,
    };
    let failure: Error | null = null;
    try {
      recorder.observe(rawObservation(rejected), "barrier");
    } catch (error: unknown) {
      failure = error as Error;
    }
    const evidence = findTrustedInstallerTrustFaultRawObservationEvidence(failure);
    expect(evidence).toMatchObject({
      acceptedObservationCount: prefix.length,
      failedPredicate: "cell-invariant",
    });
    expect(() => validateInstallerTrustFaultRawObservationEvidence(evidence)).not.toThrow();
  });

  it.each(
    INSTALLER_TRUST_FAULT_CELL_IDS,
  )("pins shared raw outcome authority for %s", (id: InstallerTrustFaultCellId) => {
    const terminal = terminalOutcome(id);
    expect(() =>
      validateInstallerTrustFaultCellPhaseOutcome(terminal, null, id, authority, resourceId),
    ).not.toThrow();
    const adversarial = expectedRawSuccess(id)
      ? {
          ...terminal,
          failureCode: "quota" as const,
          failureResourceId: null,
          transferState: "failed" as const,
          uiState: "failed" as const,
        }
      : {
          ...terminal,
          activeReleaseDigest: releaseDigest,
          failureCode: null,
          failureResourceId: null,
          releaseDigest,
          shellGenerationId: `${artifactDigest}:${releaseDigest}`,
          storeState: "ready" as const,
          transferState: "ready" as const,
          uiState: "ready" as const,
        };
    expect(() =>
      validateInstallerTrustFaultCellPhaseOutcome(adversarial, null, id, authority, resourceId),
    ).toThrow();
  });

  it("allows only the exact verified-store publication handoff before worker and UI Ready", () => {
    const previous = {
      ...state("seed", "verifying", "publishing", "installing"),
      order: 5_785,
    };
    const handoff = {
      ...state("seed", "verifying", "ready", "installing"),
      activeReleaseDigest: releaseDigest,
      order: 5_786,
    };
    expect(() =>
      validateInstallerTrustFaultCellPhaseOutcome(
        handoff,
        previous,
        "reused-object-corruption",
        authority,
        resourceId,
      ),
    ).not.toThrow();

    const forbidden = [
      { ...handoff, storeState: "publishing" as const },
      { ...handoff, activeReleaseDigest: "c".repeat(64) },
      {
        ...handoff,
        releaseDigest,
        shellGenerationId: `${artifactDigest}:${releaseDigest}`,
      },
      { ...handoff, transferState: "planning" as const },
    ];
    for (const candidate of forbidden) {
      expect(() =>
        validateInstallerTrustFaultCellPhaseOutcome(
          candidate,
          previous,
          "reused-object-corruption",
          authority,
          resourceId,
        ),
      ).toThrow();
    }

    expect(() =>
      validateInstallerTrustFaultCellPhaseOutcome(
        { ...handoff, phase: "attempt-1" },
        null,
        "quota-probe-exceeded",
        authority,
        resourceId,
      ),
    ).toThrow(/failure-only phase acquired Ready authority/u);
  });

  it("rejects wrong failure resources and revoked Repair authority restoration", () => {
    const resumableFailure = {
      ...state("attempt-1", "failed", "failed", "failed"),
      failureCode: "quota" as const,
      failureResourceId: resourceId,
      order: 1,
    };
    expect(() =>
      validateInstallerTrustFaultCellPhaseOutcome(
        resumableFailure,
        null,
        "mid-append-quota-resume",
        authority,
        resourceId,
      ),
    ).not.toThrow();
    expect(() =>
      validateInstallerTrustFaultCellPhaseOutcome(
        { ...resumableFailure, failureResourceId: null },
        null,
        "mid-append-quota-resume",
        authority,
        resourceId,
      ),
    ).toThrow();
    const wrongResource = {
      ...terminalOutcome("repeated-server-corruption"),
      failureResourceId: "resource-b",
    };
    expect(() =>
      validateInstallerTrustFaultCellPhaseOutcome(
        wrongResource,
        null,
        "repeated-server-corruption",
        authority,
        resourceId,
      ),
    ).toThrow();
    const revoked = {
      ...state("attempt-1", "verifying", "writing", "repairing"),
      releaseDigest: null,
      shellGenerationId: null,
    };
    const restored = {
      ...revoked,
      order: 2,
      releaseDigest,
      shellGenerationId: `${artifactDigest}:${releaseDigest}`,
    };
    expect(() =>
      validateInstallerTrustFaultCellPhaseOutcome(
        restored,
        revoked,
        "repeated-server-corruption",
        authority,
        resourceId,
      ),
    ).toThrow(/restored revoked authority/u);
  });

  it("never upgrades a plain-transition fallback to trusted physical raw evidence", () => {
    const recorder = createInstallerTrustFaultTransitionProofRecorder(
      "estimate-clearly-insufficient",
      authority,
      resourceId,
    );
    let failure: Error | null = null;
    try {
      recorder.observe({
        ...state("setup", "ready", "ready", "ready"),
        activeReleaseDigest: releaseDigest,
        releaseDigest,
        shellGenerationId: `${artifactDigest}:${releaseDigest}`,
        order: 1,
      });
    } catch (error: unknown) {
      failure = error as Error;
    }
    expect(failure).not.toBeNull();
    expect(findTrustedInstallerTrustFaultRawObservationEvidence(failure)).toBeNull();
  });
});

function validResumeStream(): readonly InstallerTrustFaultTransition[] {
  return [
    { ...state("setup", "idle", "idle", "idle"), order: 1 },
    {
      ...state("attempt-1", "failed", "failed", "failed"),
      failureCode: "quota",
      failureResourceId: resourceId,
      order: 2,
    },
    {
      ...state("attempt-2", "ready", "ready", "ready"),
      activeReleaseDigest: releaseDigest,
      releaseDigest,
      shellGenerationId: `${artifactDigest}:${releaseDigest}`,
      order: 3,
    },
  ];
}

function validResumeProof() {
  const recorder = createInstallerTrustFaultTransitionProofRecorder(
    "mid-append-quota-resume",
    authority,
    resourceId,
  );
  const stream = validResumeStream();
  for (const [index, transition] of stream.entries()) {
    recorder.observe(
      compactRawObservation(transition),
      stream[index + 1]?.phase !== transition.phase ? "barrier" : undefined,
    );
  }
  return recorder.finish();
}

function expectedRawSuccess(id: InstallerTrustFaultCellId): boolean {
  return (
    id === "reused-object-corruption" ||
    id === "final-verification-corruption" ||
    id === "estimate-incomplete-probe-success" ||
    id === "mid-append-quota-resume" ||
    id === "persistence-denied"
  );
}

function terminalOutcome(id: InstallerTrustFaultCellId): InstallerTrustFaultTransition {
  const phase = id === "mid-append-quota-resume" ? "attempt-2" : "attempt-1";
  if (expectedRawSuccess(id)) {
    return {
      ...state(phase, "ready", "ready", "ready"),
      activeReleaseDigest: releaseDigest,
      releaseDigest,
      shellGenerationId: `${artifactDigest}:${releaseDigest}`,
      order: 1,
    };
  }
  const resourceFailure = id === "repeated-server-corruption" ? resourceId : null;
  return {
    ...state(phase, "failed", "failed", "failed"),
    failureCode: id === "repeated-server-corruption" ? "integrity" : "quota",
    failureResourceId: resourceFailure,
    order: 1,
  };
}

function estimateStream(): InstallerTrustFaultTransition[] {
  return reindex([
    state("setup", "idle", "idle", "idle"),
    state("attempt-1", "idle", "idle", "requesting-persistence"),
    state("attempt-1", "idle", "idle", "installing"),
    state("attempt-1", "waiting-lock", "idle", "installing"),
    state("attempt-1", "planning", "idle", "installing"),
    state("attempt-1", "probing-quota", "idle", "installing"),
    {
      ...state("attempt-1", "failed", "idle", "failed"),
      failureCode: "quota",
    },
  ]);
}

function state(
  phase: InstallerTrustFaultTransition["phase"],
  transferState: InstallerTrustFaultTransferState,
  storeState: InstallerTrustFaultStoreState,
  uiState: InstallerTrustFaultUiState,
): InstallerTrustFaultTransition {
  return {
    activeReleaseDigest: null,
    failureCode: null,
    failureResourceId: null,
    order: 0,
    phase,
    releaseDigest: null,
    shellGenerationId: null,
    storeState,
    transferState,
    uiState,
  };
}

function reindex(input: readonly InstallerTrustFaultTransition[]): InstallerTrustFaultTransition[] {
  return input.map((event, index) => ({ ...event, order: index + 1 }));
}

function testRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${label} is not a record`);
  }
  return input as Record<string, unknown>;
}

function rawObservation(transition: InstallerTrustFaultTransition) {
  return {
    degradedDurabilityWarning: transition.phase !== "setup",
    persistence: transition.phase === "setup" ? ("not-requested" as const) : ("denied" as const),
    telemetry: telemetryFor(transition),
    transition,
  };
}

function compactRawObservation(transition: InstallerTrustFaultTransition) {
  return {
    degradedDurabilityWarning: transition.phase !== "setup",
    persistence: transition.phase === "setup" ? ("not-requested" as const) : ("denied" as const),
    telemetry: {
      installStore: {
        activeReleaseDigest: transition.activeReleaseDigest,
        state: transition.storeState,
      },
      installerTransfer: {
        activeReleaseDigest: transition.activeReleaseDigest,
        failureCode: transition.failureCode,
        failureClass: transition.failureCode === "quota" ? "quota" : null,
        failureEvidence: transition.failureCode === "quota" ? "quota-exceeded" : null,
        failureExpectedReleaseDigest: null,
        failureMessage:
          transition.failureCode === "quota" ? "Installer storage quota was exceeded" : null,
        failureOperation: transition.failureCode === "quota" ? "install" : null,
        failureResourceId: transition.failureResourceId,
        failureSource: transition.failureCode === null ? null : "operation",
        state: transition.transferState,
      },
    },
    transition,
  };
}

function telemetryFor(transition: InstallerTrustFaultTransition): InstallerSnapshot {
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
    quotaExceededCount: transition.failureCode === "quota" ? 1 : 0,
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
  const transfer = {
    ...idleInstallerTransferTelemetrySnapshot(),
    activeReleaseDigest: transition.activeReleaseDigest,
    failureCode: failure?.code ?? null,
    failureClass: failure?.failureClass ?? null,
    failureEvidence: failure?.failureEvidence ?? null,
    failureExpectedReleaseDigest: failure?.operation === "repair" ? releaseDigest : null,
    failureMessage: failure?.message ?? null,
    failureOperation: failure?.operation ?? null,
    failureResourceId: failure?.resourceId ?? null,
    failureSource: failure === null ? null : ("operation" as const),
    quotaFailureCount: failure === null ? 0 : 1,
    state: transition.transferState,
  };
  return { installStore, installerTransfer: transfer };
}
