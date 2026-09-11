import { describe, expect, it, vi } from "vitest";
import type { SpatialAudioRequest } from "../src/audio/spatial-audio-contract";
import { bindSpatialAudioLifecycle } from "../src/audio/spatial-audio-lifecycle";
import { createSpatialAudioService } from "../src/audio/spatial-audio-service";
import { gameplayCameraPose } from "../src/render/gameplay-camera";

const limits = { maximumClips: 2, maximumPcmBytes: 160_000, maximumVoices: 2 };
const pose = { position: [0, 0, 0], forward: [0, 0, 1], up: [0, 1, 0] } as const;
const request: SpatialAudioRequest = {
  clipId: "signal",
  sceneId: "test-world",
  gain: 0.1,
  position: [3, 0, 4],
  referenceDistance: 1,
  maximumDistance: 60,
  emitterId: 7,
};

function fakeAudio(initialState = "running") {
  const vector = () => ({ value: 0 });
  const listener = {
    positionX: vector(),
    positionY: vector(),
    positionZ: vector(),
    forwardX: vector(),
    forwardY: vector(),
    forwardZ: vector(),
    upX: vector(),
    upY: vector(),
    upZ: vector(),
  };
  const panners: ReturnType<typeof createPanner>[] = [];
  const sources: ReturnType<typeof createSource>[] = [];
  const gains: ReturnType<typeof createGain>[] = [];
  const buffers: Float32Array[] = [];
  const createPanner = () => ({
    positionX: vector(),
    positionY: vector(),
    positionZ: vector(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    panningModel: "",
    distanceModel: "",
    refDistance: 0,
    maxDistance: 0,
  });
  const createGain = () => ({ gain: vector(), connect: vi.fn(), disconnect: vi.fn() });
  const createSource = () => ({
    buffer: null,
    loop: false,
    onended: null as (() => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  });
  const context = {
    state: initialState,
    sampleRate: 48_000,
    baseLatency: 0.01,
    outputLatency: 0.02,
    listener,
    destination: {},
    onstatechange: null as (() => void) | null,
    createBuffer: vi.fn((_channels: number, frames: number, _rate: number) => {
      const samples = new Float32Array(frames);
      buffers.push(samples);
      return {
        length: frames,
        copyToChannel: (chunk: Float32Array, _channel: number, offset: number) =>
          samples.set(chunk, offset),
      };
    }),
    createPanner: () => {
      const node = createPanner();
      panners.push(node);
      return node;
    },
    createGain: () => {
      const node = createGain();
      gains.push(node);
      return node;
    },
    createBufferSource: () => {
      const node = createSource();
      sources.push(node);
      return node;
    },
    resume: vi.fn(async () => {
      context.state = "running";
      context.onstatechange?.();
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
  };
  const platform = {
    createContext: vi.fn(() => context as unknown as AudioContext),
    now: () => 10,
    yieldPreparation: vi.fn(async (): Promise<void> => undefined),
  };
  const service = createSpatialAudioService(limits, platform);
  const ready = async () => {
    await service.prepareClip({
      id: "signal",
      sampleRate: 48_000,
      samples: new Float32Array(480).fill(0.1),
    });
    service.setScene("test-world");
    service.setListener(pose);
  };
  return { service, context, panners, sources, gains, platform, ready, buffers };
}

describe("bounded spatial audio", () => {
  it("is lazy, bounds graph size, copies PCM, and reflects only the handedness axis", async () => {
    const f = fakeAudio();
    expect(f.platform.createContext).not.toHaveBeenCalled();
    await f.ready();
    expect(f.panners).toHaveLength(limits.maximumVoices);
    const id = f.service.play(request);
    expect(id).not.toBeNull();
    expect(f.panners[0]).toMatchObject({
      positionX: { value: 3 },
      positionZ: { value: -4 },
      panningModel: "equalpower",
      distanceModel: "inverse",
    });
    expect(f.context.listener.forwardZ.value).toBe(-1);
    expect(f.service.snapshot()).toMatchObject({
      activeVoices: 1,
      cacheHitCount: 1,
      clipCount: 1,
      pcmBytes: 1_920,
    });
    expect(f.service.play(request)).not.toBeNull();
    expect(f.service.play(request)).toBeNull();
    expect(f.service.snapshot().capacityDropCount).toBe(1);
    expect(f.sources).toHaveLength(2);
  });

  it("does not queue suspended sounds and coalesces pending activation", async () => {
    const f = fakeAudio("suspended");
    await f.ready();
    let resume!: () => void;
    f.context.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resume = resolve;
        }),
    );
    f.service.activate();
    f.service.activate();
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    expect(f.service.play(request)).toBeNull();
    expect(f.sources).toHaveLength(0);
    await f.service.dispose();
    resume();
    await Promise.resolve();
    expect(f.service.snapshot().state).toBe("disposed");
  });

  it("recycles voice slots without letting an old ended callback stop a new voice", async () => {
    const f = fakeAudio();
    await f.ready();
    const first = f.service.play(request);
    const delayedEnded = f.sources[0]?.onended;
    f.service.stop(first as number);
    const second = f.service.play(request);
    expect(second).not.toBe(first);
    delayedEnded?.();
    f.service.stop(first as number);
    expect(f.service.snapshot().activeVoices).toBe(1);
    f.sources[1]?.onended?.();
    expect(f.service.snapshot()).toMatchObject({ activeVoices: 0, endedCount: 1, stoppedCount: 1 });
  });

  it("updates emitter positions and stops removed emitters, scenes, clips and hidden playback", async () => {
    const f = fakeAudio();
    await f.ready();
    f.service.play({ ...request, loop: true });
    f.service.updateEmitters([{ id: 7, position: [5, 6, 7] }]);
    expect(f.panners[0]?.positionZ.value).toBe(-7);
    f.service.updateEmitters([]);
    expect(f.service.snapshot().activeVoices).toBe(0);
    f.service.play(request);
    f.service.setScene("underground");
    expect(f.service.play(request)).toBeNull();
    f.service.setScene("test-world");
    expect(f.service.play(request)).toBeNull(); // listener must be rebound to the new scene
    f.service.setListener(pose);
    f.service.play(request);
    f.service.setEnabled(false);
    expect(f.service.snapshot().activeVoices).toBe(0);
    f.service.setEnabled(true);
    f.service.play(request);
    f.service.releaseClip("signal");
    expect(f.service.snapshot()).toMatchObject({ activeVoices: 0, pcmBytes: 0, clipCount: 0 });
    expect(f.service.play(request)).toBeNull();
    expect(f.service.snapshot().cacheMissCount).toBe(1);
  });

  it("stops voices when Chrome interrupts the context and releases its nodes on disposal", async () => {
    const f = fakeAudio();
    await f.ready();
    f.service.play(request);
    f.context.state = "interrupted";
    f.context.onstatechange?.();
    expect(f.service.snapshot()).toMatchObject({ state: "suspended", activeVoices: 0 });
    await f.service.dispose();
    await f.service.dispose();
    expect(f.context.close).toHaveBeenCalledTimes(1);
    for (const node of [...f.panners, ...f.gains]) expect(node.disconnect).toHaveBeenCalledTimes(1);
  });

  it("reserves concurrent preparations, bounds memory before allocation and releases rejected PCM", async () => {
    const f = fakeAudio();
    let release!: () => void;
    f.platform.yieldPreparation.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = f.service.prepareClip({
      id: "large",
      sampleRate: 48_000,
      samples: new Float32Array(30_000),
    });
    expect(f.service.snapshot().pendingPcmBytes).toBe(120_000);
    await expect(
      f.service.prepareClip({ id: "extra", sampleRate: 48_000, samples: new Float32Array(20_000) }),
    ).rejects.toThrow(/capacity/);
    await expect(
      f.service.prepareClip({ id: "large", sampleRate: 48_000, samples: new Float32Array(1) }),
    ).rejects.toThrow(/already/);
    release();
    await pending;
    expect(f.service.snapshot()).toMatchObject({ pendingPcmBytes: 0, pcmBytes: 120_000 });
    f.service.releaseClip("large");
    await expect(
      f.service.prepareClip({
        id: "bad",
        sampleRate: 48_000,
        samples: new Float32Array([Number.NaN]),
      }),
    ).rejects.toThrow(/PCM/);
    expect(f.service.snapshot()).toMatchObject({ pendingPcmBytes: 0, pcmBytes: 0, clipCount: 0 });
  });

  it("cancels preparation during disposal without retaining a late buffer", async () => {
    const f = fakeAudio();
    let release!: () => void;
    f.platform.yieldPreparation.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = f.service.prepareClip({
      id: "large",
      sampleRate: 48_000,
      samples: new Float32Array(30_000),
    });
    await f.service.dispose();
    release();
    await expect(pending).rejects.toThrow(/disposed/);
    expect(f.service.snapshot()).toMatchObject({
      state: "disposed",
      pendingPcmBytes: 0,
      pcmBytes: 0,
      clipCount: 0,
    });
  });

  it("rejects detached PCM between preparation chunks and contains native playback failures", async () => {
    const f = fakeAudio();
    const samples = new Float32Array(30_000);
    f.platform.yieldPreparation.mockImplementation(async () => {
      samples.buffer.transfer();
    });
    await expect(
      f.service.prepareClip({ id: "detached", sampleRate: 48_000, samples }),
    ).rejects.toThrow(/changed size/);
    expect(f.service.snapshot().pendingPcmBytes).toBe(0);
    await f.ready();
    f.context.createBufferSource = () => {
      throw new Error("native allocation failure");
    };
    expect(f.service.play(request)).toBeNull();
    expect(f.service.snapshot()).toMatchObject({
      state: "failed",
      activeVoices: 0,
      pcmBytes: 0,
      failureMessage: "native allocation failure",
    });
    await f.service.dispose();
    expect(f.context.close).toHaveBeenCalledTimes(1);
  });

  it("stops on visibility/page exit and removes lifecycle listeners", async () => {
    const f = fakeAudio();
    await f.ready();
    const documentTarget = Object.assign(new EventTarget(), { hidden: false });
    const windowTarget = new EventTarget();
    const unbind = bindSpatialAudioLifecycle(
      f.service,
      documentTarget as unknown as Document,
      windowTarget as unknown as Window,
    );
    f.service.play(request);
    documentTarget.hidden = true;
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(f.service.snapshot()).toMatchObject({ enabled: false, activeVoices: 0 });
    documentTarget.hidden = false;
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    f.service.play(request);
    windowTarget.dispatchEvent(new Event("pagehide"));
    expect(f.service.snapshot().activeVoices).toBe(0);
    unbind();
    documentTarget.hidden = true;
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(f.service.snapshot().enabled).toBe(true);
  });

  it("rejects invalid configuration, vectors and orientation before playback", async () => {
    expect(() => createSpatialAudioService({ ...limits, maximumVoices: Number.NaN })).toThrow(
      /limit/,
    );
    const f = fakeAudio();
    await f.ready();
    expect(() => f.service.play({ ...request, gain: -1 })).toThrow(/invalid/);
    expect(() => f.service.play({ ...request, position: [Number.NaN, 0, 0] })).toThrow(/invalid/);
    expect(() => f.service.setListener({ ...pose, up: pose.forward })).toThrow(/orthonormal/);
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const pitch of [-0.65, 0, 0.55]) {
        const camera = gameplayCameraPose([0, 0, 0], yaw, pitch);
        expect(() => f.service.setListener(camera)).not.toThrow();
        expect(Math.hypot(...camera.forward)).toBeCloseTo(1);
      }
    }
  });
});
