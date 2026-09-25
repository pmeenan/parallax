import { MeshoptDecoder } from "meshoptimizer/decoder";
import type {
  StreamingMeshoptIndexDependencyIndexEntry,
  StreamingMeshoptVertexDependencyIndexEntry,
} from "./streaming-protocol";

/** Build-time (pack-time) check of a versioned meshopt payload against its descriptor: every
 * vertex attribute is finite and every index addresses a vertex. The runtime decode worker does
 * not repeat these scans (D-202). Installed bytes are hash-bound to the build output, so a payload
 * that passes here reaches the decoder unchanged, and a decoder defect is fixed in the decoder.
 */
export async function validateVersionedMeshoptPayload(
  descriptor: Pick<
    StreamingMeshoptVertexDependencyIndexEntry | StreamingMeshoptIndexDependencyIndexEntry,
    "decode" | "resourceId"
  >,
  bytes: Uint8Array,
): Promise<void> {
  const decode = descriptor.decode;
  await MeshoptDecoder.ready;
  const decoded = new Uint8Array(decode.count * decode.stride);
  MeshoptDecoder.decodeGltfBuffer(decoded, decode.count, decode.stride, bytes, decode.mode);
  if (decode.mode === "ATTRIBUTES") {
    const attributes = new Float32Array(decoded.buffer);
    for (let index = 0; index < attributes.length; index += 1)
      if (!Number.isFinite(attributes[index]))
        throw new Error(`Meshopt vertices ${descriptor.resourceId} contain a non-finite value`);
    return;
  }
  const indices = new Uint32Array(decoded.buffer);
  if (indices.length % 3 !== 0)
    throw new Error(`Meshopt indices ${descriptor.resourceId} are not whole triangles`);
  for (let index = 0; index < indices.length; index += 1)
    if ((indices[index] ?? decode.vertexCount) >= decode.vertexCount)
      throw new Error(`Meshopt indices ${descriptor.resourceId} address a missing vertex`);
}
