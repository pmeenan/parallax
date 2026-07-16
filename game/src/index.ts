import type { EngineIdentity, PromptApiSpikeFixture, WalkingSkeletonScene } from "@parallax/engine";

export const GAME_VERSION = "0.0.0";

// Shared by the Prompt API and P-007 phase-A backends so their M0 comparison uses
// identical game-owned NPC content rather than backend-specific prompts.
export const PROMPT_API_SPIKE_FIXTURE = Object.freeze({
  offlinePrompt: "Reply with exactly: offline-ready",
  prompt:
    "Reply with one short sentence as a village-gate watch officer reporting that the road is secure.",
}) satisfies PromptApiSpikeFixture;

export interface GameIdentity {
  readonly engine: EngineIdentity;
  readonly name: "parallax";
  readonly version: string;
}

export function identifyGame(engine: EngineIdentity): GameIdentity {
  return Object.freeze({ engine, name: "parallax", version: GAME_VERSION });
}

export function createWalkingSkeletonScene(): WalkingSkeletonScene {
  return Object.freeze({
    camera: {
      alpha: -Math.PI / 2,
      beta: Math.PI / 2.35,
      minZ: 0.1,
      radius: 6,
      target: [0, 0, 0],
    },
    clearColor: [0.015, 0.02, 0.04, 1],
    lightDirection: [0.2, 1, 0.1],
    meshColor: [0.15, 0.62, 1],
    meshSize: 1.8,
    rotationRadiansPerSecond: [0.09, 0.3],
  } satisfies WalkingSkeletonScene);
}
