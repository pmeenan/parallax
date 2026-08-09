export const NPC_KNOWLEDGE_TELEMETRY_SCHEMA_VERSION = 1;

export type NpcKnowledgeTier = "structured-game-state" | "authored-lore" | "episodic-memory";

export interface NpcKnowledgeRequest {
  readonly maximumTokens: number;
  readonly npcId: string;
  readonly playerText: string;
  readonly tags: readonly string[];
}

export interface NpcKnowledgeCandidate {
  readonly id: string;
  readonly priority: number;
  readonly relevance: number;
  readonly tags: readonly string[];
  readonly text: string;
}

export interface NpcKnowledgeProvider {
  readonly id: string;
  readonly tier: NpcKnowledgeTier;
  retrieve(
    request: NpcKnowledgeRequest,
    signal: AbortSignal,
  ): Promise<readonly NpcKnowledgeCandidate[]>;
}

export interface NpcKnowledgeEntry {
  readonly citation: string;
  readonly id: string;
  readonly providerId: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly tier: NpcKnowledgeTier;
  readonly tokenCount: number;
}

export interface NpcKnowledgeContext {
  readonly entries: readonly NpcKnowledgeEntry[];
  readonly formattedText: string;
  readonly tokenCount: number;
}

export interface NpcKnowledgeTelemetrySnapshot {
  readonly activeRequestCount: number;
  readonly assembledEntryCount: number;
  readonly assembledTokenCount: number;
  readonly cancelledRequestCount: number;
  readonly candidateCount: number;
  readonly failureCount: number;
  readonly failureMessage: string | null;
  readonly providerCount: number;
  readonly requestCount: number;
  readonly retrievalDurationHighWaterMs: number;
  readonly schemaVersion: typeof NPC_KNOWLEDGE_TELEMETRY_SCHEMA_VERSION;
  readonly state: "ready" | "assembling" | "failed" | "disposed";
}

export function validateNpcKnowledgeRequest(request: NpcKnowledgeRequest): NpcKnowledgeRequest {
  requireKnowledgeId(request.npcId, "NPC");
  if (
    !Number.isSafeInteger(request.maximumTokens) ||
    request.maximumTokens < 1 ||
    request.maximumTokens > 4_096
  ) {
    throw new Error("NPC knowledge token budget is invalid");
  }
  const playerText = requireKnowledgeText(request.playerText, "NPC knowledge query", 2_048);
  if (request.tags.length > 32) throw new Error("NPC knowledge query has too many tags");
  const tags = request.tags.map((tag) => requireKnowledgeId(tag, "NPC knowledge tag"));
  if (new Set(tags).size !== tags.length) {
    throw new Error("NPC knowledge query tags are duplicated");
  }
  return Object.freeze({
    maximumTokens: request.maximumTokens,
    npcId: request.npcId,
    playerText,
    tags: Object.freeze(tags),
  });
}

export function validateNpcKnowledgeCandidate(
  candidate: NpcKnowledgeCandidate,
): NpcKnowledgeCandidate {
  const id = requireKnowledgeId(candidate.id, "NPC knowledge candidate");
  if (
    !Number.isSafeInteger(candidate.priority) ||
    candidate.priority < 0 ||
    candidate.priority > 100
  ) {
    throw new Error(`NPC knowledge candidate ${id} priority is invalid`);
  }
  if (!Number.isFinite(candidate.relevance) || candidate.relevance < 0 || candidate.relevance > 1) {
    throw new Error(`NPC knowledge candidate ${id} relevance is invalid`);
  }
  if (candidate.tags.length > 32) {
    throw new Error(`NPC knowledge candidate ${id} has too many tags`);
  }
  const tags = candidate.tags.map((tag) => requireKnowledgeId(tag, "NPC knowledge candidate tag"));
  if (new Set(tags).size !== tags.length) {
    throw new Error(`NPC knowledge candidate ${id} tags are duplicated`);
  }
  return Object.freeze({
    id,
    priority: candidate.priority,
    relevance: candidate.relevance,
    tags: Object.freeze(tags),
    text: requireKnowledgeText(candidate.text, `NPC knowledge candidate ${id}`, 8_192),
  });
}

export function requireKnowledgeId(value: string, label: string): string {
  if (!/^[a-z0-9](?:[a-z0-9._:-]{0,127})$/u.test(value)) {
    throw new Error(`${label} ID is invalid`);
  }
  return value;
}

export function requireKnowledgeText(
  value: string,
  label: string,
  maximumCharacters: number,
): string {
  const normalized = value.trim();
  if (normalized === "" || normalized.length > maximumCharacters) {
    throw new Error(`${label} is empty or too long`);
  }
  return normalized;
}
