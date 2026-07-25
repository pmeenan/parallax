import type { DecodeWorkerRequest, DecodeWorkerResponse } from "../streaming/streaming-protocol";
import type { GreyboxCell } from "../world/world-contract";

interface DecodeWorkerScope {
  onmessage: ((event: MessageEvent<DecodeWorkerRequest>) => void) | null;
  postMessage(message: DecodeWorkerResponse): void;
}

interface CellWrapper {
  readonly cell: GreyboxCell;
  readonly districtId: string;
  readonly schemaVersion: number;
}

const scope = globalThis as unknown as DecodeWorkerScope;
const decoder = new TextDecoder("utf-8", { fatal: true });

scope.onmessage = (event): void => {
  const request = event.data;
  const startedAt = performance.now();
  try {
    const wrapper = JSON.parse(decoder.decode(request.bytes)) as CellWrapper;
    if (
      wrapper.districtId !== request.districtId ||
      wrapper.schemaVersion !== request.schemaVersion ||
      wrapper.cell.id !== request.cellId
    ) {
      throw new Error(`Decoded cell identity mismatch for ${request.cellId}`);
    }
    scope.postMessage({
      cell: wrapper.cell,
      decodeMs: performance.now() - startedAt,
      encodedBytes: request.bytes.byteLength,
      kind: "decoded-cell",
      taskId: request.taskId,
    });
  } catch (error: unknown) {
    scope.postMessage({
      kind: "decode-failure",
      message: error instanceof Error ? error.message : String(error),
      taskId: request.taskId,
    });
  }
};
