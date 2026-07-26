export interface RenderedCheckpointQueue {
  cancelAll(): void;
  flushAfterRenderedFrame(): Promise<void>;
  hasPendingRequests(): boolean;
  request(requestId: number, checkpointId: string): Promise<void>;
}

export interface RenderedCheckpointFrameGate {
  afterRenderedFrame(): void;
  cancelAndWaitForRenderLoop(): Promise<void>;
}

type DeferTask = (callback: () => void) => void;

/**
 * Submits checkpoint readbacks as requests arrive, then holds their evidence until the
 * render loop explicitly flushes them after a completed frame. Babylon Lite registers
 * captureScreenshot synchronously and services that queue from the next renderFrame.
 * The flush claims only requests covered by that frame, then defers awaiting and
 * publishing their already-submitted evidence so the animation-frame callback returns
 * first.
 */
export function createRenderedCheckpointQueue<Evidence>(
  submitCapture: (checkpointId: string) => Promise<Evidence>,
  publish: (requestId: number, evidence: Evidence) => void,
  deferTask: DeferTask = (callback) => setTimeout(callback, 0),
): RenderedCheckpointQueue {
  const pending: CheckpointRequest<Evidence>[] = [];
  const active = new Set<CheckpointRequest<Evidence>>();

  return Object.freeze({
    cancelAll(): void {
      for (const request of active) request.cancel();
      pending.length = 0;
    },

    flushAfterRenderedFrame(): Promise<void> {
      const requests = pending.splice(0, pending.length).filter((request) => !request.cancelled());
      return new Promise((resolveFlush, rejectFlush) => {
        try {
          deferTask(() => {
            void flushRequests(requests, publish).then(resolveFlush, rejectFlush);
          });
        } catch (error: unknown) {
          for (const request of requests) request.fail(error);
          rejectFlush(error);
        }
      });
    },

    hasPendingRequests(): boolean {
      return pending.some((request) => !request.cancelled());
    },

    request(requestId: number, checkpointId: string): Promise<void> {
      return new Promise((resolve, reject) => {
        let evidence: Promise<CaptureResult<Evidence>>;
        try {
          evidence = submitCapture(checkpointId).then<
            CaptureResult<Evidence>,
            CaptureResult<Evidence>
          >(
            (captured) => Object.freeze({ captured, ok: true }),
            (error: unknown) => Object.freeze({ error, ok: false }),
          );
        } catch (error: unknown) {
          evidence = Promise.resolve(Object.freeze({ error, ok: false }));
        }
        let isCancelled = false;
        let isSettled = false;
        let resolveCancellation!: (result: CaptureResult<Evidence>) => void;
        const cancellation = new Promise<CaptureResult<Evidence>>((resolveCancellationResult) => {
          resolveCancellation = resolveCancellationResult;
        });
        const request: CheckpointRequest<Evidence> = {
          cancel(): void {
            if (isSettled) return;
            isCancelled = true;
            isSettled = true;
            resolveCancellation(Object.freeze({ cancelled: true }));
            active.delete(request);
            resolve();
          },
          cancelled: () => isCancelled,
          evidence: Promise.race([evidence, cancellation]),
          fail(error: unknown): void {
            if (isSettled) return;
            isSettled = true;
            active.delete(request);
            reject(error);
          },
          requestId,
          succeed(): void {
            if (isSettled) return;
            isSettled = true;
            active.delete(request);
            resolve();
          },
        };
        active.add(request);
        pending.push(request);
      });
    },
  });
}

/**
 * Couples checkpoint readback settlement to animation-loop resumption. Reset callers
 * must cross this gate before publishing their streaming boundary: cancelling capture
 * promises alone is insufficient while the deferred flush still owns the next rAF.
 */
export function createRenderedCheckpointFrameGate(
  queue: RenderedCheckpointQueue,
  scheduleNextFrame: () => void,
  reportFailure: (error: unknown) => void,
): RenderedCheckpointFrameGate {
  let activeResumption: Promise<void> | null = null;
  return Object.freeze({
    afterRenderedFrame(): void {
      if (activeResumption !== null) {
        throw new Error("Rendered checkpoint frame gate already owns loop resumption");
      }
      if (!queue.hasPendingRequests()) {
        scheduleNextFrame();
        return;
      }
      let resumption!: Promise<void>;
      resumption = queue
        .flushAfterRenderedFrame()
        .catch((error: unknown) => reportFailure(error))
        .then(() => scheduleNextFrame())
        .finally(() => {
          if (activeResumption === resumption) activeResumption = null;
        });
      activeResumption = resumption;
    },

    cancelAndWaitForRenderLoop(): Promise<void> {
      queue.cancelAll();
      return activeResumption ?? Promise.resolve();
    },
  });
}

interface CheckpointRequest<Evidence> {
  cancel(): void;
  cancelled(): boolean;
  readonly evidence: Promise<CaptureResult<Evidence>>;
  fail(error: unknown): void;
  readonly requestId: number;
  succeed(): void;
}

type CaptureResult<Evidence> =
  | Readonly<{ captured: Evidence; ok: true }>
  | Readonly<{ error: unknown; ok: false }>
  | Readonly<{ cancelled: true }>;

async function flushRequests<Evidence>(
  requests: readonly CheckpointRequest<Evidence>[],
  publish: (requestId: number, evidence: Evidence) => void,
): Promise<void> {
  for (const request of requests) {
    const result = await request.evidence;
    if (request.cancelled() || "cancelled" in result) continue;
    if (!result.ok) {
      request.fail(result.error);
      continue;
    }
    try {
      publish(request.requestId, result.captured);
      request.succeed();
    } catch (error: unknown) {
      request.fail(error);
    }
  }
}
