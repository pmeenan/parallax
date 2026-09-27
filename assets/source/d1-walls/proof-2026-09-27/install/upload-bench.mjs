// WebGPU texture upload throughput in pinned Chrome, in a dedicated worker, for the K1 wall
// kit's exact BC1/BC7 mip chains (pack.json). Requires `pnpm build` (harness/dist).
// node upload-bench.mjs <pack.json> <out.json>
// Modes, each on a fresh device:
//   write      one queue.writeTexture per mip level (the engine's uploadStreamedPbrTexture)
//   staging    all levels in one mapped-at-creation buffer (256-byte aligned rows), then one
//              copyBufferToTexture per level in a single command buffer
//   chunked    writeTexture per level, awaiting onSubmittedWorkDone every ~32 MB
// For each: the JS time spent issuing, the time until onSubmittedWorkDone, and the longest gap
// a 10 ms interval timer saw (how long the worker's event loop was blocked).
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(import.meta.dirname, "../../../../..");
const harness = (name) =>
  import(pathToFileURL(join(repo, "harness/dist/types", `${name}.js`)).href);
const { createLocalServer, listenLocalServer, stopLocalServer } = await harness("server");
const {
  launchPersistentChrome,
  loadChromePin,
  resolveChromeExecutablePath,
  validateChromeExecutable,
} = await harness("chrome-pin");
const { launchAfterPhysicalConsoleDisplayWake } = await harness("physical-console-preflight");

const pack = JSON.parse(await readFile(resolve(process.argv[2]), "utf8"));
const textures = pack.textures.map((t) => ({
  width: t.width,
  height: t.height,
  format: t.format,
  srgb: t.srgb,
}));
const work = await mkdtemp(join(tmpdir(), "parallax-upload-bench-"));
await writeFile(join(work, "index.html"), "<!doctype html><title>upload bench</title>\n");
await writeFile(
  join(work, "worker.js"),
  `
const levelBytes = (format, w, h) => format === "rgba8" ? w * h * 4 : Math.ceil(w / 4) * Math.ceil(h / 4) * (format === "bc7" ? 16 : 8);
onmessage = async ({ data: { textures, mode } }) => {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice({ requiredFeatures: ["texture-compression-bc"] });
  // Synthetic level data of the exact sizes (content does not change the copy path).
  const sets = textures.map((t) => {
    const levels = [];
    const count = 1 + Math.floor(Math.log2(Math.max(t.width, t.height)));
    for (let l = 0; l < count; l++) {
      const w = Math.max(1, t.width >> l), h = Math.max(1, t.height >> l);
      const bytes = new Uint8Array(levelBytes(t.format, w, h));
      for (let i = 0; i < bytes.length; i += 4096) bytes[i] = (i >> 12) & 255;
      levels.push({ w, h, bytes });
    }
    return { t, levels };
  });
  let lastTick = performance.now(), maxGap = 0;
  const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - lastTick); lastTick = now; }, 10);
  await new Promise((r) => setTimeout(r, 50));
  lastTick = performance.now(); maxGap = 0;
  const start = performance.now();
  let issued = 0, totalBytes = 0, calls = 0;
  const make = (t, count) => device.createTexture({
    size: { width: t.width, height: t.height },
    format: t.format === "rgba8" ? (t.srgb ? "rgba8unorm-srgb" : "rgba8unorm") : t.format + "-rgba-unorm" + (t.srgb ? "-srgb" : ""),
    mipLevelCount: count, usage: 0x04 | 0x02,
  });
  const blockBytes = (t) => t.format === "bc7" ? 16 : t.format === "bc1" ? 8 : 0;
  if (mode === "write" || mode === "chunked") {
    let sinceWait = 0;
    for (const { t, levels } of sets) {
      const texture = make(t, levels.length);
      for (const [mip, { w, h, bytes }] of levels.entries()) {
        const block = t.format !== "rgba8";
        const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
        device.queue.writeTexture({ texture, mipLevel: mip }, bytes,
          block ? { bytesPerRow: bw * blockBytes(t), rowsPerImage: bh } : { bytesPerRow: w * 4, rowsPerImage: h },
          block ? { width: bw * 4, height: bh * 4 } : { width: w, height: h });
        calls++; totalBytes += bytes.length; sinceWait += bytes.length;
        if (mode === "chunked" && sinceWait >= 32 * 1024 * 1024) {
          sinceWait = 0;
          await device.queue.onSubmittedWorkDone();
        }
      }
    }
  } else {
    const encoder = device.createCommandEncoder();
    const buffers = [];
    for (const { t, levels } of sets) {
      const texture = make(t, levels.length);
      const block = t.format !== "rgba8";
      const layout = levels.map(({ w, h }) => {
        const rows = block ? Math.ceil(h / 4) : h;
        const rowBytes = block ? Math.ceil(w / 4) * blockBytes(t) : w * 4;
        const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
        return { rows, rowBytes, bytesPerRow, size: bytesPerRow * rows };
      });
      let size = 0; const offsets = layout.map((l) => { const o = size; size += Math.ceil(l.size / 512) * 512; return o; });
      const buffer = device.createBuffer({ size, usage: 0x04 /* COPY_SRC */, mappedAtCreation: true });
      const mapped = new Uint8Array(buffer.getMappedRange());
      for (const [mip, { bytes }] of levels.entries()) {
        const l = layout[mip];
        if (l.bytesPerRow === l.rowBytes) mapped.set(bytes, offsets[mip]);
        else for (let r = 0; r < l.rows; r++) mapped.set(bytes.subarray(r * l.rowBytes, (r + 1) * l.rowBytes), offsets[mip] + r * l.bytesPerRow);
        totalBytes += bytes.length;
      }
      buffer.unmap();
      buffers.push(buffer);
      for (const [mip, { w, h }] of levels.entries()) {
        const l = layout[mip];
        const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
        encoder.copyBufferToTexture({ buffer, offset: offsets[mip], bytesPerRow: l.bytesPerRow, rowsPerImage: l.rows },
          { texture, mipLevel: mip }, block ? { width: bw * 4, height: bh * 4 } : { width: w, height: h });
        calls++;
      }
    }
    device.queue.submit([encoder.finish()]);
  }
  issued = performance.now() - start;
  await device.queue.onSubmittedWorkDone();
  const done = performance.now() - start;
  await new Promise((r) => setTimeout(r, 50));
  clearInterval(timer);
  postMessage({ mode, textures: sets.length, calls, totalBytes, issuedMs: issued, doneMs: done, maxEventLoopGapMs: maxGap });
};
`,
);
const pin = await loadChromePin(join(repo, "harness/chrome/stable.json"));
const executable = await resolveChromeExecutablePath(repo, pin);
const executableSha256 = await validateChromeExecutable(pin, executable);
const results = [];
const server = createLocalServer({ root: work });
const address = await listenLocalServer(server);
const origin = `http://127.0.0.1:${address.port}`;
try {
  for (const mode of ["write", "staging", "chunked", "write", "staging", "chunked"]) {
    const context = await launchAfterPhysicalConsoleDisplayWake(async () =>
      launchPersistentChrome(
        executable,
        await mkdtemp(join(tmpdir(), "parallax-upload-bench-profile-")),
      ),
    );
    try {
      const page = await context.newPage();
      await page.goto(`${origin}/index.html`);
      const result = await page.evaluate(
        ({ url, textures, mode }) =>
          new Promise((done, fail) => {
            const worker = new Worker(url);
            worker.onerror = (e) => fail(new Error(e.message));
            worker.onmessage = (e) => done(e.data);
            worker.postMessage({ textures, mode });
          }),
        { url: `${origin}/worker.js`, textures, mode },
      );
      results.push(result);
      console.log(JSON.stringify(result));
    } finally {
      await context.close();
    }
  }
} finally {
  await stopLocalServer(server);
}
await writeFile(
  resolve(process.argv[3]),
  `${JSON.stringify({ scenario: "webgpu-bc-upload-bench@1", browser: { version: pin.version, executableSha256 }, results }, null, 1)}\n`,
);
