import { describe, expect, it } from "vitest";
import {
  RENDER_RECOVERY_ATTEMPTS,
  RENDER_RECOVERY_MANDATORY_METRIC_SET_VERSION,
  RENDER_RECOVERY_MANDATORY_METRICS,
  RENDER_RECOVERY_REPORT_SCHEMA_VERSION,
  RENDER_RECOVERY_SCENARIO,
} from "./render-recovery.js";

describe("render-recovery@1 run contract", () => {
  it("keeps three isolated real-fault attempts and a versioned result contract", () => {
    expect(RENDER_RECOVERY_SCENARIO).toBe("render-recovery@1");
    expect(RENDER_RECOVERY_REPORT_SCHEMA_VERSION).toBe(33);
    expect(RENDER_RECOVERY_MANDATORY_METRIC_SET_VERSION).toBe(5);
    expect(RENDER_RECOVERY_ATTEMPTS).toEqual([
      { firstProbe: "device-loss", id: "device-loss-recovery", secondProbe: null },
      { firstProbe: "worker-crash", id: "worker-crash-recovery", secondProbe: null },
      { firstProbe: "device-loss", id: "retry-exhaustion", secondProbe: "worker-crash" },
    ]);
    expect(new Set(RENDER_RECOVERY_ATTEMPTS.map(({ id }) => id)).size).toBe(3);
    expect(RENDER_RECOVERY_MANDATORY_METRICS).toHaveLength(9);
  });
});
