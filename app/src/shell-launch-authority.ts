import type { OfflineShellAdmission, OfflineShellService } from "@parallax/engine";

export interface ShellLaunchAuthority {
  readonly markAdmitted: () => void;
  readonly signal: AbortSignal;
}

export async function completeInstalledRuntimeShellAdmission<T>(
  preflight: () => Promise<T>,
  offlineShell: Pick<OfflineShellService, "admit">,
  expectedShell: OfflineShellAdmission,
  authority: ShellLaunchAuthority,
): Promise<T> {
  const result = await preflight();
  requireCurrentShellAuthority(authority.signal);
  await offlineShell.admit(expectedShell);
  requireCurrentShellAuthority(authority.signal);
  authority.markAdmitted();
  return result;
}

function requireCurrentShellAuthority(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason = signal.reason;
  throw reason instanceof Error
    ? reason
    : new Error("Offline-shell launch authority was revoked before locked admission");
}
