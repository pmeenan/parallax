import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  compareUnicodeScalarStrings,
  historicalCaseFoldedCanonicalJson,
} from "./canonical-json.js";

describe("harness canonical JSON", () => {
  it("orders object keys by Unicode scalar value independently of insertion order", () => {
    const privateUse = "\ue000";
    const astral = "😀";
    const first = { [astral]: 2, [privateUse]: 1, z: 0 };
    const second = { z: 0, [privateUse]: 1, [astral]: 2 };

    expect(compareUnicodeScalarStrings(privateUse, astral)).toBeLessThan(0);
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(canonicalJson(first)).toBe(`{"z":0,"${privateUse}":1,"${astral}":2}`);
  });

  it("rejects non-scalar surrogate keys instead of assigning platform-dependent order", () => {
    expect(() => canonicalJson({ "\ud800": true })).toThrow(/non-scalar Unicode/u);
  });

  it.each(["\ud800", "\udfff"])("rejects non-scalar string values recursively: %j", (nonScalar) => {
    expect(() => canonicalJson(nonScalar)).toThrow(/non-scalar Unicode/u);
    expect(() => canonicalJson(["valid", [nonScalar]])).toThrow(/non-scalar Unicode/u);
    expect(() => canonicalJson({ only: nonScalar })).toThrow(/non-scalar Unicode/u);
    expect(() => historicalCaseFoldedCanonicalJson({ nested: [nonScalar] })).toThrow(
      /non-scalar Unicode/u,
    );
  });

  it("accepts well-formed astral string values at every nesting position", () => {
    expect(canonicalJson(["😀", { only: "����" }])).toBe('["😀",{"only":"����"}]');
  });

  it("reproduces historical camel-case ordering without locale or ICU state", () => {
    expect(historicalCaseFoldedCanonicalJson({ installStore: 1, installerTransfer: 2 })).toBe(
      '{"installerTransfer":2,"installStore":1}',
    );
  });
});
