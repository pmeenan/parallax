// Release-age gate for exact dependency pins (docs/dependencies.md, "Release age").
//
// pnpm 11 applies one `minimumReleaseAge` to every version and accepts only exact versions in
// `minimumReleaseAgeExclude`. The project policy is tiered by semver level:
//   patch (x.y.Z)            any age: fast-follow fixes may be taken at once
//   minor (x.Y.z)            the new minor line opened at least 1 day ago
//   major (X.y.z, or 0.Y.z)  the new major line opened at least 7 days ago
//   new dependency           the exact version is at least 7 days old
// A window applies to the release that opens the new line, not to later patches on it: moving
// from 1.12.0 to 1.31.1 needs 1.31.0 to be a day old, while 1.31.1 may be any age. This keeps the
// verdict independent of whether an intermediate pin (say 1.31.0) was ever committed.
// This command compares every exact pin in the workspace manifests with `git HEAD`, fetches the
// registry publish times of each changed package, and fails on a violation. With --write it adds
// the exact `name@version` exclusions pnpm needs for pins younger than its window and removes
// exclusions for versions no longer pinned.
//
//   node harness/scripts/release-age-gate.mjs [--write]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Minimum age by change level. pnpm's `minimumReleaseAge` must stay at the minor window. */
export const RELEASE_AGE_MS = Object.freeze({ major: 7 * DAY_MS, minor: DAY_MS, patch: 0 });
export const PNPM_MINIMUM_RELEASE_AGE_MINUTES = RELEASE_AGE_MS.minor / 60_000;
const MANIFESTS = ["package.json", "app", "assets", "engine", "game", "harness"].map((path) =>
  path.endsWith(".json") ? path : `${path}/package.json`,
);
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version);
  if (match === null) throw new Error(`Not an exact semver pin: ${version}`);
  return match.slice(1, 4).map(Number);
}

const isPrerelease = (version) => version.includes("-");

/** Semver level of an update. Below 1.0.0 a minor bump is breaking, so it counts as major. */
export function classifyVersionChange(from, to) {
  if (from === to) return "none";
  const [a, b, c] = parseVersion(from);
  const [x, y, z] = parseVersion(to);
  if (x !== a) return x > a ? "major" : "downgrade";
  if (y !== b) return y < b ? "downgrade" : x === 0 ? "major" : "minor";
  if (z < c) return "downgrade";
  return "patch";
}

/**
 * Earliest publish time of the line `version` belongs to: the same major (`level` "major", or
 * the same 0.y below 1.0.0) or the same major.minor (`level` "minor"). Prereleases only open a
 * line for a prerelease pin.
 */
export function lineOpenedAt(times, version, level) {
  const [x, y] = parseVersion(version);
  let opened = Number.POSITIVE_INFINITY;
  for (const [candidate, time] of Object.entries(times)) {
    if (!/^\d+\.\d+\.\d+/.test(candidate)) continue; // "created", "modified"
    if (isPrerelease(candidate) && !isPrerelease(version)) continue;
    const [a, b] = parseVersion(candidate);
    const sameLine = level === "minor" || x === 0 ? a === x && b === y : a === x;
    if (sameLine) opened = Math.min(opened, Date.parse(time));
  }
  return opened;
}

/**
 * Policy verdict for one changed pin. `times` is the registry `time` map; `now` is epoch ms.
 * A new dependency must itself clear the major window. An update must let each line it enters
 * clear that line's window; patch releases on an opened line are exempt.
 */
export function evaluateReleaseAge({ name, from, to, times, now }) {
  const change = from === null ? "new" : classifyVersionChange(from, to);
  const ageMs = now - Date.parse(times[to]);
  const checks = [];
  if (change === "new")
    checks.push({ openedAt: Date.parse(times[to]), requiredMs: RELEASE_AGE_MS.major });
  if (change === "major")
    checks.push({ openedAt: lineOpenedAt(times, to, "major"), requiredMs: RELEASE_AGE_MS.major });
  if (change === "major" || change === "minor")
    checks.push({ openedAt: lineOpenedAt(times, to, "minor"), requiredMs: RELEASE_AGE_MS.minor });
  const lineAgeMs = Math.min(
    Number.POSITIVE_INFINITY,
    ...checks.map((check) => now - check.openedAt),
  );
  return Object.freeze({
    ageMs,
    change,
    lineAgeMs,
    name,
    ok: Number.isFinite(ageMs) && checks.every((check) => now - check.openedAt >= check.requiredMs),
    // pnpm blocks anything younger than its window, so an allowed young pin needs an exclusion.
    needsExclusion: ageMs < RELEASE_AGE_MS.minor,
    requiredMs: Math.max(0, ...checks.map((check) => check.requiredMs)),
    to,
  });
}

/** Exact pins across the workspace manifests, as `name` -> set of versions. */
export function collectPins(manifests) {
  const pins = new Map();
  for (const manifest of manifests)
    for (const field of DEPENDENCY_FIELDS)
      for (const [name, version] of Object.entries(manifest[field] ?? {})) {
        if (version.startsWith("workspace:")) continue;
        parseVersion(version);
        if (!pins.has(name)) pins.set(name, new Set());
        pins.get(name).add(version);
      }
  return pins;
}

/** Publish times from the npm registry that pnpm resolves against. */
async function publishTimes(name) {
  const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`);
  if (!response.ok) throw new Error(`Registry lookup for ${name} failed: ${response.status}`);
  const document = await response.json();
  return document.time ?? {};
}

/** Rewrite the exclusion list: young allowed pins in, versions no longer pinned out. */
export function updateExclusions(workspaceYaml, keep) {
  const newline = workspaceYaml.includes("\r\n") ? "\r\n" : "\n";
  const normalized = workspaceYaml.replace(/\r\n/g, "\n");
  const entries = [...keep].sort();
  const block =
    entries.length === 0
      ? ""
      : `minimumReleaseAgeExclude:\n${entries.map((entry) => `  - '${entry}'`).join("\n")}\n`;
  const stripped = normalized.replace(/^minimumReleaseAgeExclude:\n(?: {2}- .*(?:\n|$))*/m, "");
  return `${stripped.replace(/\n*$/, "\n")}${block}`.replace(/\n/g, newline);
}

async function main() {
  const root = resolve(import.meta.dirname, "../..");
  const write = process.argv.includes("--write");
  const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
  const readHead = (path) => {
    try {
      return JSON.parse(
        execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8" }),
      );
    } catch {
      return {};
    }
  };
  const current = collectPins(MANIFESTS.map(read));
  const previous = collectPins(MANIFESTS.map(readHead));
  const now = Date.now();
  const verdicts = [];
  for (const [name, versions] of current)
    for (const to of versions) {
      if (previous.get(name)?.has(to)) continue;
      const before = [...(previous.get(name) ?? [])].sort();
      const from = before.at(-1) ?? null;
      const times = await publishTimes(name);
      verdicts.push({ ...evaluateReleaseAge({ name, from, to, times, now }), from });
    }
  const hours = (ms) => (Number.isFinite(ms) ? `${(ms / 3_600_000).toFixed(1)} h` : "n/a");
  for (const verdict of verdicts)
    console.log(
      `${verdict.ok ? "ok  " : "FAIL"} ${verdict.name} ${verdict.from ?? "(new)"} -> ${verdict.to}: ${verdict.change}, ` +
        `${hours(verdict.ageMs)} old, line ${hours(verdict.lineAgeMs)} old, needs ${hours(verdict.requiredMs)}` +
        (verdict.needsExclusion ? " (exact pnpm exclusion required)" : ""),
    );
  const workspacePath = join(root, "pnpm-workspace.yaml");
  const workspace = readFileSync(workspacePath, "utf8");
  const normalizedWorkspace = workspace.replace(/\r\n/g, "\n");
  if (
    !new RegExp(`^minimumReleaseAge: ${PNPM_MINIMUM_RELEASE_AGE_MINUTES}(?:\\n|$)`, "m").test(
      normalizedWorkspace,
    )
  )
    throw new Error(
      `pnpm-workspace.yaml must set minimumReleaseAge: ${PNPM_MINIMUM_RELEASE_AGE_MINUTES}`,
    );
  const pinned = new Set(
    [...current].flatMap(([name, versions]) => [...versions].map((v) => `${name}@${v}`)),
  );
  const exclusionBlock =
    /^minimumReleaseAgeExclude:\n((?: {2}- .*(?:\n|$))*)/m.exec(normalizedWorkspace)?.[1] ?? "";
  const existing = [...exclusionBlock.matchAll(/^ {2}- '?([^'\n]+)'?$/gm)].map((match) => match[1]);
  const keep = new Set(existing.filter((entry) => pinned.has(entry)));
  for (const verdict of verdicts)
    if (verdict.ok && verdict.needsExclusion) keep.add(`${verdict.name}@${verdict.to}`);
  const next = updateExclusions(workspace, keep);
  if (next !== workspace) {
    if (write) writeFileSync(workspacePath, next);
    console.log(
      `${write ? "Updated" : "Would update"} minimumReleaseAgeExclude: ${[...keep].join(", ") || "(none)"}`,
    );
  }
  if (verdicts.some((verdict) => !verdict.ok)) process.exitCode = 1;
  else if (next !== workspace && !write) process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename))
  await main();
