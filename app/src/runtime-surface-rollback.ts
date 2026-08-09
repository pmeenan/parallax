export const RUNTIME_SURFACE_IDS = Object.freeze([
  "render-canvas",
  "runtime-status",
  "app-owned-llm-spike",
  "streaming-dashboard",
  "benchmark-mode",
  "game-ui",
] as const);

export function captureRuntimeSurfaceRollback(documentTarget: Document): () => void {
  const snapshots = RUNTIME_SURFACE_IDS.flatMap((id) => {
    const element = documentTarget.querySelector(`#${id}`);
    if (!(element instanceof HTMLElement)) return [];
    return [Object.freeze({ id, pristine: element.cloneNode(true) as HTMLElement })];
  });
  return (): void => {
    for (const snapshot of snapshots) {
      const current = documentTarget.querySelector(`#${snapshot.id}`);
      if (!(current instanceof HTMLElement)) continue;
      current.replaceWith(snapshot.pristine.cloneNode(true));
    }
  };
}
