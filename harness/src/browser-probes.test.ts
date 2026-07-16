import type { BrowserContext, Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { readWebGpuAdapterIdentityFromProbePage } from "./browser-probes.js";
import type { WebGpuAdapterIdentity } from "./environment.js";

const ADAPTER: WebGpuAdapterIdentity = Object.freeze({
  architecture: "lovelace",
  backend: "D3D12",
  description: "NVIDIA GeForce RTX 4080 SUPER",
  device: "0x2702",
  driver: "D3D12 driver version 32.0.16.1074",
  isFallbackAdapter: false,
  type: "discrete-gpu",
  vendor: "nvidia",
});

describe("browser probes", () => {
  it("isolates WebGPU adapter identity on the inert harness control page", async () => {
    const goto = vi.fn(async () => null);
    const close = vi.fn(async () => undefined);
    const page = {
      close,
      evaluate: vi.fn(async () => ADAPTER),
      goto,
    } as unknown as Page;
    const context = {
      newPage: vi.fn(async () => page),
    } as unknown as BrowserContext;

    await expect(
      readWebGpuAdapterIdentityFromProbePage(context, "http://127.0.0.1:4173"),
    ).resolves.toEqual(ADAPTER);
    expect(goto).toHaveBeenCalledWith("http://127.0.0.1:4173/__parallax/identity", {
      waitUntil: "load",
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the control page when adapter identity probing fails", async () => {
    const close = vi.fn(async () => undefined);
    const page = {
      close,
      evaluate: vi.fn(async () => {
        throw new Error("adapter unavailable");
      }),
      goto: vi.fn(async () => null),
    } as unknown as Page;
    const context = {
      newPage: vi.fn(async () => page),
    } as unknown as BrowserContext;

    await expect(
      readWebGpuAdapterIdentityFromProbePage(context, "http://127.0.0.1:4173"),
    ).rejects.toThrow("adapter unavailable");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
