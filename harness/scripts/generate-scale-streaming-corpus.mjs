import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MeshoptEncoder } from "../../engine/node_modules/meshoptimizer/meshopt_encoder.js";
import { KTX_ENCODER_PIN, loadPinnedKtxEncoder } from "../../engine/scripts/ktx-encoder-pin.mjs";
import { scaleStreamingDependencyResourceId } from "../../engine/src/streaming/scale-streaming-resource-id.ts";

const definitions = Object.freeze([
  ["compact", 64, 64, 16, 16, "checker", "uniform-diagonal"],
  ["courtyard", 128, 64, 32, 16, "brick", "alternating-diagonal"],
  ["streetscape", 128, 128, 32, 32, "road-markings", "row-diagonal"],
  ["woodland", 256, 128, 64, 32, "foliage", "hashed-diagonal"],
  ["district", 256, 256, 64, 64, "facade", "block-diagonal"],
  ["hero", 1024, 1024, 192, 192, "terrain-noise", "radial-diagonal"],
]);

const outputRoot = resolve(requiredArgument("--output"));
await mkdir(outputRoot, { recursive: true });
await mkdir(resolve(outputRoot, "immutable"), { recursive: true });
const ktx = await loadPinnedKtxEncoder();
await MeshoptEncoder.ready;
const graphs = [];
for (const [ordinal, definition] of definitions.entries()) {
  graphs.push(await generateGraph(ordinal, definition));
}
await writeFile(
  resolve(outputRoot, "scale-streaming-corpus.json"),
  `${JSON.stringify({
    encoder: {
      ktxArchiveSha256: KTX_ENCODER_PIN.archiveSha256,
      ktxJsSha256: KTX_ENCODER_PIN.jsSha256,
      ktxVersion: KTX_ENCODER_PIN.version,
      ktxWasmSha256: KTX_ENCODER_PIN.wasmSha256,
      meshoptVersion: "1.2.0",
      policy: "uastc-one-thread-no-sse-no-rdo",
    },
    graphs,
    schemaVersion: 1,
    totals: {
      encodedBytes: graphs
        .flatMap(({ resources }) => resources)
        .reduce((sum, item) => sum + item.bytes, 0),
      resourceCount: graphs.length * 3,
    },
  })}\n`,
  { flag: "wx" },
);

async function generateGraph(
  _ordinal,
  [id, width, height, columns, rows, texturePattern, topology],
) {
  const rgba = new Uint8Array(width * height * 4);
  let entropyTransitions = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [red, green, blue] = texturePixel(texturePattern, x, y);
      rgba[offset] = red;
      rgba[offset + 1] = green;
      rgba[offset + 2] = blue;
      rgba[offset + 3] = 255;
      if (offset > 0 && rgba[offset] !== rgba[offset - 4]) entropyTransitions += 1;
    }
  }
  const info = new ktx.textureCreateInfo();
  info.vkFormat = ktx.VkFormat.R8G8B8A8_SRGB;
  info.baseWidth = width;
  info.baseHeight = height;
  info.baseDepth = 1;
  info.numDimensions = 2;
  info.numLevels = 1;
  info.numLayers = 1;
  info.numFaces = 1;
  info.isArray = false;
  info.generateMipmaps = false;
  const texture = new ktx.texture(info, ktx.TextureCreateStorageEnum.ALLOC_STORAGE);
  const basis = new ktx.basisParams();
  try {
    texture.setImageFromMemory(0, 0, 0, rgba);
    basis.uastc = true;
    basis.threadCount = 1;
    basis.noSSE = true;
    basis.uastcRDO = false;
    basis.uastcRDONoMultithreading = true;
    texture.compressBasis(basis);
    const ktx2 = Uint8Array.from(texture.writeToMemory());
    const vertexCount = (columns + 1) * (rows + 1);
    const attributes = new Float32Array(vertexCount * 8);
    for (let row = 0; row <= rows; row += 1) {
      for (let column = 0; column <= columns; column += 1) {
        const vertex = row * (columns + 1) + column;
        const [x, y, z] = vertexPosition(id, column, row, columns, rows);
        attributes.set([x, y, z, 0, 1, 0, column / columns, row / rows], vertex * 8);
      }
    }
    const indices = new Uint32Array(columns * rows * 6);
    let cursor = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const a = row * (columns + 1) + column;
        const b = a + 1;
        const c = a + columns + 1;
        const d = c + 1;
        const flipped = flipDiagonal(topology, column, row, columns, rows);
        indices.set(flipped ? [a, c, d, a, d, b] : [a, c, b, b, c, d], cursor);
        cursor += 6;
      }
    }
    const encodedAttributes = MeshoptEncoder.encodeGltfBuffer(
      new Uint8Array(attributes.buffer),
      vertexCount,
      32,
      "ATTRIBUTES",
      0,
    );
    const encodedIndices = MeshoptEncoder.encodeGltfBuffer(
      new Uint8Array(indices.buffer),
      indices.length,
      4,
      "TRIANGLES",
      0,
    );
    const textureResource = await writeResource("texture", "ktx2", ktx2);
    const verticesResource = await writeResource("vertices", "meshopt", encodedAttributes);
    const indicesResource = await writeResource("indices", "meshopt", encodedIndices);
    return {
      entropy: {
        rgbaDistinctByteCount: new Set(rgba).size,
        transitionRatio: entropyTransitions / (width * height - 1),
      },
      id,
      indexCount: indices.length,
      resources: [textureResource, verticesResource, indicesResource],
      texture: { height, width },
      texturePattern,
      topology,
      vertexCount,
    };
  } finally {
    texture.delete();
    basis.delete();
    info.delete();
  }
}

async function writeResource(role, extension, bytes) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const resourceId = scaleStreamingDependencyResourceId(role, sha256);
  const source = `immutable/streaming-${role}-${sha256}.${extension}`;
  await writeFile(resolve(outputRoot, source), bytes, { flag: "wx" });
  return { bytes: bytes.byteLength, resourceId, role, sha256, source };
}

function texturePixel(pattern, x, y) {
  if (pattern === "checker") {
    return ((x >> 3) + (y >> 3)) % 2 === 0 ? [52, 74, 92] : [188, 164, 118];
  }
  if (pattern === "brick") {
    const shiftedX = x + ((Math.floor(y / 12) & 1) === 0 ? 0 : 8);
    if (y % 12 < 2 || shiftedX % 16 < 2) return [66, 62, 58];
    const shade = ((x >> 4) + (y >> 3)) & 3;
    return [132 + shade * 14, 62 + shade * 7, 48 + shade * 5];
  }
  if (pattern === "road-markings") {
    if (x % 48 >= 22 && x % 48 <= 25) return [238, 214, 92];
    if (x % 64 < 5 || x % 64 > 58) return [154, 150, 142];
    const shade = (y >> 4) & 3;
    return [48 + shade * 3, 52 + shade * 3, 56 + shade * 3];
  }
  if (pattern === "foliage") {
    const noise = mix32((x * 0x85ebca6b) ^ (y * 0xc2b2ae35));
    const shade = noise & 31;
    return [24 + (shade >> 1), 72 + shade * 4, 30 + ((noise >>> 8) & 31)];
  }
  if (pattern === "facade") {
    const frame = x % 32 < 4 || y % 24 < 4;
    const window = x % 32 >= 9 && x % 32 <= 25 && y % 24 >= 7 && y % 24 <= 19;
    if (frame) return [82, 76, 68];
    if (window) return [38 + ((x + y) & 7), 76 + ((x >> 2) & 15), 104 + ((y >> 2) & 15)];
    return [166 + ((x >> 5) & 7), 148 + ((y >> 5) & 7), 122];
  }
  const noise = mix32((x * 0x9e3779b1) ^ (y * 0x85ebca6b) ^ ((x + y) * 0xc2b2ae35));
  return [noise & 255, (noise >>> 8) & 255, (noise >>> 16) & 255];
}

function vertexPosition(id, column, row, columns, rows) {
  const u = column / columns;
  const v = row / rows;
  if (id === "compact") return [column, 0, row];
  if (id === "courtyard") {
    const edge = Math.min(column, row, columns - column, rows - row);
    return [column, edge < 3 ? 4 - edge : -1.5, row];
  }
  if (id === "streetscape") {
    const curb = Math.abs(u - 0.5) > 0.34 ? 0.65 : 0;
    return [(u - 0.5) * columns * 1.8, curb, row];
  }
  if (id === "woodland") {
    return [column, Math.sin(column * 0.31) * 1.7 + Math.cos(row * 0.23) * 2.1, row];
  }
  if (id === "district") {
    return [column, Math.floor((Math.sin(column * 0.12) + Math.cos(row * 0.09) + 2) * 1.5), row];
  }
  const dx = u - 0.5;
  const dz = v - 0.5;
  const radius = Math.hypot(dx, dz);
  return [
    (u - 0.5) * 384,
    Math.cos(radius * 18) * 12 * (1 - radius) + radius * 20,
    (v - 0.5) * 384,
  ];
}

function flipDiagonal(topology, column, row, columns, rows) {
  if (topology === "uniform-diagonal") return false;
  if (topology === "alternating-diagonal") return ((column + row) & 1) === 0;
  if (topology === "row-diagonal") return (row & 3) < 2;
  if (topology === "hashed-diagonal") return (mix32(column ^ (row * 0x9e3779b1)) & 1) === 0;
  if (topology === "block-diagonal") return (((column >> 2) + (row >> 2)) & 1) === 0;
  const dx = column - columns / 2;
  const dy = row - rows / 2;
  return Math.abs(dx) > Math.abs(dy) ? dx > 0 : dy > 0;
}

function mix32(value) {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function requiredArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value === "") throw new Error(`Missing ${name}`);
  return value;
}
