import { describe, expect, it } from "vitest";
import {
  createSimulationSnapshotBuffer,
  createSimulationSnapshotBufferWriter,
  readSimulationSnapshotBuffer,
  simulationSnapshotBufferBytes,
} from "../src/sim/simulation-snapshot-buffer";

describe("simulation snapshot shared buffer", () => {
  it("publishes fixed-capacity triple-buffered transforms with stable IDs", () => {
    const buffer = createSimulationSnapshotBuffer(2);
    expect(buffer.byteLength).toBe(simulationSnapshotBufferBytes(2));
    const writer = createSimulationSnapshotBufferWriter(buffer);
    const publication = writer.publish({
      entities: Object.freeze([
        Object.freeze({
          id: 1,
          position: Object.freeze([1, 2, 3]) as readonly [number, number, number],
          yawRadians: 0.5,
        }),
        Object.freeze({
          id: 9,
          position: Object.freeze([-4, 5, 6]) as readonly [number, number, number],
          yawRadians: -0.25,
        }),
      ]),
      stateHash: "a".repeat(64),
      tick: 7,
    });
    expect(readSimulationSnapshotBuffer(buffer, "a".repeat(64), publication).tick).toBe(7);
    expect(readSimulationSnapshotBuffer(buffer, "a".repeat(64))).toEqual({
      entities: [
        { id: 1, position: [1, 2, 3], yawRadians: 0.5 },
        { id: 9, position: [-4, 5, 6], yawRadians: -0.25 },
      ],
      stateHash: "a".repeat(64),
      tick: 7,
    });
  });

  it("rejects an exact publication after its triple-buffer slot is reused", () => {
    const buffer = createSimulationSnapshotBuffer(1);
    const writer = createSimulationSnapshotBufferWriter(buffer);
    const first = writer.publish({
      entities: [{ id: 1, position: [0, 0, 0], yawRadians: 0 }],
      stateHash: "a".repeat(64),
      tick: 1,
    });
    for (let tick = 2; tick <= 4; tick += 1) {
      writer.publish({
        entities: [{ id: 1, position: [tick, 0, 0], yawRadians: 0 }],
        stateHash: "b".repeat(64),
        tick,
      });
    }
    expect(() => readSimulationSnapshotBuffer(buffer, "a".repeat(64), first)).toThrow(
      /overwritten/,
    );
  });

  it("rejects a slot marked in-progress instead of accepting a torn payload", () => {
    const buffer = createSimulationSnapshotBuffer(1);
    const publication = createSimulationSnapshotBufferWriter(buffer).publish({
      entities: [{ id: 1, position: [0, 0, 0], yawRadians: 0 }],
      stateHash: "a".repeat(64),
      tick: 1,
    });
    const words = new Int32Array(buffer);
    Atomics.store(words, 4, -publication.sequence);
    expect(() => readSimulationSnapshotBuffer(buffer, "a".repeat(64), publication)).toThrow(
      /overwritten/,
    );
  });

  it("round-trips safe integer ticks and entity IDs wider than signed 32-bit", () => {
    const wide = 0x1_0000_0000 + 17;
    const buffer = createSimulationSnapshotBuffer(1);
    const publication = createSimulationSnapshotBufferWriter(buffer).publish({
      entities: [{ id: wide, position: [1, 2, 3], yawRadians: 0 }],
      stateHash: "a".repeat(64),
      tick: wide,
    });
    expect(readSimulationSnapshotBuffer(buffer, "a".repeat(64), publication)).toMatchObject({
      entities: [{ id: wide }],
      tick: wide,
    });
  });

  it("rejects capacity overflow without publishing a partial snapshot", () => {
    const buffer = createSimulationSnapshotBuffer(1);
    const writer = createSimulationSnapshotBufferWriter(buffer);
    expect(() =>
      writer.publish({
        entities: [
          { id: 1, position: [0, 0, 0], yawRadians: 0 },
          { id: 2, position: [0, 0, 0], yawRadians: 0 },
        ],
        stateHash: "b".repeat(64),
        tick: 1,
      }),
    ).toThrow(/capacity/);
    expect(() => readSimulationSnapshotBuffer(buffer, "b".repeat(64))).toThrow(/not published/);
  });
});
