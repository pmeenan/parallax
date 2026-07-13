import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateGateEnvironment,
  type GateEnvironmentObservation,
  loadMachineDescriptor,
  type MachineDescriptor,
  parseDisplayRefreshRates,
  safeMachineIdForFilename,
} from "./environment.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

const descriptor: MachineDescriptor = {
  arch: "x64",
  cpu: { cores: 24, logicalProcessors: 32, name: "Reference CPU" },
  display: {
    dimensionTolerancePixels: 2,
    height: 2_160,
    refreshRateHz: 60,
    refreshRateToleranceHz: 1,
    width: 3_840,
  },
  gateTiers: ["showcase"],
  gpu: {
    architecture: "lovelace",
    backend: "D3D12",
    deviceId: 0x2702,
    driverVersion: "32.0.15.9649",
    name: "Reference GPU",
    subSysId: 0x41441458,
    vendor: "nvidia",
    vendorId: 0x10de,
  },
  id: "dev-01",
  minimumPhysicalMemoryBytes: 128_000_000_000,
  osBuild: "26200.8655",
  platform: "win32",
  powerSchemeGuid: "381b4222-f694-41f0-9685-ff5bb260df2e",
  schemaVersion: 1,
};

const validScreen = {
  availHeight: 1_400,
  availWidth: 2_560,
  colorDepth: 24,
  devicePixelRatio: 1.5,
  height: 1_440,
  width: 2_560,
};

const validObservation: GateEnvironmentObservation = {
  adapter: {
    architecture: "lovelace",
    backend: "D3D12",
    description: "Reference GPU",
    device: "0x2702",
    driver: "D3D12 driver version 32.0.15.9649",
    isFallbackAdapter: false,
    type: "discrete GPU",
    vendor: "nvidia",
  },
  arch: "x64",
  browserDisplay: {
    probeFailures: [],
    refreshRatesHz: [60],
    screen: validScreen,
  },
  host: {
    cpu: { cores: 24, logicalProcessors: 32, name: "Reference CPU" },
    os: { build: "26200.8655", caption: "Microsoft Windows 11 Pro" },
    physicalMemoryBytes: 137_277_173_760,
    power: { guid: "381b4222-f694-41f0-9685-ff5bb260df2e", name: "Balanced" },
    remoteSession: false,
    videoControllers: [
      {
        driverVersion: "32.0.15.9649",
        height: 2_160,
        name: "Reference GPU",
        pnpDeviceId: "PCI\\VEN_10DE&DEV_2702",
        refreshRateHz: 59,
        width: 3_840,
      },
    ],
  },
  platform: "win32",
  primaryGpu: {
    deviceId: 0x2702,
    deviceString: "Reference GPU",
    driverVendor: "NVIDIA",
    driverVersion: "32.0.15.9649",
    revision: 161,
    subSysId: 0x41441458,
    vendorId: 0x10de,
    vendorString: "",
  },
  requestedTier: "showcase",
};

describe("gate environment validation", () => {
  it("accepts a fully matched local reference-machine observation", () => {
    expect(evaluateGateEnvironment(descriptor, validObservation)).toEqual({
      state: "measured",
      value: true,
    });
  });

  it("matches the registered display adapter by PCI identity rather than its mutable name", () => {
    expect(
      evaluateGateEnvironment(descriptor, {
        ...validObservation,
        host: {
          ...validObservation.host,
          videoControllers: validObservation.host.videoControllers.map((controller) => ({
            ...controller,
            name: "Localized or driver-updated adapter label",
          })),
        },
      }),
    ).toEqual({ state: "measured", value: true });
  });

  it("normalizes case and whitespace only for descriptive identity fields", () => {
    expect(
      evaluateGateEnvironment(descriptor, {
        ...validObservation,
        adapter: {
          ...validObservation.adapter,
          architecture: "LOVELACE",
          backend: "d3d12",
          description: "  reference   gpu ",
          vendor: "NVIDIA",
        },
        host: {
          ...validObservation.host,
          cpu: { ...validObservation.host.cpu, name: "  REFERENCE   cpu " },
        },
      }),
    ).toEqual({ state: "measured", value: true });
  });

  it("retains browser display probe failures as invalid gate evidence", () => {
    const state = evaluateGateEnvironment(descriptor, {
      ...validObservation,
      browserDisplay: {
        ...validObservation.browserDisplay,
        probeFailures: ["Browser refresh-rate diagnostics probe failed: CDP page crashed"],
      },
    });

    expect(state.state).toBe("invalid");
    if (state.state === "invalid") {
      expect(state.reasons).toContain(
        "Browser refresh-rate diagnostics probe failed: CDP page crashed",
      );
    }
  });

  it("does not trust a matching adapter name with a different PCI identity", () => {
    const state = evaluateGateEnvironment(descriptor, {
      ...validObservation,
      host: {
        ...validObservation.host,
        videoControllers: validObservation.host.videoControllers.map((controller) => ({
          ...controller,
          pnpDeviceId: "PCI\\VEN_1234&DEV_5678",
        })),
      },
    });

    expect(state.state).toBe("invalid");
    if (state.state === "invalid") {
      expect(state.reasons.some((reason) => reason.includes("unregistered active"))).toBe(true);
      expect(state.reasons.some((reason) => reason.includes("did not report"))).toBe(true);
    }
  });

  it("rejects remote sessions and virtual display adapters", () => {
    const state = evaluateGateEnvironment(descriptor, {
      ...validObservation,
      host: {
        ...validObservation.host,
        remoteSession: true,
        videoControllers: [
          ...validObservation.host.videoControllers,
          {
            driverVersion: "10.0.26100.1",
            height: 2_160,
            name: "Microsoft Remote Display Adapter",
            pnpDeviceId: "SWD\\REMOTEDISPLAYENUM\\RDPIDD",
            refreshRateHz: 32,
            width: 3_840,
          },
        ],
      },
    });

    expect(state.state).toBe("invalid");
    if (state.state === "invalid") {
      expect(state.reasons).toContain("Windows reports a remote session");
      expect(
        state.reasons.some((reason) => reason.includes("Microsoft Remote Display Adapter")),
      ).toBe(true);
    }
  });

  it("rejects non-RDP virtual display adapters and ambiguous Chrome display timing", () => {
    const state = evaluateGateEnvironment(descriptor, {
      ...validObservation,
      browserDisplay: {
        ...validObservation.browserDisplay,
        refreshRatesHz: [60, 120],
      },
      host: {
        ...validObservation.host,
        videoControllers: [
          ...validObservation.host.videoControllers,
          {
            driverVersion: "1.0.0",
            height: 2_160,
            name: "Parsec Virtual Display Adapter",
            pnpDeviceId: "ROOT\\PARSEC\\0000",
            refreshRateHz: 60,
            width: 3_840,
          },
        ],
      },
    });

    expect(state.state).toBe("invalid");
    if (state.state === "invalid") {
      expect(state.reasons.some((reason) => reason.includes("Parsec Virtual Display"))).toBe(true);
      expect(state.reasons.some((reason) => reason.includes("120 Hz"))).toBe(true);
    }
  });

  it("ties the browser screen's physical dimensions to the gate display", () => {
    const state = evaluateGateEnvironment(descriptor, {
      ...validObservation,
      browserDisplay: {
        ...validObservation.browserDisplay,
        screen: { ...validScreen, width: 1_920 },
      },
    });

    expect(state.state).toBe("invalid");
    if (state.state === "invalid") {
      expect(state.reasons.some((reason) => reason.startsWith("browser display width"))).toBe(true);
    }
  });

  it("reports every mismatched gate dimension instead of trusting declarations", () => {
    const state = evaluateGateEnvironment(descriptor, {
      ...validObservation,
      adapter: { ...validObservation.adapter, backend: "vulkan" },
      requestedTier: "standard",
      host: {
        ...validObservation.host,
        os: { ...validObservation.host.os, build: "10.0.99999.1" },
        power: { ...validObservation.host.power, guid: "00000000-0000-0000-0000-000000000000" },
      },
    });

    expect(state.state).toBe("invalid");
    if (state.state === "invalid") {
      expect(state.reasons).toContain("dev-01 is not a registered standard gate machine");
      expect(state.reasons).toContain("WebGPU backend expected D3D12, received vulkan");
      expect(state.reasons.some((reason) => reason.startsWith("OS build expected"))).toBe(true);
      expect(state.reasons.some((reason) => reason.startsWith("power scheme expected"))).toBe(true);
    }
  });
});

describe("machine descriptor loading", () => {
  it("owns ID validation, descriptor matching, and quality-tier display consistency", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-machine-"));
    cleanup.push(root);
    await writeFile(join(root, "dev-01.json"), JSON.stringify(descriptor));

    await expect(loadMachineDescriptor(root, "dev-01")).resolves.toEqual(descriptor);
    await expect(loadMachineDescriptor(root, "DEV-01")).resolves.toEqual(descriptor);
    await expect(loadMachineDescriptor(root, "../escape")).rejects.toThrow("Invalid machine ID");

    await writeFile(
      join(root, "dev-01.json"),
      JSON.stringify({ ...descriptor, gpu: { ...descriptor.gpu, driverVersion: 123 } }),
    );
    await expect(loadMachineDescriptor(root, "dev-01")).rejects.toThrow(
      "gpu.driverVersion must be a string",
    );

    const mismatched = {
      ...descriptor,
      display: { ...descriptor.display, refreshRateHz: 120 },
    };
    await writeFile(join(root, "dev-01.json"), JSON.stringify(mismatched));
    await expect(loadMachineDescriptor(root, "dev-01")).rejects.toThrow(
      "does not match showcase profile",
    );
  });
});

describe("browser display diagnostic parsing", () => {
  it("finds the next positive refresh label despite empty nodes and unit suffixes", () => {
    expect(
      parseDisplayRefreshRates([
        "Refresh Rate in Hz",
        "",
        "60 Hz",
        "Refresh Rate in Hz",
        "",
        "120.01",
      ]),
    ).toEqual([60, 120.01]);
  });

  it("fails closed for missing, zero, or unrelated numeric labels", () => {
    expect(parseDisplayRefreshRates(["Refresh Rate in Hz", "", "0", "GPU", "1234"])).toEqual([]);
  });
});

describe("report filename identity", () => {
  it("preserves valid IDs and replaces unsafe raw IDs", () => {
    expect(safeMachineIdForFilename("dev-01")).toBe("dev-01");
    expect(safeMachineIdForFilename("DEV-01")).toBe("dev-01");
    expect(safeMachineIdForFilename("../lost-report")).toBe("invalid-machine-id");
  });
});
