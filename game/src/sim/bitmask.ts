const UINT32_BIT_COUNT = 32;

export function lowBitsMask(count: number): number {
  if (!Number.isSafeInteger(count) || count < 0 || count > UINT32_BIT_COUNT) {
    throw new Error("Uint32 bit-mask count is invalid");
  }
  return count === UINT32_BIT_COUNT ? 0xffff_ffff : (2 ** count - 1) >>> 0;
}

export function countSetBits(value: number): number {
  let remaining = value >>> 0;
  let count = 0;
  while (remaining !== 0) {
    remaining &= remaining - 1;
    count += 1;
  }
  return count;
}
