import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type InstallerTrustFaultRuntimeDependencies,
  runInstallerTrustFaultQualification,
} from "./installer-trust-faults-run.js";
import { reserveResultPair } from "./result-pair.js";

export interface InstallerTrustFaultCliDependencies {
  readonly createRuntimeDependencies: (
    repositoryRoot: string,
  ) => Promise<InstallerTrustFaultRuntimeDependencies>;
  readonly now: () => Date;
}

export async function runInstallerTrustFaultCli(
  arguments_: readonly string[],
  repositoryRoot: string,
  dependencies: InstallerTrustFaultCliDependencies,
): Promise<number> {
  if (arguments_.length !== 1 || arguments_[0] !== "--physical-console-confirmed") {
    throw new Error(
      "Usage: installer-trust-faults-cli --physical-console-confirmed (run only after the developer confirms native local dev-01 access and a visibly awake display)",
    );
  }
  const outcome = await runInstallerTrustFaultQualification(
    join(repositoryRoot, "harness/results/installer-trust-faults"),
    {
      createRuntimeDependencies: () => dependencies.createRuntimeDependencies(repositoryRoot),
      now: dependencies.now,
      reserve: (root, startedAt, pending) =>
        reserveResultPair(
          root,
          startedAt,
          pending,
          {},
          "installer-trust-faults",
          "Installer trust + fault qualification",
        ),
    },
  );
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  return outcome.state === "failed" ? 1 : 0;
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  process.exitCode = await runInstallerTrustFaultCli(
    process.argv.slice(2),
    resolve(import.meta.dirname, "../../.."),
    {
      createRuntimeDependencies: async (repositoryRoot) => {
        const module = await import("./installer-trust-faults-browser.js");
        return module.createInstallerTrustFaultBrowserDependencies(repositoryRoot);
      },
      now: () => new Date(),
    },
  );
}
