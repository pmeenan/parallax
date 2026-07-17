import { describe, expect, it } from "vitest";
import {
  createPersistentChromeLaunchOptions,
  validateChromeSandboxCommandLine,
} from "./chrome-pin.js";

describe("Chrome sandbox launch contract", () => {
  it("enables Chromium sandboxing for persistent harness contexts", () => {
    expect(createPersistentChromeLaunchOptions("chrome.exe")).toMatchObject({
      chromiumSandbox: true,
      executablePath: "chrome.exe",
    });
  });

  it("rejects caller-supplied and effective no-sandbox launches", () => {
    expect(() => createPersistentChromeLaunchOptions("chrome.exe", ["--no-sandbox"])).toThrow(
      /may not disable process sandboxing/,
    );
    expect(() => createPersistentChromeLaunchOptions("chrome.exe", ["--no-sandbox=true"])).toThrow(
      /may not disable process sandboxing/,
    );
    expect(() =>
      validateChromeSandboxCommandLine('"chrome.exe" --remote-debugging-pipe --no-sandbox'),
    ).toThrow(/disabled process sandboxing/);
    expect(() =>
      validateChromeSandboxCommandLine('"chrome.exe" --remote-debugging-pipe --no-sandbox=true'),
    ).toThrow(/disabled process sandboxing/);
  });

  it("accepts an effective sandboxed command line", () => {
    expect(validateChromeSandboxCommandLine('"chrome.exe" --remote-debugging-pipe')).toBe(true);
  });
});
