import { describe, expect, it, vi } from "vitest";
import {
  INSTALLER_TARGET_REQUEST_HEADER,
  INSTALLER_TARGET_REQUEST_VALUE,
  resolveNetworkFirstInstallerTarget,
  resolveOfflineShellCachePath,
  shouldPassThroughOfflineShellRangeRequest,
  shouldPassThroughUninstallRequest,
  shouldUseNetworkFirstInstallerTargetRequest,
} from "../src/index";

describe("offline-shell fetch policy", () => {
  it("maps only exact query-free shell URLs into the selected generation", () => {
    const origin = "https://parallax.test";
    expect(
      resolveOfflineShellCachePath(
        { method: "GET", mode: "same-origin", url: `${origin}/immutable/app.js` },
        origin,
      ),
    ).toBe("immutable/app.js");
    expect(
      resolveOfflineShellCachePath(
        { method: "GET", mode: "navigate", url: `${origin}/play` },
        origin,
      ),
    ).toBe("index.html");
    const rejectedRequests: readonly Pick<Request, "method" | "mode" | "url">[] = [
      { method: "GET", mode: "same-origin", url: `${origin}/immutable/app.js?variant=other` },
      { method: "GET", mode: "navigate", url: `${origin}/?variant=other` },
      { method: "POST", mode: "same-origin", url: `${origin}/index.html` },
      { method: "GET", mode: "same-origin", url: "https://other.test/index.html" },
    ];
    for (const request of rejectedRequests) {
      expect(resolveOfflineShellCachePath(request, origin)).toBeNull();
    }
  });

  it("passes only an exact same-origin POST navigation to /uninstall directly to network", () => {
    const exact = {
      method: "POST",
      mode: "navigate",
      url: "https://parallax.test/uninstall",
    } as const;
    expect(shouldPassThroughUninstallRequest(exact, "https://parallax.test")).toBe(true);
    for (const request of [
      { ...exact, method: "GET" },
      { ...exact, mode: "cors" },
      { ...exact, url: "https://parallax.test/uninstall?target=other" },
      { ...exact, url: "https://other.test/uninstall" },
      { ...exact, url: "https://parallax.test/uninstall/child" },
    ]) {
      expect(
        shouldPassThroughUninstallRequest(request as typeof exact, "https://parallax.test"),
      ).toBe(false);
    }
  });
  it.each([
    "https://parallax.test/immutable/app-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.js",
    "https://parallax.test/immutable/model-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.gguf",
  ])("passes same-origin installer Range traffic through for %s", (url) => {
    expect(
      shouldPassThroughOfflineShellRangeRequest(
        new Request(url, { headers: { Range: "bytes=8-" } }),
        "https://parallax.test",
      ),
    ).toBe(true);
  });

  it("does not bypass cached delivery for ordinary shell requests", () => {
    expect(
      shouldPassThroughOfflineShellRangeRequest(
        new Request("https://parallax.test/immutable/app.js"),
        "https://parallax.test",
      ),
    ).toBe(false);
  });

  it("does not classify cross-origin or non-GET traffic as installer pass-through", () => {
    expect(
      shouldPassThroughOfflineShellRangeRequest(
        new Request("https://cdn.example/model.gguf", { headers: { Range: "bytes=8-" } }),
        "https://parallax.test",
      ),
    ).toBe(false);
    expect(
      shouldPassThroughOfflineShellRangeRequest(
        new Request("https://parallax.test/model.gguf", {
          headers: { Range: "bytes=8-" },
          method: "POST",
        }),
        "https://parallax.test",
      ),
    ).toBe(false);
  });

  it.each([
    "build-manifest.json",
    "install-manifest.json",
  ])("uses network-first with cached offline fallback only for an exact installer %s request", (path) => {
    const request = new Request(`https://parallax.test/${path}`, {
      headers: { [INSTALLER_TARGET_REQUEST_HEADER]: INSTALLER_TARGET_REQUEST_VALUE },
    });
    expect(shouldUseNetworkFirstInstallerTargetRequest(request, "https://parallax.test")).toBe(
      true,
    );
    expect(
      shouldUseNetworkFirstInstallerTargetRequest(
        new Request(`https://parallax.test/${path}`),
        "https://parallax.test",
      ),
    ).toBe(false);
    expect(
      shouldUseNetworkFirstInstallerTargetRequest(
        new Request(`https://parallax.test/${path}?drift=1`, {
          headers: { [INSTALLER_TARGET_REQUEST_HEADER]: INSTALLER_TARGET_REQUEST_VALUE },
        }),
        "https://parallax.test",
      ),
    ).toBe(false);
  });

  it("does not grant installer network-first authority to other paths or origins", () => {
    const headers = { [INSTALLER_TARGET_REQUEST_HEADER]: INSTALLER_TARGET_REQUEST_VALUE };
    expect(
      shouldUseNetworkFirstInstallerTargetRequest(
        new Request("https://parallax.test/index.html", { headers }),
        "https://parallax.test",
      ),
    ).toBe(false);
    expect(
      shouldUseNetworkFirstInstallerTargetRequest(
        new Request("https://other.test/build-manifest.json", { headers }),
        "https://parallax.test",
      ),
    ).toBe(false);
  });

  it("uses the network representation when available and falls back only on network TypeError", async () => {
    const fallback = vi.fn(async () => "cached");
    await expect(resolveNetworkFirstInstallerTarget(async () => "network", fallback)).resolves.toBe(
      "network",
    );
    expect(fallback).not.toHaveBeenCalled();

    await expect(
      resolveNetworkFirstInstallerTarget(
        async () => Promise.reject(new TypeError("offline")),
        fallback,
      ),
    ).resolves.toBe("cached");
    expect(fallback).toHaveBeenCalledOnce();

    await expect(
      resolveNetworkFirstInstallerTarget(
        async () => Promise.reject(new Error("contract")),
        fallback,
      ),
    ).rejects.toThrow("contract");
    expect(fallback).toHaveBeenCalledOnce();
  });
});
