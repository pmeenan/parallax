import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const WINDOWS_DISPLAY_WAKE_SCRIPT =
  '(New-Object -ComObject WScript.Shell).SendKeys("{F15}")';

export async function withClosedBrowserContext<
  TContext extends Readonly<{ close(): Promise<void> }>,
  TResult,
>(launch: () => Promise<TContext>, use: (context: TContext) => Promise<TResult>): Promise<TResult> {
  const context = await launch();
  try {
    return await use(context);
  } finally {
    await context.close();
  }
}

export async function wakeWindowsPhysicalConsoleDisplay(
  options: Readonly<{
    readonly execute?: (executable: string, args: readonly string[]) => Promise<unknown>;
    readonly platform?: NodeJS.Platform;
  }> = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    throw new Error(`Physical-console display wake requires Windows, received ${platform}`);
  }
  const execute =
    options.execute ??
    ((executable, args) =>
      execFileAsync(executable, [...args], {
        encoding: "utf8",
        windowsHide: true,
      }));
  await execute("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    WINDOWS_DISPLAY_WAKE_SCRIPT,
  ]);
}

export async function launchAfterPhysicalConsoleDisplayWake<T>(
  launch: () => Promise<T>,
  options: Readonly<{
    readonly execute?: (executable: string, args: readonly string[]) => Promise<unknown>;
    readonly platform?: NodeJS.Platform;
  }> = {},
): Promise<T> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    await wakeWindowsPhysicalConsoleDisplay({
      ...(options.execute === undefined ? {} : { execute: options.execute }),
      platform,
    });
  }
  return launch();
}
