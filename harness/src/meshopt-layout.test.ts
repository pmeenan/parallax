import { canonicalMeshoptLayoutErrors } from "@parallax/engine";
import { describe, expect, it } from "vitest";

describe("canonical meshopt glTF layout", () => {
  it("accepts one-buffer documents with canonical compressed sources", () => {
    expect(
      canonicalMeshoptLayoutErrors({
        buffers: [{}],
        bufferViews: [{ extensions: { EXT_meshopt_compression: { buffer: 0 } } }, { buffer: 0 }],
      }),
    ).toEqual([]);
  });

  it("rejects multi-buffer documents before Babylon Lite sees them", () => {
    expect(
      canonicalMeshoptLayoutErrors({
        buffers: [{}, {}],
        bufferViews: [{ extensions: { EXT_meshopt_compression: { buffer: 1 } } }, { buffer: 1 }],
      }),
    ).toEqual([
      "expected exactly one glTF buffer; received 2",
      "bufferView 0 has meshopt source buffer 1; expected 0",
      "bufferView 1 has uncompressed buffer 1; expected 0",
    ]);
  });
});
