import { describe, expect, it } from "vitest";
import {
  isSanitizedAssetUpdateDiagnostic,
  isSanitizedAssetUpdateErrorName,
  sanitizeAssetUpdateDiagnostic,
} from "./asset-update-v8-sanitization.js";

describe("asset-update V8 diagnostic sanitization", () => {
  it("redacts credentials, URL authority/query data, local paths, and controls idempotently", () => {
    const hostile =
      "\u0000 Authorization: Bearer abc.def.ghi api_key=private-value " +
      String.raw`\\corp-server\private-share\operator ` +
      "https://alice:pw@example.test/update?q=secret path=/home/operator/private " +
      "file:///Users/operator/private";
    const sanitized = sanitizeAssetUpdateDiagnostic(hostile);

    expect(sanitized).not.toMatch(
      /abc\.def\.ghi|private-value|corp-server|private-share|operator|alice|pw|q=secret/u,
    );
    expect(sanitized).not.toContain("\u0000");
    expect(sanitized).toContain("Authorization=<redacted>");
    expect(sanitized).toContain("api_key=<redacted>");
    expect(sanitized).toContain("<local-path>");
    expect(sanitized).toContain("https://example.test/update?<redacted-query>");
    expect(sanitizeAssetUpdateDiagnostic(sanitized)).toBe(sanitized);
    expect(isSanitizedAssetUpdateDiagnostic(hostile)).toBe(false);
    expect(isSanitizedAssetUpdateDiagnostic(sanitized)).toBe(true);
  });

  it("rejects credential-bearing error names", () => {
    expect(isSanitizedAssetUpdateErrorName("ApiKeyError")).toBe(false);
    expect(isSanitizedAssetUpdateErrorName("SessionError")).toBe(false);
    expect(isSanitizedAssetUpdateErrorName("ProtocolError")).toBe(true);
  });

  it("re-bounds a diagnostic after a prefix is composed around a maximum-length reason", () => {
    const sourceReason = "x".repeat(400);
    expect(isSanitizedAssetUpdateDiagnostic(sourceReason)).toBe(true);

    const composed = sanitizeAssetUpdateDiagnostic(`V8 trace is invalid: ${sourceReason}`);
    expect(composed).toHaveLength(400);
    expect(isSanitizedAssetUpdateDiagnostic(composed)).toBe(true);
    expect(sanitizeAssetUpdateDiagnostic(composed)).toBe(composed);
  });

  it("redacts quoted credentials and local paths containing spaces", () => {
    const sanitized = sanitizeAssetUpdateDiagnostic(
      String.raw`{"token":"s3cr3t"} C:\Users\Jane Doe\AppData\private.txt`,
    );
    expect(sanitized).not.toMatch(/s3cr3t|Jane Doe|AppData|private\.txt/u);
    expect(isSanitizedAssetUpdateDiagnostic(sanitized)).toBe(true);
  });
});
