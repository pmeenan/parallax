import { describe, expect, it } from "vitest";
import { requireExactInvocation } from "./branded-parity-run.js";

describe("branded parity command boundary", () => {
  const environment = { PARALLAX_MACHINE_ID: "dev-01", PARALLAX_TIER: "showcase" };

  it("accepts only explicit production dev-01/Showcase", () => {
    expect(requireExactInvocation(["--target", "https://parallax-web.com"], environment)).toBe(
      true,
    );
  });

  it.each([
    [[], environment],
    [["--target", "local"], environment],
    [["--target", "https://parallax-web.com", "--include-v8-code-cache"], environment],
    [["--target", "https://parallax-web.com"], { ...environment, PARALLAX_MACHINE_ID: "other" }],
    [["--target", "https://parallax-web.com"], { ...environment, PARALLAX_TIER: "standard" }],
    [
      ["--target", "https://parallax-web.com"],
      { ...environment, PARALLAX_CHROME_PIN_ANCHOR: "150.0.7871.115" },
    ],
  ])("rejects non-gating invocation %#", (arguments_, processEnvironment) => {
    expect(() => requireExactInvocation(arguments_, processEnvironment)).toThrow();
  });
});
