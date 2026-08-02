import {
  OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
  type OfflineShellTelemetrySnapshot,
} from "./shell-generation-contract";

export interface OfflineShellNotificationClient {
  postMessage(message: unknown): void;
}

export interface OfflineShellDurableSelection {
  readonly generationId: string | null;
  readonly telemetry: OfflineShellTelemetrySnapshot;
}

export async function notifyOfflineShellSelectionChangeFromDurableRead(
  previousGenerationId: string | null,
  readSelection: () => Promise<OfflineShellDurableSelection | null>,
  notify: (
    previousGenerationId: string | null,
    telemetry: OfflineShellTelemetrySnapshot,
  ) => Promise<void>,
): Promise<void> {
  const selection = await readSelection().catch(() => null);
  if (selection === null) return;
  await notify(previousGenerationId, selection.telemetry);
}

export function postOfflineShellSelectionChange(
  clients: readonly OfflineShellNotificationClient[],
  telemetry: OfflineShellTelemetrySnapshot,
): void {
  for (const client of clients) {
    try {
      client.postMessage({
        kind: "selection-changed",
        protocolVersion: OFFLINE_SHELL_SERVICE_WORKER_PROTOCOL_VERSION,
        telemetry,
      });
    } catch {
      // A detached client cannot replace a selected fetch response or suppress peers.
    }
  }
}
