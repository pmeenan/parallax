import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  brandedBrowserValidation,
  type InstalledBrandedChromeIdentity,
  inspectInstalledBrandedChrome,
  loadInboxPowerShellSecurityModuleScript,
  requireBrandedChromeComparable,
  validateBrandedBrowserVersion,
  validateInstalledBrandedChromeIdentity,
  validateObservedBrowserVersionIdentity,
} from "./branded-chrome.js";
import type { ChromePin } from "./chrome-pin.js";

const execFileAsync = promisify(execFile);

const pin = Object.freeze({
  browserRevision: `@${"a".repeat(40)}`,
  channel: "stable",
  downloads: Object.freeze({}),
  executableSha256: Object.freeze({ win64: "b".repeat(64) }),
  revision: "1654411",
  version: "151.0.7922.71",
}) satisfies ChromePin;

function branded(overrides: Partial<InstalledBrandedChromeIdentity> = {}) {
  return {
    executablePath: resolve("C:/Program Files/Google/Chrome/Application/chrome.exe"),
    executableSha256: "c".repeat(64),
    fileDescription: "Google Chrome",
    fileVersion: "151.0.7922.68",
    originalFilename: "chrome.exe",
    productName: "Google Chrome",
    registryPath:
      "Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
    signatureStatus: "Valid",
    signerSubject: "CN=Google LLC, O=Google LLC, L=Mountain View, S=California, C=US",
    ...overrides,
  } as const;
}

describe("installed branded Chrome identity", () => {
  it("requires exact current major/build comparability and rejects installed 150", () => {
    expect(requireBrandedChromeComparable("151.0.7922.68", pin)).toBe(true);
    expect(() => requireBrandedChromeComparable("150.0.7871.115", pin)).toThrow(
      "major/build must match",
    );
    expect(() => requireBrandedChromeComparable("151.0.7923.1", pin)).toThrow(
      "major/build must match",
    );
  });

  it("rejects path overrides before inspecting or launching Chrome", async () => {
    await expect(
      inspectInstalledBrandedChrome({ PARALLAX_CHROME_PATH: "C:\\arbitrary\\chrome.exe" }),
    ).rejects.toThrow("forbidden");
    await expect(
      inspectInstalledBrandedChrome({ PARALLAX_BRANDED_CHROME_PATH: "C:\\fake\\chrome.exe" }),
    ).rejects.toThrow("forbidden");
  });

  it.runIf(process.platform === "win32")(
    "loads the inbox Authenticode command despite an incompatible PSModulePath shadow",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "parallax-powershell-security-shadow-"));
      const shadowModule = join(root, "Microsoft.PowerShell.Security");
      try {
        await mkdir(shadowModule);
        await writeFile(
          join(shadowModule, "Microsoft.PowerShell.Security.psd1"),
          "@{ RootModule = 'Microsoft.PowerShell.Security.psm1'; ModuleVersion = '99.0.0' }\n",
          "utf8",
        );
        await writeFile(
          join(shadowModule, "Microsoft.PowerShell.Security.psm1"),
          "throw 'PSModulePath shadow was loaded'\n",
          "utf8",
        );

        const probe = String.raw`
$ErrorActionPreference = 'Stop'
${loadInboxPowerShellSecurityModuleScript}
$command = Get-Command -Name 'Microsoft.PowerShell.Security\Get-AuthenticodeSignature' -ErrorAction Stop
[pscustomobject]@{
  moduleName = $command.ModuleName
  modulePath = $command.Module.Path
  powerShellHome = $PSHOME
} | ConvertTo-Json -Compress
`;
        const { stdout } = await execFileAsync(
          "powershell.exe",
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", probe],
          {
            encoding: "utf8",
            env: { ...process.env, PSModulePath: root },
            maxBuffer: 1024 * 1024,
          },
        );
        const result = JSON.parse(stdout) as {
          readonly moduleName: unknown;
          readonly modulePath: unknown;
          readonly powerShellHome: unknown;
        };
        expect(result.moduleName).toBe("Microsoft.PowerShell.Security");
        expect(typeof result.modulePath).toBe("string");
        expect(typeof result.powerShellHome).toBe("string");
        expect(resolve(result.modulePath as string).toLowerCase()).toBe(
          resolve(
            result.powerShellHome as string,
            "Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1",
          ).toLowerCase(),
        );
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it("rejects Chrome for Testing masquerading as the installed branded channel", () => {
    expect(() =>
      validateInstalledBrandedChromeIdentity({
        ...branded(),
        fileDescription: "Google Chrome for Testing",
        productName: "Google Chrome for Testing",
      }),
    ).toThrow("productName");
    expect(() =>
      validateInstalledBrandedChromeIdentity({
        ...branded(),
        signatureStatus: "NotSigned",
      }),
    ).toThrow("signatureStatus");
  });

  it("binds all Browser.getVersion fields to the registered executable", () => {
    const installed = validateInstalledBrandedChromeIdentity(branded());
    expect(
      validateBrandedBrowserVersion(
        {
          jsVersion: "15.1.2",
          product: "Chrome/151.0.7922.68",
          protocolVersion: "1.3",
          revision: `@${"d".repeat(40)}`,
          userAgent: "Mozilla/5.0 Chrome/151.0.7922.68 Safari/537.36",
        },
        installed,
        pin,
      ),
    ).toBe(true);
    expect(
      validateBrandedBrowserVersion(
        {
          jsVersion: "15.1.2",
          product: "Chrome/151.0.7922.68",
          protocolVersion: "1.3",
          revision: `@${"d".repeat(40)}`,
          userAgent: "Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36",
        },
        installed,
        pin,
      ),
    ).toBe(true);
    expect(() =>
      validateBrandedBrowserVersion(
        {
          jsVersion: "15.1.2",
          product: "Chrome/151.0.7922.67",
          protocolVersion: "1.3",
          revision: `@${"d".repeat(40)}`,
          userAgent: "Mozilla/5.0 Chrome/151.0.7922.67 Safari/537.36",
        },
        installed,
        pin,
      ),
    ).toThrow("registered executable");
  });

  it.each([
    ["wrong family", "Mozilla/5.0 Chromium/151.0.0.0 Safari/537.36"],
    ["wrong reduced major", "Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36"],
    ["invalid reduced patch", "Mozilla/5.0 Chrome/151.0.0.1 Safari/537.36"],
    ["mismatched full version", "Mozilla/5.0 Chrome/151.0.7922.67 Safari/537.36"],
    ["multiple Chrome tokens", "Mozilla/5.0 Chrome/151.0.0.0 Chrome/151.0.7922.68 Safari/537.36"],
  ])("rejects %s Browser.getVersion userAgent", (_label, userAgent) => {
    expect(() =>
      validateBrandedBrowserVersion(
        {
          jsVersion: "15.1.2",
          product: "Chrome/151.0.7922.68",
          protocolVersion: "1.3",
          revision: `@${"d".repeat(40)}`,
          userAgent,
        },
        validateInstalledBrandedChromeIdentity(branded()),
        pin,
      ),
    ).toThrow("userAgent");
  });

  it("bounds the independently retained raw Browser.getVersion observation", () => {
    const observation = {
      jsVersion: "15.1.206.10",
      product: "Chrome/151.0.7922.72",
      protocolVersion: "1.3",
      revision: `@${"d".repeat(40)}`,
      userAgent: "Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36",
    };
    expect(validateObservedBrowserVersionIdentity(observation)).toEqual(observation);
    expect(() =>
      validateObservedBrowserVersionIdentity({ ...observation, product: "x".repeat(1_025) }),
    ).toThrow("exceeds");
    expect(() =>
      validateObservedBrowserVersionIdentity({ ...observation, unexpected: "field" }),
    ).toThrow("unexpected fields");
  });

  it("records bounded raw CDP identity before relational validation rejects it", async () => {
    const installed = validateInstalledBrandedChromeIdentity(branded());
    const invalidObservation = validateObservedBrowserVersionIdentity({
      jsVersion: "15.1.206.10",
      product: "Chrome/151.0.7922.67",
      protocolVersion: "1.3",
      revision: `@${"d".repeat(40)}`,
      userAgent: "Mozilla/5.0 Chrome/151.0.7922.67 Safari/537.36",
    });
    let retained: unknown = null;
    const validation = brandedBrowserValidation(installed, pin, async (observation) => {
      retained = validateObservedBrowserVersionIdentity(observation);
    });
    await validation.beforeVersionValidation?.(invalidObservation);
    expect(retained).toEqual(invalidObservation);
    expect(() => validation.validateVersion(invalidObservation)).toThrow("registered executable");
  });
});
