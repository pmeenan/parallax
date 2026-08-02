import { describe, expect, it } from "vitest";
import {
  AUTOMATION_RUNTIME_QUERY,
  AUTOMATION_RUNTIME_VALUE,
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
});
