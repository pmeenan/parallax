import { describe, expect, it } from "vitest";
import {
  classifyVersionChange,
  collectPins,
  evaluateReleaseAge,
  lineOpenedAt,
  PNPM_MINIMUM_RELEASE_AGE_MINUTES,
  updateExclusions,
} from "./release-age-gate.mjs";

const HOUR = 3_600_000;
const now = Date.parse("2026-09-24T20:00:00Z");
const at = (ageHours) => new Date(now - ageHours * HOUR).toISOString();
const verdict = (from, to, times) => evaluateReleaseAge({ name: "pkg", from, to, times, now });

describe("release-age gate", () => {
  it("classifies semver levels, treating 0.y minor bumps as breaking", () => {
    expect(classifyVersionChange("1.31.0", "1.31.1")).toBe("patch");
    expect(classifyVersionChange("9.27.1", "9.28.0")).toBe("minor");
    expect(classifyVersionChange("1.31.0", "2.0.0")).toBe("major");
    expect(classifyVersionChange("0.5.24", "0.6.0")).toBe("major");
    expect(classifyVersionChange("0.5.24", "0.5.25")).toBe("patch");
    expect(classifyVersionChange("1.31.1", "1.31.0")).toBe("downgrade");
    expect(classifyVersionChange("2.0.0-dev.3.10", "2.0.0-dev.3.11")).toBe("patch");
    expect(() => classifyVersionChange("^1.0.0", "1.0.1")).toThrow(/exact semver/);
  });

  it("allows patches at any age, minors after a day and majors after a week", () => {
    const times = {
      created: at(9000),
      "1.30.0": at(200),
      "1.31.0": at(30),
      "1.31.1": at(1),
      "1.32.0": at(12),
      "2.0.0-rc.1": at(400),
      "2.0.0": at(6 * 24),
      "2.0.1": at(2),
    };
    expect(verdict("1.31.0", "1.31.1", times)).toMatchObject({ ok: true, needsExclusion: true });
    expect(verdict("1.30.0", "1.31.0", times)).toMatchObject({ ok: true, needsExclusion: false });
    expect(verdict("1.31.1", "1.32.0", times)).toMatchObject({ ok: false, change: "minor" });
    // The minor window applies to the release opening 1.31, so a young 1.31 patch rides on it,
    // whether or not 1.31.0 was ever committed.
    expect(verdict("1.12.0", "1.31.1", times)).toMatchObject({
      change: "minor",
      needsExclusion: true,
      ok: true,
    });
    // A prerelease does not open the stable 2.x line; 2.0.0 itself is 6 days old.
    expect(verdict("1.31.1", "2.0.1", times)).toMatchObject({ ok: false, change: "major" });
    expect(verdict("1.31.1", "2.0.1", { ...times, "2.0.0": at(7 * 24) })).toMatchObject({
      ok: true,
    });
    // A newly added dependency has no prior pin, so the exact version must clear the major window.
    expect(verdict(null, "1.30.0", times)).toMatchObject({ ok: true, change: "new" });
    expect(verdict(null, "1.31.0", times)).toMatchObject({ ok: false, change: "new" });
    expect(PNPM_MINIMUM_RELEASE_AGE_MINUTES).toBe(1440);
  });

  it("finds the release that opened a line, treating 0.y as the major line", () => {
    const times = { "0.5.0": at(100), "0.5.9": at(1), "0.6.0": at(50), "0.6.1": at(2) };
    expect(lineOpenedAt(times, "0.6.1", "major")).toBe(Date.parse(times["0.6.0"]));
    expect(lineOpenedAt(times, "0.6.1", "minor")).toBe(Date.parse(times["0.6.0"]));
    expect(verdict("0.5.9", "0.6.1", times)).toMatchObject({ ok: false, change: "major" });
    expect(verdict("0.5.9", "0.6.1", { ...times, "0.6.0": at(7 * 24) })).toMatchObject({
      ok: true,
    });
    expect(verdict("0.5.0", "0.5.9", times)).toMatchObject({ ok: true, change: "patch" });
  });

  it("collects exact pins and rewrites only the exclusion block", () => {
    const pins = collectPins([
      { dependencies: { a: "1.0.0", b: "workspace:*" }, devDependencies: { c: "2.1.3" } },
      { dependencies: { a: "1.0.1" } },
    ]);
    expect([...pins.get("a")]).toEqual(["1.0.0", "1.0.1"]);
    expect(pins.has("b")).toBe(false);
    const yaml =
      "packages:\n  - app\n\nminimumReleaseAge: 1440\nminimumReleaseAgeExclude:\n  - 'old@1.0.0'\n";
    expect(updateExclusions(yaml, new Set(["@x/y@1.2.3"]))).toBe(
      "packages:\n  - app\n\nminimumReleaseAge: 1440\n" +
        "minimumReleaseAgeExclude:\n  - '@x/y@1.2.3'\n",
    );
    expect(updateExclusions(yaml, new Set())).toBe(
      "packages:\n  - app\n\nminimumReleaseAge: 1440\n",
    );
  });

  it("replaces exclusions in Windows checkouts without leaving a duplicate YAML key", () => {
    const yaml = "minimumReleaseAge: 1440\r\nminimumReleaseAgeExclude:\r\n  - 'old@1.0.0'\r\n";
    expect(updateExclusions(yaml, new Set(["pkg@1.2.3"]))).toBe(
      "minimumReleaseAge: 1440\r\nminimumReleaseAgeExclude:\r\n  - 'pkg@1.2.3'\r\n",
    );
  });
});
