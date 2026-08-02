import createDracoDecoder from "parallax:draco-decoder-factory";
import createMscTranscoder from "parallax:msc-transcoder-factory";
import * as KTX2Decoder from "@babylonjs/ktx2decoder";
import { MeshoptDecoder } from "meshoptimizer/decoder";

const immutableRoot = new URL("./", import.meta.url);

const decoderArtifacts = Object.freeze({
  draco: "__DRACO_DECODER_WASM_ARTIFACT__",
  msc: "__MSC_TRANSCODER_WASM_ARTIFACT__",
  uastcAstc: "__UASTC_ASTC_WASM_ARTIFACT__",
  uastcBc7: "__UASTC_BC7_WASM_ARTIFACT__",
  uastcR8: "__UASTC_R8_WASM_ARTIFACT__",
  uastcRg8: "__UASTC_RG8_WASM_ARTIFACT__",
  uastcRgbaSrgb: "__UASTC_RGBA_SRGB_WASM_ARTIFACT__",
  uastcRgbaUnorm: "__UASTC_RGBA_UNORM_WASM_ARTIFACT__",
  zstd: "__ZSTD_DECODER_WASM_ARTIFACT__",
});

function immutableUrl(fileName: string): string {
  return new URL(fileName, immutableRoot).href;
}

type DecoderGlobals = typeof globalThis & {
  DracoDecoderModule?: typeof createDracoDecoder;
  KTX2DECODER?: typeof KTX2Decoder;
  MeshoptDecoder?: typeof MeshoptDecoder;
};

export interface DecoderBootstrapTelemetry {
  readonly installedAtMs: number;
  readonly paths: Readonly<{
    draco: "preinstalled-global";
    ktx2: "preinstalled-global";
    meshopt: "preinstalled-global";
  }>;
  readonly versions: Readonly<{
    draco: "1.5.7";
    ktx2: "9.17.0";
    meshopt: "1.2.0";
  }>;
}

export interface DecoderFixtureTelemetry {
  readonly draco: Readonly<{ readonly durationMs: number; readonly faces: number }>;
  readonly ktx2: Readonly<{
    readonly durationMs: number;
    readonly height: number;
    readonly transcoder: string;
    readonly width: number;
  }>;
  readonly meshopt: Readonly<{ readonly bytes: number; readonly durationMs: number }>;
}

export function installDecoderGlobals(): DecoderBootstrapTelemetry {
  const globals = globalThis as DecoderGlobals;
  if (
    globals.DracoDecoderModule !== undefined ||
    globals.KTX2DECODER !== undefined ||
    globals.MeshoptDecoder !== undefined
  ) {
    throw new Error("Decoder globals must have one render-worker owner");
  }

  const dracoWasmUrl = immutableUrl(decoderArtifacts.draco);
  const dracoWasm = fetch(dracoWasmUrl).then(async (response) => {
    if (!response.ok) throw new Error(`Draco decoder WASM fetch failed: ${response.status}`);
    return await response.arrayBuffer();
  });
  globals.DracoDecoderModule = async (options) =>
    await createDracoDecoder({
      ...options,
      locateFile: (fileName) =>
        fileName.endsWith(".wasm") ? dracoWasmUrl : (options.locateFile?.(fileName) ?? fileName),
      wasmBinary: await dracoWasm,
    });

  KTX2Decoder.MSCTranscoder.JSModule = createMscTranscoder;
  KTX2Decoder.MSCTranscoder.UseFromWorkerThread = false;
  KTX2Decoder.WASMMemoryManager.LoadBinariesFromCurrentThread = true;
  KTX2Decoder.MSCTranscoder.WasmModuleURL = immutableUrl(decoderArtifacts.msc);
  KTX2Decoder.LiteTranscoder_UASTC_ASTC.WasmModuleURL = immutableUrl(decoderArtifacts.uastcAstc);
  KTX2Decoder.LiteTranscoder_UASTC_BC7.WasmModuleURL = immutableUrl(decoderArtifacts.uastcBc7);
  KTX2Decoder.LiteTranscoder_UASTC_R8_UNORM.WasmModuleURL = immutableUrl(decoderArtifacts.uastcR8);
  KTX2Decoder.LiteTranscoder_UASTC_RG8_UNORM.WasmModuleURL = immutableUrl(
    decoderArtifacts.uastcRg8,
  );
  KTX2Decoder.LiteTranscoder_UASTC_RGBA_SRGB.WasmModuleURL = immutableUrl(
    decoderArtifacts.uastcRgbaSrgb,
  );
  KTX2Decoder.LiteTranscoder_UASTC_RGBA_UNORM.WasmModuleURL = immutableUrl(
    decoderArtifacts.uastcRgbaUnorm,
  );
  KTX2Decoder.ZSTDDecoder.WasmModuleURL = immutableUrl(decoderArtifacts.zstd);
  globals.KTX2DECODER = KTX2Decoder;
  globals.MeshoptDecoder = MeshoptDecoder;

  return Object.freeze({
    installedAtMs: performance.now(),
    paths: Object.freeze({
      draco: "preinstalled-global",
      ktx2: "preinstalled-global",
      meshopt: "preinstalled-global",
    }),
    versions: Object.freeze({ draco: "1.5.7", ktx2: "9.17.0", meshopt: "1.2.0" }),
  });
}

interface DracoStatus {
  error_msg(): string;
  ok(): boolean;
}

interface DracoMesh {
  num_faces(): number;
}

interface DracoDecoderModule {
  readonly Mesh: new () => DracoMesh;
  readonly Decoder: new () => {
    DecodeBufferToMesh(buffer: object, mesh: DracoMesh): DracoStatus;
  };
  readonly DecoderBuffer: new () => {
    Init(bytes: Int8Array, byteLength: number): void;
  };
  destroy(value: object): void;
}

// Khronos glTF-Sample-Assets @ 2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf,
// CarConcept/glTF-KTX-BasisU-Draco/Dot_C.ktx2 (SHA-256 08968e9d…041ca).
export const KTX2_FIXTURE_BASE64 =
  "q0tUWCAyMLsNChoKAAAAAAEAAACAAAAAgAAAAAAAAAAAAAAAAQAAAAgAAAABAAAAEAEAACwAAAA8AQAAPAAAAHgBAAAAAAAAGAIAAAAAAABvBAAAAAAAAO8AAAAAAAAAAAAAAAAAAADkAwAAAAAAAIsAAAAAAAAAAAAAAAAAAACwAwAAAAAAADQAAAAAAAAAAAAAAAAAAACeAwAAAAAAABIAAAAAAAAAAAAAAAAAAACXAwAAAAAAAAcAAAAAAAAAAAAAAAAAAACUAwAAAAAAAAMAAAAAAAAAAAAAAAAAAACSAwAAAAAAAAIAAAAAAAAAAAAAAAAAAACQAwAAAAAAAAIAAAAAAAAAAAAAAAAAAAAsAAAAAAAAAAIAKACjAQIAAwMAAAAAAAAAAAAAAAA/AAAAAAAAAAAA/////zcAAABLVFh3cml0ZXIAUmFwaWRQaXBlbGluZSAzRCBQcm9jZXNzb3IgLyBsaWJrdHggdjQuMC4wfjUAAAkAVAAyAAAAyQAAAGkAAAAAAAAAAAAAAAAAAADvAAAAAAAAAAAAAAAAAAAAAAAAAIsAAAAAAAAAAAAAAAAAAAAAAAAANAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAABHAhAABAAAAENSBwAogCoAAAAAA5BqWgAATAQAAAAAAyIMBCEAEAAEAAEAIddtAa8tZGAemCEwDQRQA0Pd3lmbbbsiKJUFAWFGJGIcdhe4ROAIHQAw36BHA9gQIxCS9QB0CRIOqqqrq8fh5Q18kEg05DLrUw0iClDBCYoQIt134hUaGxoxdLfK+VhmTMiLRaGIhHnFChqSRMgziRaSzLp5/alkvrzWTZZgwjY2kwRJM1zSYsaNRilr3uRXrUs//mEU3iqvv6Jw391+Hfik0lkpuOK+2l8PVQPTEQNeLzby1feg7hqAP7oYwr98v+sl2NWXKQp2Uj/n09vcEAcEcAU0giAIA+gSLLbbwO6QOnkHshLGw8ALWskcIIaWkSRlvY2pHENIEQrxJemF/AhABAAAAQRA0eUYlEAtSWgegAMrbQN8G7wkRAv5UBBX8SWpHW20dcAF4KoAHDAAgCINkMTWi8gEBowGjAeP9B7U/37tX/AKX/5j4DF8QFy/HVxQfeTgWUQFjSjwsCBefmXNvfghePilE3P/t2Rz8PBe7W84OiXiqpNOkCFGrj1UjLrZmfC7cG83SwdIuJaX8p+z9EhPv3UYmTYi4R8jdjPj/bvFtgsTpjZUrYdnbXz7Wt88ZKDE89u/6Etv7vZ48f7LO7G8ngqWTH5DheGFguB0OpA5hOIwMbxkMt4FA2ipGriPDqW56xdJ+m1GbYGqtI0ltNL9R22/33LPN8Nj2ukOXNGnftLlTDgcRtyOBxHFmYJgkeLWfCCWlXDmTJo0og5bj9fABD9BuRQXba4GWY78Jiq/oV3iHVrkB/JJ0GwdscAccWzD/VG4CV5puwwKx4e6tGnjq659SBju0pX/O9DukDw449XHALYNnRR7HGWjVncKKbv+AP3hO7MfwDRycEirFbi7QOI+6gg6sdkGlmO4LNA6NDrygpWiBhhUUBTqwr0Kl2F4NNAZR3/ENdM0BO7RKA/hjHCstcAZ0nQVy01TawJ3hdbdHMDFZBfvzwawTowMeadrS3ul+RsQCLufFDN3SgEOSVl0UNiv4uSzewe59oOU4OCIUR9GrqGCaB1qO1Rp8QB8S";

// Khronos glTF-Sample-Assets at the same commit, Box/glTF-Draco/Box.bin
// (SHA-256 610dc6e0…bf2e).
const DRACO_FIXTURE_BASE64 =
  "RFJBQ08CAgEBAAAACAwBCwAAA19bCgEBEFUEXOONRgL/AAAAAQABAAkDAAECAQEJAwAAAwEBAQADAwEwARADACSWEwokBAAAAAD/BwAAAAAAvwAAAL8AAAC/AACAPwsGAwEBAQEBQAEA/wAAAH8AAAD/AqFBCAAA";

// meshoptimizer 1.2.0's upstream decodeVertexBuffer regression vector.
const MESHOPT_FIXTURE_BASE64 =
  "oAE/AAAAWFdYASYAAAABDAAAAFgBCAAAAAAAAAABPwAAABcYFwEmAAAAAQwAAAAXAQgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

const MESHOPT_EXPECTED = new Uint8Array([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 44, 1, 0, 0, 0, 0, 0, 0, 244, 1, 0, 0, 0, 0, 44, 1, 0, 0, 0,
  0, 0, 0, 244, 1, 44, 1, 44, 1, 0, 0, 0, 0, 244, 1, 244, 1,
]);

export async function runDecoderFixtures(): Promise<DecoderFixtureTelemetry> {
  const globals = globalThis as DecoderGlobals;
  const dracoFactory = globals.DracoDecoderModule;
  if (dracoFactory === undefined) throw new Error("Draco decoder global was not installed");

  const dracoStartedAt = performance.now();
  const dracoBytes = Int8Array.from(atob(DRACO_FIXTURE_BASE64), (character) =>
    character.charCodeAt(0),
  );
  let draco: DracoDecoderModule;
  try {
    draco = (await dracoFactory({})) as DracoDecoderModule;
  } catch (error: unknown) {
    throw new Error(`Draco decoder initialization failed: ${errorMessage(error)}`);
  }
  const dracoBuffer = new draco.DecoderBuffer();
  const dracoDecoder = new draco.Decoder();
  const dracoMesh = new draco.Mesh();
  dracoBuffer.Init(dracoBytes, dracoBytes.byteLength);
  const dracoStatus = dracoDecoder.DecodeBufferToMesh(dracoBuffer, dracoMesh);
  if (!dracoStatus.ok()) {
    throw new Error(`Draco glTF fixture decode failed: ${dracoStatus.error_msg()}`);
  }
  const faces = dracoMesh.num_faces();
  draco.destroy(dracoBuffer);
  draco.destroy(dracoMesh);
  draco.destroy(dracoDecoder);
  if (faces <= 0) throw new Error("Draco fixture decoded no faces");

  const ktx2StartedAt = performance.now();
  const ktx2Bytes = Uint8Array.from(atob(KTX2_FIXTURE_BASE64), (character) =>
    character.charCodeAt(0),
  );
  let ktx2: Awaited<ReturnType<KTX2Decoder.KTX2Decoder["decode"]>>;
  try {
    ktx2 = await new KTX2Decoder.KTX2Decoder().decode(ktx2Bytes, {
      astc: false,
      bptc: false,
      etc1: false,
      etc2: false,
      pvrtc: false,
      s3tc: false,
    });
  } catch (error: unknown) {
    throw new Error(`KTX2 decoder fixture failed: ${errorMessage(error)}`);
  }
  if (ktx2.width !== 128 || ktx2.height !== 128 || ktx2.mipmaps.length === 0) {
    throw new Error(`KTX2 fixture decoded unexpected dimensions: ${ktx2.width}x${ktx2.height}`);
  }

  const meshoptStartedAt = performance.now();
  await MeshoptDecoder.ready;
  const decodedMeshopt = new Uint8Array(MESHOPT_EXPECTED.byteLength);
  const meshoptBytes = Uint8Array.from(atob(MESHOPT_FIXTURE_BASE64), (character) =>
    character.charCodeAt(0),
  );
  MeshoptDecoder.decodeGltfBuffer(decodedMeshopt, 4, 12, meshoptBytes, "ATTRIBUTES");
  if (!decodedMeshopt.every((value, index) => value === MESHOPT_EXPECTED[index])) {
    throw new Error("meshopt fixture output did not match the pinned decoded bytes");
  }

  return Object.freeze({
    draco: Object.freeze({ durationMs: ktx2StartedAt - dracoStartedAt, faces }),
    ktx2: Object.freeze({
      durationMs: meshoptStartedAt - ktx2StartedAt,
      height: ktx2.height,
      transcoder: ktx2.transcoderName,
      width: ktx2.width,
    }),
    meshopt: Object.freeze({
      bytes: decodedMeshopt.byteLength,
      durationMs: performance.now() - meshoptStartedAt,
    }),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
