import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  analyzeGreyboxRenderedOutput,
  GREYBOX_MAXIMUM_VISIBLE_PIXEL_RATIO,
  GREYBOX_MINIMUM_VISIBLE_PIXEL_RATIO,
  requireGreyboxRenderedOutputEvidence,
} from "./greybox-rendered-output.js";

async function solidPng(red: number, green: number, blue: number): Promise<Buffer> {
  const pixels = Buffer.alloc(10 * 10 * 3);
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
  }
  return sharp(pixels, { raw: { channels: 3, height: 10, width: 10 } })
    .png()
    .toBuffer();
}

async function splitPng(
  clear: readonly [number, number, number],
  visible: readonly [number, number, number],
  visiblePixels: number,
  width = 10,
  height = 10,
): Promise<Buffer> {
  const pixelCount = width * height;
  const pixels = Buffer.alloc(pixelCount * 3);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const color = pixel < visiblePixels ? visible : clear;
    const offset = pixel * 3;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
  }
  return sharp(pixels, { raw: { channels: 3, height, width } })
    .png()
    .toBuffer();
}

const clearColor = Object.freeze([0.32, 0.64, 0.92, 1] as const);

describe("greybox rendered-output evidence", () => {
  it("rejects a canvas that contains only the renderer clear color", async () => {
    await expect(
      analyzeGreyboxRenderedOutput(await solidPng(82, 163, 235), clearColor),
    ).rejects.toThrow("covers only 0.00%");
  });

  it("derives the clear color and hashes a canvas with geometry plus visible sky", async () => {
    const evidence = await analyzeGreyboxRenderedOutput(
      await splitPng([26, 51, 77], [42, 118, 54], 60),
      [0.1, 0.2, 0.3, 1],
    );

    expect(evidence).toMatchObject({
      clearColorRgb: [26, 51, 77],
      height: 10,
      visiblePixelCount: 60,
      visiblePixelRatio: 0.6,
      width: 10,
    });
    expect(evidence.pngSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(requireGreyboxRenderedOutputEvidence(evidence)).toEqual(evidence);
  });

  it("rejects a canvas whose pixels all differ from the declared clear color", async () => {
    await expect(
      analyzeGreyboxRenderedOutput(await solidPng(42, 118, 54), clearColor),
    ).rejects.toThrow("did not retain enough detectable clear-color pixels");
  });

  it("rejects output with no more than one tenth of a percent detectable clear color", async () => {
    await expect(
      analyzeGreyboxRenderedOutput(
        await splitPng([26, 51, 77], [42, 118, 54], 999, 1_000, 1),
        [0.1, 0.2, 0.3, 1],
      ),
    ).rejects.toThrow("did not retain enough detectable clear-color pixels");
  });

  it("rejects persisted evidence below the mandatory visible-pixel ratio", () => {
    expect(() =>
      requireGreyboxRenderedOutputEvidence({
        clearColorRgb: [82, 163, 235],
        height: 10,
        pngSha256: "a".repeat(64),
        visiblePixelCount: 34,
        visiblePixelRatio: GREYBOX_MINIMUM_VISIBLE_PIXEL_RATIO - 0.01,
        width: 10,
      }),
    ).toThrow("rendered-output evidence is invalid");
  });

  it("rejects persisted evidence at the maximum visible-pixel ratio", () => {
    expect(() =>
      requireGreyboxRenderedOutputEvidence({
        clearColorRgb: [82, 163, 235],
        height: 1_000,
        pngSha256: "a".repeat(64),
        visiblePixelCount: 999_000,
        visiblePixelRatio: GREYBOX_MAXIMUM_VISIBLE_PIXEL_RATIO,
        width: 1_000,
      }),
    ).toThrow("rendered-output evidence is invalid");
  });
});
