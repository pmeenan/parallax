export function parseServerPort(value: string | undefined): number {
  const candidate = value === undefined || value === "" ? "4173" : value;
  if (!/^\d+$/.test(candidate)) {
    throw new Error(`PORT must be an integer from 1 to 65535; received ${JSON.stringify(value)}`);
  }

  const port = Number.parseInt(candidate, 10);
  if (port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer from 1 to 65535; received ${JSON.stringify(value)}`);
  }
  return port;
}
