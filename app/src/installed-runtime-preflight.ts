import type {
  InstalledModelSource,
  InstalledReleaseBinding,
  PsoWarmupTraceBundle,
  PsoWarmupTraceBundleReady,
} from "@parallax/engine";
import { psoWarmupFailureError } from "@parallax/engine";
import type { InstalledRuntimePreflightPhase } from "./launch-lifecycle";

export interface InstalledRuntimePreflightDependencies {
  readonly admit: (releaseDigest: string) => Promise<InstalledReleaseBinding>;
  readonly createModelSource: (binding: InstalledReleaseBinding) => InstalledModelSource;
  readonly loadPsoWarmupTrace: (binding: InstalledReleaseBinding) => Promise<PsoWarmupTraceBundle>;
  readonly onPhaseCompleted?: (phase: InstalledRuntimePreflightPhase) => void;
  readonly readmit: (releaseDigest: string) => Promise<void>;
  readonly resolveStreaming: (binding: InstalledReleaseBinding) => Promise<void>;
}

export interface InstalledRuntimePreflightResult {
  readonly binding: InstalledReleaseBinding;
  readonly modelSource: InstalledModelSource;
  readonly psoWarmupTrace: PsoWarmupTraceBundleReady;
}

export async function preflightInstalledRuntime(
  releaseDigest: string,
  dependencies: InstalledRuntimePreflightDependencies,
): Promise<InstalledRuntimePreflightResult> {
  const binding = await dependencies.admit(releaseDigest);
  dependencies.onPhaseCompleted?.("initial-release-admission");
  const modelSource = dependencies.createModelSource(binding);
  await modelSource.initialize();
  dependencies.onPhaseCompleted?.("model-source-ready");
  await dependencies.resolveStreaming(binding);
  dependencies.onPhaseCompleted?.("streaming-references-ready");
  const psoWarmupTrace = await dependencies.loadPsoWarmupTrace(binding);
  if (psoWarmupTrace.failure !== null) {
    throw psoWarmupFailureError(psoWarmupTrace.failure);
  }
  dependencies.onPhaseCompleted?.("pso-trace-ready");
  await dependencies.readmit(releaseDigest);
  dependencies.onPhaseCompleted?.("final-release-admission");
  return Object.freeze({ binding, modelSource, psoWarmupTrace });
}
