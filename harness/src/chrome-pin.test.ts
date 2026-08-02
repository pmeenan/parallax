import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPersistentChromeLaunchOptions,
  loadChromePin,
  loadSmokeChromePin,
  resolveSmokeChromePinPath,
  validateChromeBrowserIdentity,
  validateChromeSandboxCommandLine,
} from "./chrome-pin.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const temporaryRoots: string[] = [];

type ChromePinDescriptorFixture = Record<string, unknown> & {
  readonly downloads: Readonly<Record<string, string>>;
  readonly executableSha256: Readonly<Record<string, string>>;
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("Chrome sandbox launch contract", () => {
  it("enables Chromium sandboxing for persistent harness contexts", () => {
    const options = createPersistentChromeLaunchOptions("chrome.exe");
    expect(options).toMatchObject({
      chromiumSandbox: true,
      executablePath: "chrome.exe",
    });
    expect(options).not.toHaveProperty("channel");
  });

  it("combines the branded chrome channel with the exact registered executable", () => {
    expect(
      createPersistentChromeLaunchOptions(
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        [],
        "branded-stable-channel",
      ),
    ).toMatchObject({
      channel: "chrome",
      chromiumSandbox: true,
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    });
  });

  it("rejects caller-supplied and effective no-sandbox launches", () => {
    expect(() => createPersistentChromeLaunchOptions("chrome.exe", ["--no-sandbox"])).toThrow(
      /may not disable process sandboxing/,
    );
    expect(() => createPersistentChromeLaunchOptions("chrome.exe", ["--no-sandbox=true"])).toThrow(
      /may not disable process sandboxing/,
    );
    expect(() =>
      validateChromeSandboxCommandLine('"chrome.exe" --remote-debugging-pipe --no-sandbox'),
    ).toThrow(/disabled process sandboxing/);
    expect(() =>
      validateChromeSandboxCommandLine('"chrome.exe" --remote-debugging-pipe --no-sandbox=true'),
    ).toThrow(/disabled process sandboxing/);
  });

  it("accepts an effective sandboxed command line", () => {
    expect(validateChromeSandboxCommandLine('"chrome.exe" --remote-debugging-pipe')).toBe(true);
  });
});

describe("smoke Chrome pin selection", () => {
  it("defaults to the current stable descriptor", async () => {
    await expect(resolveSmokeChromePinPath(repositoryRoot, {})).resolves.toBe(
      join(repositoryRoot, "harness/chrome/stable.json"),
    );
    await expect(loadSmokeChromePin(repositoryRoot, {})).resolves.toMatchObject({
      version: "151.0.7922.71",
    });
  });

  it("selects the checked-in previous-Chrome descriptor and its executable hash", async () => {
    const environment = { PARALLAX_CHROME_PIN_ANCHOR: "151.0.7922.34" };
    await expect(resolveSmokeChromePinPath(repositoryRoot, environment)).resolves.toBe(
      join(repositoryRoot, "harness/chrome/anchors/151.0.7922.34.json"),
    );
    await expect(loadSmokeChromePin(repositoryRoot, environment)).resolves.toMatchObject({
      browserRevision: "@782af9cb30a53f54487e5d2e44738645a8ec457c",
      executableSha256: {
        win64: "409805a16d6416087e6b2f778df1cf8f7bbb267d6b99f6b5bb0a618eace234f2",
      },
      version: "151.0.7922.34",
    });
  });

  it.each([
    "../151.0.7922.34",
    "151.0.7922.34.json",
    "151.0.7922/34",
    "151.0.7922\\34",
    "01.0.7922.34",
  ])("rejects non-version anchor token %j", async (anchor) => {
    await expect(
      resolveSmokeChromePinPath(repositoryRoot, { PARALLAX_CHROME_PIN_ANCHOR: anchor }),
    ).rejects.toThrow("must be an exact four-component Chrome version");
  });

  it("rejects an unknown well-formed anchor", async () => {
    await expect(
      resolveSmokeChromePinPath(repositoryRoot, {
        PARALLAX_CHROME_PIN_ANCHOR: "151.0.7922.35",
      }),
    ).rejects.toThrow("Unknown Chrome pin anchor 151.0.7922.35");
  });

  it("rejects a descriptor whose declared version does not match its filename token", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-chrome-anchor-test-"));
    temporaryRoots.push(root);
    const anchors = join(root, "harness/chrome/anchors");
    await mkdir(anchors, { recursive: true });
    await writeFile(
      join(anchors, "151.0.7922.34.json"),
      JSON.stringify(validChromePinDescriptor("151.0.7922.71")),
      "utf8",
    );

    await expect(
      loadSmokeChromePin(root, { PARALLAX_CHROME_PIN_ANCHOR: "151.0.7922.34" }),
    ).rejects.toThrow(
      "Chrome pin anchor descriptor version mismatch: selected 151.0.7922.34, descriptor declares 151.0.7922.71",
    );
  });

  it("rejects an observed browser revision that differs from the selected descriptor", async () => {
    const pin = await loadSmokeChromePin(repositoryRoot, {
      PARALLAX_CHROME_PIN_ANCHOR: "151.0.7922.34",
    });
    expect(
      validateChromeBrowserIdentity(pin, {
        product: "Chrome/151.0.7922.34",
        revision: "@782af9cb30a53f54487e5d2e44738645a8ec457c",
      }),
    ).toBe(true);
    expect(() =>
      validateChromeBrowserIdentity(pin, {
        product: "Chrome/151.0.7922.34",
        revision: `@${"f".repeat(40)}`,
      }),
    ).toThrow(
      "Chrome for Testing browser revision mismatch: expected @782af9cb30a53f54487e5d2e44738645a8ec457c",
    );
  });
});

describe("Chrome pin descriptor validation", () => {
  it("accepts both checked-in descriptors", async () => {
    await expect(
      loadChromePin(join(repositoryRoot, "harness/chrome/stable.json")),
    ).resolves.toMatchObject({ version: "151.0.7922.71" });
    await expect(
      loadChromePin(join(repositoryRoot, "harness/chrome/anchors/151.0.7922.34.json")),
    ).resolves.toMatchObject({ version: "151.0.7922.34" });
  });

  it.each([
    ["a non-object root", []],
    ["an extra top-level key", { ...validChromePinDescriptor(), extra: true }],
    [
      "an unexpected archive hash field",
      {
        ...validChromePinDescriptor(),
        archiveSha256: { win64: "a".repeat(64) },
      },
    ],
    ["a missing top-level key", withoutKey(validChromePinDescriptor(), "browserRevision")],
    ["a numeric version", { ...validChromePinDescriptor(), version: 151 }],
    ["a leading-zero version", validChromePinDescriptor("0151.0.7922.34")],
    ["a non-stable channel", { ...validChromePinDescriptor(), channel: "beta" }],
    ["a numeric revision", { ...validChromePinDescriptor(), revision: 1654411 }],
    ["an empty revision", { ...validChromePinDescriptor(), revision: "" }],
    [
      "a malformed browser revision",
      {
        ...validChromePinDescriptor(),
        browserRevision: "782af9cb30a53f54487e5d2e44738645a8ec457c",
      },
    ],
    [
      "an uppercase browser revision",
      {
        ...validChromePinDescriptor(),
        browserRevision: `@${"A".repeat(40)}`,
      },
    ],
    [
      "a non-string download",
      {
        ...validChromePinDescriptor(),
        downloads: { ...validChromePinDescriptor().downloads, win64: 7 },
      },
    ],
    [
      "a missing download platform",
      {
        ...validChromePinDescriptor(),
        downloads: withoutKey(validChromePinDescriptor().downloads, "linux64"),
      },
    ],
    [
      "an extra download platform",
      {
        ...validChromePinDescriptor(),
        downloads: { ...validChromePinDescriptor().downloads, win32: "https://example.invalid" },
      },
    ],
    [
      "a download URL bound to another version",
      {
        ...validChromePinDescriptor(),
        downloads: {
          ...validChromePinDescriptor().downloads,
          win64:
            "https://storage.googleapis.com/chrome-for-testing-public/151.0.7922.71/win64/chrome-win64.zip",
        },
      },
    ],
    [
      "a download URL bound to another platform",
      {
        ...validChromePinDescriptor(),
        downloads: {
          ...validChromePinDescriptor().downloads,
          win64:
            "https://storage.googleapis.com/chrome-for-testing-public/151.0.7922.34/linux64/chrome-linux64.zip",
        },
      },
    ],
    [
      "a download URL on another origin",
      {
        ...validChromePinDescriptor(),
        downloads: {
          ...validChromePinDescriptor().downloads,
          win64: "https://example.invalid/151.0.7922.34/win64/chrome-win64.zip",
        },
      },
    ],
    [
      "a missing executable-hash platform",
      {
        ...validChromePinDescriptor(),
        executableSha256: {},
      },
    ],
    [
      "an extra executable-hash platform",
      {
        ...validChromePinDescriptor(),
        executableSha256: { linux64: "a".repeat(64), win64: "a".repeat(64) },
      },
    ],
    [
      "a non-string executable hash",
      {
        ...validChromePinDescriptor(),
        executableSha256: { win64: 7 },
      },
    ],
    [
      "an uppercase executable hash",
      {
        ...validChromePinDescriptor(),
        executableSha256: { win64: "A".repeat(64) },
      },
    ],
    [
      "a short executable hash",
      {
        ...validChromePinDescriptor(),
        executableSha256: { win64: "a".repeat(63) },
      },
    ],
  ])("rejects %s", async (_label, descriptor) => {
    const path = await writeChromePinDescriptor(descriptor);
    await expect(loadChromePin(path)).rejects.toThrow();
  });
});

function validChromePinDescriptor(version = "151.0.7922.34"): ChromePinDescriptorFixture {
  return {
    browserRevision: "@782af9cb30a53f54487e5d2e44738645a8ec457c",
    channel: "stable",
    downloads: {
      linux64: `https://storage.googleapis.com/chrome-for-testing-public/${version}/linux64/chrome-linux64.zip`,
      "mac-arm64": `https://storage.googleapis.com/chrome-for-testing-public/${version}/mac-arm64/chrome-mac-arm64.zip`,
      "mac-x64": `https://storage.googleapis.com/chrome-for-testing-public/${version}/mac-x64/chrome-mac-x64.zip`,
      win64: `https://storage.googleapis.com/chrome-for-testing-public/${version}/win64/chrome-win64.zip`,
    },
    executableSha256: { win64: "a".repeat(64) },
    revision: "1654411",
    version,
  };
}

function withoutKey(
  value: Readonly<Record<string, unknown>> | unknown,
  excluded: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== excluded));
}

async function writeChromePinDescriptor(value: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "parallax-chrome-pin-test-"));
  temporaryRoots.push(root);
  const path = join(root, "chrome-pin.json");
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}
