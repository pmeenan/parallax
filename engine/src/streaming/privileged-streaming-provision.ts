import { parseStreamingDistrictIndex } from "./installed-streaming-release";
import type {
  StreamingCellIndexEntry,
  StreamingDependencyIndexEntry,
  StreamingDistrictIndex,
} from "./streaming-protocol";

export interface PrivilegedStreamingProvisionPlan {
  readonly index: StreamingDistrictIndex;
  readonly packages: readonly (StreamingCellIndexEntry | StreamingDependencyIndexEntry)[];
}

/** Automation provisioning uses the same content graph without claiming release admission. */
export function parsePrivilegedStreamingProvisionPlan(
  input: unknown,
  districtId: string,
): PrivilegedStreamingProvisionPlan {
  const index = parseStreamingDistrictIndex(input, districtId);
  return Object.freeze({
    index,
    packages: Object.freeze([...index.cells, ...(index.resources ?? [])]),
  });
}
