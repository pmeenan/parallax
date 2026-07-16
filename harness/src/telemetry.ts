import {
  type ParallaxTelemetryExport,
  type ParallaxTelemetrySnapshot,
  TELEMETRY_GLOBAL_NAME,
} from "@parallax/engine";
import type { Page } from "playwright-core";

export function readTelemetry(page: Page): Promise<ParallaxTelemetrySnapshot> {
  return page.evaluate((globalName) => {
    const telemetry = Reflect.get(globalThis, globalName) as ParallaxTelemetryExport;
    return telemetry.snapshot();
  }, TELEMETRY_GLOBAL_NAME);
}
