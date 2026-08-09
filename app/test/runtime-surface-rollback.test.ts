import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureRuntimeSurfaceRollback,
  RUNTIME_SURFACE_IDS,
} from "../src/runtime-surface-rollback";

class FakeElement {
  hidden = true;
  textContent = "original";
  readonly attributes = new Map<string, string>([["data-state", "idle"]]);

  constructor(
    readonly id: string,
    private readonly owner: FakeDocument,
  ) {}

  cloneNode(): FakeElement {
    const clone = new FakeElement(this.id, this.owner);
    clone.hidden = this.hidden;
    clone.textContent = this.textContent;
    clone.attributes.clear();
    for (const [name, value] of this.attributes) clone.attributes.set(name, value);
    return clone;
  }

  replaceWith(replacement: FakeElement): void {
    this.owner.elements.set(this.id, replacement);
  }
}

class FakeDocument {
  readonly elements = new Map<string, FakeElement>();

  querySelector(selector: string): FakeElement | null {
    return this.elements.get(selector.slice(1)) ?? null;
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("runtime surface rollback", () => {
  it("restores pristine hidden surfaces and replaces a transferred canvas", () => {
    const documentTarget = new FakeDocument();
    vi.stubGlobal("HTMLElement", FakeElement);
    for (const id of RUNTIME_SURFACE_IDS) {
      documentTarget.elements.set(id, new FakeElement(id, documentTarget));
    }
    const originalCanvas = documentTarget.elements.get("render-canvas");
    if (originalCanvas === undefined) throw new Error("Test canvas is missing");
    const rollback = captureRuntimeSurfaceRollback(documentTarget as unknown as Document);

    for (const element of documentTarget.elements.values()) {
      element.hidden = false;
      element.textContent = "failed attempt";
      element.attributes.set("data-state", "failed");
    }
    originalCanvas.replaceWith(originalCanvas.cloneNode());
    rollback();

    for (const id of RUNTIME_SURFACE_IDS) {
      const restored = documentTarget.elements.get(id);
      expect(restored).toMatchObject({ hidden: true, textContent: "original" });
      expect(restored?.attributes.get("data-state")).toBe("idle");
    }
    expect(documentTarget.elements.get("render-canvas")).not.toBe(originalCanvas);
  });
});
