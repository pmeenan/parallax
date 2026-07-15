import { describe, expect, it } from "vitest";
import { evaluateHttpServingEvidence, formatHttpServingEvidence } from "./http-evidence.js";
import type { LocalServerMetrics } from "./server.js";

function delta(overrides: Partial<LocalServerMetrics>): LocalServerMetrics {
  return {
    bytesServed: 0,
    bytesServedByPathClass: { document: 0, immutable: 0, other: 0 },
    metadataCacheHits: 0,
    metadataCacheMisses: 0,
    pathClasses: { document: 0, immutable: 0, other: 0 },
    requests: 0,
    schemaVersion: 2,
    statuses: {},
    statusesByPathClass: { document: {}, immutable: {}, other: {} },
    ...overrides,
  };
}

// Calibrated against recorded smoke results: fresh runs fetch the document plus every
// immutable artifact as full-body 200s; warm runs revalidate the document via 304 and
// serve the immutable artifacts from the browser HTTP cache without contacting the
// server at all.
const observedFresh = delta({
  bytesServed: 5_267_831,
  bytesServedByPathClass: { document: 1_206, immutable: 5_266_625, other: 0 },
  metadataCacheMisses: 5,
  pathClasses: { document: 1, immutable: 4, other: 0 },
  requests: 5,
  statuses: { "200": 5, "404": 0 },
  statusesByPathClass: {
    document: { "200": 1 },
    immutable: { "200": 4, "404": 0 },
    other: {},
  },
});

const observedWarm = delta({
  metadataCacheHits: 1,
  pathClasses: { document: 1, immutable: 0, other: 0 },
  requests: 1,
  statuses: { "200": 0, "304": 1, "404": 0 },
  statusesByPathClass: {
    document: { "200": 0, "304": 1 },
    immutable: {},
    other: {},
  },
});

describe("HTTP serving evidence", () => {
  it("accepts the recorded fresh-run serving shape", () => {
    const observations = evaluateHttpServingEvidence("fresh", 1, observedFresh);
    expect(observations).toHaveLength(2);
    expect(observations.every((observation) => observation.satisfied)).toBe(true);
  });

  it("accepts the recorded warm-run serving shape", () => {
    const observations = evaluateHttpServingEvidence("warm", 2, observedWarm);
    expect(observations).toHaveLength(3);
    expect(observations.every((observation) => observation.satisfied)).toBe(true);
  });

  it("ignores zero-count error-status keys carried over from the cumulative snapshot", () => {
    const observations = evaluateHttpServingEvidence("fresh", 1, observedFresh);
    expect(observations[0]?.satisfied).toBe(true);
    expect(observations[0]?.description).toContain("shows none");
  });

  it("flags error responses inside the run window", () => {
    const observations = evaluateHttpServingEvidence(
      "fresh",
      3,
      delta({ requests: 2, statuses: { "200": 1, "404": 1 } }),
    );
    expect(observations[0]).toMatchObject({ satisfied: false });
    expect(observations[0]?.description).toContain("1x 404");
  });

  it("flags a fresh run whose immutable artifacts never reached the server", () => {
    const observations = evaluateHttpServingEvidence(
      "fresh",
      1,
      delta({
        bytesServed: 1_206,
        bytesServedByPathClass: { document: 1_206, immutable: 0, other: 0 },
        pathClasses: { document: 1, immutable: 0, other: 0 },
        requests: 1,
        statuses: { "200": 1 },
        statusesByPathClass: { document: { "200": 1 }, immutable: {}, other: {} },
      }),
    );
    expect(observations[1]).toMatchObject({ satisfied: false });
    expect(observations[1]?.description).toContain("0 immutable requests");
  });

  it("flags a fresh run whose immutable responses were revalidations instead of bodies", () => {
    // Aggregate counters alone would pass this shape: document bytes are positive and
    // immutable requests exist — but the correlated counters prove the immutable
    // responses were 304s without bodies.
    const observations = evaluateHttpServingEvidence(
      "fresh",
      2,
      delta({
        bytesServed: 1_206,
        bytesServedByPathClass: { document: 1_206, immutable: 0, other: 0 },
        pathClasses: { document: 1, immutable: 4, other: 0 },
        requests: 5,
        statuses: { "200": 1, "304": 4 },
        statusesByPathClass: { document: { "200": 1 }, immutable: { "304": 4 }, other: {} },
      }),
    );
    expect(observations[1]).toMatchObject({ satisfied: false });
    expect(observations[1]?.description).toContain("4x 304");
  });

  it("flags warm-run immutable requests that reached the server", () => {
    const observations = evaluateHttpServingEvidence(
      "warm",
      1,
      delta({
        pathClasses: { document: 1, immutable: 2, other: 0 },
        requests: 3,
        statuses: { "304": 3 },
        statusesByPathClass: { document: { "304": 1 }, immutable: { "304": 2 }, other: {} },
      }),
    );
    expect(observations[1]).toMatchObject({ satisfied: false });
    expect(observations[1]?.description).toContain("the delta shows 2");
  });

  it("flags a warm-run document load that did not revalidate via 304", () => {
    const observations = evaluateHttpServingEvidence(
      "warm",
      1,
      delta({
        bytesServed: 128,
        bytesServedByPathClass: { document: 128, immutable: 0, other: 0 },
        pathClasses: { document: 1, immutable: 0, other: 0 },
        requests: 1,
        statuses: { "200": 1 },
        statusesByPathClass: { document: { "200": 1 }, immutable: {}, other: {} },
      }),
    );
    expect(observations[2]).toMatchObject({ satisfied: false });
    expect(observations[2]?.description).toContain("1 document request with statuses 1x 200");
  });

  it("fails the warm-run revalidation observation when no document request was made", () => {
    // Zero document requests never demonstrated revalidation; an unrelated 304 in the
    // aggregate statuses must not turn this into a pass.
    const observations = evaluateHttpServingEvidence(
      "warm",
      3,
      delta({
        pathClasses: { document: 0, immutable: 0, other: 1 },
        requests: 1,
        statuses: { "304": 1 },
        statusesByPathClass: { document: {}, immutable: {}, other: { "304": 1 } },
      }),
    );
    expect(observations[2]).toMatchObject({ satisfied: false });
    expect(observations[2]?.description).toContain("0 document requests with statuses none");
  });

  it("renders a one-line report summary from a delta", () => {
    expect(formatHttpServingEvidence("fresh", 1, observedFresh)).toBe(
      "- fresh repeat 1: 5 requests (1 document / 4 immutable / 0 other); statuses 5x 200; 5267831 bytes served; metadata cache 0 hits / 5 misses",
    );
    expect(formatHttpServingEvidence("warm", 2, observedWarm)).toBe(
      "- warm repeat 2: 1 request (1 document / 0 immutable / 0 other); statuses 1x 304; 0 bytes served; metadata cache 1 hit / 0 misses",
    );
  });
});
