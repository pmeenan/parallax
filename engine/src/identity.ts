export const ENGINE_VERSION = "0.0.0";

export interface EngineIdentity {
  readonly name: "parallax-engine";
  readonly version: string;
}

export function initializeEngine(): EngineIdentity {
  return Object.freeze({ name: "parallax-engine", version: ENGINE_VERSION });
}
