import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  launchAfterPhysicalConsoleDisplayWake,
  WINDOWS_DISPLAY_WAKE_SCRIPT,
  wakeWindowsPhysicalConsoleDisplay,
  withClosedBrowserContext,
} from "./physical-console-preflight.js";

describe("physical-console preflight", () => {
  it("sends an inert F15 key before a Windows physical gate", async () => {
    const execute = vi.fn(async () => undefined);

    await wakeWindowsPhysicalConsoleDisplay({ execute, platform: "win32" });

    expect(execute).toHaveBeenCalledWith("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      WINDOWS_DISPLAY_WAKE_SCRIPT,
    ]);
  });

  it("fails closed when display wake is unavailable or not running on Windows", async () => {
    await expect(
      wakeWindowsPhysicalConsoleDisplay({ execute: vi.fn(), platform: "linux" }),
    ).rejects.toThrow(/requires Windows/);
    await expect(
      wakeWindowsPhysicalConsoleDisplay({
        execute: async () => {
          throw new Error("COM unavailable");
        },
        platform: "win32",
      }),
    ).rejects.toThrow(/COM unavailable/);
  });

  it("wakes immediately before every Windows Chrome launch and does not launch on wake failure", async () => {
    const events: string[] = [];
    const execute = vi.fn(async () => {
      events.push("wake");
    });
    const launch = vi.fn(async () => {
      events.push("launch");
      return "context";
    });

    await expect(
      launchAfterPhysicalConsoleDisplayWake(launch, { execute, platform: "win32" }),
    ).resolves.toBe("context");
    await launchAfterPhysicalConsoleDisplayWake(launch, { execute, platform: "win32" });
    expect(events).toEqual(["wake", "launch", "wake", "launch"]);

    await expect(
      launchAfterPhysicalConsoleDisplayWake(launch, {
        execute: async () => {
          throw new Error("wake failed");
        },
        platform: "win32",
      }),
    ).rejects.toThrow(/wake failed/);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("launches without the Windows wake preflight on other platforms", async () => {
    const execute = vi.fn();
    const launch = vi.fn(async () => "context");

    await expect(
      launchAfterPhysicalConsoleDisplayWake(launch, { execute, platform: "linux" }),
    ).resolves.toBe("context");
    expect(execute).not.toHaveBeenCalled();
  });

  it("closes an acquired browser context when setup rejects", async () => {
    const close = vi.fn(async () => undefined);
    await expect(
      withClosedBrowserContext(
        async () => ({ close }),
        async () => {
          throw new Error("page setup failed");
        },
      ),
    ).rejects.toThrow(/page setup failed/);
    expect(close).toHaveBeenCalledOnce();
  });

  it("wraps every harness Chrome context launch at the immediate wake boundary", () => {
    const sourceDirectory = new URL(".", import.meta.url);
    const launchSources = readdirSync(sourceDirectory)
      .filter(
        (name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "chrome-pin.ts",
      )
      .map((name) =>
        Object.freeze({ name, text: readFileSync(new URL(name, sourceDirectory), "utf8") }),
      )
      .filter(({ text }) => text.includes("launchPersistentChrome("));
    const calls = launchSources.flatMap(({ name, text }) =>
      [...text.matchAll(/launchPersistentChrome\(/g)].map(() => name),
    );
    const wrappedCalls = launchSources.flatMap(({ name, text }) =>
      [
        ...text.matchAll(
          /launchAfterPhysicalConsoleDisplayWake\(\(\) =>\s*launchPersistentChrome\(/g,
        ),
      ].map(() => name),
    );

    expect(calls).toHaveLength(13);
    expect(wrappedCalls).toEqual(calls);
  });
});
