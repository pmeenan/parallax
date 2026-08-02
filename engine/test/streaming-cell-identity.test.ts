import { describe, expect, it } from "vitest";
import {
  canonicalStreamingCellArtifactIdentity,
  canonicalStreamingCellId,
  canonicalStreamingDistrictIndexResourceId,
  parseStreamingCellArtifactSource,
} from "../src/streaming/streaming-cell-identity";

describe("streaming cell schema-v1 identity", () => {
  it("derives the generator, immutable source, and install resource identities together", () => {
    const sha256 = "a".repeat(64);
    const identity = canonicalStreamingCellArtifactIdentity("district-1-surface", [3, 12], sha256);

    expect(identity).toEqual({
      artifactScope: "district-1-surface",
      cellId: "district-1-surface-cell-03-12",
      coordinate: [3, 12],
      coordinateToken: "03-12",
      resourceId: "game-specific-world-cell-district-1-surface-03-12",
      sha256,
      source: `immutable/district-1-surface-cell-03-12-${sha256}.json`,
    });
    expect(parseStreamingCellArtifactSource(identity.source)).toEqual({
      ...identity,
      cellId: "district-1-surface-cell-03-12",
    });
    expect(canonicalStreamingCellId("district-1-surface", [3, 12])).toBe(identity.cellId);
  });

  it("rejects noncanonical source tokens and coordinates", () => {
    expect(() =>
      parseStreamingCellArtifactSource(
        `immutable/district-1-surface-cell-3-12-${"a".repeat(64)}.json`,
      ),
    ).toThrow(/invalid/);
    expect(() =>
      canonicalStreamingCellArtifactIdentity("district-1-surface", [-1, 0], "a".repeat(64)),
    ).toThrow(/non-negative/);
  });

  it("owns the canonical install resource identity for district indexes", () => {
    expect(canonicalStreamingDistrictIndexResourceId(" District.One__A ")).toBe(
      "game-specific-district-index-district-one-a",
    );
    expect(() => canonicalStreamingDistrictIndexResourceId("._-")).toThrow(/artifact scope/);
  });

  it("keeps generator and build-facing IDs equal for a district alias and parser round-trip", () => {
    const sha256 = "b".repeat(64);
    const districtAlias = " District.One__A ";
    const identity = canonicalStreamingCellArtifactIdentity(districtAlias, [1, 2], sha256);

    expect(identity.cellId).toBe("district-one-a-cell-01-02");
    expect(canonicalStreamingCellId(districtAlias, [1, 2])).toBe(identity.cellId);
    expect(canonicalStreamingCellId("district-one-a", [1, 2])).toBe(identity.cellId);
    expect(parseStreamingCellArtifactSource(identity.source)).toEqual(identity);
  });
});
