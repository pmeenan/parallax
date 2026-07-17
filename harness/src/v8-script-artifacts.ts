import type { BuildManifest, ManifestArtifact } from "./build-manifest.js";

export function selectV8ScriptManifestArtifacts(
  manifest: BuildManifest,
): readonly ManifestArtifact[] {
  // D-058/P-007: the storage and AI workers are explicit-spike entrypoints and are
  // intentionally absent from ordinary smoke's isolated V8 lifecycle diagnostic.
  // Requiring a compilation event for artifacts that this scenario never loads makes
  // the diagnostic invalid by construction.
  const inactiveDiagnosticWorkers = new Set(
    manifest.workerEntrypoints
      .filter((entrypoint) => entrypoint.role === "ai" || entrypoint.role === "storage")
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
