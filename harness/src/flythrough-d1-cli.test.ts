import { describe, expect, it } from "vitest";
import { requireNoFlythroughD1Arguments } from "./flythrough-d1-cli.js";

describe("flythrough-d1 CLI arguments", () => {
  it("accepts the argument-free canonical command", () => {
    expect(() => requireNoFlythroughD1Arguments([])).not.toThrow();
  });

  it.each([
    "--m1-exit-diagnostic",
    "--unknown",
  ])("rejects retired or unknown argument %s before a run can start", (argument) => {
    expect(() => requireNoFlythroughD1Arguments([argument])).toThrow(
      `flythrough-d1 accepts no command-line arguments; received "${argument}"`,
    );
  });
});
