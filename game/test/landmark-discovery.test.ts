import { simulationWorldDefinition } from "@parallax/engine";
import { describe, expect, it } from "vitest";
import { LANDMARK_RULES_VERSION } from "../src/balance/exploration";
import { lowBitsMask } from "../src/sim/bitmask";
import {
  assertExplorationState,
  createInitialExplorationState,
  deserializeExplorationState,
  discoverNearbyLandmarks,
  EXPLORATION_STATE_BYTES,
  resolveNamedLandmarks,
  serializeExplorationState,
} from "../src/sim/exploration";
import { createGameSimulationAdapter, createReshapeCommand } from "../src/sim/m3-simulation";
import { awardExperience, spendAttributePoint } from "../src/sim/progression";
import { DISTRICT_1_GREYBOX_SPEC } from "../src/world/district-1.data";
import { createGreyboxScene } from "../src/world/greybox-generator";
import {
  assertNamedLandmarkDefinitions,
  LANDMARK_CAPACITY,
  NAMED_LANDMARKS,
  type NamedLandmarkDefinition,
} from "../src/world/landmarks";

const world = simulationWorldDefinition(createGreyboxScene(DISTRICT_1_GREYBOX_SPEC).world);
const context = Object.freeze({ timestepHz: 60, world });

describe("M3.5 landmark discovery", () => {
  it("discovers every authored landmark exactly once in stable data order", () => {
    const resolved = resolveNamedLandmarks(world);
    expect(resolved.map(({ landmark }) => landmark.id)).toEqual(
      NAMED_LANDMARKS.map(({ id }) => id),
    );
    let state = createInitialExplorationState();
    for (const landmark of resolved) {
      const first = discoverNearbyLandmarks(state, resolved, landmark.position);
      expect(first.discoveries.map(({ index }) => index)).toEqual([landmark.index]);
      const repeated = discoverNearbyLandmarks(first.state, resolved, landmark.position);
      expect(repeated.discoveries).toEqual([]);
      expect(repeated.state).toBe(first.state);
      state = first.state;
    }
    expect(state).toEqual({
      discoveredLandmarkCount: NAMED_LANDMARKS.length,
      discoveredLandmarkMask: lowBitsMask(NAMED_LANDMARKS.length),
      landmarkNominalExperienceAwarded: NAMED_LANDMARKS.reduce(
        (sum, landmark) => sum + landmark.experience,
        0,
      ),
    });
  });

  it("round-trips the canonical exploration block and rejects invalid masks", () => {
    const resolved = resolveNamedLandmarks(world);
    const discovered = discoverNearbyLandmarks(
      createInitialExplorationState(),
      resolved,
      resolved[0]?.position ?? [0, 0, 0],
    ).state;
    const bytes = new Uint8Array(EXPLORATION_STATE_BYTES);
    serializeExplorationState(new DataView(bytes.buffer), 0, discovered);
    expect(deserializeExplorationState(new DataView(bytes.buffer), 0)).toEqual(discovered);

    new DataView(bytes.buffer).setUint32(12, LANDMARK_RULES_VERSION + 1, true);
    expect(() => deserializeExplorationState(new DataView(bytes.buffer), 0)).toThrow(
      /unsupported landmark rules version/,
    );
    new DataView(bytes.buffer).setUint32(12, LANDMARK_RULES_VERSION, true);
    new DataView(bytes.buffer).setUint32(0, 1 << NAMED_LANDMARKS.length, true);
    expect(() => deserializeExplorationState(new DataView(bytes.buffer), 0)).toThrow(
      /exploration state is invalid/i,
    );
    expect(() =>
      assertExplorationState({ ...discovered, landmarkNominalExperienceAwarded: 0 }),
    ).toThrow(/exploration state is invalid/i);
  });

  it("guards the 31-bit vocabulary and validates authored landmark definitions", () => {
    expect(lowBitsMask(LANDMARK_CAPACITY)).toBe(0x7fff_ffff);
    expect(lowBitsMask(32)).toBe(0xffff_ffff);
    const fixture = NAMED_LANDMARKS[0];
    if (fixture === undefined) throw new Error("Named-landmark fixture is missing");
    const definition = (
      index: number,
      overrides: Partial<NamedLandmarkDefinition> = {},
    ): NamedLandmarkDefinition =>
      Object.freeze({
        ...fixture,
        id: `landmark-${index}`,
        markerId: `marker-${index}`,
        ...overrides,
      });
    expect(() =>
      assertNamedLandmarkDefinitions(
        Array.from({ length: LANDMARK_CAPACITY + 1 }, (_, index) => definition(index)),
      ),
    ).toThrow(/exceeds the persisted mask/);
    expect(() =>
      assertNamedLandmarkDefinitions([definition(0), definition(1, { id: "landmark-0" })]),
    ).toThrow(/definition.*invalid/);
    expect(() =>
      assertNamedLandmarkDefinitions([definition(0), definition(1, { markerId: "marker-0" })]),
    ).toThrow(/definition.*invalid/);
    expect(() => assertNamedLandmarkDefinitions([definition(0, { experience: 0 })])).toThrow(
      /definition.*invalid/,
    );
    expect(() =>
      assertNamedLandmarkDefinitions([definition(0, { discoveryRadiusMeters: 0 })]),
    ).toThrow(/definition.*invalid/);
    expect(() =>
      assertNamedLandmarkDefinitions([
        definition(0, {
          districtId: "missing-district" as NamedLandmarkDefinition["districtId"],
        }),
      ]),
    ).toThrow(/definition.*invalid/);
  });

  it("requires exact tagged-marker parity and walkable landmark positions", () => {
    const castleGateMarkerId = NAMED_LANDMARKS[0]?.markerId;
    if (castleGateMarkerId === undefined) throw new Error("Castle Gate fixture is missing");
    const withoutTag = Object.freeze({
      ...world,
      markers: Object.freeze(
        world.markers.map((marker) =>
          marker.id === castleGateMarkerId
            ? Object.freeze({ ...marker, tags: marker.tags.filter((tag) => tag !== "landmark") })
            : marker,
        ),
      ),
    });
    expect(() => resolveNamedLandmarks(withoutTag)).toThrow(/no tagged authored world marker/);

    const withUnknownTag = Object.freeze({
      ...world,
      markers: Object.freeze([
        ...world.markers,
        Object.freeze({
          id: "unexpected-landmark-marker",
          kind: "path" as const,
          position: Object.freeze([128, 0, 128] as const),
          tags: Object.freeze(["landmark"]),
        }),
      ]),
    });
    expect(() => resolveNamedLandmarks(withUnknownTag)).toThrow(/has no named-landmark definition/);

    const outsideNavigation = Object.freeze({
      ...world,
      markers: Object.freeze(
        world.markers.map((marker) =>
          marker.id === castleGateMarkerId
            ? Object.freeze({ ...marker, position: Object.freeze([10_000, 0, 10_000] as const) })
            : marker,
        ),
      ),
    });
    expect(() =>
      createGameSimulationAdapter(Object.freeze({ timestepHz: 60, world: outsideNavigation })),
    ).toThrow(/outside the navigation projection/);
  });

  it("awards proximity discovery through progression and publishes semantic evidence", () => {
    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(7);
    const first = adapter.step(initial, 1);
    expect(first.events.map(({ kind }) => kind)).toContain("landmark.discovered");
    expect(first.events.map(({ kind }) => kind)).toContain("progression.experience-gained");
    expect(first.state.progression).toMatchObject({
      experience: initial.progression.experience + 25,
      experienceAwardCount: initial.progression.experienceAwardCount + 1,
    });
    expect(adapter.telemetryCounters(first.state)).toMatchObject({
      landmarkDiscoveredCount: 1,
      landmarkNominalExperienceAwarded: 25,
    });

    const repeated = adapter.step(first.state, 2);
    expect(repeated.events.map(({ kind }) => kind)).not.toContain("landmark.discovered");
    expect(repeated.state.exploration).toEqual(first.state.exploration);
    expect(repeated.state.progression).toEqual(first.state.progression);

    const restored = adapter.deserializeState(adapter.serializeState(repeated.state));
    expect(restored.exploration).toEqual(first.state.exploration);
    expect(restored.progression).toEqual(first.state.progression);
  });

  it("keeps nominal discovery XP explicit when progression is already capped", () => {
    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(13);
    const cappedProgression = awardExperience(initial.progression, 100_000).state;
    const discovered = adapter.step(
      Object.freeze({ ...initial, progression: cappedProgression }),
      1,
    ).state;
    expect(discovered.progression.experience).toBe(cappedProgression.experience);
    expect(adapter.telemetryCounters(discovered)).toMatchObject({
      landmarkNominalExperienceAwarded: 25,
    });
  });

  it.each([
    ["Village Square", -640, -96],
    ["Forest Edge", 0, 768],
  ])("allows reshape at the new %s waystone", (_name, x, z) => {
    const adapter = createGameSimulationAdapter(context);
    const initial = adapter.createInitialState(17);
    const leveled = awardExperience(initial.progression, 500).state;
    const developed = spendAttributePoint(leveled, "might");
    const reshaped = adapter.applyCommand(
      Object.freeze({
        ...initial,
        playerPosition: Object.freeze([x, 0, z] as const),
        progression: developed,
      }),
      createReshapeCommand(0, 1),
    );
    expect(reshaped.events[0]?.kind).toBe("progression.reshaped");
    expect(reshaped.state.items.marks).toBe(0);
    expect(reshaped.state.progression.might).toBe(initial.progression.might);
  });

  it("exposes the saved discovered set as a bounded query snapshot", () => {
    const adapter = createGameSimulationAdapter(context);
    const discovered = adapter.step(adapter.createInitialState(11), 1).state;
    const payload = adapter.queryState?.(discovered, {
      kind: "landmarks.snapshot@1",
      payload: new Uint8Array(),
    });
    if (payload === undefined) throw new Error("Landmark query is unavailable");
    const snapshot = JSON.parse(new TextDecoder().decode(payload)) as Readonly<{
      readonly discoveredCount: number;
      readonly nominalExperienceAwarded: number;
      readonly landmarks: readonly Readonly<{
        readonly discovered: boolean;
        readonly id: string;
      }>[];
      readonly version: number;
    }>;
    expect(snapshot).toMatchObject({
      discoveredCount: 1,
      nominalExperienceAwarded: 25,
      version: 1,
    });
    expect(snapshot.landmarks).toHaveLength(NAMED_LANDMARKS.length);
    expect(snapshot.landmarks.filter(({ discovered: value }) => value).map(({ id }) => id)).toEqual(
      ["castle-gate-waystone"],
    );
  });
});
