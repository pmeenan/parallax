// GPU-ready delivery (D-203): every streamed resource the build ships must reach the GPU exactly
// as stored, with no client-side transcode, decompression or decode. Client work is allowed only
// through a registered exception whose measured memory or bandwidth saving justifies it.

/** Registered client-decode exceptions. Each entry names the resources it covers, why the client
 * work pays for itself (a measured, large memory or bandwidth saving), and its decision. Adding
 * one is a deliberate decision-log change, never a way to make a build pass. */
export const CLIENT_DECODE_EXCEPTIONS = Object.freeze([
  Object.freeze({
    id: "meshopt-geometry",
    decision: "D-203",
    reason:
      "meshopt-encoded vertex and index streams download and install about 2.3x smaller; the " +
      "decode runs in the decode worker, off the render thread.",
    measured:
      "Paving candidate 8, 2026-09-24: 5.76 MB meshopt against 13.25 MB raw, a 7.5 MB saving " +
      "(about 25% of the paving's download), for about 6 ms of decode-worker time per cell.",
    covers: (descriptor) => descriptor.format === "meshopt" && descriptor.decode.version === 1,
  }),
]);

// KTX2 vkFormats the engine uploads as stored: BC1 RGB, BC7 and RGBA8, each UNORM or sRGB.
const GPU_READY_KTX2 = Object.freeze({
  bc1: Object.freeze({ srgb: 132, linear: 131 }),
  bc7: Object.freeze({ srgb: 146, linear: 145 }),
  rgba8: Object.freeze({ srgb: 43, linear: 37 }),
});

/** Throws unless `descriptor` + `bytes` upload as stored, or a registered exception covers it.
 * Returns the covering exception's id, or null for a GPU-ready resource. */
export function requireGpuReadyDelivery(descriptor, bytes, exceptions = CLIENT_DECODE_EXCEPTIONS) {
  const clientWork = clientWorkFor(descriptor, bytes);
  if (clientWork === null) return null;
  const exception = exceptions.find((candidate) => candidate.covers(descriptor));
  if (exception !== undefined) return exception.id;
  throw new Error(
    `${descriptor.resourceId} would need ${clientWork} on the client. Ship it GPU-ready, or ` +
      "register a client-decode exception with its measured saving (D-203).",
  );
}

function clientWorkFor(descriptor, bytes) {
  if (descriptor.format === "ktx2") {
    if (bytes.byteLength < 80) return "an invalid KTX2 container";
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const vkFormat = view.getUint32(12, true);
    const supercompression = view.getUint32(44, true);
    if (vkFormat === 0) return "a Basis transcode";
    if (supercompression !== 0) return "KTX2 supercompression decoding";
    const expected = GPU_READY_KTX2[descriptor.decode.format]?.[descriptor.decode.colorSpace];
    return vkFormat === expected
      ? null
      : `a ${descriptor.decode.format} upload of vkFormat ${vkFormat}`;
  }
  if (descriptor.format === "meshopt") return "a meshopt decode";
  return `an unknown ${descriptor.format} decode`;
}
