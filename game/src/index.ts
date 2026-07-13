import type { EngineIdentity } from "@parallax/engine";

export const GAME_VERSION = "0.0.0";

export interface GameIdentity {
  readonly engine: EngineIdentity;
  readonly name: "parallax";
  readonly version: string;
}

export function identifyGame(engine: EngineIdentity): GameIdentity {
  return Object.freeze({ engine, name: "parallax", version: GAME_VERSION });
}
