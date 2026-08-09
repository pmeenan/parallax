export interface NpcDialogMemoryTurn {
  readonly npcSpeech: string;
  readonly playerSpeech: string;
}

export interface NpcDialogMemorySnapshot {
  readonly recentTurns: readonly NpcDialogMemoryTurn[];
  readonly summary: NpcDialogMemoryTurn | null;
}

export interface NpcDialogMemory {
  record(turn: NpcDialogMemoryTurn): NpcDialogMemorySnapshot;
  snapshot(): NpcDialogMemorySnapshot;
}

const RECENT_TURN_CAPACITY = 4;
const SUMMARY_ROLE_CHARACTER_CAPACITY = 512;
const SUMMARY_FRAGMENT_CAPACITY = 160;

export function createNpcDialogMemory(): NpcDialogMemory {
  let recentTurns: NpcDialogMemoryTurn[] = [];
  let summary: NpcDialogMemoryTurn | null = null;

  const snapshot = (): NpcDialogMemorySnapshot =>
    Object.freeze({
      recentTurns: Object.freeze(recentTurns.map((turn) => Object.freeze({ ...turn }))),
      summary: summary === null ? null : Object.freeze({ ...summary }),
    });

  return Object.freeze({
    record(input: NpcDialogMemoryTurn): NpcDialogMemorySnapshot {
      const turn = Object.freeze({
        npcSpeech: requireSpeech(input.npcSpeech),
        playerSpeech: requireSpeech(input.playerSpeech),
      });
      recentTurns = [...recentTurns, turn];
      while (recentTurns.length > RECENT_TURN_CAPACITY) {
        const evicted = recentTurns.shift();
        if (evicted === undefined) break;
        summary = Object.freeze({
          npcSpeech: appendSummary(summary?.npcSpeech ?? "", summarize(evicted.npcSpeech)),
          playerSpeech: appendSummary(summary?.playerSpeech ?? "", summarize(evicted.playerSpeech)),
        });
      }
      return snapshot();
    },
    snapshot,
  });
}

function appendSummary(existing: string, fragment: string): string {
  const combined = `${existing}${existing === "" ? "" : " | "}${fragment}`;
  if (combined.length <= SUMMARY_ROLE_CHARACTER_CAPACITY) return combined;
  const bounded = combined.slice(combined.length - SUMMARY_ROLE_CHARACTER_CAPACITY);
  const boundary = bounded.indexOf(" | ");
  return boundary >= 0 ? bounded.slice(boundary + 3) : bounded;
}

function summarize(value: string): string {
  const sentenceEnd = value.search(/[.!?](?:\s|$)/u);
  const sentence = sentenceEnd < 0 ? value : value.slice(0, sentenceEnd + 1);
  return sentence.length <= SUMMARY_FRAGMENT_CAPACITY
    ? sentence
    : `${sentence.slice(0, SUMMARY_FRAGMENT_CAPACITY - 1).trimEnd()}…`;
}

function requireSpeech(value: string): string {
  const normalized = value.trim();
  if (normalized === "" || normalized.length > 2_048) {
    throw new Error("NPC dialog memory speech is empty or too long");
  }
  return normalized;
}
