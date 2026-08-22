import type {
  HybridUiDialogView,
  HybridUiDomLabels,
  HybridUiPresentation,
  HybridUiTone,
  SimulationWorldDefinition,
} from "@parallax/engine";
import { IRONSET_STANCE } from "../balance/combat";

export type M3GameplayScreenId = "inventory" | "journal" | "progression";

export interface M3GameplayScreenAction {
  readonly actionId: string;
  readonly disabled: boolean;
  readonly label: string;
  readonly tone?: HybridUiTone;
}

export interface M3GameplayScreenView {
  readonly actions: readonly M3GameplayScreenAction[];
  readonly id: M3GameplayScreenId;
  readonly lines: readonly string[];
}

export interface M3HudStatus {
  readonly aether: number;
  readonly experienceForNextLevel: number;
  readonly experienceIntoLevel: number;
  readonly health: number;
  readonly ironsetTicks: number;
  readonly level: number;
  readonly levelCap: number;
  readonly maxAether: number;
  readonly maxHealth: number;
  readonly maxStamina: number;
  readonly stamina: number;
  readonly unspentAbilityPicks: number;
  readonly unspentAttributePoints: number;
}

export interface M3HybridUiModel {
  closeDialog(): HybridUiPresentation;
  closeScreen(): HybridUiPresentation;
  recordInteraction(markerId: string): HybridUiPresentation;
  recordSemanticMessage(message: string): HybridUiPresentation;
  showDialog(dialog: HybridUiDialogView): HybridUiPresentation;
  showScreen(screen: M3GameplayScreenView): HybridUiPresentation;
  snapshot(): HybridUiPresentation;
  updateHud(status: M3HudStatus): HybridUiPresentation | null;
}

const CONTROL_MESSAGE =
  "WASD move · mouse look · E interact · I inventory/craft · P progression · J journal";
const IRONSET_MESSAGE =
  `IRONSET PLANTED · +${IRONSET_STANCE.guardBonus} guard · stagger immune · ` +
  `×${IRONSET_STANCE.movementNumerator}/${IRONSET_STANCE.movementDenominator} movement`;
const MAXIMUM_SCREEN_ACTIONS = 15;
const MAXIMUM_SCREEN_LINES = 20;

export const M3_HYBRID_UI_DOM_LABELS = Object.freeze({
  conversation: "Conversation",
  playerStatus: "Player status",
  screenControls: "Screen controls",
  submit: "Submit",
}) satisfies HybridUiDomLabels;

export function createM3HybridUiModel(world: SimulationWorldDefinition): M3HybridUiModel {
  let revision = 0;
  let lastInteraction: string | null = null;
  let semanticMessage: string | null = null;
  let dialog: HybridUiDialogView = hiddenDialog();
  let screen: M3GameplayScreenView | null = null;
  let hudStatus: M3HudStatus | null = null;

  const snapshot = (): HybridUiPresentation =>
    Object.freeze({
      dialog,
      heavyScreen: screen === null ? null : buildHeavyScreen(screen),
      hud: Object.freeze({
        meters: hudMeters(hudStatus),
        messages: hudMessages(hudStatus, screen, lastInteraction, semanticMessage),
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
    closeScreen(): HybridUiPresentation {
      screen = null;
      revision += 1;
      return snapshot();
    },
    recordInteraction(markerId: string): HybridUiPresentation {
      lastInteraction = markerId;
      revision += 1;
      return snapshot();
    },
    recordSemanticMessage(message: string): HybridUiPresentation {
      semanticMessage = message;
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
    showScreen(next: M3GameplayScreenView): HybridUiPresentation {
      if (next.actions.length > MAXIMUM_SCREEN_ACTIONS) {
        throw new Error("Gameplay screen action capacity exceeded");
      }
      screen = Object.freeze({
        actions: Object.freeze(next.actions.map((action) => Object.freeze({ ...action }))),
        id: next.id,
        lines: Object.freeze(next.lines.slice(0, MAXIMUM_SCREEN_LINES)),
      });
      revision += 1;
      return snapshot();
    },
    snapshot,
    updateHud(next: M3HudStatus): HybridUiPresentation | null {
      if (hudStatus !== null && sameHudStatus(hudStatus, next)) return null;
      hudStatus = Object.freeze({ ...next });
      revision += 1;
      return snapshot();
    },
  });
}

function buildHeavyScreen(
  screen: M3GameplayScreenView,
): NonNullable<HybridUiPresentation["heavyScreen"]> {
  const rowHeight = Math.min(0.055, 0.66 / Math.max(1, screen.actions.length));
  const rowGap = 0.012;
  const primitives = [
    Object.freeze({
      actionId: null,
      disabled: false,
      id: `${screen.id}:backdrop`,
      layer: 0,
      rect: Object.freeze({ height: 0.84, width: 0.78, x: 0.11, y: 0.08 }),
      tone: "neutral" as const,
    }),
    ...screen.actions.map((action, index) =>
      Object.freeze({
        actionId: action.actionId,
        disabled: action.disabled,
        id: `${screen.id}:action:${index}`,
        layer: index + 1,
        rect: Object.freeze({
          height: rowHeight,
          width: 0.28,
          x: 0.59,
          y: 0.12 + index * (rowHeight + rowGap),
        }),
        tone: action.tone ?? (action.disabled ? "disabled" : "accent"),
      }),
    ),
  ];
  const firstEnabled = screen.actions.find((action) => !action.disabled)?.actionId ?? null;
  return Object.freeze({
    cancelActionId: "screen:close",
    focusActionId: firstEnabled,
    id: screen.id,
    primitives: Object.freeze(primitives),
    semanticActions: Object.freeze(
      screen.actions.map((action) =>
        Object.freeze({
          actionId: action.actionId,
          disabled: action.disabled,
          label: action.label,
        }),
      ),
    ),
    textEntry: null,
    visible: true,
  });
}

function hudMeters(status: M3HudStatus | null): HybridUiPresentation["hud"]["meters"] {
  if (status === null) return Object.freeze([]);
  const meters = [
    meter("health", "Health", status.health, status.maxHealth),
    meter("stamina", "Stamina", status.stamina, status.maxStamina),
    meter("aether", "Aether", status.aether, Math.max(1, status.maxAether)),
    meter(
      "experience",
      `Level ${status.level} XP`,
      status.level === status.levelCap ? 1 : status.experienceIntoLevel,
      status.level === status.levelCap ? 1 : Math.max(1, status.experienceForNextLevel),
    ),
  ];
  if (status.ironsetTicks > 0) {
    meters.push(meter("ironset", "Ironset", status.ironsetTicks, IRONSET_STANCE.durationTicks));
  }
  return Object.freeze(meters);
}

function meter(id: string, label: string, value: number, maximum: number) {
  return Object.freeze({ id, label, maximum, value: Math.max(0, Math.min(maximum, value)) });
}

function hudMessages(
  status: M3HudStatus | null,
  screen: M3GameplayScreenView | null,
  lastInteraction: string | null,
  semanticMessage: string | null,
): readonly string[] {
  const messages = [CONTROL_MESSAGE];
  if (status !== null && (status.unspentAttributePoints > 0 || status.unspentAbilityPicks > 0)) {
    messages.push(
      `UNSPENT · ${status.unspentAttributePoints} attribute · ${status.unspentAbilityPicks} ability`,
    );
  }
  if (status?.ironsetTicks !== undefined && status.ironsetTicks > 0) {
    messages.push(IRONSET_MESSAGE);
  }
  if (lastInteraction !== null) messages.push(`Activated ${lastInteraction}`);
  if (semanticMessage !== null) messages.push(semanticMessage);
  if (screen !== null) messages.push(...screen.lines);
  return Object.freeze(messages.slice(0, 32));
}

function sameHudStatus(left: M3HudStatus, right: M3HudStatus): boolean {
  return (Object.keys(left) as (keyof M3HudStatus)[]).every((key) => left[key] === right[key]);
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
