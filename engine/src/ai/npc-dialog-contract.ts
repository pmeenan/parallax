export const NPC_DIALOG_TELEMETRY_SCHEMA_VERSION = 1;
export const NPC_DIALOG_NO_ACTION = "no_action";
export const NPC_DIALOG_NO_SUBJECT = "none";

export type NpcDialogInferenceDevice = "wllama-wasm" | "wllama-webgpu";

export interface NpcDialogMessage {
  readonly content: string;
  readonly role: "assistant" | "system" | "user";
}

export interface NpcDialogIntentDefinition {
  readonly description: string;
  readonly kind: string;
  readonly subjects: readonly string[];
}

export interface NpcDialogIntent {
  readonly kind: string;
  readonly subject: string;
}

export interface NpcDialogRequest {
  readonly intentDefinitions: readonly NpcDialogIntentDefinition[];
  readonly maxOutputTokens: number;
  readonly messages: readonly NpcDialogMessage[];
  readonly npcId: string;
}

export interface NpcDialogResponse {
  readonly firstTokenLatencyMs: number;
  readonly inputTokens: number;
  readonly intent: NpcDialogIntent;
  readonly outputTokens: number;
  readonly speech: string;
  readonly totalLatencyMs: number;
}

export interface NpcDialogFrameImpactTelemetry {
  readonly frameDurationMaximumMs: number | null;
  readonly frameDurationP95Ms: number | null;
  readonly presentIntervalMaximumMs: number | null;
  readonly presentIntervalP95Ms: number | null;
  readonly sampleCount: number;
}

export interface NpcDialogTelemetrySnapshot {
  readonly activeNpcId: string | null;
  readonly device: NpcDialogInferenceDevice;
  readonly failureCount: number;
  readonly failureMessage: string | null;
  readonly firstTokenLatencyMaximumMs: number | null;
  readonly firstTokenLatencyP95Ms: number | null;
  readonly frameImpact: NpcDialogFrameImpactTelemetry;
  readonly generationCount: number;
  readonly inputTokenCount: number;
  readonly loadElapsedMs: number | null;
  readonly outputTokenCount: number;
  readonly rejectedOutputCount: number;
  readonly requestCount: number;
  readonly schemaVersion: typeof NPC_DIALOG_TELEMETRY_SCHEMA_VERSION;
  readonly state:
    | "idle"
    | "loading-model"
    | "ready"
    | "generating"
    | "failed"
    | "unavailable"
    | "disposed";
}

export function validateNpcDialogRequest(request: NpcDialogRequest): NpcDialogRequest {
  requireId(request.npcId, "NPC");
  if (
    !Number.isSafeInteger(request.maxOutputTokens) ||
    request.maxOutputTokens < 1 ||
    request.maxOutputTokens > 256
  ) {
    throw new Error("NPC dialog output-token limit is invalid");
  }
  if (request.messages.length < 2 || request.messages.length > 32) {
    throw new Error("NPC dialog message count is invalid");
  }
  let characters = 0;
  const messages = request.messages.map((message) => {
    if (message.role !== "assistant" && message.role !== "system" && message.role !== "user") {
      throw new Error("NPC dialog message role is invalid");
    }
    const content = requireText(message.content, "NPC dialog message", 16_384);
    characters += content.length;
    return Object.freeze({ content, role: message.role });
  });
  if (characters > 32_768) throw new Error("NPC dialog prompt character budget exceeded");
  const kinds = new Set<string>([NPC_DIALOG_NO_ACTION]);
  const subjects = new Set<string>([NPC_DIALOG_NO_SUBJECT]);
  const definitions = request.intentDefinitions.map((definition) => {
    requireId(definition.kind, "NPC dialog intent");
    if (kinds.has(definition.kind)) throw new Error("NPC dialog intent kind is duplicated");
    kinds.add(definition.kind);
    const definitionSubjects = definition.subjects.map((subject) => {
      requireId(subject, "NPC dialog intent subject");
      if (subject === NPC_DIALOG_NO_SUBJECT) {
        throw new Error("NPC dialog intent cannot claim the reserved no-subject value");
      }
      subjects.add(subject);
      return subject;
    });
    if (
      definitionSubjects.length === 0 ||
      new Set(definitionSubjects).size !== definitionSubjects.length
    ) {
      throw new Error("NPC dialog intent subjects are empty or duplicated");
    }
    return Object.freeze({
      description: requireText(definition.description, "NPC dialog intent description", 512),
      kind: definition.kind,
      subjects: Object.freeze(definitionSubjects),
    });
  });
  if (definitions.length > 16 || subjects.size > 64) {
    throw new Error("NPC dialog structured-intent capacity exceeded");
  }
  return Object.freeze({
    intentDefinitions: Object.freeze(definitions),
    maxOutputTokens: request.maxOutputTokens,
    messages: Object.freeze(messages),
    npcId: request.npcId,
  });
}

export function parseNpcDialogOutput(
  output: string,
  definitions: readonly NpcDialogIntentDefinition[],
): Readonly<{ readonly intent: NpcDialogIntent; readonly speech: string }> {
  let value: unknown;
  try {
    value = JSON.parse(output) as unknown;
  } catch {
    throw new Error("NPC dialog output was not valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("NPC dialog output was not an object");
  }
  if (!hasExactKeys(value, ["intent", "speech", "subject"])) {
    throw new Error("NPC dialog output had unsupported or missing keys");
  }
  const speech = Reflect.get(value, "speech");
  const kind = Reflect.get(value, "intent");
  const subject = Reflect.get(value, "subject");
  if (typeof speech !== "string" || typeof kind !== "string" || typeof subject !== "string") {
    throw new Error("NPC dialog output fields had invalid types");
  }
  const normalizedSpeech = requireText(speech, "NPC dialog speech", 2_048);
  if (kind === NPC_DIALOG_NO_ACTION) {
    if (subject !== NPC_DIALOG_NO_SUBJECT) {
      throw new Error("NPC dialog no-action output named a state subject");
    }
  } else {
    const definition = definitions.find((candidate) => candidate.kind === kind);
    if (definition === undefined || !definition.subjects.includes(subject)) {
      throw new Error("NPC dialog output requested an unauthorized intent or subject");
    }
  }
  return Object.freeze({
    intent: Object.freeze({ kind, subject }),
    speech: normalizedSpeech,
  });
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function requireId(value: string, label: string): string {
  if (!/^[a-z0-9](?:[a-z0-9._:-]{0,127})$/u.test(value)) {
    throw new Error(`${label} ID is invalid`);
  }
  return value;
}

function requireText(value: string, label: string, maximumCharacters: number): string {
  const normalized = value.trim();
  if (normalized === "" || normalized.length > maximumCharacters) {
    throw new Error(`${label} is empty or too long`);
  }
  return normalized;
}
