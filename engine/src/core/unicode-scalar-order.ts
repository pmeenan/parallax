/** Orders strings lexicographically by Unicode scalar value, not UTF-16 code units or locale. */
export function compareUnicodeScalars(left: string, right: string): number {
  assertUnicodeScalarString(left);
  assertUnicodeScalarString(right);
  let leftOffset = 0;
  let rightOffset = 0;
  while (leftOffset < left.length && rightOffset < right.length) {
    const leftScalar = left.codePointAt(leftOffset);
    const rightScalar = right.codePointAt(rightOffset);
    if (leftScalar === undefined || rightScalar === undefined) {
      throw new Error("Unicode scalar comparison reached an invalid string offset");
    }
    if (leftScalar !== rightScalar) return leftScalar < rightScalar ? -1 : 1;
    leftOffset += leftScalar > 0xffff ? 2 : 1;
    rightOffset += rightScalar > 0xffff ? 2 : 1;
  }
  return leftOffset < left.length ? 1 : rightOffset < right.length ? -1 : 0;
}

/** Rejects lone UTF-16 surrogates so callers cannot canonicalize non-scalar strings. */
export function assertUnicodeScalarString(value: string): void {
  let offset = 0;
  while (offset < value.length) {
    const codeUnit = value.charCodeAt(offset);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(offset + 1);
      if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) {
        throw new Error("Unicode scalar text contains a lone high surrogate");
      }
      offset += 2;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Error("Unicode scalar text contains a lone low surrogate");
    }
    offset += 1;
  }
}
