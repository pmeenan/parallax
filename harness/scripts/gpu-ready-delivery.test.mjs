import { expect, it } from "vitest";
import {
  BC1_MIP_CHAIN_FIXTURE,
  BC7_MIP_CHAIN_FIXTURE,
  PRODUCTION_COMPRESSED_STREAMING_FIXTURES,
  RAW_RGBA8_MIP_CHAIN_FIXTURES,
  UASTC_MIP_CHAIN_FIXTURE,
} from "../../engine/src/streaming/production-compressed-fixtures.generated.ts";
import { CLIENT_DECODE_EXCEPTIONS, requireGpuReadyDelivery } from "./gpu-ready-delivery.mjs";

const bytes = (base64) => Uint8Array.from(Buffer.from(base64, "base64"));
const texture = (format, colorSpace) => ({
  resourceId: `texture-${format}`,
  format: "ktx2",
  decode: { format, colorSpace },
});

it("accepts textures stored in the exact GPU format they upload as", () => {
  expect(requireGpuReadyDelivery(texture("bc1", "srgb"), bytes(BC1_MIP_CHAIN_FIXTURE.ktx2))).toBe(
    null,
  );
  expect(requireGpuReadyDelivery(texture("bc7", "linear"), bytes(BC7_MIP_CHAIN_FIXTURE.ktx2))).toBe(
    null,
  );
  const compact = PRODUCTION_COMPRESSED_STREAMING_FIXTURES[0];
  expect(requireGpuReadyDelivery(texture("rgba8", "srgb"), bytes(compact.gpuReadyKtx2))).toBe(null);
});

it("refuses anything the client would have to transcode or decompress", () => {
  expect(() =>
    requireGpuReadyDelivery(texture("bc7", "linear"), bytes(UASTC_MIP_CHAIN_FIXTURE.ktx2)),
  ).toThrow(/Basis transcode.*D-203/);
  const zstd = RAW_RGBA8_MIP_CHAIN_FIXTURES.find((fixture) => fixture.zstd);
  expect(() => requireGpuReadyDelivery(texture("rgba8", "linear"), bytes(zstd.ktx2))).toThrow(
    /supercompression/,
  );
  // Stored BC7 declared as BC1, or sRGB BC1 declared linear: the upload would be wrong.
  expect(() =>
    requireGpuReadyDelivery(texture("bc1", "linear"), bytes(BC7_MIP_CHAIN_FIXTURE.ktx2)),
  ).toThrow(/vkFormat 145/);
  expect(() =>
    requireGpuReadyDelivery(texture("bc1", "linear"), bytes(BC1_MIP_CHAIN_FIXTURE.ktx2)),
  ).toThrow(/vkFormat 132/);
});

it("allows client decoding only through a registered exception", () => {
  const meshopt = {
    resourceId: "vertices",
    format: "meshopt",
    decode: { version: 1, mode: "ATTRIBUTES", count: 3, stride: 32 },
  };
  expect(requireGpuReadyDelivery(meshopt, new Uint8Array(8))).toBe("meshopt-geometry");
  expect(() => requireGpuReadyDelivery(meshopt, new Uint8Array(8), [])).toThrow(
    /meshopt decode.*register a client-decode exception/,
  );
  for (const exception of CLIENT_DECODE_EXCEPTIONS) {
    expect(exception.decision).toMatch(/^D-\d+$/);
    expect(exception.reason.length).toBeGreaterThan(20);
    expect(exception.measured).toMatch(/\d/);
  }
});
