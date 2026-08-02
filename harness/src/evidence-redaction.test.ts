import { describe, expect, it } from "vitest";
import {
  containsSensitiveEvidenceText,
  isSanitizedEvidenceText,
  sanitizeEvidenceText,
} from "./evidence-redaction.js";

const options = { fallback: "unknown", maximumLength: 320 } as const;

describe("shared evidence redaction", () => {
  it("is idempotent at every whitespace truncation boundary", () => {
    for (let maximumLength = 1; maximumLength <= 512; maximumLength += 1) {
      const boundedOptions = { fallback: "unknown", maximumLength };
      const raw = `${"x".repeat(Math.max(0, maximumLength - 1))} ${"y".repeat(520)}`;
      const sanitized = sanitizeEvidenceText(raw, boundedOptions);
      expect(sanitized.length).toBeLessThanOrEqual(maximumLength);
      expect(sanitizeEvidenceText(sanitized, boundedOptions)).toBe(sanitized);
      expect(isSanitizedEvidenceText(sanitized, boundedOptions)).toBe(true);
    }
  });

  it.each([
    "file:///D:/src/parallax/private.txt",
    "D:/src/parallax/private.txt",
    String.raw`C:\Users\Jane Doe\AppData\private.txt`,
    String.raw`d:\src\parallax\private.txt`,
    String.raw`\\corp-server\private share\secret.txt`,
    "/home/operator/private.txt",
    '{"token":"s3cr3t"}',
  ])("redacts and independently rejects sensitive input %s", (raw) => {
    expect(containsSensitiveEvidenceText(raw)).toBe(true);
    const sanitized = sanitizeEvidenceText(raw, options);
    expect(sanitized).not.toMatch(/D:|Jane Doe|s3cr3t|corp-server|operator|private\.txt/iu);
    expect(containsSensitiveEvidenceText(sanitized)).toBe(false);
    expect(isSanitizedEvidenceText(sanitized, options)).toBe(true);
  });
});
