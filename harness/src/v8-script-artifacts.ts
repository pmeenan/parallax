import type { BuildManifest, ManifestArtifact } from "./build-manifest.js";

export function selectV8ScriptManifestArtifacts(
  manifest: BuildManifest,
): readonly ManifestArtifact[] {
  // D-058: the storage worker is a core-run-only microbenchmark entrypoint and is
  // intentionally absent from the isolated V8 lifecycle diagnostic. Requiring a
  // compilation event for an artifact that this scenario never loads makes the
  // diagnostic invalid by construction.
  const inactiveDiagnosticWorkers = new Set(
    manifest.workerEntrypoints
      .filter((entrypoint) => entrypoint.role === "storage")
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
