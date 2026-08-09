import type { GameplayInputService } from "../input/gameplay-input-service";
import type { RenderService } from "../render/render-service";
import {
  freezeHybridUiPresentation,
  HYBRID_UI_TELEMETRY_SCHEMA_VERSION,
  type HybridUiAction,
  type HybridUiDialogChoice,
  type HybridUiPresentation,
  type HybridUiTelemetrySnapshot,
  type HybridUiWorkerInput,
  idleHybridUiWorkerTelemetry,
} from "./hybrid-ui-contract";

export type HybridUiListener = (snapshot: HybridUiTelemetrySnapshot) => void;
export type HybridUiActionListener = (action: HybridUiAction) => void;

export interface HybridUiService {
  dispose(): void;
  present(presentation: HybridUiPresentation): void;
  snapshot(): HybridUiTelemetrySnapshot;
  subscribe(listener: HybridUiListener): () => void;
  subscribeActions(listener: HybridUiActionListener): () => void;
}

export interface HybridUiDomLabels {
  readonly conversation: string;
  readonly playerStatus: string;
  readonly screenControls: string;
  readonly submit: string;
}

interface MeterElements {
  readonly label: HTMLSpanElement;
  readonly progress: HTMLProgressElement;
  readonly root: HTMLDivElement;
}

interface ChoiceElements {
  readonly button: HTMLButtonElement;
  readonly root: HTMLLIElement;
}

interface SemanticActionElements {
  readonly button: HTMLButtonElement;
}

interface TextEntryElements {
  readonly button: HTMLButtonElement;
  readonly form: HTMLFormElement;
  gameValue: string;
  readonly input: HTMLInputElement;
  readonly label: HTMLLabelElement;
  readonly submitActionId: string;
  dirty: boolean;
}

type HybridUiUnsequencedInput =
  | Readonly<{ readonly kind: "activate" | "cancel" | "focus-next" | "focus-previous" }>
  | Readonly<{ readonly actionId: string; readonly kind: "semantic-activate" }>
  | Readonly<{ readonly kind: "pointer-activate"; readonly x: number; readonly y: number }>;

export function createHybridUiService(
  root: HTMLElement,
  initialCanvas: HTMLCanvasElement,
  renderService: RenderService,
  gameplayInputService: GameplayInputService,
  labels: HybridUiDomLabels,
): HybridUiService {
  validateLabels(labels);
  const dom = createDom(root, labels);
  const meters = new Map<string, MeterElements>();
  const messageElements: HTMLLIElement[] = [];
  const choices = new Map<string, ChoiceElements>();
  const semanticActions = new Map<string, SemanticActionElements>();
  const actionListeners = new Set<HybridUiActionListener>();
  const listeners = new Set<HybridUiListener>();
  let activeCanvas = initialCanvas;
  let disposed = false;
  let nextInputSequence = 0;
  let presentation: HybridUiPresentation | null = null;
  let dialogEntry: TextEntryElements | null = null;
  let semanticEntry: TextEntryElements | null = null;
  let telemetry: HybridUiTelemetrySnapshot = Object.freeze({
    dialogDomActionCount: 0,
    domMutationDurationHighWaterMs: 0,
    domNodeCountHighWater: 0,
    forwardedInputCount: 0,
    imeDomActionCount: 0,
    presentationCount: 0,
    presentationRevision: null,
    schemaVersion: HYBRID_UI_TELEMETRY_SCHEMA_VERSION,
    semanticNodeCountHighWater: 0,
    state: "idle",
    worker: idleHybridUiWorkerTelemetry(),
    workerActionCount: 0,
  });

  const publish = (next: HybridUiTelemetrySnapshot): void => {
    telemetry = Object.freeze(next);
    for (const listener of listeners) {
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("Hybrid UI telemetry listener failed", error);
      }
    }
  };
  const emitAction = (action: HybridUiAction): void => {
    for (const listener of actionListeners) {
      try {
        listener(action);
      } catch (error: unknown) {
        console.error("Hybrid UI action listener failed", error);
      }
    }
  };
  const emitDomAction = (
    actionId: string,
    source: "dialog-dom" | "ime-dom",
    payload: string | null,
  ): void => {
    const current = presentation;
    if (current === null) return;
    const action = Object.freeze({
      actionId,
      inputSequence: nextInputSequence++,
      payload,
      presentationRevision: current.revision,
      source,
    });
    publish({
      ...telemetry,
      dialogDomActionCount: telemetry.dialogDomActionCount + (source === "dialog-dom" ? 1 : 0),
      imeDomActionCount: telemetry.imeDomActionCount + (source === "ime-dom" ? 1 : 0),
    });
    emitAction(action);
  };
  const forward = (input: HybridUiUnsequencedInput): void => {
    if (renderService.snapshot().state !== "ready") return;
    const sequenced = Object.freeze({
      ...input,
      sequence: nextInputSequence++,
    }) as HybridUiWorkerInput;
    renderService.sendHybridUiInput(sequenced);
    publish({ ...telemetry, forwardedInputCount: telemetry.forwardedInputCount + 1 });
  };
  const activeHeavyScreen = (): boolean => presentation?.heavyScreen?.visible === true;
  const onPointerDown = (event: PointerEvent): void => {
    if (!activeHeavyScreen()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const bounds = activeCanvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    forward({
      kind: "pointer-activate",
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    });
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!activeHeavyScreen() || event.isComposing) return;
    if (
      isDomUiTarget(root, event.target) &&
      !(event.key === "Escape" && isDomUiTarget(dom.semantic, event.target))
    ) {
      return;
    }
    const kind = keyboardInputKind(event);
    if (kind === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    forward({ kind });
  };
  const bindCanvas = (canvas: HTMLCanvasElement): void => {
    activeCanvas.removeEventListener("pointerdown", onPointerDown, true);
    activeCanvas = canvas;
    activeCanvas.addEventListener("pointerdown", onPointerDown, true);
  };
  activeCanvas.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onKeyDown, true);

  const unsubscribeCanvas = renderService.subscribeCanvas(bindCanvas);
  const unsubscribeRender = renderService.subscribe((render) => {
    if (disposed) return;
    const workerReady = render.state === "ready";
    dom.semantic.inert = !workerReady;
    dom.semantic.setAttribute("aria-disabled", String(!workerReady));
    publish({ ...telemetry, worker: render.hybridUi });
  });
  const unsubscribeWorkerActions = renderService.subscribeHybridUiActions((action) => {
    if (disposed) return;
    publish({ ...telemetry, workerActionCount: telemetry.workerActionCount + 1 });
    emitAction(action);
  });

  const renderDom = (next: HybridUiPresentation): void => {
    const restoreDialogFocus = !next.dialog.visible && dom.dialog.contains(document.activeElement);
    const restoreSemanticFocus =
      next.heavyScreen?.visible !== true && dom.semantic.contains(document.activeElement);
    dom.hud.hidden = !next.hud.visible;
    reconcileMeters(dom.meters, meters, next.hud.meters);
    reconcileMessages(dom.messages, messageElements, next.hud.messages);
    dom.dialog.hidden = !next.dialog.visible;
    dom.dialogSpeaker.textContent = next.dialog.speaker;
    dom.dialogBody.textContent = next.dialog.body;
    reconcileChoices(dom.dialogChoices, choices, next.dialog.choices, (actionId) =>
      emitDomAction(actionId, "dialog-dom", null),
    );
    dialogEntry = reconcileTextEntry(
      dom.dialogEntry,
      dialogEntry,
      next.dialog.textEntry,
      "dialog",
      labels.submit,
      (actionId, value) => emitDomAction(actionId, "ime-dom", value),
    );
    const heavyScreen = next.heavyScreen?.visible === true ? next.heavyScreen : null;
    dom.semantic.hidden = heavyScreen === null;
    reconcileSemanticActions(
      dom.semanticActions,
      semanticActions,
      heavyScreen?.semanticActions ?? [],
      (actionId) => forward({ actionId, kind: "semantic-activate" }),
    );
    semanticEntry = reconcileTextEntry(
      dom.semanticEntry,
      semanticEntry,
      heavyScreen?.textEntry ?? null,
      "heavy-screen",
      labels.submit,
      (actionId, value) => emitDomAction(actionId, "ime-dom", value),
    );
    if (restoreDialogFocus || restoreSemanticFocus) activeCanvas.focus();
  };

  return Object.freeze({
    dispose(): void {
      if (disposed) return;
      disposed = true;
      activeCanvas.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribeCanvas();
      unsubscribeRender();
      unsubscribeWorkerActions();
      if (presentationOwnsGameplayInput(presentation)) {
        gameplayInputService.setUiSuppressed(false);
      }
      actionListeners.clear();
      root.replaceChildren();
      publish({ ...telemetry, state: "disposed" });
      listeners.clear();
    },
    present(next: HybridUiPresentation): void {
      if (disposed) throw new Error("Hybrid UI service is disposed");
      const frozen = freezeHybridUiPresentation(next);
      if (presentation !== null && frozen.revision <= presentation.revision) return;
      const startedAt = performance.now();
      renderDom(frozen);
      const domMutationDurationMs = performance.now() - startedAt;
      renderService.setHybridUiPresentation(frozen);
      const wasUiOwned = presentationOwnsGameplayInput(presentation);
      const isUiOwned = presentationOwnsGameplayInput(frozen);
      if (wasUiOwned !== isUiOwned) gameplayInputService.setUiSuppressed(isUiOwned);
      presentation = frozen;
      const semanticNodeCount =
        (frozen.heavyScreen?.visible === true ? frozen.heavyScreen.semanticActions.length : 0) +
        (frozen.heavyScreen?.visible === true && frozen.heavyScreen.textEntry !== null ? 1 : 0);
      publish({
        ...telemetry,
        domMutationDurationHighWaterMs: Math.max(
          telemetry.domMutationDurationHighWaterMs,
          domMutationDurationMs,
        ),
        domNodeCountHighWater: Math.max(
          telemetry.domNodeCountHighWater,
          root.querySelectorAll("*").length,
        ),
        presentationCount: telemetry.presentationCount + 1,
        presentationRevision: frozen.revision,
        semanticNodeCountHighWater: Math.max(
          telemetry.semanticNodeCountHighWater,
          semanticNodeCount,
        ),
        state: "ready",
      });
    },
    snapshot(): HybridUiTelemetrySnapshot {
      return telemetry;
    },
    subscribe(listener: HybridUiListener): () => void {
      listeners.add(listener);
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("Hybrid UI telemetry listener failed", error);
      }
      return () => listeners.delete(listener);
    },
    subscribeActions(listener: HybridUiActionListener): () => void {
      actionListeners.add(listener);
      return () => actionListeners.delete(listener);
    },
  });
}

function presentationOwnsGameplayInput(presentation: HybridUiPresentation | null): boolean {
  return presentation?.dialog.visible === true || presentation?.heavyScreen?.visible === true;
}

function createDom(root: HTMLElement, labels: HybridUiDomLabels) {
  root.classList.add("hybrid-ui");
  const hud = document.createElement("section");
  hud.className = "hybrid-ui-hud";
  hud.setAttribute("aria-label", labels.playerStatus);
  const meters = document.createElement("div");
  meters.className = "hybrid-ui-meters";
  const messages = document.createElement("ul");
  messages.className = "hybrid-ui-messages";
  messages.setAttribute("aria-live", "polite");
  hud.append(meters, messages);

  const dialog = document.createElement("section");
  dialog.className = "hybrid-ui-dialog";
  dialog.setAttribute("aria-label", labels.conversation);
  const dialogSpeaker = document.createElement("h2");
  const dialogBody = document.createElement("p");
  const dialogChoices = document.createElement("ol");
  const dialogEntry = document.createElement("div");
  dialog.append(dialogSpeaker, dialogBody, dialogChoices, dialogEntry);

  const semantic = document.createElement("nav");
  semantic.className = "hybrid-ui-semantic-bridge";
  semantic.setAttribute("aria-label", labels.screenControls);
  const semanticActions = document.createElement("div");
  const semanticEntry = document.createElement("div");
  semantic.append(semanticActions, semanticEntry);
  root.replaceChildren(hud, dialog, semantic);
  return {
    dialog,
    dialogBody,
    dialogChoices,
    dialogEntry,
    dialogSpeaker,
    hud,
    messages,
    meters,
    semantic,
    semanticActions,
    semanticEntry,
  };
}

function reconcileMeters(
  root: HTMLElement,
  existing: Map<string, MeterElements>,
  next: HybridUiPresentation["hud"]["meters"],
): void {
  const active = new Set(next.map((meter) => meter.id));
  for (const [id, elements] of existing) {
    if (active.has(id)) continue;
    elements.root.remove();
    existing.delete(id);
  }
  for (let index = 0; index < next.length; index += 1) {
    const meter = next[index];
    if (meter === undefined) continue;
    let elements = existing.get(meter.id);
    if (elements === undefined) {
      const meterRoot = document.createElement("div");
      meterRoot.dataset.meterId = meter.id;
      const label = document.createElement("span");
      const progress = document.createElement("progress");
      meterRoot.append(label, progress);
      elements = { label, progress, root: meterRoot };
      existing.set(meter.id, elements);
    }
    elements.label.textContent = meter.label;
    elements.progress.ariaLabel = meter.label;
    elements.progress.max = meter.maximum;
    elements.progress.value = meter.value;
    const current = root.children[index];
    if (current !== elements.root) root.insertBefore(elements.root, current ?? null);
  }
}

function reconcileChoices(
  root: HTMLElement,
  existing: Map<string, ChoiceElements>,
  next: readonly HybridUiDialogChoice[],
  activate: (actionId: string) => void,
): void {
  const active = new Set(next.map((choice) => choice.id));
  for (const [id, elements] of existing) {
    if (active.has(id)) continue;
    elements.root.remove();
    existing.delete(id);
  }
  for (let index = 0; index < next.length; index += 1) {
    const choice = next[index];
    if (choice === undefined) continue;
    let elements = existing.get(choice.id);
    if (elements === undefined) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      item.append(button);
      elements = { button, root: item };
      existing.set(choice.id, elements);
    }
    elements.button.disabled = choice.disabled;
    elements.button.textContent = choice.label;
    elements.button.onclick = () => activate(choice.actionId);
    placeFocusableNode(root, elements.root, index, elements.button);
  }
}

function reconcileMessages(
  root: HTMLUListElement,
  existing: HTMLLIElement[],
  next: readonly string[],
): void {
  for (let index = 0; index < next.length; index += 1) {
    const message = next[index];
    if (message === undefined) continue;
    let item = existing[index];
    if (item === undefined) {
      item = document.createElement("li");
      existing.push(item);
      root.append(item);
    }
    if (item.textContent !== message) item.textContent = message;
  }
  while (existing.length > next.length) existing.pop()?.remove();
}

function reconcileTextEntry(
  root: HTMLElement,
  existing: TextEntryElements | null,
  entry: HybridUiPresentation["dialog"]["textEntry"],
  surfaceId: "dialog" | "heavy-screen",
  submitLabel: string,
  submit: (actionId: string, value: string) => void,
): TextEntryElements | null {
  if (entry === null) {
    if (existing !== null) root.replaceChildren();
    return null;
  }
  let elements = existing;
  if (elements === null || elements.submitActionId !== entry.submitActionId) {
    const form = document.createElement("form");
    const label = document.createElement("label");
    const input = document.createElement("input");
    const button = document.createElement("button");
    const id = `hybrid-ui-entry-${surfaceId}-${entry.submitActionId}`;
    label.htmlFor = id;
    input.id = id;
    input.type = "text";
    button.type = "submit";
    const created = {
      button,
      dirty: false,
      form,
      gameValue: entry.value,
      input,
      label,
      submitActionId: entry.submitActionId,
    };
    elements = created;
    input.value = entry.value;
    input.addEventListener("input", () => {
      created.dirty = true;
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit(created.submitActionId, created.input.value);
    });
    form.append(label, input, button);
    root.replaceChildren(form);
  }
  elements.label.textContent = entry.label;
  elements.button.textContent = submitLabel;
  if (entry.value !== elements.gameValue) {
    elements.input.value = entry.value;
    elements.gameValue = entry.value;
    elements.dirty = false;
  } else if (!elements.dirty && elements.input.value !== entry.value) {
    elements.input.value = entry.value;
  }
  return elements;
}

function reconcileSemanticActions(
  root: HTMLElement,
  existing: Map<string, SemanticActionElements>,
  next: NonNullable<HybridUiPresentation["heavyScreen"]>["semanticActions"],
  activate: (actionId: string) => void,
): void {
  const active = new Set(next.map((action) => action.actionId));
  for (const [actionId, elements] of existing) {
    if (active.has(actionId)) continue;
    elements.button.remove();
    existing.delete(actionId);
  }
  for (let index = 0; index < next.length; index += 1) {
    const action = next[index];
    if (action === undefined) continue;
    let elements = existing.get(action.actionId);
    if (elements === undefined) {
      const button = document.createElement("button");
      button.type = "button";
      elements = { button };
      existing.set(action.actionId, elements);
    }
    elements.button.disabled = action.disabled;
    elements.button.textContent = action.label;
    elements.button.onclick = () => activate(action.actionId);
    placeFocusableNode(root, elements.button, index, elements.button);
  }
}

function placeFocusableNode(
  root: HTMLElement,
  node: HTMLElement,
  index: number,
  focusTarget: HTMLElement,
): void {
  const current = root.children[index];
  if (current === node) return;
  const restoreFocus = node.contains(document.activeElement);
  root.insertBefore(node, current ?? null);
  if (restoreFocus) focusTarget.focus();
}

function validateLabels(labels: HybridUiDomLabels): void {
  for (const [name, value] of Object.entries(labels)) {
    if (value.trim() === "") throw new Error(`Hybrid UI DOM label ${name} cannot be empty`);
  }
}

function keyboardInputKind(
  event: KeyboardEvent,
): "activate" | "cancel" | "focus-next" | "focus-previous" | null {
  if (event.key === "ArrowDown" || event.key === "ArrowRight") return "focus-next";
  if (event.key === "ArrowUp" || event.key === "ArrowLeft") return "focus-previous";
  if (event.key === "Enter" || event.key === " ") return "activate";
  if (event.key === "Escape") return "cancel";
  return null;
}

function isDomUiTarget(root: HTMLElement, target: EventTarget | null): boolean {
  return target instanceof Node && root.contains(target);
}
