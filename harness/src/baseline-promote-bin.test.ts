import { describe, expect, it } from "vitest";
import { parseArguments } from "./baseline-promote-bin.js";

describe("baseline promotion CLI arguments", () => {
  it("parses the explicit audit fields and rebaseline acknowledgement", () => {
    expect(
      parseArguments([
        "report.json",
        "--actor",
        "lead-agent",
        "--reason",
        "reviewed Chrome advance",
        "--rebaseline",
      ]),
    ).toEqual({
      actor: "lead-agent",
      reason: "reviewed Chrome advance",
      rebaseline: true,
      reportPath: "report.json",
    });
  });

  it("rejects flags used as audit values, duplicates, and unknown arguments", () => {
    expect(() => parseArguments(["report.json", "--actor", "--reason", "why"])).toThrow(/Usage/);
    expect(() =>
      parseArguments(["report.json", "--actor", "first", "--actor", "second", "--reason", "why"]),
    ).toThrow(/Usage/);
    expect(() =>
      parseArguments(["report.json", "--actor", "who", "--reason", "why", "extra"]),
    ).toThrow(/Usage/);
  });
});
