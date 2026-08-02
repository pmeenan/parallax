import { describe, expect, it } from "vitest";
import type { InstallerTrustFaultCell } from "./installer-trust-faults-result.js";
import {
  canonicalizeInstallerTrustFaultTransitions,
  canonicalizeInstallerTrustFaultTransitionWindow,
  INSTALLER_TRUST_FAULT_FAILURE_CODES,
  INSTALLER_TRUST_FAULT_MAX_ATTEMPT_MILESTONES,
  INSTALLER_TRUST_FAULT_MAX_CANONICAL_TRANSITIONS,
  projectInstallerTrustFaultAttemptMilestones,
} from "./installer-trust-faults-transitions.js";

type Transition = InstallerTrustFaultCell["transitions"][number];

function transition(order: number, input: Partial<Transition> = {}): Transition {
  return Object.freeze({
    activeReleaseDigest: null,
    failureCode: null,
    failureResourceId: null,
    order,
    phase: "attempt-1",
    releaseDigest: null,
    shellGenerationId: null,
    storeState: "idle",
    transferState: "transferring",
    uiState: "installing",
    ...input,
  });
}

describe("installer trust-fault canonical transition capture", () => {
  it("retains the exact engine failure-code domain used by proof bounds and runtime checks", () => {
    expect(INSTALLER_TRUST_FAULT_FAILURE_CODES).toEqual([
      "cancel-target-invalid",
      "cancelled",
      "concurrent-install",
      "disposed",
      "install-manifest-invalid",
      "integrity",
      "protocol",
      "quota",
      "repair-target-mismatch",
      "shell-incompatible",
      "store",
      "transport",
      "unknown",
      "validator",
    ]);
  });

  it("losslessly retains ordered semantic boundaries while compacting store telemetry churn", () => {
    const raw: Transition[] = [
      transition(1, {
        phase: "setup",
        transferState: "idle",
        uiState: "idle",
      }),
      transition(2, { transferState: "planning" }),
      ...Array.from({ length: 2_000 }, (_, index) =>
        transition(index + 3, {
          storeState: index % 2 === 0 ? "writing" : "verifying",
        }),
      ),
      transition(2_003, { transferState: "verifying" }),
      transition(2_004, {
        activeReleaseDigest: "a".repeat(64),
        storeState: "ready",
        transferState: "ready",
      }),
      transition(2_005, {
        activeReleaseDigest: "a".repeat(64),
        releaseDigest: "a".repeat(64),
        shellGenerationId: `${"b".repeat(64)}:${"a".repeat(64)}`,
        storeState: "ready",
        transferState: "ready",
        uiState: "ready",
      }),
    ];

    const capture = canonicalizeInstallerTrustFaultTransitions(raw);

    expect(capture).toMatchObject({
      complete: true,
      observedCount: 2_005,
      omittedSemanticCount: 0,
    });
    expect(capture.events.map(({ transferState, uiState }) => [transferState, uiState])).toEqual([
      ["idle", "idle"],
      ["planning", "installing"],
      ["transferring", "installing"],
      ["verifying", "installing"],
      ["ready", "installing"],
      ["ready", "ready"],
    ]);
    expect(capture.events.map(({ order }) => order)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("reports incomplete capture instead of silently truncating distinct semantic boundaries", () => {
    const raw = Array.from(
      { length: INSTALLER_TRUST_FAULT_MAX_CANONICAL_TRANSITIONS + 3 },
      (_, index) =>
        transition(index + 1, {
          transferState: index % 2 === 0 ? "transferring" : "verifying",
        }),
    );

    const capture = canonicalizeInstallerTrustFaultTransitions(raw);

    expect(capture.complete).toBe(false);
    expect(capture.events).toHaveLength(INSTALLER_TRUST_FAULT_MAX_CANONICAL_TRANSITIONS);
    expect(capture.omittedSemanticCount).toBe(3);
    expect(capture.observedCount).toBe(raw.length);
  });

  it("does not compact authority, terminal-store, failure, UI, transfer, or phase changes", () => {
    const raw = [
      transition(1),
      transition(2, { activeReleaseDigest: "a".repeat(64) }),
      transition(3, { failureCode: "integrity" }),
      transition(4, { failureResourceId: "resource" }),
      transition(5, { releaseDigest: "b".repeat(64) }),
      transition(6, { shellGenerationId: "generation" }),
      transition(7, { storeState: "failed", transferState: "failed" }),
      transition(8, { uiState: "failed" }),
      transition(9, { phase: "attempt-2" }),
    ];

    const capture = canonicalizeInstallerTrustFaultTransitions(raw);

    expect(capture.complete).toBe(true);
    expect(capture.events).toHaveLength(raw.length);
  });

  it.each([
    "ready",
    "failed",
  ] as const)("retains standalone store transitions into and out of %s", (terminalStoreState) => {
    const raw = [
      transition(1, { storeState: "writing" }),
      transition(2, { storeState: terminalStoreState }),
      transition(3, { storeState: "writing" }),
    ];

    const capture = canonicalizeInstallerTrustFaultTransitions(raw);

    expect(capture).toMatchObject({
      complete: true,
      observedCount: 3,
      omittedSemanticCount: 0,
    });
    expect(capture.events.map(({ storeState }) => storeState)).toEqual([
      "writing",
      terminalStoreState,
      "writing",
    ]);
  });

  it.each([
    "ready",
    "failed",
  ] as const)("reports exact overflow for alternating nonterminal/%s store boundaries", (terminalStoreState) => {
    const raw = Array.from(
      { length: INSTALLER_TRUST_FAULT_MAX_CANONICAL_TRANSITIONS + 3 },
      (_, index) =>
        transition(index + 1, {
          storeState: index % 2 === 0 ? "writing" : terminalStoreState,
        }),
    );

    const capture = canonicalizeInstallerTrustFaultTransitions(raw);

    expect(capture.complete).toBe(false);
    expect(capture.events).toHaveLength(INSTALLER_TRUST_FAULT_MAX_CANONICAL_TRANSITIONS);
    expect(capture.omittedSemanticCount).toBe(3);
    expect(capture.observedCount).toBe(raw.length);
  });

  it.each([
    ["out-of-order source", [transition(1), transition(3)]],
    [
      "invalid suppressed observation",
      [
        transition(1),
        {
          ...transition(2),
          storeState: "invented",
        },
      ],
    ],
  ])("rejects %s instead of canonicalizing it away", (_name, raw) => {
    expect(() => canonicalizeInstallerTrustFaultTransitions(raw as readonly Transition[])).toThrow(
      /Installer trust-fault transition at index/,
    );
  });

  it("accepts a contiguous globally ordered phase window and renumbers only its canonical output", () => {
    const raw = [
      transition(17, {
        phase: "seed",
        transferState: "planning",
      }),
      transition(18, {
        activeReleaseDigest: "a".repeat(64),
        phase: "seed",
        transferState: "planning",
      }),
      transition(19, {
        activeReleaseDigest: "a".repeat(64),
        phase: "seed",
        transferState: "probing-quota",
      }),
    ];

    const capture = canonicalizeInstallerTrustFaultTransitionWindow(raw);

    expect(capture.complete).toBe(true);
    expect(capture.events.map(({ order }) => order)).toEqual([1, 2, 3]);
    expect(capture.events.map(({ phase }) => phase)).toEqual(["seed", "seed", "seed"]);
    expect(capture.events[1]?.activeReleaseDigest).toBe("a".repeat(64));
  });

  it("rejects a gap inside a globally ordered phase window with its exact index", () => {
    const raw = [transition(17, { phase: "seed" }), transition(19, { phase: "seed" })];

    expect(() => canonicalizeInstallerTrustFaultTransitionWindow(raw)).toThrow(
      "Installer trust-fault transition at index 1 has order 19; expected contiguous order 18",
    );
  });

  it("continues to require full-run capture to start at order one", () => {
    expect(() =>
      canonicalizeInstallerTrustFaultTransitions([
        transition(17, { phase: "seed" }),
        transition(18, { phase: "seed" }),
      ]),
    ).toThrow(
      "Installer trust-fault transition at index 0 has order 17; expected contiguous order 1",
    );
  });

  it("projects high-volume ready-store churn onto finite transfer edges with exact diagnostics", () => {
    const raw = [
      transition(41, { transferState: "planning" }),
      transition(42, { transferState: "probing-quota" }),
      ...Array.from({ length: 2_000 }, (_, index) =>
        transition(index + 43, {
          storeState: index % 2 === 0 ? "writing" : "ready",
          transferState: "transferring",
        }),
      ),
      transition(2_043, { transferState: "verifying" }),
      transition(2_044, {
        activeReleaseDigest: "a".repeat(64),
        storeState: "ready",
        transferState: "ready",
      }),
      transition(2_045, {
        activeReleaseDigest: "a".repeat(64),
        releaseDigest: "a".repeat(64),
        shellGenerationId: "generation",
        storeState: "ready",
        transferState: "ready",
        uiState: "ready",
      }),
    ];

    const projection = projectInstallerTrustFaultAttemptMilestones(raw);

    expect(projection.milestones).toEqual([
      "planning",
      "probing-quota",
      "transferring",
      "verifying",
      "ready",
    ]);
    expect(projection.milestones.length).toBeLessThanOrEqual(
      INSTALLER_TRUST_FAULT_MAX_ATTEMPT_MILESTONES,
    );
    expect(projection.diagnostics.observedCount).toBe(2_005);
    expect(projection.diagnostics.semanticBoundaryCount).toBeGreaterThan(
      INSTALLER_TRUST_FAULT_MAX_CANONICAL_TRANSITIONS,
    );
    expect(projection.diagnostics.dimensionChangeCounts.storeState).toBe(2_002);
    expect(projection.diagnostics.dimensionChangeCounts.transferState).toBe(4);
    expect(projection.diagnostics.dimensionChangeCounts.uiState).toBe(1);
    expect(projection.diagnostics.dimensionChangeCounts.phase).toBe(0);
    expect(projection.diagnostics.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("retains the first occurrence of a forbidden transfer edge despite prior destination state", () => {
    const raw = [
      transition(1, { transferState: "planning" }),
      transition(2, { transferState: "probing-quota" }),
      transition(3, { transferState: "transferring" }),
      transition(4, { transferState: "planning" }),
    ];

    expect(projectInstallerTrustFaultAttemptMilestones(raw).milestones).toEqual([
      "planning",
      "probing-quota",
      "transferring",
      "planning",
    ]);
  });

  it("bounds repeated transfer cycles by the finite directed-edge contract", () => {
    const raw = Array.from({ length: 10_000 }, (_, index) =>
      transition(index + 1, {
        transferState: index % 2 === 0 ? "transferring" : "verifying",
      }),
    );

    const projection = projectInstallerTrustFaultAttemptMilestones(raw);

    expect(projection.milestones).toEqual(["transferring", "verifying", "transferring"]);
    expect(projection.milestones.length).toBeLessThanOrEqual(
      INSTALLER_TRUST_FAULT_MAX_ATTEMPT_MILESTONES,
    );
  });
});
