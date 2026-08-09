import type {
  NpcKnowledgeCandidate,
  NpcKnowledgeProvider,
  NpcKnowledgeRequest,
  SimulationGameStateQuery,
  SimulationService,
} from "@parallax/engine";
import { M3_NPC_KNOWLEDGE_DISTRICTS, M3_NPC_KNOWLEDGE_PROFILES } from "./knowledge-data";

export const M3_NPC_KNOWLEDGE_QUERY_KIND = "npc.structured-knowledge@1";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

interface M3NpcKnowledgeQueryDocument {
  readonly npcId: string;
  readonly playerText: string;
  readonly tags: readonly string[];
}

export interface M3NpcKnowledgeLocationState {
  readonly npcId: string;
  readonly pathCursor: number;
  readonly position: readonly [number, number, number];
  readonly routeId: string;
  readonly targetStopIndex: number;
}

export function createM3StructuredKnowledgeProvider(
  simulationService: SimulationService,
): NpcKnowledgeProvider {
  return Object.freeze({
    id: "m3-game-state",
    async retrieve(
      request: NpcKnowledgeRequest,
      signal: AbortSignal,
    ): Promise<readonly NpcKnowledgeCandidate[]> {
      if (signal.aborted) throw signal.reason ?? new Error("NPC knowledge query was cancelled");
      const result = await simulationService.queryGameState(encodeM3NpcKnowledgeQuery(request));
      if (signal.aborted) throw signal.reason ?? new Error("NPC knowledge query was cancelled");
      return decodeM3NpcKnowledgeCandidates(result.payload);
    },
    tier: "structured-game-state",
  });
}

export function executeM3NpcKnowledgeQuery(
  query: SimulationGameStateQuery,
  districtId: string,
  locations: readonly M3NpcKnowledgeLocationState[],
): Uint8Array {
  if (query.kind !== M3_NPC_KNOWLEDGE_QUERY_KIND) {
    throw new Error(`Unsupported M3 game-state query ${query.kind}`);
  }
  const request = parseQueryDocument(query.payload);
  const profile = M3_NPC_KNOWLEDGE_PROFILES.find(({ npcId }) => npcId === request.npcId);
  if (profile === undefined)
    throw new Error(`NPC knowledge profile ${request.npcId} is unavailable`);
  const scope = new Set(request.tags);
  const words = normalizedWords(request.playerText);
  const district = M3_NPC_KNOWLEDGE_DISTRICTS[districtId] ?? Object.freeze([]);
  const candidates: NpcKnowledgeCandidate[] = district
    .filter(
      (fact) => fact.npcIds.includes(request.npcId) && fact.tags.some((tag) => scope.has(tag)),
    )
    .map((fact) =>
      Object.freeze({
        id: fact.id,
        priority: fact.priority,
        relevance: relevance(words, fact.tags),
        tags: fact.tags,
        text: fact.text,
      }),
    );
  const location = locations.find(({ npcId }) => npcId === request.npcId);
  if (location !== undefined && scope.has("npc-location")) {
    candidates.push(
      Object.freeze({
        id: `npc-location.${request.npcId}`,
        priority: 60,
        relevance: relevance(words, [
          "npc",
          "location",
          "route",
          "where",
          "headed",
          location.routeId,
        ]),
        tags: Object.freeze(["npc-location", "schedule"]),
        text: `${profile.displayName} is currently following the ${location.routeId} village route toward stop ${location.targetStopIndex}, at path step ${location.pathCursor} near (${formatCoordinate(location.position[0])}, ${formatCoordinate(location.position[2])}).`,
      }),
    );
  }
  return encoder.encode(JSON.stringify(candidates));
}

function encodeM3NpcKnowledgeQuery(request: NpcKnowledgeRequest): SimulationGameStateQuery {
  return Object.freeze({
    kind: M3_NPC_KNOWLEDGE_QUERY_KIND,
    payload: encoder.encode(
      JSON.stringify({ npcId: request.npcId, playerText: request.playerText, tags: request.tags }),
    ),
  });
}

function parseQueryDocument(payload: Uint8Array): M3NpcKnowledgeQueryDocument {
  const value = JSON.parse(decoder.decode(payload)) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).toSorted().join(",") !== "npcId,playerText,tags"
  ) {
    throw new Error("M3 NPC knowledge query document is invalid");
  }
  const npcId = Reflect.get(value, "npcId");
  const playerText = Reflect.get(value, "playerText");
  const tags = Reflect.get(value, "tags");
  if (
    typeof npcId !== "string" ||
    typeof playerText !== "string" ||
    !Array.isArray(tags) ||
    tags.some((tag) => typeof tag !== "string")
  ) {
    throw new Error("M3 NPC knowledge query fields are invalid");
  }
  return Object.freeze({ npcId, playerText, tags: Object.freeze(tags) });
}

function decodeM3NpcKnowledgeCandidates(payload: Uint8Array): readonly NpcKnowledgeCandidate[] {
  const value = JSON.parse(decoder.decode(payload)) as unknown;
  if (!Array.isArray(value)) throw new Error("M3 NPC knowledge result is not an array");
  return Object.freeze(value as NpcKnowledgeCandidate[]);
}

function relevance(queryWords: ReadonlySet<string>, candidateTerms: readonly string[]): number {
  const terms = new Set(candidateTerms.flatMap((term) => [...normalizedWords(term)]));
  let score = 0.1;
  for (const word of queryWords) if (terms.has(word)) score += 0.2;
  return Math.min(1, score);
}

function normalizedWords(text: string): ReadonlySet<string> {
  return new Set(text.toLocaleLowerCase("en-US").match(/[a-z0-9]+/gu) ?? []);
}

function formatCoordinate(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}
