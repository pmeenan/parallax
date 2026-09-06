import { createCompressedStreamingDecoder } from "../streaming/compressed-streaming-codecs";
import {
  type DecodeWorkerRequest,
  type DecodeWorkerResponse,
  STREAMING_DECODE_PROTOCOL_VERSION,
} from "../streaming/streaming-protocol";
import { validatePbrAssetPlacements } from "../world/pbr-asset";
import type { GreyboxCell } from "../world/world-contract";

interface DecodeWorkerScope {
  onmessage: ((event: MessageEvent<DecodeWorkerRequest>) => void) | null;
  postMessage(message: DecodeWorkerResponse, transfer?: readonly Transferable[]): void;
}

interface CellWrapper {
  readonly cell: GreyboxCell;
  readonly districtId: string;
  readonly schemaVersion: number;
}

const scope = globalThis as unknown as DecodeWorkerScope;
const decoder = new TextDecoder("utf-8", { fatal: true });
const compressedDecoder = createCompressedStreamingDecoder();

scope.onmessage = (event): void => {
  void decodeRequest(event.data);
};

async function decodeRequest(request: DecodeWorkerRequest): Promise<void> {
  const startedAt = performance.now();
  try {
    if (
      request.protocolVersion !== STREAMING_DECODE_PROTOCOL_VERSION ||
      !Array.isArray(request.dependencies) ||
      new Set(request.dependencies.map(({ descriptor }) => descriptor.resourceId)).size !==
        request.dependencies.length
    ) {
      throw new Error(`Decode request ${request.taskId} has an invalid protocol envelope`);
    }
    const wrapper = JSON.parse(decoder.decode(request.bytes)) as CellWrapper;
    if (
      wrapper.districtId !== request.districtId ||
      wrapper.schemaVersion !== request.schemaVersion ||
      wrapper.cell.id !== request.cellId
    ) {
      throw new Error(`Decoded cell identity mismatch for ${request.cellId}`);
    }
    const dependencies = [];
    if (wrapper.cell.pbrAssets !== undefined)
      validatePbrAssetPlacements(wrapper.cell.pbrAssets, wrapper.cell.bounds);
    for (const dependency of request.dependencies) {
      dependencies.push(await compressedDecoder.decode(dependency));
    }
    const response = {
      cell: wrapper.cell,
      decodeMs: performance.now() - startedAt,
      dependencies: Object.freeze(dependencies),
      encodedBytes:
        request.bytes.byteLength +
        request.dependencies.reduce((sum, dependency) => sum + dependency.bytes.byteLength, 0),
      kind: "decoded-cell",
      protocolVersion: STREAMING_DECODE_PROTOCOL_VERSION,
      taskId: request.taskId,
    } satisfies DecodeWorkerResponse;
    scope.postMessage(
      response,
      dependencies.flatMap((dependency) =>
        dependency.format === "ktx2"
          ? (dependency.mipmaps?.map((mip) => mip.rgba) ?? [dependency.rgba])
          : dependency.kind !== "legacy-positions"
            ? dependency.kind === "indices"
              ? dependency.indices
              : dependency.attributes
            : dependency.positions,
      ),
    );
  } catch (error: unknown) {
    scope.postMessage({
      kind: "decode-failure",
      message: error instanceof Error ? error.message : String(error),
      taskId: request.taskId,
    });
  }
}
