export function compareUnicodeScalarStrings(left: string, right: string): number {
  const leftScalars = left[Symbol.iterator]();
  const rightScalars = right[Symbol.iterator]();
  while (true) {
    const leftNext = leftScalars.next();
    const rightNext = rightScalars.next();
    if (leftNext.done || rightNext.done) {
      return leftNext.done === rightNext.done ? 0 : leftNext.done ? -1 : 1;
    }
    const leftScalar = unicodeScalarValue(leftNext.value);
    const rightScalar = unicodeScalarValue(rightNext.value);
    if (leftScalar !== rightScalar) return leftScalar < rightScalar ? -1 : 1;
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    for (const [key] of entries) assertUnicodeScalarString(key);
    return `{${entries
      .sort(([left], [right]) => compareUnicodeScalarStrings(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  if (typeof value === "string") assertUnicodeScalarString(value);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Canonical JSON contains an unsupported value");
  return serialized;
}

export function historicalCaseFoldedCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(historicalCaseFoldedCanonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    for (const [key] of entries) assertUnicodeScalarString(key);
    return `{${entries
      .sort(([left], [right]) => {
        const folded = compareUnicodeScalarStrings(left.toLowerCase(), right.toLowerCase());
        return folded === 0 ? compareUnicodeScalarStrings(left, right) : folded;
      })
      .map(([key, entry]) => `${JSON.stringify(key)}:${historicalCaseFoldedCanonicalJson(entry)}`)
      .join(",")}}`;
  }
  if (typeof value === "string") assertUnicodeScalarString(value);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Canonical JSON contains an unsupported value");
  return serialized;
}

function unicodeScalarValue(character: string): number {
  const value = character.codePointAt(0);
  if (value === undefined || (value >= 0xd800 && value <= 0xdfff)) {
    throw new Error("Canonical ordering encountered a non-scalar Unicode string");
  }
  return value;
}

function assertUnicodeScalarString(value: string): void {
  for (const character of value) unicodeScalarValue(character);
}
