import { describe, expect, it } from "vitest";
import { districtSwapPresentIntervalInsideWindow } from "../src/render/district-swap-frame-window";

describe("district swap frame window", () => {
  it("excludes the pre-window portion of the first present interval", () => {
    expect(districtSwapPresentIntervalInsideWindow(0, 120, 1_000, 995)).toBe(5);
    expect(districtSwapPresentIntervalInsideWindow(1, 17, 1_017, 995)).toBe(17);
  });

  it("treats a first frame without prior present evidence as zero interval", () => {
    expect(districtSwapPresentIntervalInsideWindow(0, null, 1_000, 995)).toBe(0);
  });
});
