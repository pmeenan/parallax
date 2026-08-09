import type { HybridUiHeavyPrimitive } from "./hybrid-ui-contract";

export function topmostHybridUiPrimitiveAt(
  primitives: readonly HybridUiHeavyPrimitive[],
  x: number,
  y: number,
): HybridUiHeavyPrimitive | null {
  for (let index = primitives.length - 1; index >= 0; index -= 1) {
    const primitive = primitives[index];
    if (
      primitive !== undefined &&
      x >= primitive.rect.x &&
      x <= primitive.rect.x + primitive.rect.width &&
      y >= primitive.rect.y &&
      y <= primitive.rect.y + primitive.rect.height
    ) {
      return primitive;
    }
  }
  return null;
}
