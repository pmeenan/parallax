import { describe, expect, it } from "vitest";
import {
  evaluateModelStatusPage,
  hasRequiredSettledAvailability,
  isChromeVersionAtLeast,
  isPromptApiAvailability,
} from "./prompt-api-branded-run.js";

describe("branded Prompt API settled availability", () => {
  const completedTransitions = [
    { availability: "available", elapsedMs: 100, phase: "install-completed" },
    {
      availability: "available",
      elapsedMs: 200,
      phase: "post-restart-fixture-completed",
    },
  ] as const;

  it("requires both install completion and the post-restart fixture to settle available", () => {
    expect(hasRequiredSettledAvailability(completedTransitions)).toBe(true);
  });

  it("rejects a profile whose initial install completion remains downloading", () => {
    expect(
      hasRequiredSettledAvailability([
        { availability: "downloading", elapsedMs: 100, phase: "install-completed" },
        completedTransitions[1],
      ]),
    ).toBe(false);
  });

  it("rejects a profile whose post-restart fixture does not settle available", () => {
    expect(
      hasRequiredSettledAvailability([
        completedTransitions[0],
        {
          availability: "downloading",
          elapsedMs: 200,
          phase: "post-restart-fixture-completed",
        },
      ]),
    ).toBe(false);
  });
});

describe("branded Prompt API model-status evidence", () => {
  it("accepts identifiable model status details from the Chrome internal page", () => {
    expect(
      evaluateModelStatusPage({
        bodyText: "Model Status\nModel Name: v3Nano\nVersion: 2026.07.01\nFolder Size: 4 GB",
        title: "On-device Internals",
        url: "chrome://on-device-internals/",
      }),
    ).toMatchObject({ state: "measured" });
  });

  it("rejects arbitrary nonempty internals content", () => {
    expect(
      evaluateModelStatusPage({
        bodyText: "On-device Internals\nEvent Logs",
        title: "On-device Internals",
        url: "chrome://on-device-internals/",
      }),
    ).toMatchObject({ reason: expect.stringContaining("Model Status"), state: "invalid" });
  });

  it("rejects model-detail labels without values", () => {
    expect(
      evaluateModelStatusPage({
        bodyText: "Model Status\nModel Name:\nVersion:\nFolder Size:",
        title: "On-device Internals",
        url: "chrome://on-device-internals/",
      }),
    ).toMatchObject({ reason: expect.stringContaining("populated"), state: "invalid" });
  });

  it("retains automation-disabled model internals as unsupported diagnostic evidence", () => {
    expect(
      evaluateModelStatusPage({
        bodyText: "",
        title: "Debug WebUIs Disabled",
        url: "chrome://debug-webuis-disabled/?host=chrome://on-device-internals/",
      }),
    ).toMatchObject({ reason: expect.stringContaining("automation"), state: "unsupported" });
  });

  it("requires the exact known automation-disabled redirect", () => {
    expect(
      evaluateModelStatusPage({
        bodyText: "",
        title: "Debug WebUIs Disabled",
        url: "chrome://debug-webuis-disabled/?host=chrome://on-device-internals/&reason=policy",
      }),
    ).toMatchObject({ reason: expect.stringContaining("unexpected URL"), state: "invalid" });
  });
});

describe("branded Chrome version floor", () => {
  it("accepts pinned Stable or newer and rejects older or invalid versions", () => {
    expect(isChromeVersionAtLeast("150.0.7871.115", "150.0.7871.115")).toBe(true);
    expect(isChromeVersionAtLeast("151.0.1.0", "150.0.7871.115")).toBe(true);
    expect(isChromeVersionAtLeast("150.0.7871.114", "150.0.7871.115")).toBe(false);
    expect(isChromeVersionAtLeast("Canary", "150.0.7871.115")).toBe(false);
    expect(isChromeVersionAtLeast("150.0.7871.115", "")).toBe(false);
    expect(isChromeVersionAtLeast("150.0.7871.115", "   ")).toBe(false);
  });
});

describe("branded Prompt API availability validation", () => {
  it("accepts only primitive availability strings", () => {
    expect(isPromptApiAvailability("available")).toBe(true);
    expect(isPromptApiAvailability(["available"])).toBe(false);
    expect(isPromptApiAvailability(new String("available"))).toBe(false);
  });
});
