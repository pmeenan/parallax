import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppOwnedLlmRunRequest,
  AppOwnedLlmSpikeTelemetrySnapshot,
} from "../src/ai/app-owned-llm-spike-protocol";

interface FakeCompletionOptions {
  readonly onData?: (chunk: unknown) => void;
}

interface FakeLoadOptions {
  readonly progressCallback?: (progress: { loaded: number; total: number }) => void;
}

const fake = vi.hoisted(() => ({
  completion: vi.fn(async (options: FakeCompletionOptions) => {
    options.onData?.({
      choices: [{ delta: { content: "Hello" } }],
      timings: { predicted_n: 1, prompt_n: 2 },
    });
  }),
  events: [] as string[],
  exit: vi.fn(async () => {
    fake.events.push("exit");
  }),
  load: vi.fn(async (_url: string, options: FakeLoadOptions) => {
    options.progressCallback?.({ loaded: 10, total: 10 });
  }),
}));

vi.mock("@wllama/wllama/esm/index.js", () => ({
  LoggerWithoutDebug: Object.freeze({}),
  Wllama: class {
    readonly createChatCompletion = fake.completion;
    readonly exit = fake.exit;
    readonly loadModelFromUrl = fake.load;
  },
}));

import { runWllamaSpike } from "../src/ai/app-owned-llm-wllama-runner";

const REQUEST = Object.freeze({
  device: "wllama-webgpu",
  fixtureSet: Object.freeze({
    cases: Object.freeze([
      Object.freeze({
        id: "runner-test",
        kind: "latency",
        maxNewTokens: 2,
        messages: Object.freeze([Object.freeze({ content: "Hello", role: "user" })]),
        repetitions: 1,
      }),
    ]),
    id: "runner-test",
    version: 1,
  }),
  modelUrl: "https://models.example/model.gguf",
}) satisfies AppOwnedLlmRunRequest;

describe("wllama spike runner lifecycle", () => {
  beforeEach(() => {
    fake.completion.mockClear();
    fake.events.length = 0;
    fake.exit.mockClear();
    fake.load.mockClear();
  });

  it("tears wllama down before publishing completion", async () => {
    const snapshots: AppOwnedLlmSpikeTelemetrySnapshot[] = [];

    await runWllamaSpike(REQUEST, (snapshot) => {
      snapshots.push(snapshot);
      if (snapshot.state === "completed") fake.events.push("completed");
    });

    expect(fake.events).toEqual(["exit", "completed"]);
    expect(snapshots.at(-1)?.state).toBe("completed");
  });

  it("tears wllama down when model loading fails", async () => {
    fake.load.mockRejectedValueOnce(new Error("load failed"));

    await expect(runWllamaSpike(REQUEST, () => undefined)).rejects.toThrow("load failed");

    expect(fake.exit).toHaveBeenCalledOnce();
  });
});
