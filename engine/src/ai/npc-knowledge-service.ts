import {
  NPC_KNOWLEDGE_TELEMETRY_SCHEMA_VERSION,
  type NpcKnowledgeCandidate,
  type NpcKnowledgeContext,
  type NpcKnowledgeEntry,
  type NpcKnowledgeProvider,
  type NpcKnowledgeRequest,
  type NpcKnowledgeTelemetrySnapshot,
  requireKnowledgeId,
  validateNpcKnowledgeCandidate,
  validateNpcKnowledgeRequest,
} from "./npc-knowledge-contract";

const MAXIMUM_PROVIDER_CANDIDATES = 256;
const MAXIMUM_PROVIDERS = 16;
const MAXIMUM_TOTAL_CANDIDATES = 512;
const knowledgeEncoder = new TextEncoder();

export interface NpcKnowledgeService {
  assemble(request: NpcKnowledgeRequest, signal?: AbortSignal): Promise<NpcKnowledgeContext>;
  dispose(): void;
  snapshot(): NpcKnowledgeTelemetrySnapshot;
  subscribe(listener: (snapshot: NpcKnowledgeTelemetrySnapshot) => void): () => void;
}

export interface NpcKnowledgeServiceOptions {
  readonly estimateTokens?: (text: string) => number;
  readonly now?: () => number;
}

interface RankedCandidate {
  readonly candidate: NpcKnowledgeCandidate;
  readonly providerId: string;
  readonly providerOrder: number;
  readonly tier: NpcKnowledgeProvider["tier"];
}

export function createNpcKnowledgeService(
  providers: readonly NpcKnowledgeProvider[],
  options: NpcKnowledgeServiceOptions = {},
): NpcKnowledgeService {
  const registeredProviders = validateProviders(providers);
  const estimateTokens = options.estimateTokens ?? estimateNpcKnowledgeTokens;
  const now = options.now ?? (() => performance.now());
  const listeners = new Set<(snapshot: NpcKnowledgeTelemetrySnapshot) => void>();
  const activeControllers = new Set<AbortController>();
  let disposed = false;
  let telemetry = initialTelemetry(registeredProviders.length);

  const publish = (next: NpcKnowledgeTelemetrySnapshot): void => {
    telemetry = Object.freeze({ ...next });
    for (const listener of listeners) {
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("NPC knowledge telemetry listener failed", error);
      }
    }
  };

  return Object.freeze({
    async assemble(
      input: NpcKnowledgeRequest,
      callerSignal?: AbortSignal,
    ): Promise<NpcKnowledgeContext> {
      if (disposed) throw new Error("NPC knowledge service is disposed");
      const request = validateNpcKnowledgeRequest(input);
      const controller = new AbortController();
      activeControllers.add(controller);
      const forwardAbort = (): void => controller.abort(callerSignal?.reason);
      callerSignal?.addEventListener("abort", forwardAbort, { once: true });
      if (callerSignal?.aborted === true) forwardAbort();
      const startedAt = now();
      publish({
        ...telemetry,
        activeRequestCount: activeControllers.size,
        failureMessage: null,
        requestCount: telemetry.requestCount + 1,
        state: "assembling",
      });
      try {
        throwIfAborted(controller.signal);
        const providerResults = await Promise.all(
          registeredProviders.map(async (provider, providerOrder) => {
            const candidates = await awaitWithAbort(
              provider.retrieve(request, controller.signal),
              controller.signal,
            );
            throwIfAborted(controller.signal);
            if (candidates.length > MAXIMUM_PROVIDER_CANDIDATES) {
              throw new Error(`NPC knowledge provider ${provider.id} exceeded candidate capacity`);
            }
            return candidates.map(
              (candidate): RankedCandidate => ({
                candidate: validateNpcKnowledgeCandidate(candidate),
                providerId: provider.id,
                providerOrder,
                tier: provider.tier,
              }),
            );
          }),
        );
        const ranked = providerResults.flat().toSorted(compareCandidates);
        if (ranked.length > MAXIMUM_TOTAL_CANDIDATES) {
          throw new Error("NPC knowledge providers exceeded total candidate capacity");
        }
        const context = assembleContext(ranked, request.maximumTokens, estimateTokens);
        const duration = elapsed(now(), startedAt);
        publish({
          ...telemetry,
          activeRequestCount: Math.max(0, activeControllers.size - 1),
          assembledEntryCount: telemetry.assembledEntryCount + context.entries.length,
          assembledTokenCount: telemetry.assembledTokenCount + context.tokenCount,
          candidateCount: telemetry.candidateCount + ranked.length,
          failureMessage: null,
          retrievalDurationHighWaterMs: Math.max(telemetry.retrievalDurationHighWaterMs, duration),
          state: disposed ? "disposed" : activeControllers.size > 1 ? "assembling" : "ready",
        });
        return context;
      } catch (error: unknown) {
        const cancelled = controller.signal.aborted;
        if (!cancelled) controller.abort(error);
        const duration = elapsed(now(), startedAt);
        publish({
          ...telemetry,
          activeRequestCount: Math.max(0, activeControllers.size - 1),
          cancelledRequestCount: telemetry.cancelledRequestCount + (cancelled ? 1 : 0),
          failureCount: telemetry.failureCount + (cancelled ? 0 : 1),
          failureMessage: cancelled ? null : errorMessage(error),
          retrievalDurationHighWaterMs: Math.max(telemetry.retrievalDurationHighWaterMs, duration),
          state: disposed
            ? "disposed"
            : activeControllers.size > 1
              ? "assembling"
              : cancelled
                ? "ready"
                : "failed",
        });
        throw error;
      } finally {
        callerSignal?.removeEventListener("abort", forwardAbort);
        activeControllers.delete(controller);
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const controller of activeControllers)
        controller.abort(new Error("NPC knowledge service disposed"));
      activeControllers.clear();
      publish({ ...telemetry, activeRequestCount: 0, state: "disposed" });
      listeners.clear();
    },
    snapshot(): NpcKnowledgeTelemetrySnapshot {
      return telemetry;
    },
    subscribe(listener: (snapshot: NpcKnowledgeTelemetrySnapshot) => void): () => void {
      listeners.add(listener);
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("NPC knowledge telemetry listener failed", error);
      }
      return () => listeners.delete(listener);
    },
  });
}

export function estimateNpcKnowledgeTokens(text: string): number {
  // llama.cpp's byte-level tokenizer cannot emit more tokens than the UTF-8 input has
  // bytes. Budgeting by bytes is deliberately conservative but remains a hard bound
  // without coupling the generic retrieval service to a selected model tokenizer.
  return Math.max(1, knowledgeEncoder.encode(text).byteLength);
}

function validateProviders(
  providers: readonly NpcKnowledgeProvider[],
): readonly NpcKnowledgeProvider[] {
  if (providers.length > MAXIMUM_PROVIDERS) {
    throw new Error("NPC knowledge provider capacity exceeded");
  }
  const ids = new Set<string>();
  return Object.freeze(
    providers.map((provider) => {
      const id = requireKnowledgeId(provider.id, "NPC knowledge provider");
      if (ids.has(id)) throw new Error(`NPC knowledge provider ${id} is duplicated`);
      ids.add(id);
      const tier = provider.tier;
      if (
        tier !== "structured-game-state" &&
        tier !== "authored-lore" &&
        tier !== "episodic-memory"
      ) {
        throw new Error(`NPC knowledge provider ${id} tier is invalid`);
      }
      const retrieve = provider.retrieve;
      if (typeof retrieve !== "function") {
        throw new Error(`NPC knowledge provider ${id} retrieve function is invalid`);
      }
      return Object.freeze({ id, retrieve: retrieve.bind(provider), tier });
    }),
  );
}

function compareCandidates(left: RankedCandidate, right: RankedCandidate): number {
  return (
    right.candidate.relevance - left.candidate.relevance ||
    right.candidate.priority - left.candidate.priority ||
    left.providerOrder - right.providerOrder ||
    (left.candidate.id < right.candidate.id ? -1 : left.candidate.id > right.candidate.id ? 1 : 0)
  );
}

function assembleContext(
  ranked: readonly RankedCandidate[],
  maximumTokens: number,
  estimateTokens: (text: string) => number,
): NpcKnowledgeContext {
  const entries: NpcKnowledgeEntry[] = [];
  const identities = new Set<string>();
  let tokenCount = 0;
  for (const rankedCandidate of ranked) {
    const { candidate, providerId, tier } = rankedCandidate;
    const identity = `${providerId}:${candidate.id}`;
    if (identities.has(identity))
      throw new Error(`NPC knowledge candidate ${identity} is duplicated`);
    identities.add(identity);
    const citation = `[${identity}]`;
    const entryTokens = estimateTokens(`${citation} ${candidate.text}`);
    if (!Number.isSafeInteger(entryTokens) || entryTokens < 1) {
      throw new Error("NPC knowledge token estimator returned an invalid count");
    }
    if (tokenCount + entryTokens > maximumTokens) continue;
    entries.push(
      Object.freeze({
        citation,
        id: candidate.id,
        providerId,
        tags: candidate.tags,
        text: candidate.text,
        tier,
        tokenCount: entryTokens,
      }),
    );
    tokenCount += entryTokens;
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    formattedText: entries.map((entry) => `${entry.citation} ${entry.text}`).join("\n"),
    tokenCount,
  });
}

function initialTelemetry(providerCount: number): NpcKnowledgeTelemetrySnapshot {
  return Object.freeze({
    activeRequestCount: 0,
    assembledEntryCount: 0,
    assembledTokenCount: 0,
    cancelledRequestCount: 0,
    candidateCount: 0,
    failureCount: 0,
    failureMessage: null,
    providerCount,
    requestCount: 0,
    retrievalDurationHighWaterMs: 0,
    schemaVersion: NPC_KNOWLEDGE_TELEMETRY_SCHEMA_VERSION,
    state: "ready",
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error("NPC knowledge request was cancelled");
}

function awaitWithAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = (): void =>
      reject(signal.reason ?? new Error("NPC knowledge request was cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function elapsed(now: number, startedAt: number): number {
  const duration = now - startedAt;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "NPC knowledge retrieval failed";
}
