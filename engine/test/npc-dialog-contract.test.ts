import { describe, expect, it } from "vitest";
import { parseNpcDialogOutput, validateNpcDialogRequest } from "../src/ai/npc-dialog-contract";

const definitions = Object.freeze([
  Object.freeze({
    description: "Offer an authored route.",
    kind: "offer_directions",
    subjects: Object.freeze(["east-road"]),
  }),
]);

describe("NPC dialog contract", () => {
  it("freezes a bounded prompt and admits only exact authorized intent pairs", () => {
    const request = validateNpcDialogRequest({
      intentDefinitions: definitions,
      maxOutputTokens: 64,
      messages: [
        { content: "Stay grounded.", role: "system" },
        { content: "Which road?", role: "user" },
      ],
      npcId: "mara-venn",
    });
    expect(Object.isFrozen(request.messages)).toBe(true);
    expect(
      parseNpcDialogOutput(
        JSON.stringify({
          intent: "offer_directions",
          speech: "Take the east road.",
          subject: "east-road",
        }),
        definitions,
      ),
    ).toEqual({
      intent: { kind: "offer_directions", subject: "east-road" },
      speech: "Take the east road.",
    });
    expect(
      parseNpcDialogOutput(
        JSON.stringify({ intent: "no_action", speech: "Good evening.", subject: "none" }),
        definitions,
      ),
    ).toEqual({ intent: { kind: "no_action", subject: "none" }, speech: "Good evening." });
  });

  it("rejects extra fields, mismatched no-action subjects, and unauthorized state requests", () => {
    expect(() =>
      parseNpcDialogOutput(
        JSON.stringify({ extra: true, intent: "no_action", speech: "Hello.", subject: "none" }),
        definitions,
      ),
    ).toThrow(/unsupported or missing keys/);
    expect(() =>
      parseNpcDialogOutput(
        JSON.stringify({ intent: "no_action", speech: "Hello.", subject: "east-road" }),
        definitions,
      ),
    ).toThrow(/no-action/);
    expect(() =>
      parseNpcDialogOutput(
        JSON.stringify({ intent: "open_gate", speech: "Done.", subject: "east-road" }),
        definitions,
      ),
    ).toThrow(/unauthorized/);
  });
});
