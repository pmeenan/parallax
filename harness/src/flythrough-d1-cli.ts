export function requireNoFlythroughD1Arguments(arguments_: readonly string[]): void {
  if (arguments_.length === 0) return;
  throw new Error(
    `flythrough-d1 accepts no command-line arguments; received ${arguments_
      .map((argument) => JSON.stringify(argument))
      .join(", ")}`,
  );
}
