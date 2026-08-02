import { describe, expect, it } from "vitest";
import {
  canonicalInstallStoreRecord,
  formatInstallStoreOrdinal,
  type InstallStoreRecord,
  isStrongEtag,
  parseJsonRecord,
  parsePartialCheckpointRecord,
  parseReleaseCommitRecord,
  parseReleasePublishedRecord,
  parseReleaseRepairEligibilityRecord,
  parseVerifiedObjectRecord,
  STRONG_ETAG_MAX_QDTEXT_CHARS,
  serializeInstallStoreRecord,
} from "../src/storage/opfs-release-store-contract";

const DIGEST = "a".repeat(64);

describe("OPFS release-store v1 records", () => {
  it("round-trips canonical newline-terminated records", () => {
    const record = {
      bytes: 7,
      schemaVersion: 1,
      scope: "common",
      sha256: DIGEST,
    } as const;
    const bytes = serializeInstallStoreRecord(record);
    expect(new TextDecoder().decode(bytes)).toBe(
      `{"bytes":7,"schemaVersion":1,"scope":"common","sha256":"${DIGEST}"}\n`,
    );
    expect(parseJsonRecord(bytes, parseVerifiedObjectRecord)).toEqual(record);
  });

  it("orders canonical record keys by codepoint without locale dependence", () => {
    const bmp = "\ue000";
    const astral = "\u{10000}";
    const adversarial = { [astral]: 1, [bmp]: 2 } as unknown as InstallStoreRecord;
    expect(canonicalInstallStoreRecord(adversarial)).toBe(
      JSON.stringify({ [bmp]: 2, [astral]: 1 }),
    );
  });

  it.each([
    ["lone high", "\ud800"],
    ["lone low", "\udc00"],
  ])("rejects %s surrogate keys before durable record canonicalization", (_label, invalid) => {
    expect(() =>
      canonicalInstallStoreRecord({ [invalid]: 1 } as unknown as InstallStoreRecord),
    ).toThrow(/lone.*surrogate/u);
    expect(() =>
      canonicalInstallStoreRecord({
        bytes: 1,
        schemaVersion: 1,
        scope: "common",
        sha256: invalid,
      }),
    ).toThrow(/lone.*surrogate/u);
  });

  it("rejects extra keys, unsafe integers, uppercase digests, and torn JSON", () => {
    expect(() =>
      parseVerifiedObjectRecord({
        bytes: 1,
        extra: true,
        schemaVersion: 1,
        scope: "common",
        sha256: DIGEST,
      }),
    ).toThrow("unsupported or missing");
    expect(() =>
      parsePartialCheckpointRecord({
        bytesCommitted: Number.MAX_SAFE_INTEGER,
        expectedBytes: 1,
        expectedSha256: DIGEST,
        releaseDigest: DIGEST,
        resourceId: "resource",
        schemaVersion: 2,
        source: "resource.bin",
        strongEtag: '"etag"',
      }),
    ).toThrow("Invalid partial-checkpoint");
    expect(() =>
      parseReleaseCommitRecord({
        ordinal: 1,
        releaseDigest: DIGEST.toUpperCase(),
        schemaVersion: 1,
      }),
    ).toThrow("Invalid release-commit");
    expect(() =>
      parseJsonRecord(new TextEncoder().encode('{"ordinal":1}'), parseReleaseCommitRecord),
    ).toThrow("newline");
  });

  it("accepts only checkpoint-v2 records bound to a strong ETag", () => {
    const checkpoint = {
      bytesCommitted: 1,
      expectedBytes: 2,
      expectedSha256: DIGEST,
      releaseDigest: DIGEST,
      resourceId: "resource",
      schemaVersion: 2,
      source: "resource.bin",
      strongEtag: '"immutable"',
    } as const;
    expect(parsePartialCheckpointRecord(checkpoint)).toEqual(checkpoint);
    expect(() => parsePartialCheckpointRecord({ ...checkpoint, schemaVersion: 1 })).toThrow(
      "partial-checkpoint@2",
    );
    expect(() => parsePartialCheckpointRecord({ ...checkpoint, strongEtag: 'W/"weak"' })).toThrow(
      "partial-checkpoint@2",
    );
    expect(() => parsePartialCheckpointRecord({ ...checkpoint, strongEtag: "unquoted" })).toThrow(
      "partial-checkpoint@2",
    );
  });

  it("accepts exactly 1..1024 ASCII qdtext characters in a strong ETag", () => {
    expect(isStrongEtag('"a"')).toBe(true);
    expect(isStrongEtag(`"${"a".repeat(STRONG_ETAG_MAX_QDTEXT_CHARS)}"`)).toBe(true);
    expect(isStrongEtag('" \t!#[]~"')).toBe(true);

    for (const invalid of [
      '""',
      `W/"a"`,
      "unquoted",
      '"unterminated',
      `"${"a".repeat(STRONG_ETAG_MAX_QDTEXT_CHARS + 1)}"`,
      '"\\\\"',
      '"\u0080"',
    ]) {
      expect(isStrongEtag(invalid)).toBe(false);
    }
  });

  it("formats the exact unique commit namespace and fails closed on overflow", () => {
    expect(formatInstallStoreOrdinal(42)).toBe("00000000000000000042");
    expect(() => formatInstallStoreOrdinal(0)).toThrow("Invalid commit ordinal");
    expect(() => formatInstallStoreOrdinal(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      "Invalid commit ordinal",
    );
  });

  it("binds the published marker to one exact release digest", () => {
    const published = { releaseDigest: DIGEST, schemaVersion: 1 } as const;
    expect(parseReleasePublishedRecord(published)).toEqual({
      releaseDigest: DIGEST,
      schemaVersion: 1,
    });
    expect(
      parseJsonRecord(serializeInstallStoreRecord(published), parseReleasePublishedRecord),
    ).toEqual(published);
    expect(() =>
      parseReleasePublishedRecord({
        releaseDigest: DIGEST,
        schemaVersion: 1,
        state: "published",
      }),
    ).toThrow("unsupported or missing");
  });

  it("binds repair eligibility v2 to the exact pre-revocation marker bytes", () => {
    const record = {
      bytes: 7,
      commitOrdinal: 1,
      commitRecordSha256: "b".repeat(64),
      observedBytes: 7,
      observedSha256: "c".repeat(64),
      publishedRecordSha256: "d".repeat(64),
      readyRecordSha256: "e".repeat(64),
      releaseDigest: DIGEST,
      resourceId: "resource",
      schemaVersion: 2,
      scope: "common",
      sha256: "f".repeat(64),
      verifiedRecordSha256: "1".repeat(64),
    } as const;
    expect(parseReleaseRepairEligibilityRecord(record)).toEqual(record);
    expect(() => parseReleaseRepairEligibilityRecord({ ...record, schemaVersion: 1 })).toThrow(
      "release-repair-eligibility@2",
    );
    expect(() =>
      parseReleaseRepairEligibilityRecord({
        ...record,
        verifiedRecordSha256: undefined,
      }),
    ).toThrow();
  });
});
