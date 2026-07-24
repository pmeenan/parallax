import { createHash } from "node:crypto";
import sharp from "sharp";

export const GREYBOX_MINIMUM_VISIBLE_PIXEL_RATIO = 0.35;
export const GREYBOX_MAXIMUM_VISIBLE_PIXEL_RATIO = 0.999;

export interface GreyboxRenderedOutputEvidence {
  readonly clearColorRgb: readonly [number, number, number];
  readonly height: number;
  readonly pngSha256: string;
  readonly visiblePixelCount: number;
  readonly visiblePixelRatio: number;
  readonly width: number;
}

const CLEAR_COLOR_DISTANCE_THRESHOLD = 24;

export function screenshotClearColorRgb(
  clearColor: readonly [number, number, number, number],
): readonly [number, number, number] {
  if (
    clearColor.some(
      (component) =>
        typeof component !== "number" ||
        !Number.isFinite(component) ||
        component < 0 ||
        component > 1,
    )
  ) {
    throw new Error("Greybox clear color must contain normalized finite components");
  }
  return Object.freeze([
    Math.round(clearColor[0] * 255),
    Math.round(clearColor[1] * 255),
    Math.round(clearColor[2] * 255),
  ]);
}

export async function analyzeGreyboxRenderedOutput(
  pngBytes: Uint8Array,
  clearColor: readonly [number, number, number, number],
): Promise<GreyboxRenderedOutputEvidence> {
  const clearColorRgb = screenshotClearColorRgb(clearColor);
  const decoded = await sharp(pngBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.channels !== 3 || decoded.info.width <= 0 || decoded.info.height <= 0) {
    throw new Error("Greybox screenshot did not decode to non-empty RGB pixels");
  }
  const pixelCount = decoded.info.width * decoded.info.height;
  let visiblePixelCount = 0;
  for (let offset = 0; offset < decoded.data.length; offset += 3) {
    const red = decoded.data[offset] ?? 0;
    const green = decoded.data[offset + 1] ?? 0;
    const blue = decoded.data[offset + 2] ?? 0;
    const distance = Math.hypot(
      red - clearColorRgb[0],
      green - clearColorRgb[1],
      blue - clearColorRgb[2],
    );
    if (distance > CLEAR_COLOR_DISTANCE_THRESHOLD) visiblePixelCount += 1;
  }
  const visiblePixelRatio = visiblePixelCount / pixelCount;
  if (visiblePixelRatio < GREYBOX_MINIMUM_VISIBLE_PIXEL_RATIO) {
    throw new Error(
      `Greybox rendered output covers only ${(visiblePixelRatio * 100).toFixed(2)}% of canvas pixels`,
    );
  }
  if (visiblePixelRatio >= GREYBOX_MAXIMUM_VISIBLE_PIXEL_RATIO) {
    throw new Error(
      `Greybox rendered output covers ${(visiblePixelRatio * 100).toFixed(2)}% of canvas pixels and did not retain enough detectable clear-color pixels`,
    );
  }
  return Object.freeze({
    clearColorRgb,
    height: decoded.info.height,
    pngSha256: createHash("sha256").update(pngBytes).digest("hex"),
    visiblePixelCount,
    visiblePixelRatio,
    width: decoded.info.width,
  });
}

export function requireGreyboxRenderedOutputEvidence(
  value: unknown,
): GreyboxRenderedOutputEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Greybox rendered-output evidence is missing");
  }
  const record = value as Record<string, unknown>;
  const width = record.width as number;
  const height = record.height as number;
  const visiblePixelCount = record.visiblePixelCount as number;
  const visiblePixelRatio = record.visiblePixelRatio as number;
  const pixelCount = width * height;
  if (
    !Number.isInteger(record.width) ||
    width <= 0 ||
    !Number.isInteger(record.height) ||
    height <= 0 ||
    !Number.isInteger(record.visiblePixelCount) ||
    visiblePixelCount <= 0 ||
    visiblePixelCount > pixelCount ||
    typeof record.visiblePixelRatio !== "number" ||
    !Number.isFinite(visiblePixelRatio) ||
    visiblePixelRatio < GREYBOX_MINIMUM_VISIBLE_PIXEL_RATIO ||
    visiblePixelRatio >= GREYBOX_MAXIMUM_VISIBLE_PIXEL_RATIO ||
    Math.abs(visiblePixelRatio - visiblePixelCount / pixelCount) > 1e-12 ||
    !isRgbTuple(record.clearColorRgb) ||
    typeof record.pngSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.pngSha256)
  ) {
    throw new Error("Greybox rendered-output evidence is invalid");
  }
  return value as GreyboxRenderedOutputEvidence;
}

function isRgbTuple(value: unknown): value is readonly [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => Number.isInteger(component) && component >= 0 && component <= 255)
  );
}
