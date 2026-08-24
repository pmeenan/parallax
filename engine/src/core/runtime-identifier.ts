const RUNTIME_IDENTIFIER = /^[a-z0-9](?:[a-z0-9._:@-]{0,127})$/u;

export function isRuntimeIdentifier(value: unknown): value is string {
  return typeof value === "string" && RUNTIME_IDENTIFIER.test(value);
}
