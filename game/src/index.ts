import type { AppOwnedLlmFixtureSet, EngineIdentity } from "@parallax/engine";

export type { M1BenchmarkUiCopy } from "./benchmark/m1-benchmark-mode";
export {
  formatM1BenchmarkPreset,
  formatM1BenchmarkReport,
  formatM1BenchmarkStatus,
  M1_BENCHMARK_DEFINITION,
  M1_BENCHMARK_UI_COPY,
} from "./benchmark/m1-benchmark-mode";
export type { M3GameplayRuntime } from "./sim/m3-gameplay-runtime";
export { createM3GameplayRuntime } from "./sim/m3-gameplay-runtime";
export type {
  StreamingDashboardMetric,
  StreamingDashboardMetricState,
  StreamingDashboardModel,
  StreamingDashboardSection,
} from "./ui/streaming-dashboard";
export {
  createStreamingDashboardModel,
  STREAMING_DASHBOARD_TITLE,
} from "./ui/streaming-dashboard";
export { DISTRICT_1_GREYBOX_SPEC, GREYBOX_DISTRICT_SPECS } from "./world/district-1.data";
export { DISTRICT_1_FLYTHROUGH } from "./world/district-1.flythrough";
export { createGreyboxScene, sampleGreyboxTerrain } from "./world/greybox-generator";
export type { GreyboxDistrictSpec } from "./world/greybox-spec";

interface DevelopmentImportMeta extends ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}

export function gameSimulationModuleUrl(): string {
  return (
    (import.meta as DevelopmentImportMeta).env?.DEV === true
      ? new URL("./sim/m3-simulation.ts", import.meta.url)
      : new URL(/* @vite-ignore */ "./__GAME_SIMULATION_ARTIFACT__", import.meta.url)
  ).href;
}

export const GAME_VERSION = "0.0.0";

const GATE_WATCH_NPC_DIALOG_PROMPT =
  "Reply with one short sentence as a village-gate watch officer reporting that the road is secure.";

const GATE_WATCH_PERSONA =
  "You are Mara Venn, a practical village-gate watch officer. Stay in character, be concise, and never invent facts that are absent from the retrieved context.";

function retrievedWatchLog(entries: number): string {
  return Array.from(
    { length: entries },
    (_, index) =>
      `Watch log ${String(index + 1).padStart(3, "0")}: the east road was inspected; no hazards were found; the tide bell remained quiet.`,
  ).join("\n");
}

// P-007 phase A deliberately keeps performance deterministic (greedy decoding) and
// separates raw quality evidence from exact schema/grounding checks.
export const APP_OWNED_LLM_SPIKE_FIXTURE_SET = Object.freeze({
  cases: Object.freeze([
    Object.freeze({
      id: "gate-watch-latency",
      kind: "latency",
      maxNewTokens: 32,
      messages: Object.freeze([
        Object.freeze({ content: GATE_WATCH_NPC_DIALOG_PROMPT, role: "user" }),
      ]),
      repetitions: 20,
    }),
    Object.freeze({
      id: "retrieved-fact-grounding",
      kind: "context",
      maxNewTokens: 48,
      messages: Object.freeze([
        Object.freeze({ content: GATE_WATCH_PERSONA, role: "system" }),
        Object.freeze({
          content:
            "Retrieved context: the west bridge is closed because its center span washed out. A traveler insists it is open. Answer whether they may use it and why.",
          role: "user",
        }),
      ]),
      repetitions: 1,
      validation: Object.freeze({
        forbiddenPhrases: Object.freeze(["bridge is open", "may cross"]),
        requiredPhrases: Object.freeze(["closed"]),
      }),
    }),
    Object.freeze({
      id: "state-intent-json",
      kind: "structured",
      maxNewTokens: 64,
      messages: Object.freeze([
        Object.freeze({
          content: `${GATE_WATCH_PERSONA} Return only a JSON object with string keys speech and intent. intent must be one of allow_passage, deny_passage, or no_action.`,
          role: "system",
        }),
        Object.freeze({
          content:
            "The player asks to pass. Retrieved context says the east road is secure and the gate is open.",
          role: "user",
        }),
      ]),
      repetitions: 5,
      validation: Object.freeze({
        allowedIntents: Object.freeze(["allow_passage", "deny_passage", "no_action"]),
        requiredJsonKeys: Object.freeze(["speech", "intent"]),
      }),
    }),
    Object.freeze({
      id: "context-short",
      kind: "context",
      maxNewTokens: 32,
      messages: Object.freeze([
        Object.freeze({ content: GATE_WATCH_PERSONA, role: "system" }),
        Object.freeze({
          content: `Summarize the latest road status in one sentence.\n${retrievedWatchLog(8)}`,
          role: "user",
        }),
      ]),
      repetitions: 1,
    }),
    Object.freeze({
      id: "context-medium",
      kind: "context",
      maxNewTokens: 32,
      messages: Object.freeze([
        Object.freeze({ content: GATE_WATCH_PERSONA, role: "system" }),
        Object.freeze({
          content: `Summarize the latest road status in one sentence.\n${retrievedWatchLog(64)}`,
          role: "user",
        }),
      ]),
      repetitions: 1,
    }),
    Object.freeze({
      id: "context-large",
      kind: "context",
      maxNewTokens: 32,
      messages: Object.freeze([
        Object.freeze({ content: GATE_WATCH_PERSONA, role: "system" }),
        Object.freeze({
          content: `Summarize the latest road status in one sentence.\n${retrievedWatchLog(256)}`,
          role: "user",
        }),
      ]),
      repetitions: 1,
    }),
    Object.freeze({
      id: "quality-conversation",
      kind: "quality",
      maxNewTokens: 96,
      messages: Object.freeze([
        Object.freeze({ content: GATE_WATCH_PERSONA, role: "system" }),
        Object.freeze({
          content:
            "I have walked since dawn and the inn is full. Talk to me like a person, not a quest dispenser. What would you suggest?",
          role: "user",
        }),
      ]),
      repetitions: 1,
    }),
  ]),
  id: "npc-dialog-phase-a@1",
  version: 1,
}) satisfies AppOwnedLlmFixtureSet;

// Attribution-only ordering: a short context supplies the excluded warmup and the
// unchanged large context runs before repeated generation can retain resources.
export const APP_OWNED_LLM_CONTEXT_FIRST_FIXTURE_SET = Object.freeze({
  cases: Object.freeze(
    [
      "context-short",
      "context-large",
      "gate-watch-latency",
      "retrieved-fact-grounding",
      "state-intent-json",
      "context-medium",
      "quality-conversation",
    ].map(requireAppOwnedLlmFixture),
  ),
  id: "npc-dialog-phase-a-context-first@1",
  version: 1,
}) satisfies AppOwnedLlmFixtureSet;

function requireAppOwnedLlmFixture(id: string): AppOwnedLlmFixtureSet["cases"][number] {
  const fixture = APP_OWNED_LLM_SPIKE_FIXTURE_SET.cases.find((candidate) => candidate.id === id);
  if (fixture === undefined) throw new Error(`App-owned LLM fixture ${id} is missing`);
  return fixture;
}

export interface GameIdentity {
  readonly engine: EngineIdentity;
  readonly name: "parallax";
  readonly version: string;
}

export function identifyGame(engine: EngineIdentity): GameIdentity {
  return Object.freeze({ engine, name: "parallax", version: GAME_VERSION });
}
