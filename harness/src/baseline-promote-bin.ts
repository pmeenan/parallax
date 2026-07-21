import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { baselineStorePath, promoteBaseline } from "./baseline-store.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

if (isMainModule()) await main();

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const reportPath = resolve(repositoryRoot, options.reportPath);
  const reportBytes = await readFile(reportPath);
  const promoted = await promoteBaseline({
    actor: options.actor,
    allowIneligible: options.rebaseline,
    reason: options.reason,
    reportBytes,
    reportPath,
    storePath: baselineStorePath(repositoryRoot),
  });
  console.log(
    `Promoted smoke@1 ${promoted.browser.version} baseline for ${promoted.comparisonEnvironment.machineId}/${promoted.comparisonEnvironment.requestedTier}: ${promoted.reportFile}`,
  );
}

export function parseArguments(arguments_: readonly string[]): {
  readonly actor: string;
  readonly reason: string;
  readonly rebaseline: boolean;
  readonly reportPath: string;
} {
  const reportPath = arguments_[0];
  let actor: string | undefined;
  let reason: string | undefined;
  let rebaseline = false;
  if (reportPath === undefined || reportPath.startsWith("--")) usageError();
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--rebaseline") {
      if (rebaseline) usageError();
      rebaseline = true;
      continue;
    }
    if (argument !== "--actor" && argument !== "--reason") usageError();
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) usageError();
    if (argument === "--actor") {
      if (actor !== undefined) usageError();
      actor = value;
    } else {
      if (reason !== undefined) usageError();
      reason = value;
    }
    index += 1;
  }
  if (actor === undefined || reason === undefined) usageError();
  return Object.freeze({ actor, reason, rebaseline, reportPath });
}

function usageError(): never {
  throw new Error(
    "Usage: pnpm harness:baseline:promote <report.json> --actor <name> --reason <reason> [--rebaseline]",
  );
}

function isMainModule(): boolean {
  const entryPath = process.argv[1];
  if (entryPath === undefined) return false;
  return import.meta.url === pathToFileURL(resolve(entryPath)).href;
}
