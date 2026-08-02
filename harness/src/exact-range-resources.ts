export interface ExactRangeResourceIdentity {
  readonly bytes: number;
  readonly sha256: string;
  readonly source: string;
}

export function createExactRangeResources(
  resources: readonly ExactRangeResourceIdentity[],
): readonly Readonly<ExactRangeResourceIdentity>[] {
  return Object.freeze(
    resources.map((resource) => {
      if (
        resource.source.startsWith("https://") ||
        resource.source.startsWith("/") ||
        resource.source.includes("\\") ||
        resource.source.includes("?") ||
        resource.source.includes("#")
      ) {
        throw new Error(
          `Exact-range transport requires a same-origin install source: ${resource.source}`,
        );
      }
      return Object.freeze({
        bytes: resource.bytes,
        sha256: resource.sha256,
        source: resource.source,
      });
    }),
  );
}
