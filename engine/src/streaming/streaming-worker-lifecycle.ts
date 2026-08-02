export type StreamingWorkerLifecycleState = "active" | "disposing" | "disposed" | "failed";

export interface StreamingWorkerLifecycle {
  beginDisposal(): boolean;
  finishDisposal(): boolean;
  readonly disposalRequested: boolean;
  readonly state: StreamingWorkerLifecycleState;
  tryFail(): boolean;
}

export function createStreamingWorkerLifecycle(): StreamingWorkerLifecycle {
  let state: StreamingWorkerLifecycleState = "active";
  return Object.freeze({
    beginDisposal(): boolean {
      if (state !== "active") return false;
      state = "disposing";
      return true;
    },
    get disposalRequested(): boolean {
      return state !== "active";
    },
    finishDisposal(): boolean {
      if (state === "failed") return false;
      if (state !== "disposing") return false;
      state = "disposed";
      return true;
    },
    get state(): StreamingWorkerLifecycleState {
      return state;
    },
    tryFail(): boolean {
      if (state === "failed" || state === "disposed") return false;
      state = "failed";
      return true;
    },
  });
}
