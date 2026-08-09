export const NPC_ENTITY_ID_START = 1_000;

export const CONVERSATIONAL_NPC_ENTITY_IDS: readonly number[] = Object.freeze([
  NPC_ENTITY_ID_START,
]);

export function isConversationalNpcEntityId(entityId: number): boolean {
  return CONVERSATIONAL_NPC_ENTITY_IDS.includes(entityId);
}
