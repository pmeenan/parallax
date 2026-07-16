import type { BrowserContext, Page } from "playwright-core";
import {
  type BrowserDisplayIdentity,
  parseDisplayRefreshRates,
  type WebGpuAdapterIdentity,
} from "./environment.js";

export function readWebGpuAdapterIdentity(page: Page): Promise<WebGpuAdapterIdentity> {
  return page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter === null || adapter === undefined) throw new Error("WebGPU adapter is unavailable");
    const info = adapter.info;
    const optionalString = (name: string): string | null => {
      const value = Reflect.get(info, name);
      return typeof value === "string" ? value : null;
    };
    return Object.freeze({
      architecture: info.architecture,
      backend: optionalString("backend"),
      description: info.description,
      device: info.device,
      driver: optionalString("driver"),
      isFallbackAdapter: info.isFallbackAdapter,
      type: optionalString("type"),
      vendor: info.vendor,
    });
  });
}

export async function readWebGpuAdapterIdentityFromProbePage(
  context: BrowserContext,
  baseUrl: string,
): Promise<WebGpuAdapterIdentity> {
  const identityPage = await context.newPage();
  try {
    await identityPage.goto(`${baseUrl}/__parallax/identity`, { waitUntil: "load" });
    return await readWebGpuAdapterIdentity(identityPage);
  } finally {
    await identityPage.close();
  }
}

export async function readBrowserDisplayIdentity(
  context: BrowserContext,
  page: Page,
): Promise<BrowserDisplayIdentity> {
  const refreshRatesHz = await readChromeDisplayRefreshRates(context);
  const screen = await page.evaluate(() =>
    Object.freeze({
      availHeight: globalThis.screen.availHeight,
      availWidth: globalThis.screen.availWidth,
      colorDepth: globalThis.screen.colorDepth,
      devicePixelRatio,
      height: globalThis.screen.height,
      width: globalThis.screen.width,
    }),
  );
  return Object.freeze({ probeFailures: Object.freeze([]), refreshRatesHz, screen });
}

export async function readChromeDisplayRefreshRates(
  context: BrowserContext,
): Promise<readonly number[]> {
  const gpuPage = await context.newPage();
  try {
    await gpuPage.goto("chrome://gpu", { waitUntil: "load" });
    const session = await context.newCDPSession(gpuPage);
    const document = (await session.send("DOM.getDocument")) as { root: { nodeId: number } };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const matches = (await session.send("Accessibility.queryAXTree", {
        accessibleName: "Refresh Rate in Hz",
        nodeId: document.root.nodeId,
      })) as { nodes: readonly { name?: { value?: unknown } }[] };
      const labelIsReady = matches.nodes.some((node) => node.name?.value === "Refresh Rate in Hz");
      if (!labelIsReady) {
        await gpuPage.waitForTimeout(250);
        continue;
      }
      const tree = (await session.send("Accessibility.getFullAXTree")) as {
        nodes: readonly { name?: { value?: unknown } }[];
      };
      const names = tree.nodes.flatMap((node) =>
        typeof node.name?.value === "string" ? [node.name.value] : [],
      );
      const refreshRates = parseDisplayRefreshRates(names);
      if (refreshRates.length > 0) return Object.freeze([...new Set(refreshRates)]);
      await gpuPage.waitForTimeout(250);
    }
    return Object.freeze([]);
  } finally {
    await gpuPage.close();
  }
}

export async function readChromeCommandLine(context: BrowserContext): Promise<string> {
  const versionPage = await context.newPage();
  try {
    await versionPage.goto("chrome://version", { waitUntil: "load" });
    const commandLine = await versionPage.locator("#command_line").innerText();
    if (commandLine.trim() === "") {
      throw new Error("chrome://version exposed an empty browser command line");
    }
    return commandLine;
  } finally {
    await versionPage.close();
  }
}
