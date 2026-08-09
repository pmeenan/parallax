export const HYBRID_UI_TELEMETRY_SCHEMA_VERSION = 1;
export const HYBRID_UI_WORLD_ANCHOR_CAPACITY = 64;
export const HYBRID_UI_HEAVY_PRIMITIVE_CAPACITY = 256;
export const HYBRID_UI_SEMANTIC_ACTION_CAPACITY = 16;
export const HYBRID_UI_HUD_METER_CAPACITY = 16;
export const HYBRID_UI_HUD_MESSAGE_CAPACITY = 32;
export const HYBRID_UI_DIALOG_CHOICE_CAPACITY = 16;

export type HybridUiTone = "accent" | "danger" | "disabled" | "neutral";

export interface HybridUiHudMeter {
  readonly id: string;
  readonly label: string;
  readonly maximum: number;
  readonly value: number;
}

export interface HybridUiHudView {
  readonly meters: readonly HybridUiHudMeter[];
  readonly messages: readonly string[];
  readonly visible: boolean;
}

export interface HybridUiDialogChoice {
  readonly actionId: string;
  readonly disabled: boolean;
  readonly id: string;
  readonly label: string;
}

export interface HybridUiTextEntry {
  readonly label: string;
  readonly submitActionId: string;
  readonly value: string;
}

export interface HybridUiDialogView {
  readonly body: string;
  readonly choices: readonly HybridUiDialogChoice[];
  readonly speaker: string;
  readonly textEntry: HybridUiTextEntry | null;
  readonly visible: boolean;
}

export interface HybridUiWorldAnchor {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly sizeMeters: readonly [number, number];
  readonly tone: HybridUiTone;
  readonly visible: boolean;
}

export interface HybridUiRect {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface HybridUiHeavyPrimitive {
  readonly actionId: string | null;
  readonly disabled: boolean;
  readonly id: string;
  readonly layer: number;
  readonly rect: HybridUiRect;
  readonly tone: HybridUiTone;
}

export interface HybridUiSemanticAction {
  readonly actionId: string;
  readonly disabled: boolean;
  readonly label: string;
}

export interface HybridUiHeavyScreen {
  readonly cancelActionId: string;
  readonly focusActionId: string | null;
  readonly id: string;
  readonly primitives: readonly HybridUiHeavyPrimitive[];
  readonly semanticActions: readonly HybridUiSemanticAction[];
  readonly textEntry: HybridUiTextEntry | null;
  readonly visible: boolean;
}

export interface HybridUiPresentation {
  readonly dialog: HybridUiDialogView;
  readonly heavyScreen: HybridUiHeavyScreen | null;
  readonly hud: HybridUiHudView;
  readonly revision: number;
  readonly worldAnchors: readonly HybridUiWorldAnchor[];
}

export type HybridUiWorkerInput =
  | Readonly<{
      readonly kind: "activate" | "cancel" | "focus-next" | "focus-previous";
      readonly sequence: number;
    }>
  | Readonly<{
      readonly actionId: string;
      readonly kind: "semantic-activate";
      readonly sequence: number;
    }>
  | Readonly<{
      readonly kind: "pointer-activate";
      readonly sequence: number;
      readonly x: number;
      readonly y: number;
    }>;

export interface HybridUiAction {
  readonly actionId: string;
  readonly inputSequence: number;
  readonly payload: string | null;
  readonly presentationRevision: number;
  readonly source: "dialog-dom" | "heavy-screen-worker" | "ime-dom";
}

export interface HybridUiWorkerTelemetrySnapshot {
  readonly actionCount: number;
  readonly heavyPrimitiveCapacity: typeof HYBRID_UI_HEAVY_PRIMITIVE_CAPACITY;
  readonly heavyPrimitiveCount: number;
  readonly hitTestDurationHighWaterMs: number;
  readonly inputCount: number;
  readonly presentationCount: number;
  readonly presentationRevision: number | null;
  readonly presentationUpdateDurationHighWaterMs: number;
  readonly schemaVersion: typeof HYBRID_UI_TELEMETRY_SCHEMA_VERSION;
  readonly worldAnchorCapacity: typeof HYBRID_UI_WORLD_ANCHOR_CAPACITY;
  readonly worldAnchorCount: number;
}

export interface HybridUiTelemetrySnapshot {
  readonly dialogDomActionCount: number;
  readonly domMutationDurationHighWaterMs: number;
  readonly domNodeCountHighWater: number;
  readonly forwardedInputCount: number;
  readonly imeDomActionCount: number;
  readonly presentationCount: number;
  readonly presentationRevision: number | null;
  readonly schemaVersion: typeof HYBRID_UI_TELEMETRY_SCHEMA_VERSION;
  readonly semanticNodeCountHighWater: number;
  readonly state: "idle" | "ready" | "disposed";
  readonly worker: HybridUiWorkerTelemetrySnapshot;
  readonly workerActionCount: number;
}

const ID = /^[a-z0-9](?:[a-z0-9._:-]{0,127})$/;

export function idleHybridUiWorkerTelemetry(): HybridUiWorkerTelemetrySnapshot {
  return Object.freeze({
    actionCount: 0,
    heavyPrimitiveCapacity: HYBRID_UI_HEAVY_PRIMITIVE_CAPACITY,
    heavyPrimitiveCount: 0,
    hitTestDurationHighWaterMs: 0,
    inputCount: 0,
    presentationCount: 0,
    presentationRevision: null,
    presentationUpdateDurationHighWaterMs: 0,
    schemaVersion: HYBRID_UI_TELEMETRY_SCHEMA_VERSION,
    worldAnchorCapacity: HYBRID_UI_WORLD_ANCHOR_CAPACITY,
    worldAnchorCount: 0,
  });
}

export function freezeHybridUiPresentation(input: HybridUiPresentation): HybridUiPresentation {
  requireSafeSequence(input.revision, "Hybrid UI presentation revision");
  if (input.worldAnchors.length > HYBRID_UI_WORLD_ANCHOR_CAPACITY) {
    throw new Error("Hybrid UI world-anchor capacity exceeded");
  }
  const anchorIds = new Set<string>();
  const worldAnchors = input.worldAnchors.map((anchor) => {
    requireId(anchor.id, "world anchor");
    requireUnique(anchorIds, anchor.id, "world anchor");
    requireFiniteTuple(anchor.position, "world-anchor position");
    requirePositiveTuple(anchor.sizeMeters, "world-anchor size");
    requireTone(anchor.tone);
    requireBoolean(anchor.visible, "world-anchor visibility");
    return Object.freeze({
      ...anchor,
      position: Object.freeze([...anchor.position]) as readonly [number, number, number],
      sizeMeters: Object.freeze([...anchor.sizeMeters]) as readonly [number, number],
    });
  });
  return Object.freeze({
    dialog: freezeDialog(input.dialog),
    heavyScreen: input.heavyScreen === null ? null : freezeHeavyScreen(input.heavyScreen),
    hud: freezeHud(input.hud),
    revision: input.revision,
    worldAnchors: Object.freeze(worldAnchors),
  });
}

export function requireHybridUiWorkerInput(input: HybridUiWorkerInput): void {
  requireSafeSequence(input.sequence, "Hybrid UI input sequence");
  if (input.kind === "pointer-activate") {
    if (
      !Number.isFinite(input.x) ||
      !Number.isFinite(input.y) ||
      input.x < 0 ||
      input.x > 1 ||
      input.y < 0 ||
      input.y > 1
    ) {
      throw new Error("Hybrid UI pointer input must use normalized coordinates");
    }
  } else if (input.kind === "semantic-activate") {
    requireId(input.actionId, "semantic action");
  } else if (
    input.kind !== "activate" &&
    input.kind !== "cancel" &&
    input.kind !== "focus-next" &&
    input.kind !== "focus-previous"
  ) {
    throw new Error("Hybrid UI worker input kind is invalid");
  }
}

export function validateHybridUiWorkerTelemetry(
  value: HybridUiWorkerTelemetrySnapshot,
): HybridUiWorkerTelemetrySnapshot {
  if (
    value.schemaVersion !== HYBRID_UI_TELEMETRY_SCHEMA_VERSION ||
    value.worldAnchorCapacity !== HYBRID_UI_WORLD_ANCHOR_CAPACITY ||
    value.heavyPrimitiveCapacity !== HYBRID_UI_HEAVY_PRIMITIVE_CAPACITY ||
    !Number.isSafeInteger(value.worldAnchorCount) ||
    value.worldAnchorCount < 0 ||
    value.worldAnchorCount > value.worldAnchorCapacity ||
    !Number.isSafeInteger(value.heavyPrimitiveCount) ||
    value.heavyPrimitiveCount < 0 ||
    value.heavyPrimitiveCount > value.heavyPrimitiveCapacity ||
    !safeCount(value.actionCount) ||
    !safeCount(value.inputCount) ||
    !safeCount(value.presentationCount) ||
    value.actionCount > value.inputCount ||
    !validDuration(value.hitTestDurationHighWaterMs) ||
    !validDuration(value.presentationUpdateDurationHighWaterMs) ||
    (value.presentationRevision !== null &&
      (!Number.isSafeInteger(value.presentationRevision) || value.presentationRevision < 0)) ||
    (value.presentationCount === 0) !== (value.presentationRevision === null)
  ) {
    throw new Error("Hybrid UI worker telemetry is invalid");
  }
  return Object.freeze({ ...value });
}

export function validateHybridUiWorkerAction(value: HybridUiAction): HybridUiAction {
  requireId(value.actionId, "worker UI action");
  requireSafeSequence(value.inputSequence, "Hybrid UI worker action input sequence");
  requireSafeSequence(value.presentationRevision, "Hybrid UI worker action presentation revision");
  if (value.payload !== null || value.source !== "heavy-screen-worker") {
    throw new Error("Hybrid UI worker action has an invalid source or payload");
  }
  return Object.freeze({ ...value });
}

export function hybridUiWorkerActionAllowed(
  action: HybridUiAction,
  presentation: HybridUiPresentation,
): boolean {
  const screen = presentation.heavyScreen;
  if (action.presentationRevision !== presentation.revision || screen?.visible !== true) {
    return false;
  }
  if (action.actionId === screen.cancelActionId) return true;
  return screen.primitives.some(
    (primitive) => primitive.actionId === action.actionId && !primitive.disabled,
  );
}

export function hybridUiHeavyScreenGeometryEqual(
  left: HybridUiPresentation["heavyScreen"],
  right: HybridUiPresentation["heavyScreen"],
): boolean {
  if (left === null || right === null) return left === right;
  if (
    left.id !== right.id ||
    left.visible !== right.visible ||
    left.focusActionId !== right.focusActionId ||
    left.primitives.length !== right.primitives.length
  ) {
    return false;
  }
  return left.primitives.every((primitive, index) => {
    const other = right.primitives[index];
    return (
      other !== undefined &&
      primitive.id === other.id &&
      primitive.actionId === other.actionId &&
      primitive.disabled === other.disabled &&
      primitive.layer === other.layer &&
      primitive.tone === other.tone &&
      primitive.rect.x === other.rect.x &&
      primitive.rect.y === other.rect.y &&
      primitive.rect.width === other.rect.width &&
      primitive.rect.height === other.rect.height
    );
  });
}

function freezeHud(input: HybridUiHudView): HybridUiHudView {
  requireBoolean(input.visible, "HUD visibility");
  if (input.meters.length > HYBRID_UI_HUD_METER_CAPACITY) {
    throw new Error("Hybrid UI HUD meter capacity exceeded");
  }
  if (input.messages.length > HYBRID_UI_HUD_MESSAGE_CAPACITY) {
    throw new Error("Hybrid UI HUD message capacity exceeded");
  }
  const ids = new Set<string>();
  return Object.freeze({
    meters: Object.freeze(
      input.meters.map((meter) => {
        requireId(meter.id, "HUD meter");
        requireUnique(ids, meter.id, "HUD meter");
        requireNonemptyText(meter.label, "HUD meter label");
        if (
          !Number.isFinite(meter.maximum) ||
          meter.maximum <= 0 ||
          !Number.isFinite(meter.value) ||
          meter.value < 0 ||
          meter.value > meter.maximum
        ) {
          throw new Error(`HUD meter ${meter.id} has an invalid range`);
        }
        return Object.freeze({ ...meter });
      }),
    ),
    messages: Object.freeze(
      input.messages.map((message) => requireNonemptyText(message, "HUD message")),
    ),
    visible: input.visible,
  });
}

function freezeDialog(input: HybridUiDialogView): HybridUiDialogView {
  requireBoolean(input.visible, "dialog visibility");
  if (input.choices.length > HYBRID_UI_DIALOG_CHOICE_CAPACITY) {
    throw new Error("Hybrid UI dialog choice capacity exceeded");
  }
  const ids = new Set<string>();
  const actionIds = new Set<string>();
  requireNonemptyText(input.speaker, "dialog speaker");
  requireNonemptyText(input.body, "dialog body");
  const choices = Object.freeze(
    input.choices.map((choice) => {
      requireId(choice.id, "dialog choice");
      requireId(choice.actionId, "dialog action");
      requireUnique(ids, choice.id, "dialog choice");
      requireUnique(actionIds, choice.actionId, "dialog action");
      requireNonemptyText(choice.label, "dialog choice label");
      requireBoolean(choice.disabled, "dialog choice disabled state");
      return Object.freeze({ ...choice });
    }),
  );
  const textEntry = freezeTextEntry(input.textEntry);
  if (textEntry !== null && actionIds.has(textEntry.submitActionId)) {
    throw new Error("Hybrid UI dialog text-entry action must be distinct from choice actions");
  }
  return Object.freeze({
    body: input.body,
    choices,
    speaker: input.speaker,
    textEntry,
    visible: input.visible,
  });
}

function freezeHeavyScreen(input: HybridUiHeavyScreen): HybridUiHeavyScreen {
  requireId(input.id, "heavy screen");
  requireId(input.cancelActionId, "heavy-screen cancel action");
  requireBoolean(input.visible, "heavy-screen visibility");
  if (input.primitives.length > HYBRID_UI_HEAVY_PRIMITIVE_CAPACITY) {
    throw new Error("Hybrid UI heavy-screen primitive capacity exceeded");
  }
  if (input.semanticActions.length > HYBRID_UI_SEMANTIC_ACTION_CAPACITY) {
    throw new Error("Hybrid UI sparse semantic bridge capacity exceeded");
  }
  const primitiveIds = new Set<string>();
  const actionIds = new Set<string>();
  let previousLayer = -1;
  const primitives = input.primitives.map((primitive) => {
    requireId(primitive.id, "heavy-screen primitive");
    requireUnique(primitiveIds, primitive.id, "heavy-screen primitive");
    requireTone(primitive.tone);
    requireBoolean(primitive.disabled, "heavy-screen primitive disabled state");
    requireNormalizedRect(primitive.rect);
    if (
      !Number.isSafeInteger(primitive.layer) ||
      primitive.layer < 0 ||
      primitive.layer > 255 ||
      primitive.layer <= previousLayer
    ) {
      throw new Error(
        "Hybrid UI heavy-screen layers must be strictly increasing integers from 0 through 255",
      );
    }
    previousLayer = primitive.layer;
    if (primitive.actionId !== null) {
      requireId(primitive.actionId, "heavy-screen action");
      requireUnique(actionIds, primitive.actionId, "heavy-screen action");
    }
    return Object.freeze({ ...primitive, rect: Object.freeze({ ...primitive.rect }) });
  });
  if (actionIds.has(input.cancelActionId)) {
    throw new Error("Hybrid UI cancel action must be distinct from primitive actions");
  }
  const textEntry = freezeTextEntry(input.textEntry);
  if (
    textEntry !== null &&
    (actionIds.has(textEntry.submitActionId) || textEntry.submitActionId === input.cancelActionId)
  ) {
    throw new Error("Hybrid UI heavy-screen text-entry action must be distinct");
  }
  const semanticIds = new Set<string>();
  const semanticActions = input.semanticActions.map((action) => {
    requireId(action.actionId, "semantic action");
    requireUnique(semanticIds, action.actionId, "semantic action");
    requireBoolean(action.disabled, "semantic action disabled state");
    if (!actionIds.has(action.actionId)) {
      throw new Error(`Semantic action ${action.actionId} has no in-canvas primitive`);
    }
    const primitive = primitives.find((candidate) => candidate.actionId === action.actionId);
    if (primitive?.disabled !== action.disabled) {
      throw new Error(
        `Semantic action ${action.actionId} disabled state differs from its primitive`,
      );
    }
    requireNonemptyText(action.label, "semantic action label");
    return Object.freeze({ ...action });
  });
  if (
    input.focusActionId !== null &&
    !primitives.some(
      (primitive) => primitive.actionId === input.focusActionId && !primitive.disabled,
    )
  ) {
    throw new Error("Hybrid UI focus action does not name an enabled heavy-screen primitive");
  }
  return Object.freeze({
    ...input,
    primitives: Object.freeze(primitives),
    semanticActions: Object.freeze(semanticActions),
    textEntry,
  });
}

function freezeTextEntry(input: HybridUiTextEntry | null): HybridUiTextEntry | null {
  if (input === null) return null;
  requireNonemptyText(input.label, "text-entry label");
  requireId(input.submitActionId, "text-entry submit action");
  if (typeof input.value !== "string") throw new Error("text-entry value must be a string");
  return Object.freeze({ ...input });
}

function requireNormalizedRect(rect: HybridUiRect): void {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > 1 ||
    rect.y + rect.height > 1
  ) {
    throw new Error("Hybrid UI heavy-screen rectangles must fit normalized screen space");
  }
}

function requireId(value: string, label: string): void {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${label} ID is invalid`);
}

function requireNonemptyText(value: string, label: string): string {
  if (value.trim() === "") throw new Error(`${label} cannot be empty`);
  return value;
}

function requireSafeSequence(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`);
}

function requireFiniteTuple(value: readonly number[], label: string): void {
  if (value.length !== 3 || value.some((component) => !Number.isFinite(component)))
    throw new Error(`${label} is invalid`);
}

function requirePositiveTuple(value: readonly number[], label: string): void {
  if (
    value.length !== 2 ||
    value.some((component) => !Number.isFinite(component) || component <= 0)
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function requireTone(value: HybridUiTone): void {
  if (value !== "accent" && value !== "danger" && value !== "disabled" && value !== "neutral") {
    throw new Error("Hybrid UI tone is invalid");
  }
}

function requireUnique(values: Set<string>, value: string, label: string): void {
  if (values.has(value)) throw new Error(`${label} ID ${value} is duplicated`);
  values.add(value);
}

function requireBoolean(value: boolean, label: string): void {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
}

function safeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validDuration(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
