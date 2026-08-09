import { describe, expect, it } from "vitest";
import type { HybridUiHeavyPrimitive } from "../src/ui/hybrid-ui-contract";
import { topmostHybridUiPrimitiveAt } from "../src/ui/hybrid-ui-hit-test";

describe("hybrid UI hit testing", () => {
  it.each([
    { actionId: null, disabled: false, id: "decorative-overlay" },
    { actionId: "inventory:blocked", disabled: true, id: "disabled-overlay" },
  ])("returns the topmost $id instead of an actionable primitive below it", (overlay) => {
    const lower = primitive("actionable", "inventory:use", false, 0);
    const upper = primitive(overlay.id, overlay.actionId, overlay.disabled, 1);

    expect(topmostHybridUiPrimitiveAt([lower, upper], 0.3, 0.3)).toBe(upper);
  });
});

function primitive(
  id: string,
  actionId: string | null,
  disabled: boolean,
  layer: number,
): HybridUiHeavyPrimitive {
  return Object.freeze({
    actionId,
    disabled,
    id,
    layer,
    rect: Object.freeze({ height: 0.2, width: 0.2, x: 0.2, y: 0.2 }),
    tone: "neutral",
  });
}
