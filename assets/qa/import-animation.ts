import { resolve } from "node:path";
import { importAnimationCandidate } from "./animation-candidate.ts";

const [source, profile, output, ...extra] = process.argv.slice(2);
if (source === undefined || profile === undefined || output === undefined || extra.length > 0) {
  throw new Error(
    "Usage: pnpm assets:animation:import <source.glb> <profile.json> <new-directory-under-harness/results>",
  );
}
await importAnimationCandidate(
  source,
  profile,
  output,
  resolve(import.meta.dirname, "../../harness/results"),
);
process.stdout.write(
  `Animation candidate imported: ${resolve(output, "candidate.json")}\nSource QA passed; library admission and motion acceptance remain pending.\n`,
);
