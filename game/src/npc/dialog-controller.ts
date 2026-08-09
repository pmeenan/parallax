import type {
  HybridUiAction,
  HybridUiPresentation,
  NpcDialogIntent,
  NpcDialogMessage,
  NpcDialogService,
} from "@parallax/engine";
import { NPC_DIALOG_NO_ACTION, NPC_DIALOG_NO_SUBJECT } from "@parallax/engine";
import type { M3HybridUiModel } from "../ui/m3-hybrid-ui";
import { createNpcDialogMemory, type NpcDialogMemory } from "./dialog-memory";
import { type NpcPersonaCard, requireNpcPersonaByEntityId } from "./personas";

export interface NpcDialogIntentEvent {
  readonly intent: NpcDialogIntent;
  readonly npcId: string;
}

export interface NpcDialogController {
  dispose(): void;
  handleAction(action: HybridUiAction): void;
  open(entityId: number): HybridUiPresentation;
  subscribeIntents(listener: (event: NpcDialogIntentEvent) => void): () => void;
  subscribePresentations(listener: (presentation: HybridUiPresentation) => void): () => void;
}

const SUBMIT_ACTION = "dialog:submit";
const CLOSE_ACTION = "dialog:close";
const MAXIMUM_PLAYER_INPUT_CHARACTERS = 512;

export function createNpcDialogController(
  dialogService: NpcDialogService,
  ui: M3HybridUiModel,
): NpcDialogController {
  const memories = new Map<string, NpcDialogMemory>();
  const intentListeners = new Set<(event: NpcDialogIntentEvent) => void>();
  const presentationListeners = new Set<(presentation: HybridUiPresentation) => void>();
  let activePersona: NpcPersonaCard | null = null;
  let conversationEpoch = 0;
  let disposed = false;
  let generationTail: Promise<void> = Promise.resolve();
  let pendingGeneration: Readonly<{
    readonly abort: AbortController;
  }> | null = null;

  const present = (presentation: HybridUiPresentation): HybridUiPresentation => {
    for (const listener of presentationListeners) {
      try {
        listener(presentation);
      } catch (error: unknown) {
        console.error("NPC dialog presentation listener failed", error);
      }
    }
    return presentation;
  };
  const showReady = (persona: NpcPersonaCard, speech: string): HybridUiPresentation =>
    ui.showDialog({
      body: speech,
      choices: Object.freeze([
        Object.freeze({
          actionId: CLOSE_ACTION,
          disabled: false,
          id: "close",
          label: "End conversation",
        }),
      ]),
      speaker: persona.displayName,
      textEntry: Object.freeze({
        label: `Speak to ${persona.displayName}`,
        submitActionId: SUBMIT_ACTION,
        value: "",
      }),
      visible: true,
    });

  const submit = (playerSpeech: string): void => {
    const persona = activePersona;
    if (persona === null) return;
    const normalized = playerSpeech.trim();
    if (normalized === "") {
      present(showReady(persona, "Say what is on your mind, or end the conversation."));
      return;
    }
    if (normalized.length > MAXIMUM_PLAYER_INPUT_CHARACTERS) {
      present(showReady(persona, "That is too much for me at once. Ask in a shorter way."));
      return;
    }
    const epoch = conversationEpoch;
    present(
      ui.showDialog({
        body: `${persona.displayName} considers your words…`,
        choices: Object.freeze([
          Object.freeze({
            actionId: CLOSE_ACTION,
            disabled: false,
            id: "close",
            label: "End conversation",
          }),
        ]),
        speaker: persona.displayName,
        textEntry: null,
        visible: true,
      }),
    );
    const memory = memories.get(persona.id) ?? createNpcDialogMemory();
    memories.set(persona.id, memory);
    pendingGeneration?.abort.abort();
    const abort = new AbortController();
    const completion = generationTail
      .catch(() => undefined)
      .then(async () => {
        if (
          !isCurrentConversation(
            disposed,
            abort.signal,
            epoch,
            conversationEpoch,
            persona,
            activePersona,
          )
        ) {
          return;
        }
        try {
          const response = await dialogService.generate(
            {
              intentDefinitions: persona.intentDefinitions,
              maxOutputTokens: 128,
              messages: promptMessages(persona, memory, normalized),
              npcId: persona.id,
            },
            abort.signal,
          );
          if (
            !isCurrentConversation(
              disposed,
              abort.signal,
              epoch,
              conversationEpoch,
              persona,
              activePersona,
            )
          ) {
            return;
          }
          if (!isAllowedIntent(persona, response.intent)) {
            throw new Error("NPC dialog service returned an intent outside the persona contract");
          }
          memory.record({ npcSpeech: response.speech, playerSpeech: normalized });
          if (response.intent.kind !== NPC_DIALOG_NO_ACTION) {
            const event = Object.freeze({ intent: response.intent, npcId: persona.id });
            for (const listener of intentListeners) {
              try {
                listener(event);
              } catch (error: unknown) {
                console.error("NPC dialog intent listener failed", error);
              }
            }
          }
          present(showReady(persona, response.speech));
        } catch {
          if (
            !isCurrentConversation(
              disposed,
              abort.signal,
              epoch,
              conversationEpoch,
              persona,
              activePersona,
            )
          ) {
            return;
          }
          const speech = fallbackReply(persona, normalized);
          memory.record({ npcSpeech: speech, playerSpeech: normalized });
          present(showReady(persona, speech));
        }
      })
      .finally(() => {
        if (pendingGeneration?.abort === abort) pendingGeneration = null;
      });
    generationTail = completion;
    pendingGeneration = Object.freeze({ abort });
  };

  return Object.freeze({
    dispose(): void {
      if (disposed) return;
      disposed = true;
      pendingGeneration?.abort.abort();
      conversationEpoch += 1;
      activePersona = null;
      intentListeners.clear();
      presentationListeners.clear();
    },
    handleAction(action: HybridUiAction): void {
      if (disposed || activePersona === null) return;
      const current = ui.snapshot();
      if (action.presentationRevision !== current.revision || !current.dialog.visible) return;
      const closeEnabled = current.dialog.choices.some(
        (choice) => choice.actionId === CLOSE_ACTION && !choice.disabled,
      );
      if (
        action.actionId === CLOSE_ACTION &&
        action.source === "dialog-dom" &&
        action.payload === null &&
        closeEnabled
      ) {
        pendingGeneration?.abort.abort();
        conversationEpoch += 1;
        activePersona = null;
        present(ui.closeDialog());
      } else if (
        action.actionId === SUBMIT_ACTION &&
        action.source === "ime-dom" &&
        action.payload !== null &&
        current.dialog.textEntry?.submitActionId === SUBMIT_ACTION
      ) {
        submit(action.payload);
      }
    },
    open(entityId: number): HybridUiPresentation {
      if (disposed) throw new Error("NPC dialog controller is disposed");
      const persona = requireNpcPersonaByEntityId(entityId);
      pendingGeneration?.abort.abort();
      conversationEpoch += 1;
      activePersona = persona;
      return present(showReady(persona, persona.authoredFallback.opening));
    },
    subscribeIntents(listener: (event: NpcDialogIntentEvent) => void): () => void {
      intentListeners.add(listener);
      return () => intentListeners.delete(listener);
    },
    subscribePresentations(listener: (presentation: HybridUiPresentation) => void): () => void {
      presentationListeners.add(listener);
      return () => presentationListeners.delete(listener);
    },
  });
}

function promptMessages(
  persona: NpcPersonaCard,
  memory: NpcDialogMemory,
  playerSpeech: string,
): readonly NpcDialogMessage[] {
  const snapshot = memory.snapshot();
  const intentText = [
    `${NPC_DIALOG_NO_ACTION}/${NPC_DIALOG_NO_SUBJECT}: flavor speech with no state request.`,
    ...persona.intentDefinitions.map(
      (definition) =>
        `${definition.kind}: ${definition.description} Allowed subjects: ${definition.subjects.join(", ")}.`,
    ),
  ].join("\n");
  const messages: NpcDialogMessage[] = [
    Object.freeze({
      content: `${persona.systemPrompt}\n\nRetrieved context slot:\n${persona.retrievedContext.join("\n")}\n\nStructured intent contract:\n${intentText}\nReturn speech, intent, and subject through the constrained response.`,
      role: "system" as const,
    }),
  ];
  if (snapshot.summary !== null) {
    messages.push(
      Object.freeze({
        content: `Earlier player remarks for continuity: ${snapshot.summary.playerSpeech}`,
        role: "user" as const,
      }),
      Object.freeze({
        content: `Earlier ${persona.displayName} remarks for continuity: ${snapshot.summary.npcSpeech}`,
        role: "assistant" as const,
      }),
    );
  }
  for (const turn of snapshot.recentTurns) {
    messages.push(Object.freeze({ content: turn.playerSpeech, role: "user" as const }));
    messages.push(Object.freeze({ content: turn.npcSpeech, role: "assistant" as const }));
  }
  messages.push(Object.freeze({ content: playerSpeech, role: "user" as const }));
  return Object.freeze(messages);
}

function fallbackReply(persona: NpcPersonaCard, playerSpeech: string): string {
  const normalized = playerSpeech.toLocaleLowerCase("en-US");
  return (
    persona.authoredFallback.replies.find((reply) =>
      reply.keywords.some((keyword) => normalized.includes(keyword)),
    )?.speech ?? persona.authoredFallback.defaultReply
  );
}

function isAllowedIntent(persona: NpcPersonaCard, intent: NpcDialogIntent): boolean {
  if (intent.kind === NPC_DIALOG_NO_ACTION) return intent.subject === NPC_DIALOG_NO_SUBJECT;
  const definition = persona.intentDefinitions.find((candidate) => candidate.kind === intent.kind);
  return definition?.subjects.includes(intent.subject) === true;
}

function isCurrentConversation(
  disposed: boolean,
  signal: AbortSignal,
  expectedEpoch: number,
  actualEpoch: number,
  expectedPersona: NpcPersonaCard,
  activePersona: NpcPersonaCard | null,
): boolean {
  return (
    !disposed &&
    !signal.aborted &&
    expectedEpoch === actualEpoch &&
    activePersona?.id === expectedPersona.id
  );
}
