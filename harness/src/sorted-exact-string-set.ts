export function isSortedUniqueExactStringSet(
  value: readonly unknown[],
  expectedCount: number,
): value is readonly string[] {
  return (
    value.length === expectedCount &&
    value.every((entry) => typeof entry === "string" && entry.length > 0) &&
    new Set(value).size === expectedCount &&
    JSON.stringify(value) === JSON.stringify([...value].sort())
  );
}
