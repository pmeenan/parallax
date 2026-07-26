import type { EngineContext } from "@babylonjs/lite";

export interface WebGpuDeviceLossEvidence {
  readonly message: string;
  readonly reason: GPUDeviceLostReason;
}

interface LiteEngineWithDevice {
  readonly _device: GPUDevice;
}

function requireDevice(engine: EngineContext): GPUDevice {
  const candidate = (engine as unknown as Partial<LiteEngineWithDevice>)._device;
  if (
    candidate === undefined ||
    typeof candidate.destroy !== "function" ||
    !(candidate.lost instanceof Promise)
  ) {
    throw new Error("Babylon Lite did not expose the expected worker-owned WebGPU device");
  }
  return candidate;
}

/**
 * Babylon Lite 1.12.0 does not export its device-loss recovery surface from the package
 * root. Keep the private-device dependency isolated and guarded while Parallax restarts
 * the whole render/streaming cohort instead of rebuilding partially poisoned GPU state.
 */
export function observeLiteWebGpuDeviceLoss(
  engine: EngineContext,
  listener: (evidence: WebGpuDeviceLossEvidence) => void,
): void {
  const device = requireDevice(engine);
  void device.lost.then((info) => {
    listener(
      Object.freeze({
        message: info.message,
        reason: info.reason,
      }),
    );
  });
}

export function destroyLiteWebGpuDeviceForRecoveryTest(engine: EngineContext): void {
  requireDevice(engine).destroy();
}
