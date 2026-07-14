import { describe, expect, it } from "vitest";
import type { ChromeTraceEvent } from "./presentation-trace.js";
import {
  decodedSourceCodeUnits,
  extractV8CodeCacheEvidence,
  resolveV8CodeCacheEvidence,
  resolveV8CodeCacheProductionEvidence,
  V8_CODE_CACHE_TRACE_CATEGORY,
  V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS,
  type V8ScriptArtifact,
} from "./v8-code-cache-trace.js";

const baseUrl = "http://127.0.0.1:4173";
const artifacts: readonly V8ScriptArtifact[] = Object.freeze([
  artifact("immutable/app-a.js", V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS),
  artifact("immutable/game-b.js", V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS - 1),
]);

describe("V8 code-cache trace extraction", () => {
  it("uses the narrow V8 category that still carries compile events", () => {
    expect(V8_CODE_CACHE_TRACE_CATEGORY).toBe("v8");
  });

  it("requires successful consumption for every cacheable warm artifact", () => {
    const evidence = extractV8CodeCacheEvidence(
      [
        compile("immutable/app-a.js", { cacheRejected: false, consumedCacheSize: 4096 }),
        compile("immutable/game-b.js"),
      ],
      baseUrl,
      artifacts,
      "warm",
    );

    expect(evidence).toMatchObject({
      cacheableArtifactCount: 1,
      consumedArtifactCount: 1,
      rejectedArtifactCount: 0,
    });
    expect(evidence.artifacts[0]).toMatchObject({
      cache: { consumedBytes: 4096, outcome: "consumed", state: "measured" },
      compilations: [{ compilation: "module", compileDurationUs: 10, streamed: true }],
      compileDurationUs: 10,
    });
    expect(evidence.artifacts[1]?.cache.state).toBe("not-applicable");
  });

  it("accepts attributed compilation without consumption in a fresh profile", () => {
    const evidence = extractV8CodeCacheEvidence(
      [compile("immutable/app-a.js"), compile("immutable/game-b.js")],
      baseUrl,
      artifacts,
      "fresh",
    );

    expect(evidence).toMatchObject({ cacheableArtifactCount: 1, consumedArtifactCount: 0 });
    expect(evidence.artifacts[0]?.cache).toMatchObject({ state: "not-applicable" });
  });

  it("treats the timestamp-backed produce launch as consumption not-applicable", () => {
    const result = resolveV8CodeCacheEvidence(
      [compile("immutable/app-a.js"), compile("immutable/game-b.js")],
      baseUrl,
      artifacts,
      "produce",
    );

    expect(result.state).toBe("measured");
    expect(result.evidence?.artifacts[0]?.cache).toMatchObject({
      reason: "produce profile has only a prior hot timestamp and no code cache to consume",
      state: "not-applicable",
    });
  });

  it("requires positive URL-attributed production for every cacheable artifact", () => {
    const result = resolveV8CodeCacheProductionEvidence(
      [produce("immutable/app-a.js", 3072)],
      baseUrl,
      artifacts,
      "produce",
    );

    expect(result).toMatchObject({
      state: "measured",
      evidence: {
        cacheableArtifactCount: 1,
        producedArtifactCount: 1,
        producedBytes: 3072,
      },
    });
    expect(result.evidence?.artifacts[0]).toMatchObject({
      productions: [{ processId: 1, producedBytes: 3072, state: "measured", threadId: 2 }],
      state: "measured",
    });
    expect(result.evidence?.artifacts[1]?.state).toBe("not-applicable");
  });

  it("invalidates missing or zero-sized cache production", () => {
    const missing = resolveV8CodeCacheProductionEvidence([], baseUrl, artifacts, "produce");
    expect(missing).toMatchObject({ state: "invalid" });
    if (missing.state === "invalid") {
      expect(missing.reason).toContain("no URL-attributed code-cache production event");
    }

    const zero = resolveV8CodeCacheProductionEvidence(
      [produce("immutable/app-a.js", 0)],
      baseUrl,
      artifacts,
      "produce",
    );
    expect(zero).toMatchObject({ state: "invalid" });
    if (zero.state === "invalid") {
      expect(zero.reason).toContain("positive producedCacheSize");
    }
  });

  it("retains positive production events when a sibling event is invalid", () => {
    const result = resolveV8CodeCacheProductionEvidence(
      [produce("immutable/app-a.js", 3072), produce("immutable/app-a.js", 0)],
      baseUrl,
      artifacts,
      "produce",
    );

    expect(result).toMatchObject({ state: "invalid", evidence: { producedBytes: 3072 } });
    expect(result.evidence?.artifacts[0]).toMatchObject({
      productions: [
        { producedBytes: 3072, state: "measured" },
        { reason: "production event lacks a positive producedCacheSize", state: "invalid" },
      ],
      state: "invalid",
    });
  });

  it("asserts fresh absence and measures warm re-production", () => {
    const fresh = resolveV8CodeCacheProductionEvidence([], baseUrl, artifacts, "fresh");
    expect(fresh).toMatchObject({
      evidence: { producedArtifactCount: 0, producedBytes: 0 },
      state: "measured",
    });
    expect(fresh.evidence?.artifacts[0]).toMatchObject({
      reason: "fresh launch emitted no unexpected URL-attributed code-cache production event",
      state: "not-applicable",
    });

    expect(
      resolveV8CodeCacheProductionEvidence(
        [produce("immutable/app-a.js", 3072)],
        baseUrl,
        artifacts,
        "fresh",
      ),
    ).toMatchObject({ state: "invalid" });
    expect(
      resolveV8CodeCacheProductionEvidence(
        [produce("immutable/game-b.js", 1024)],
        baseUrl,
        artifacts,
        "fresh",
      ),
    ).toMatchObject({ state: "invalid" });

    const warmWithoutReproduction = resolveV8CodeCacheProductionEvidence(
      [],
      baseUrl,
      artifacts,
      "warm",
    );
    expect(warmWithoutReproduction).toMatchObject({
      evidence: { producedArtifactCount: 0, producedBytes: 0 },
      state: "measured",
    });
    expect(warmWithoutReproduction.evidence?.artifacts[0]).toMatchObject({
      reason: "warm launch emitted no URL-attributed code-cache re-production event",
      state: "not-applicable",
    });

    expect(
      resolveV8CodeCacheProductionEvidence(
        [produce("immutable/app-a.js", 3072)],
        baseUrl,
        artifacts,
        "warm",
      ),
    ).toMatchObject({
      evidence: { producedArtifactCount: 1, producedBytes: 3072 },
      state: "measured",
    });

    expect(resolveV8CodeCacheProductionEvidence([], baseUrl, [], "produce")).toMatchObject({
      evidence: null,
      state: "invalid",
    });
  });

  it("retains every per-artifact diagnostic when warm consumption is unobservable", () => {
    const twoCacheableArtifacts = [
      artifact("immutable/app-a.js", V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS),
      artifact("immutable/engine-b.js", V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS),
    ];
    const result = resolveV8CodeCacheEvidence(
      [compile("immutable/app-a.js"), compile("immutable/engine-b.js")],
      baseUrl,
      twoCacheableArtifacts,
      "warm",
    );

    expect(result.state).toBe("invalid");
    expect(result).toMatchObject({
      evidence: {
        artifacts: [
          { artifact: "immutable/app-a.js", cache: { state: "invalid" } },
          { artifact: "immutable/engine-b.js", cache: { state: "invalid" } },
        ],
      },
    });
    if (result.state === "invalid") {
      expect(result.reason).toContain("immutable/app-a.js");
      expect(result.reason).toContain("immutable/engine-b.js");
      expect(result.reason).toContain("omits a usable consumedCacheSize/cacheRejected result");
      expect(result.reason.match(/V8 cache hit or rejection is unobservable/g)).toHaveLength(2);
    }
  });

  it("validates all attribution before evaluating any cache outcome", () => {
    const twoCacheableArtifacts = [
      artifact("immutable/app-a.js", V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS),
      artifact("immutable/engine-b.js", V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS),
    ];
    const result = resolveV8CodeCacheEvidence(
      [compile("immutable/app-a.js")],
      baseUrl,
      twoCacheableArtifacts,
      "warm",
    );

    expect(result).toEqual({
      evidence: null,
      reason:
        "V8 code-cache trace probe failed: artifact attribution failed: expected a compilation event for immutable/engine-b.js; received 0",
      state: "invalid",
    });
  });

  it("returns aggregate not-applicable when no script meets the source-length threshold", () => {
    const smallArtifact = artifact("immutable/small-a.js", 100, 3_000);
    const result = resolveV8CodeCacheEvidence(
      [compile("immutable/small-a.js")],
      baseUrl,
      [smallArtifact],
      "warm",
    );

    expect(result).toMatchObject({
      reason: "no immutable JavaScript artifact meets Chrome 150's cacheability threshold",
      state: "not-applicable",
      evidence: { cacheableArtifactCount: 0 },
    });
  });

  it("preserves an explicit rejection as measured negative evidence", () => {
    const result = resolveV8CodeCacheEvidence(
      [
        compile("immutable/app-a.js", { cacheRejected: true, consumedCacheSize: 4096 }),
        compile("immutable/game-b.js"),
      ],
      baseUrl,
      artifacts,
      "warm",
    );

    expect(result).toMatchObject({
      state: "measured",
      evidence: {
        consumedArtifactCount: 0,
        rejectedArtifactCount: 1,
      },
    });
  });

  it("retains a measured rejection alongside an unobservable artifact", () => {
    const mixedArtifacts = [
      artifact("immutable/app-a.js", V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS),
      artifact("immutable/engine-b.js", V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS),
    ];
    const result = resolveV8CodeCacheEvidence(
      [
        compile("immutable/app-a.js", { cacheRejected: true, consumedCacheSize: 4096 }),
        compile("immutable/engine-b.js"),
      ],
      baseUrl,
      mixedArtifacts,
      "warm",
    );

    expect(result).toMatchObject({
      state: "invalid",
      evidence: {
        artifacts: [
          { artifact: "immutable/app-a.js", cache: { outcome: "rejected", state: "measured" } },
          { artifact: "immutable/engine-b.js", cache: { state: "invalid" } },
        ],
        rejectedArtifactCount: 1,
      },
    });
  });

  it("uses decoded source code units rather than response bytes for cacheability", () => {
    const nonAsciiArtifact = artifact(
      "immutable/non-ascii-a.js",
      V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS * 2,
      V8_MIN_CACHEABLE_SCRIPT_CODE_UNITS - 1,
    );
    const result = resolveV8CodeCacheEvidence(
      [
        compile("immutable/non-ascii-a.js", {
          cacheRejected: false,
          consumedCacheSize: 2048,
        }),
      ],
      baseUrl,
      [nonAsciiArtifact],
      "warm",
    );

    expect(result).toMatchObject({
      state: "measured",
      evidence: { cacheableArtifactCount: 1, consumedArtifactCount: 1 },
    });
  });

  it("retains every realm when one artifact compiles more than once", () => {
    const result = resolveV8CodeCacheEvidence(
      [
        compile("immutable/app-a.js", { cacheRejected: false, consumedCacheSize: 2048 }),
        compile(
          "immutable/app-a.js",
          { cacheRejected: false, consumedCacheSize: 4096 },
          { pid: 2, tid: 7 },
        ),
        compile("immutable/game-b.js"),
      ],
      baseUrl,
      artifacts,
      "warm",
    );

    expect(result.state).toBe("measured");
    expect(result.evidence?.consumedArtifactCount).toBe(1);
    expect(result.evidence?.artifacts[0]).toMatchObject({
      artifact: "immutable/app-a.js",
      cache: { consumedBytes: 6144, outcome: "consumed", state: "measured" },
      compileDurationUs: 20,
      compilations: [
        { processId: 1, threadId: 2 },
        { processId: 2, threadId: 7 },
      ],
    });
  });

  it("counts a rejection when a sibling realm has no observable cache result", () => {
    const result = resolveV8CodeCacheEvidence(
      [
        compile("immutable/app-a.js", { cacheRejected: true, consumedCacheSize: 0 }),
        compile("immutable/app-a.js", {}, { pid: 2, tid: 7 }),
        compile("immutable/game-b.js"),
      ],
      baseUrl,
      artifacts,
      "warm",
    );

    expect(result).toMatchObject({
      state: "invalid",
      evidence: { rejectedArtifactCount: 1 },
    });
    expect(result.evidence?.artifacts[0]).toMatchObject({
      artifact: "immutable/app-a.js",
      cache: { state: "invalid" },
      compilations: [
        { cache: { outcome: "rejected", state: "measured" } },
        { cache: { state: "invalid" } },
      ],
    });
  });

  it("counts an explicit rejection even when its size is zero or absent", () => {
    for (const consumedCacheSize of [0, undefined]) {
      const result = resolveV8CodeCacheEvidence(
        [
          compile("immutable/app-a.js", { cacheRejected: true, consumedCacheSize }),
          compile("immutable/game-b.js"),
        ],
        baseUrl,
        artifacts,
        "warm",
      );
      expect(result.state).toBe("measured");
      expect(result.evidence?.rejectedArtifactCount).toBe(1);
      expect(result.evidence?.artifacts[0]?.cache).toMatchObject({
        outcome: "rejected",
        state: "measured",
      });
    }
  });

  it("covers classic compilation, malformed streaming state, and fresh anomalies", () => {
    const classic = compile(
      "immutable/app-a.js",
      { cacheRejected: false, consumedCacheSize: 2048 },
      { name: "v8.compile", streamed: false },
    );
    const warm = resolveV8CodeCacheEvidence(
      [classic, compile("immutable/game-b.js")],
      baseUrl,
      artifacts,
      "warm",
    );
    expect(warm.state).toBe("measured");
    expect(warm.evidence?.artifacts[0]?.compilations[0]).toMatchObject({
      compilation: "classic",
      streamed: false,
    });

    const malformed = resolveV8CodeCacheEvidence(
      [compile("immutable/app-a.js", {}, { streamed: "missing" }), compile("immutable/game-b.js")],
      baseUrl,
      artifacts,
      "warm",
    );
    expect(malformed).toMatchObject({ evidence: null, state: "invalid" });

    const missingDuration = resolveV8CodeCacheEvidence(
      [compile("immutable/app-a.js", {}, { dur: "missing" }), compile("immutable/game-b.js")],
      baseUrl,
      artifacts,
      "warm",
    );
    expect(missingDuration).toMatchObject({ evidence: null, state: "invalid" });
    if (missingDuration.state === "invalid") {
      expect(missingDuration.reason).toContain("has no finite nonnegative duration");
    }

    const freshAnomaly = resolveV8CodeCacheEvidence(
      [classic, compile("immutable/game-b.js")],
      baseUrl,
      artifacts,
      "fresh",
    );
    expect(freshAnomaly.state).toBe("invalid");
    expect(freshAnomaly.evidence?.artifacts[0]?.cache.state).toBe("invalid");
  });

  it("rejects an empty artifact contract and strips a leading BOM from source length", () => {
    expect(resolveV8CodeCacheEvidence([], baseUrl, [], "warm")).toMatchObject({
      evidence: null,
      state: "invalid",
    });
    expect(decodedSourceCodeUnits("\uFEFFabc")).toBe(3);
    expect(decodedSourceCodeUnits("abc")).toBe(3);
  });
});

function artifact(
  path: string,
  sourceCodeUnits: number,
  bytes = sourceCodeUnits,
): V8ScriptArtifact {
  return { bytes, path, sourceCodeUnits };
}

function compile(
  path: string,
  cache: Readonly<{ cacheRejected?: boolean; consumedCacheSize?: number | undefined }> = {},
  options: Readonly<{
    dur?: number | "missing";
    name?: "v8.compile" | "v8.compileModule";
    pid?: number;
    streamed?: boolean | "missing";
    tid?: number;
  }> = {},
): ChromeTraceEvent {
  return {
    args: {
      data: {
        ...cache,
        ...(options.streamed === "missing" ? {} : { streamed: options.streamed ?? true }),
        url: new URL(path, `${baseUrl}/`).href,
      },
    },
    cat: "v8,devtools.timeline",
    ...(options.dur === "missing" ? {} : { dur: options.dur ?? 10 }),
    name: options.name ?? "v8.compileModule",
    ph: "X",
    pid: options.pid ?? 1,
    tid: options.tid ?? 2,
    ts: 100,
  };
}

function produce(path: string, producedCacheSize: number): ChromeTraceEvent {
  return {
    args: {
      data: {
        cacheProduceOptions: "code",
        producedCacheSize,
        url: new URL(path, `${baseUrl}/`).href,
      },
    },
    cat: "v8,devtools.timeline",
    dur: 10,
    name: "v8.produceModuleCache",
    ph: "X",
    pid: 1,
    tid: 2,
    ts: 100,
  };
}
