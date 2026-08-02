import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  brandedBrowserValidation,
  type InstalledBrandedChromeIdentity,
  inspectInstalledBrandedChrome,
  requireBrandedChromeComparable,
  validateObservedBrowserVersionIdentity,
} from "./branded-chrome.js";
import {
  assembleBrandedParityReport,
  BRANDED_PARITY_RESULT_DIRECTORY,
  type BrandedParityPreRunIdentity,
  type BrandedParityReport,
  type BrandedParityReservation,
  failedBrandedParityReport,
  formatBrandedParityReport,
  pendingBrandedParityReport,
  publishEarlyBrandedParityFailure,
  reserveBrandedParityResult,
  serializeBrandedParityReport,
} from "./branded-parity-result.js";
import { readAndValidateBuildManifest } from "./build-manifest.js";
import { type ChromePin, loadChromePin } from "./chrome-pin.js";
import type { BrowserVersionIdentity } from "./registered-environment.js";
import { measuredFinalizationEvidence } from "./report-finalization.js";
import { runSmokeCommand } from "./smoke-run.js";
import { readSourceIdentity } from "./source-identity.js";
import { PRODUCTION_ORIGIN, parseHarnessTargetArguments } from "./target.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = resolve(repositoryRoot, "dist");
const comparisonReferencePath = resolve(repositoryRoot, "harness/chrome/stable.json");
const resultRoot = resolve(repositoryRoot, "harness/results", BRANDED_PARITY_RESULT_DIRECTORY);

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const reservation = await reserveBrandedParityResult(
    resultRoot,
    startedAt,
    pendingBrandedParityReport(startedAt),
  );
  let comparisonReference: ChromePin | null = null;
  let brandedBrowser: InstalledBrandedChromeIdentity | null = null;
  let expectedIdentity: BrandedParityPreRunIdentity | null = null;
  let observedBrowserVersion: BrowserVersionIdentity | null = null;
  try {
    requireExactInvocation(process.argv.slice(2), process.env);
    comparisonReference = await loadChromePin(comparisonReferencePath);
    const build = await readAndValidateBuildManifest(buildRoot);
    const expectedBuildIdentity = Object.freeze({
      artifactDigest: build.artifactDigest,
      releaseDigest: build.releaseDigest,
      source: await readSourceIdentity(repositoryRoot),
    });
    brandedBrowser = await inspectInstalledBrandedChrome();
    requireBrandedChromeComparable(brandedBrowser.fileVersion, comparisonReference);
    await reservation.persistenceDependencies.writeJson(
      reservation.jsonPath,
      serializeBrandedParityReport(
        pendingBrandedParityReport(startedAt, { brandedBrowser, comparisonReference }),
      ),
    );
    const report = await runSmokeCommand({
      arguments: ["--target", PRODUCTION_ORIGIN],
      beforeMeasurements: async (environment) => {
        expectedIdentity = Object.freeze({
          ...expectedBuildIdentity,
          target: environment.target,
        });
        const pending = pendingBrandedParityReport(startedAt, {
          brandedBrowser,
          comparisonReference,
          expectedIdentity,
          observedBrowserVersion,
        });
        await reservation.persistenceDependencies.writeJson(
          reservation.jsonPath,
          serializeBrandedParityReport(pending),
        );
      },
      chromePin: comparisonReference,
      executablePath: brandedBrowser.executablePath,
      formatMarkdown: formatBrandedParityReport,
      inspectValidation: brandedBrowserValidation(
        brandedBrowser,
        comparisonReference,
        async (version) => {
          observedBrowserVersion = validateObservedBrowserVersionIdentity(version);
          await reservation.persistenceDependencies.writeJson(
            reservation.jsonPath,
            serializeBrandedParityReport(
              pendingBrandedParityReport(startedAt, {
                brandedBrowser,
                comparisonReference,
                expectedIdentity,
                observedBrowserVersion,
              }),
            ),
          );
        },
      ),
      persistenceDependencies: reservation.persistenceDependencies,
      prepareReportContext: async () => null,
      reportPaths: () => ({ json: reservation.jsonPath, markdown: reservation.markdownPath }),
      resultLabel: "Branded parity result",
      summaryLabel: "Branded parity summary",
      toReport: (smoke, _context) =>
        assembleBrandedParityReport({
          brandedBrowser: requirePresent(brandedBrowser, "branded browser identity"),
          comparisonReference: requirePresent(comparisonReference, "CfT comparison reference"),
          expectedIdentity: requirePresent(expectedIdentity, "reserved source/build identity"),
          observedBrowserVersion: requirePresent(
            observedBrowserVersion,
            "observed Browser.getVersion identity",
          ),
          reportPersistence: smoke.reportPersistence,
          smoke,
          startedAt,
        }),
    });
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    const failed = failedBrandedParityReport({
      brandedBrowser,
      comparisonReference,
      error,
      expectedIdentity,
      observedBrowserVersion,
      reportPersistence: measuredFinalizationEvidence(),
      startedAt,
    });
    const persisted = await publishEarlyBrandedParityFailure(reservation, failed);
    console.error(persisted.failure);
    console.log(`Branded parity result: ${reservation.jsonPath}`);
    if (persisted.reportPersistence.state === "measured") {
      console.log(`Branded parity summary: ${reservation.markdownPath}`);
    }
    process.exitCode = 1;
  }
}

export function requireExactInvocation(
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): true {
  const target = parseHarnessTargetArguments(arguments_);
  if (target.request !== PRODUCTION_ORIGIN || target.remainingArguments.length !== 0) {
    throw new Error(
      `Branded-Stable parity requires only --target ${PRODUCTION_ORIGIN}; local or extra options are forbidden`,
    );
  }
  if (environment.PARALLAX_MACHINE_ID !== "dev-01") {
    throw new Error("Branded-Stable parity runs only on registered dev-01");
  }
  if ((environment.PARALLAX_TIER ?? "showcase").toLowerCase() !== "showcase") {
    throw new Error("Branded-Stable parity runs only at the Showcase tier");
  }
  if (
    environment.PARALLAX_CHROME_PIN_ANCHOR !== undefined &&
    environment.PARALLAX_CHROME_PIN_ANCHOR !== ""
  ) {
    throw new Error(
      "Branded-Stable parity forbids Chrome pin anchors and always compares with harness/chrome/stable.json",
    );
  }
  return true;
}

function requirePresent<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`${label} is unavailable`);
  return value;
}

export async function publishBrandedParityFailureForTest(
  reservation: BrandedParityReservation,
  report: BrandedParityReport,
): Promise<BrandedParityReport> {
  return publishEarlyBrandedParityFailure(reservation, report);
}
