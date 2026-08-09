import { describe, expect, it } from "vitest";
import {
  AUTOMATION_GAMEPLAY_INPUT_QUERY,
  AUTOMATION_GAMEPLAY_INPUT_VALUE,
  AUTOMATION_RUNTIME_QUERY,
  AUTOMATION_RUNTIME_VALUE,
  isAutomationGameplayInputLaunch,
  isAutomationRuntimeLaunch,
} from "../src/install/installer-automation";

describe("installer automation launch authorization", () => {
  it("requires both WebDriver and the exact explicit route token", () => {
    const base = "https://parallax-web.com/";
    expect(isAutomationRuntimeLaunch(base, true)).toBe(false);
    expect(
      isAutomationRuntimeLaunch(
        `${base}?${AUTOMATION_RUNTIME_QUERY}=${AUTOMATION_RUNTIME_VALUE}`,
        false,
      ),
    ).toBe(false);
    expect(isAutomationRuntimeLaunch(`${base}?${AUTOMATION_RUNTIME_QUERY}=installer`, true)).toBe(
      false,
    );
    expect(
      isAutomationRuntimeLaunch(
        `${base}?${AUTOMATION_RUNTIME_QUERY}=${AUTOMATION_RUNTIME_VALUE}`,
        true,
      ),
    ).toBe(true);
  });

  it("preserves authorization when a harness scenario adds its own query parameters", () => {
    expect(
      isAutomationRuntimeLaunch(
        `http://127.0.0.1:8080/?${AUTOMATION_RUNTIME_QUERY}=${AUTOMATION_RUNTIME_VALUE}&appOwnedLlmSpike=manual`,
        true,
      ),
    ).toBe(true);
  });

  it("admits gameplay input only for the exact WebDriver runtime smoke opt-in", () => {
    const base = `https://parallax-web.com/?${AUTOMATION_RUNTIME_QUERY}=${AUTOMATION_RUNTIME_VALUE}`;
    const optedIn = `${base}&${AUTOMATION_GAMEPLAY_INPUT_QUERY}=${AUTOMATION_GAMEPLAY_INPUT_VALUE}`;
    expect(isAutomationGameplayInputLaunch(optedIn, true)).toBe(true);
    expect(isAutomationGameplayInputLaunch(optedIn, false)).toBe(false);
    expect(isAutomationGameplayInputLaunch(base, true)).toBe(false);
    expect(
      isAutomationGameplayInputLaunch(
        `https://parallax-web.com/?${AUTOMATION_GAMEPLAY_INPUT_QUERY}=${AUTOMATION_GAMEPLAY_INPUT_VALUE}`,
        true,
      ),
    ).toBe(false);
    expect(
      isAutomationGameplayInputLaunch(`${base}&${AUTOMATION_GAMEPLAY_INPUT_QUERY}=benchmark`, true),
    ).toBe(false);
  });
});
