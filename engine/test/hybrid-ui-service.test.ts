import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameplayInputService } from "../src/input/gameplay-input-service";
import type { RenderService } from "../src/render/render-service";
import {
  type HybridUiPresentation,
  idleHybridUiWorkerTelemetry,
} from "../src/ui/hybrid-ui-contract";
import { createHybridUiService } from "../src/ui/hybrid-ui-service";

class FakeElement extends EventTarget {
  private readonly pointerListeners = new Set<(event: PointerEvent) => void>();
  readonly children: FakeElement[] = [];
  readonly classList = { add: vi.fn() };
  readonly dataset: Record<string, string> = {};
  ariaLabel = "";
  disabled = false;
  hidden = false;
  htmlFor = "";
  id = "";
  inert = false;
  insertBeforeCallCount = 0;
  max = 0;
  onclick: (() => void) | null = null;
  parent: FakeElement | null = null;
  placementMutationCount = 0;
  tabIndex = -1;
  textContent: string | null = null;
  type = "";
  value: string | number = "";

  constructor(
    readonly tagName: string,
    private readonly owner: FakeDocument,
  ) {
    super();
  }

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (type === "pointerdown" && typeof listener === "function") {
      this.pointerListeners.add(listener as (event: PointerEvent) => void);
      return;
    }
    super.addEventListener(type, listener, options);
  }

  append(...nodes: FakeElement[]): void {
    this.placementMutationCount += nodes.length;
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }

  contains(node: unknown): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }

  override dispatchEvent(event: Event): boolean {
    if (event.type === "pointerdown") {
      for (const listener of this.pointerListeners) listener(event as PointerEvent);
      return !event.defaultPrevented;
    }
    return super.dispatchEvent(event);
  }

  focus(): void {
    this.owner.activeElement = this;
  }

  getBoundingClientRect(): DOMRect {
    return {
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
    } as DOMRect;
  }

  querySelectorAll(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.querySelectorAll()]);
  }

  remove(): void {
    if (this.parent === null) return;
    if (this.contains(this.owner.activeElement)) this.owner.activeElement = null;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (type === "pointerdown" && typeof listener === "function") {
      this.pointerListeners.delete(listener as (event: PointerEvent) => void);
      return;
    }
    super.removeEventListener(type, listener, options);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
    this.append(...nodes);
  }

  insertBefore(node: FakeElement, reference: FakeElement | null): void {
    this.insertBeforeCallCount += 1;
    this.placementMutationCount += 1;
    const restoreAt = reference === null ? this.children.length : this.children.indexOf(reference);
    node.remove();
    node.parent = this;
    this.children.splice(restoreAt < 0 ? this.children.length : restoreAt, 0, node);
  }

  setAttribute(): void {}
}

class FakeDocument {
  activeElement: FakeElement | null = null;

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }
}

class FakeWindow {
  private readonly listeners = new Set<(event: KeyboardEvent) => void>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "keydown" && typeof listener === "function") {
      this.listeners.add(listener as (event: KeyboardEvent) => void);
    }
  }

  dispatchKey(key: string, target: FakeElement): void {
    const event = {
      isComposing: false,
      key,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
      target,
    } as unknown as KeyboardEvent;
    for (const listener of this.listeners) listener(event);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "keydown" && typeof listener === "function") {
      this.listeners.delete(listener as (event: KeyboardEvent) => void);
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hybrid UI DOM service", () => {
  it("routes Escape from semantic controls, restores canvas focus, and retains live nodes", () => {
    const documentTarget = new FakeDocument();
    const windowTarget = new FakeWindow();
    vi.stubGlobal("Node", FakeElement);
    vi.stubGlobal("document", documentTarget);
    vi.stubGlobal("window", windowTarget);
    const root = documentTarget.createElement("main");
    const canvas = documentTarget.createElement("canvas");
    const forwarded: unknown[] = [];
    const suppressed: boolean[] = [];
    const renderService = {
      sendHybridUiInput: (input: unknown) => forwarded.push(input),
      setHybridUiPresentation: vi.fn(),
      snapshot: () => ({ state: "ready" }),
      subscribe: (listener: (snapshot: unknown) => void) => {
        listener({ hybridUi: idleHybridUiWorkerTelemetry(), state: "ready" });
        return () => undefined;
      },
      subscribeCanvas: (listener: (next: FakeElement) => void) => {
        listener(canvas);
        return () => undefined;
      },
      subscribeHybridUiActions: () => () => undefined,
    } as unknown as RenderService;
    const gameplayInputService = {
      setUiSuppressed: (value: boolean) => suppressed.push(value),
    } as unknown as GameplayInputService;
    const service = createHybridUiService(
      root as unknown as HTMLElement,
      canvas as unknown as HTMLCanvasElement,
      renderService,
      gameplayInputService,
      {
        conversation: "Conversation",
        playerStatus: "Player status",
        screenControls: "Screen controls",
        submit: "Submit",
      },
    );

    service.present(presentation(1, true, false));
    const meter = root.children[0]?.children[0]?.children[0];
    const message = root.children[0]?.children[1]?.children[0];
    const semanticButton = root.children[2]?.children[0]?.children[0];
    if (semanticButton === undefined) throw new Error("Semantic button was not rendered");
    semanticButton.focus();
    windowTarget.dispatchKey("Escape", semanticButton);
    expect(forwarded).toEqual([{ kind: "cancel", sequence: 0 }]);

    const meterPlacementCount = root.children[0]?.children[0]?.placementMutationCount;
    service.present(presentation(2, true, false));
    expect(documentTarget.activeElement).toBe(semanticButton);
    expect(root.children[0]?.children[0]?.children[0]).toBe(meter);
    expect(root.children[0]?.children[0]?.placementMutationCount).toBe(meterPlacementCount);

    service.present(presentation(3, false, true));
    expect(documentTarget.activeElement).toBe(canvas);
    expect(root.children[0]?.children[1]?.children[0]).toBe(message);
    const dialogButton = root.children[1]?.children[2]?.children[0]?.children[0];
    if (dialogButton === undefined) throw new Error("Dialog button was not rendered");
    dialogButton.focus();
    service.present(presentation(4, false, false));
    expect(documentTarget.activeElement).toBe(canvas);
    expect(suppressed).toEqual([true, false]);

    service.present(entryPresentation(5));
    const dialogInput = root.children[1]?.children[3]?.children[0]?.children[1];
    const dialogSubmit = root.children[1]?.children[3]?.children[0]?.children[2];
    const semanticInput = root.children[2]?.children[1]?.children[0]?.children[1];
    if (dialogInput === undefined || dialogSubmit === undefined || semanticInput === undefined) {
      throw new Error("Text-entry controls were not rendered");
    }
    expect(dialogInput.id).not.toBe(semanticInput.id);
    windowTarget.dispatchKey("Escape", dialogInput);
    expect(forwarded).toEqual([{ kind: "cancel", sequence: 0 }]);
    dialogInput.value = "unpublished player text";
    dialogInput.dispatchEvent(new Event("input"));
    dialogSubmit.focus();
    service.present(entryPresentation(6));
    expect(dialogInput.value).toBe("unpublished player text");
    expect(documentTarget.activeElement).toBe(dialogSubmit);
    service.dispose();

    windowTarget.dispatchKey("Escape", semanticButton);
    canvas.dispatchEvent(pointerEvent(30, 30));
    expect(forwarded).toEqual([{ kind: "cancel", sequence: 0 }]);

    const replacement = createHybridUiService(
      root as unknown as HTMLElement,
      canvas as unknown as HTMLCanvasElement,
      renderService,
      gameplayInputService,
      {
        conversation: "Conversation",
        playerStatus: "Player status",
        screenControls: "Screen controls",
        submit: "Submit",
      },
    );
    replacement.present(presentation(1, true, false));
    canvas.dispatchEvent(pointerEvent(30, 30));
    expect(forwarded).toEqual([
      { kind: "cancel", sequence: 0 },
      { kind: "pointer-activate", sequence: 0, x: 0.3, y: 0.3 },
    ]);
    replacement.dispose();
  });
});

function pointerEvent(clientX: number, clientY: number): PointerEvent {
  const event = new Event("pointerdown");
  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event as PointerEvent;
}

function presentation(
  revision: number,
  heavyVisible: boolean,
  dialogVisible: boolean,
): HybridUiPresentation {
  return {
    dialog: {
      body: "Talk",
      choices: dialogVisible
        ? [{ actionId: "dialog:close", disabled: false, id: "close", label: "Close" }]
        : [],
      speaker: "Mara",
      textEntry: null,
      visible: dialogVisible,
    },
    heavyScreen: heavyVisible
      ? {
          cancelActionId: "inventory:close",
          focusActionId: "inventory:use",
          id: "inventory",
          primitives: [
            {
              actionId: "inventory:use",
              disabled: false,
              id: "use",
              layer: 0,
              rect: { height: 0.2, width: 0.2, x: 0.2, y: 0.2 },
              tone: "neutral",
            },
          ],
          semanticActions: [{ actionId: "inventory:use", disabled: false, label: "Use item" }],
          textEntry: null,
          visible: true,
        }
      : null,
    hud: {
      messages: ["Status unchanged"],
      meters: [{ id: "health", label: "Health", maximum: 100, value: 80 }],
      visible: true,
    },
    revision,
    worldAnchors: [],
  };
}

function entryPresentation(revision: number): HybridUiPresentation {
  const base = presentation(revision, true, true);
  if (base.heavyScreen === null) throw new Error("Entry test requires a heavy screen");
  const entry = { label: "Name", submitActionId: "entry:submit", value: "game value" };
  return {
    ...base,
    dialog: { ...base.dialog, textEntry: entry },
    heavyScreen: { ...base.heavyScreen, textEntry: entry },
  };
}
