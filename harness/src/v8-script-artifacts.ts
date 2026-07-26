import type { BuildManifest, ManifestArtifact } from "./build-manifest.js";

export function selectV8ScriptManifestArtifacts(
  manifest: BuildManifest,
): readonly ManifestArtifact[] {
  // D-058/D-085/D-095: the isolated lifecycle page neither triggers streaming
  // traversal (and therefore decode workers) nor waits for the Rust/WASM spike.
  // Decode and wasm-thread entrypoints are consequently outside its stable
  // capture topology. Requiring compilation events for artifacts that the scenario
  // never loads, or may load only after capture, makes the diagnostic invalid by
  // construction.
  const inactiveDiagnosticWorkers = new Set(
    manifest.workerEntrypoints
      .filter((entrypoint) => entrypoint.role === "decode" || entrypoint.role === "wasm-thread")
      .map((entrypoint) => entrypoint.path),
  );
  return Object.freeze(
    manifest.artifacts.filter(
      (artifact) =>
        artifact.path.startsWith("immutable/") &&
        artifact.path.endsWith(".js") &&
        !inactiveDiagnosticWorkers.has(artifact.path),
    ),
  );
}
