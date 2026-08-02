import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("installer trust-fault compiled module graph", () => {
  it("evaluates the acyclic run/browser/shared graph without unsettled-TLA exit 13", () => {
    const compiledRoot = resolve(process.cwd(), "harness/dist/types");
    const moduleUrls = [
      "installer-trust-faults-run.js",
      "installer-trust-faults-browser.js",
      "installer-trust-faults-terminal-evidence.js",
      "installer-trust-faults-cli.js",
    ].map((name) => pathToFileURL(resolve(compiledRoot, name)).href);
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `await Promise.all(${JSON.stringify(moduleUrls)}.map((url) => import(url)));`,
      ],
      {
        encoding: "utf8",
        timeout: 10_000,
      },
    );

    expect(child.error).toBeUndefined();
    expect(child.status).not.toBe(13);
    expect(child.status, child.stderr).toBe(0);
    expect(child.stderr).not.toContain("unsettled top-level await");
  });

  it("observes the compiled CLI top-level rejection instead of an unobserved main catch", () => {
    const cliPath = resolve(process.cwd(), "harness/dist/types/installer-trust-faults-cli.js");
    const child = spawnSync(process.execPath, [cliPath], {
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(child.error).toBeUndefined();
    expect(child.status).not.toBe(13);
    expect(child.status).toBe(1);
    expect(child.stderr).toContain(
      "Usage: installer-trust-faults-cli --physical-console-confirmed",
    );
  });
});
