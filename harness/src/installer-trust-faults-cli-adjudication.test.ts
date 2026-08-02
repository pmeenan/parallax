import { describe, expect, it } from "vitest";
import {
  INSTALLER_TRUST_FAULT_CLI_ADJUDICATION_CONTRACT,
  INSTALLER_TRUST_FAULT_EXIT_13_ADJUDICATION,
} from "./installer-trust-faults-cli-adjudication.js";

describe("installer trust-fault CLI no-result adjudication", () => {
  it("retains the authorized exit-13 invocation without inventing a start timestamp", () => {
    expect(INSTALLER_TRUST_FAULT_EXIT_13_ADJUDICATION).toEqual({
      command: "pnpm harness:installer-trust-faults --physical-console-confirmed",
      contract: INSTALLER_TRUST_FAULT_CLI_ADJUDICATION_CONTRACT,
      environment: {
        PARALLAX_MACHINE_ID: "dev-01",
        PARALLAX_TIER: "showcase",
      },
      observation: {
        acceptedHeavyEvidenceWrittenAt: "2026-07-31T02:54:30.786021Z",
        firstSurvivingBuildFiles: {
          buildManifest: {
            path: "dist/build-manifest.json",
            writtenAt: "2026-07-31T02:56:56.188188Z",
          },
          engineModule: {
            label: "engine.js",
            writtenAt: "2026-07-31T02:56:51.6398942Z",
          },
          trustFaultRunner: {
            path: "harness/dist/types/installer-trust-faults-run.js",
            writtenAt: "2026-07-31T02:56:50.6001165Z",
          },
        },
        startedAt: null,
        startedAtState: "not-retained",
        toolReportedWallTimeMs: 34_500,
      },
      outcome: {
        exitCode: 13,
        failure: "unsettled-top-level-await",
        resultArtifacts: [],
        scenarioResourcesStarted: [],
        v7ResultFiles: 0,
      },
      schemaVersion: 1,
      source: {
        artifactDigest: "a2ef1907bd5ba52b3356d02be4d35825b0ea7850ace50677115199cd9766c6f5",
        commit: "7fdc5465b5903751301a4e319a160848eacefac6",
        dirtyTreeDigest: "ed955fd5405315fada564516818605f3ef72e65a07e150c7054feca03bd0ebcc",
        releaseDigest: "4ff870f5a356a3521110407c6e3c1c22e0f2b1bd8c3a8029132888f7f35da098",
      },
      tools: {
        node: "24.18.0",
        pnpm: "11.12.0",
      },
    });
  });
});
