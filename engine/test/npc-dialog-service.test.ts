import { describe, expect, it } from "vitest";
import type { InstalledModelSource } from "../src/ai/installed-model-source";
import {
  createNpcDialogService,
  NpcDialogRejectedOutputError,
  type NpcDialogRuntimeFactory,
  NpcDialogUnavailableError,
  npcDialogResponseFormat,
  settleNpcDialogRuntimeCleanup,
} from "../src/ai/npc-dialog-service";
import type { RenderTelemetrySnapshot } from "../src/render/render-service";
import { createRenderService } from "../src/render/render-service";

describe("NPC dialog service", () => {
  it("bounds cleanup even when the runtime never settles", async () => {
    const startedAt = performance.now();
    await settleNpcDialogRuntimeCleanup(new Promise(() => undefined), 5);
    expect(performance.now() - startedAt).toBeLessThan(100);
  });

  it("builds a strict finite response grammar", () => {
    expect(npcDialogResponseFormat(request())).toEqual({
      json_schema: {
        name: "parallax_npc_dialog_turn",
        schema: {
          additionalProperties: false,
          properties: {
            intent: { enum: ["no_action"], type: "string" },
            speech: { maxLength: 2_048, minLength: 1, type: "string" },
            subject: { enum: ["none"], type: "string" },
          },
          required: ["intent", "speech", "subject"],
          type: "object",
        },
        strict: true,
      },
      type: "json_schema",
    });
  });

  it("lazily creates the selected runtime and records generation/frame impact", async () => {
    let render = createRenderService().snapshot();
    let renderListener: ((snapshot: RenderTelemetrySnapshot) => void) | null = null;
    let selectedDevice = "";
    let generationIndex = 0;
    const factory: NpcDialogRuntimeFactory = {
      async create(_source, device) {
        selectedDevice = device;
        return {
          dispose: () => Promise.resolve(),
          async generate() {
            generationIndex += 1;
            const activeListener = renderListener;
            if (activeListener !== null) {
              const recentFrames =
                generationIndex === 1
                  ? [
                      {
                        durationMs: 2,
                        lightingIntensity: 1,
                        lightingPhase: 0,
                        presentIntervalMs: 16,
                        sunDirection: [0, -1, 0] as const,
                        sunIntensity: 1,
                        rendering: {
                          casterCount: 0,
                          depthArrayBytes: 16_777_216,
                          membershipUpdates: 0,
                          retainedMaterialCount: 0,
                          technique: "directional-csm-pcf5@1" as const,
                          cpuSubmitMs: 1,
                          gpuFrameEmaMs: null,
                          shadowTaskGpuMs: null,
                          gpuTaskFrameIndex: null,
                          gpuTaskStatus: "unsupported",
                          droppedGpuTasks: 0,
                        },
                      },
                      {
                        durationMs: 4,
                        lightingIntensity: 1,
                        lightingPhase: 0,
                        presentIntervalMs: 20,
                        sunDirection: [0, -1, 0] as const,
                        sunIntensity: 1,
                        rendering: {
                          casterCount: 0,
                          depthArrayBytes: 16_777_216,
                          membershipUpdates: 0,
                          retainedMaterialCount: 0,
                          technique: "directional-csm-pcf5@1" as const,
                          cpuSubmitMs: 1,
                          gpuFrameEmaMs: null,
                          shadowTaskGpuMs: null,
                          gpuTaskFrameIndex: null,
                          gpuTaskStatus: "unsupported",
                          droppedGpuTasks: 0,
                        },
                      },
                    ]
                  : [
                      {
                        durationMs: 1,
                        lightingIntensity: 1,
                        lightingPhase: 0,
                        presentIntervalMs: 17,
                        sunDirection: [0, -1, 0] as const,
                        sunIntensity: 1,
                        rendering: {
                          casterCount: 0,
                          depthArrayBytes: 16_777_216,
                          membershipUpdates: 0,
                          retainedMaterialCount: 0,
                          technique: "directional-csm-pcf5@1" as const,
                          cpuSubmitMs: 1,
                          gpuFrameEmaMs: null,
                          shadowTaskGpuMs: null,
                          gpuTaskFrameIndex: null,
                          gpuTaskStatus: "unsupported",
                          droppedGpuTasks: 0,
                        },
                      },
                    ];
              render = {
                ...render,
                frameCount: render.frameCount + recentFrames.length,
                recentFrames,
              };
              activeListener(render);
            }
            return {
              firstTokenLatencyMs: 120,
              inputTokens: 40,
              intent: { kind: "no_action", subject: "none" },
              outputTokens: 12,
              speech: "The road is quiet.",
              totalLatencyMs: 250,
            };
          },
        };
      },
    };
    const service = createNpcDialogService(
      readySource(),
      {
        snapshot: () => render,
        subscribe(listener) {
          renderListener = listener;
          listener(render);
          return () => {
            renderListener = null;
          };
        },
      },
      "wllama-wasm",
      factory,
    );
    await expect(service.generate(request())).resolves.toMatchObject({
      speech: "The road is quiet.",
    });
    expect(selectedDevice).toBe("wllama-wasm");
    expect(service.snapshot()).toMatchObject({
      firstTokenLatencyP95Ms: 120,
      frameImpact: {
        frameDurationMaximumMs: 4,
        presentIntervalP95Ms: 20,
        sampleCount: 2,
      },
      generationCount: 1,
      inputTokenCount: 40,
      outputTokenCount: 12,
      requestCount: 1,
      state: "ready",
    });
    render = { ...render, recentFrames: [] };
    await service.generate(request());
    expect(service.snapshot().frameImpact).toMatchObject({
      frameDurationMaximumMs: 1,
      presentIntervalMaximumMs: 17,
      sampleCount: 1,
    });
    service.dispose();
  });

  it("classifies rejected output by type rather than runtime error wording", async () => {
    let generationIndex = 0;
    const service = createNpcDialogService(readySource(), createRenderService(), "wllama-webgpu", {
      async create() {
        return {
          dispose: () => Promise.resolve(),
          async generate() {
            generationIndex += 1;
            if (generationIndex === 1) throw new Error("failed to allocate output buffer");
            throw new NpcDialogRejectedOutputError("structured output was rejected");
          },
        };
      },
    });
    await expect(service.generate(request())).rejects.toThrow("allocate output buffer");
    expect(service.snapshot().rejectedOutputCount).toBe(0);
    await expect(service.generate(request())).rejects.toBeInstanceOf(NpcDialogRejectedOutputError);
    expect(service.snapshot().rejectedOutputCount).toBe(1);
    service.dispose();
  });

  it("fails closed to unavailable without constructing a runtime", async () => {
    let created = false;
    const service = createNpcDialogService(
      unavailableSource(),
      createRenderService(),
      "wllama-webgpu",
      {
        async create() {
          created = true;
          throw new Error("must not run");
        },
      },
    );
    await expect(service.generate(request())).rejects.toBeInstanceOf(NpcDialogUnavailableError);
    expect(created).toBe(false);
    expect(service.snapshot()).toMatchObject({
      activeNpcId: null,
      failureCount: 0,
      requestCount: 1,
      state: "unavailable",
    });
    service.dispose();
  });

  it("records one terminal failure when model initialization fails", async () => {
    const service = createNpcDialogService(readySource(), createRenderService(), "wllama-webgpu", {
      async create() {
        throw new Error("corrupt model shard");
      },
    });
    await expect(service.generate(request())).rejects.toThrow("corrupt model shard");
    expect(service.snapshot()).toMatchObject({
      activeNpcId: null,
      failureCount: 1,
      failureMessage: "corrupt model shard",
      requestCount: 1,
      state: "failed",
    });
    service.dispose();
  });

  it("cancels an active generation without recording an inference failure", async () => {
    const service = createNpcDialogService(readySource(), createRenderService(), "wllama-webgpu", {
      async create() {
        return {
          dispose: () => Promise.resolve(),
          generate(_request, signal) {
            return new Promise((_, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            });
          },
        };
      },
    });
    const controller = new AbortController();
    const generation = service.generate(request(), controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(generation).rejects.toBeInstanceOf(DOMException);
    expect(service.snapshot()).toMatchObject({
      activeNpcId: null,
      failureCount: 0,
      state: "ready",
    });
    service.dispose();
  });

  it("keeps disposed telemetry terminal when model loading settles later", async () => {
    let finishLoad!: (runtime: Awaited<ReturnType<NpcDialogRuntimeFactory["create"]>>) => void;
    const loading = new Promise<Awaited<ReturnType<NpcDialogRuntimeFactory["create"]>>>(
      (resolve) => {
        finishLoad = resolve;
      },
    );
    const service = createNpcDialogService(readySource(), createRenderService(), "wllama-webgpu", {
      create: () => loading,
    });
    const generation = service.generate(request());
    service.dispose();
    finishLoad({ dispose: () => Promise.resolve(), generate: () => Promise.reject() });
    await expect(generation).rejects.toBeInstanceOf(DOMException);
    expect(service.snapshot()).toMatchObject({ activeNpcId: null, state: "disposed" });
  });
});

function request() {
  return {
    intentDefinitions: [],
    maxOutputTokens: 32,
    messages: [
      { content: "Stay grounded.", role: "system" as const },
      { content: "How is the road?", role: "user" as const },
    ],
    npcId: "mara-venn",
  };
}

function readySource(): InstalledModelSource {
  return {
    artifacts: () => [],
    initialize: () => Promise.resolve([]),
    snapshot: () =>
      ({
        expectedArtifactBytes: 0,
        expectedArtifactCount: 0,
        failureMessage: null,
        networkFallbackCount: 0,
        releaseDigest: "a".repeat(64),
        resolvedArtifactBytes: 0,
        resolvedArtifactCount: 0,
        schemaVersion: 1,
        state: "ready",
      }) as const,
    subscribe: () => () => undefined,
  };
}

function unavailableSource(): InstalledModelSource {
  return {
    ...readySource(),
    artifacts: () => {
      throw new Error("unavailable");
    },
    initialize: () => Promise.reject(new Error("unavailable")),
    snapshot: () => ({ ...readySource().snapshot(), releaseDigest: null, state: "unavailable" }),
  };
}
