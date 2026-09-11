import type { SpatialAudioService } from "./spatial-audio-contract";

/** Capture activation before UI handlers consume the gesture; hide/page-exit stops voices. */
export function bindSpatialAudioLifecycle(
  audio: SpatialAudioService,
  documentTarget: Document = document,
  windowTarget: Window = window,
): () => void {
  const visibility = (): void => audio.setEnabled(!documentTarget.hidden);
  const activate = (event: Event): void => {
    if (!event.isTrusted || documentTarget.hidden) return;
    const state = audio.snapshot().state;
    if (state === "failed" || state === "disposed") return;
    try {
      audio.activate();
    } catch (error: unknown) {
      console.error("Audio activation failed", error);
    }
  };
  const onVisibility = (): void => {
    const state = audio.snapshot().state;
    if (state !== "disposed" && state !== "failed") visibility();
  };
  const onPageHide = (): void => {
    audio.reset();
  };
  documentTarget.addEventListener("pointerdown", activate, true);
  documentTarget.addEventListener("keydown", activate, true);
  documentTarget.addEventListener("visibilitychange", onVisibility);
  windowTarget.addEventListener("pagehide", onPageHide);
  visibility();
  return () => {
    documentTarget.removeEventListener("pointerdown", activate, true);
    documentTarget.removeEventListener("keydown", activate, true);
    documentTarget.removeEventListener("visibilitychange", onVisibility);
    windowTarget.removeEventListener("pagehide", onPageHide);
  };
}
