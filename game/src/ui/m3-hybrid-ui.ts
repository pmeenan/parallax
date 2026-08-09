import type {
  HybridUiDialogView,
  HybridUiDomLabels,
  HybridUiPresentation,
  SimulationWorldDefinition,
} from "@parallax/engine";

export interface M3HybridUiModel {
  closeDialog(): HybridUiPresentation;
  recordInteraction(markerId: string): HybridUiPresentation;
  showDialog(dialog: HybridUiDialogView): HybridUiPresentation;
  snapshot(): HybridUiPresentation;
}

const CONTROL_MESSAGE = "WASD to move · mouse to look · E to interact";

export const M3_HYBRID_UI_DOM_LABELS = Object.freeze({
  conversation: "Conversation",
  playerStatus: "Player status",
  screenControls: "Screen controls",
  submit: "Submit",
}) satisfies HybridUiDomLabels;

export function createM3HybridUiModel(world: SimulationWorldDefinition): M3HybridUiModel {
  let revision = 0;
  let lastInteraction: string | null = null;
  let dialog: HybridUiDialogView = hiddenDialog();

  const snapshot = (): HybridUiPresentation =>
    Object.freeze({
      dialog,
      heavyScreen: null,
      hud: Object.freeze({
        meters: Object.freeze([]),
        messages: Object.freeze(
          lastInteraction === null
            ? [CONTROL_MESSAGE]
            : [CONTROL_MESSAGE, `Activated ${lastInteraction}`],
        ),
        visible: true,
      }),
      revision,
      worldAnchors: Object.freeze(
        world.markers
          .filter((marker) => marker.kind === "transition")
          .map((marker) =>
            Object.freeze({
              id: `transition-anchor:${marker.id}`,
              position: Object.freeze([
                marker.position[0],
                marker.position[1] + 2.25,
                marker.position[2],
              ] as const),
              sizeMeters: Object.freeze([0.45, 0.45] as const),
              tone: "accent" as const,
              visible: true,
            }),
          ),
      ),
    });

  return Object.freeze({
    closeDialog(): HybridUiPresentation {
      dialog = hiddenDialog();
      revision += 1;
      return snapshot();
    },
    recordInteraction(markerId: string): HybridUiPresentation {
      lastInteraction = markerId;
      revision += 1;
      return snapshot();
    },
    showDialog(next: HybridUiDialogView): HybridUiPresentation {
      dialog = Object.freeze({
        ...next,
        choices: Object.freeze(next.choices.map((choice) => Object.freeze({ ...choice }))),
        textEntry: next.textEntry === null ? null : Object.freeze({ ...next.textEntry }),
      });
      revision += 1;
      return snapshot();
    },
    snapshot,
  });
}

function hiddenDialog(): HybridUiDialogView {
  return Object.freeze({
    body: "No active conversation.",
    choices: Object.freeze([]),
    speaker: "Conversation",
    textEntry: null,
    visible: false,
  });
}
