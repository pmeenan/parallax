import { createSimulationRuntime, runSimulationReplay } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import {
  createGameSimulationAdapter,
  createPlayerInputCommand,
  PLAYER_ENTITY_ID,
} from "../src/sim/m3-simulation";

describe("M3 game simulation adapter", () => {
  it("uses stable identity and a canonical binary input/save representation", () => {
    const adapter = createGameSimulationAdapter();
    const runtime = createSimulationRuntime(adapter, 0x1234_5678, 60);
    expect(
      runtime.enqueue(createPlayerInputCommand(0, 1, { forward: 1, right: -0.5, yawRadians: 1 })),
    ).toBe(true);
    expect(runtime.step()).toMatchObject({
      appliedCommandCount: 1,
      events: [{ kind: "input.command-applied", sequence: 0, tick: 1 }],
    });
    const saved = runtime.save();
    expect(saved.presentation.entities).toEqual([
      { id: PLAYER_ENTITY_ID, position: [0, 12, 0], yawRadians: 1 },
    ]);
    expect(createSimulationRuntime(adapter, 0, 60).load(saved.saveBytes).presentation).toEqual(
      saved.presentation,
    );
  });

  it("hash-matches repeated same-host replay", () => {
    const commands = Object.freeze([
      createPlayerInputCommand(0, 2, { forward: 1, right: 0, yawRadians: 0.25 }),
      createPlayerInputCommand(1, 8, { forward: 0, right: 1, yawRadians: -0.5 }),
    ]);
    const first = runSimulationReplay(createGameSimulationAdapter(), 8675309, 60, commands, 120);
    const second = runSimulationReplay(createGameSimulationAdapter(), 8675309, 60, commands, 120);
    expect(second).toEqual(first);
  });

  it("rejects serialized input axes outside the admitted command invariant", () => {
    const adapter = createGameSimulationAdapter();
    const bytes = adapter.serializeState(adapter.createInitialState(1));
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setFloat32(8, 999, true);
    expect(() => adapter.deserializeState(bytes)).toThrow(/input state/);
  });

  it("rejects a digest-valid save whose game payload violates input invariants", async () => {
    const adapter = createGameSimulationAdapter();
    const saved = createSimulationRuntime(adapter, 1, 60).save().saveBytes;
    const corrupt = saved.slice();
    new DataView(corrupt.buffer, corrupt.byteOffset, corrupt.byteLength).setFloat32(
      80 + 8,
      999,
      true,
    );
    const body = corrupt.subarray(80);
    const digestInput = new Uint8Array(48 + body.byteLength);
    digestInput.set(corrupt.subarray(0, 48));
    digestInput.set(body, 48);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput));
    corrupt.set(digest, 48);
    expect(() => createSimulationRuntime(adapter, 2, 60).load(corrupt)).toThrow(/input state/);
  });
});
