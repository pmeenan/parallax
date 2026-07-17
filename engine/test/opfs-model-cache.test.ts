import { describe, expect, it } from "vitest";
import type { AppOwnedLlmModelArtifact } from "../src/ai/app-owned-llm-spike-protocol";
import { createOpfsModelCache, type OpfsModelCachePlatform } from "../src/ai/opfs-model-cache";

const BASE_URL = "https://models.example/revision/";
const HELLO = new TextEncoder().encode("hello");
const HELLO_ARTIFACT = Object.freeze({
  bytes: HELLO.byteLength,
  path: "model.bin",
  sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
}) satisfies AppOwnedLlmModelArtifact;

describe("OPFS model cache", () => {
  it("installs only a hash-valid artifact and reads it from OPFS", async () => {
    const fileSystem = new MemoryDirectory();
    let now = 0;
    const cache = createOpfsModelCache(BASE_URL, [HELLO_ARTIFACT], {
      getRoot: async () => fileSystem.asHandle(),
      now: () => (now += 5),
    });

    expect(await cache.cache.match(`${BASE_URL}model.bin`)).toBeUndefined();
    await cache.cache.put(`${BASE_URL}model.bin`, new Response(HELLO));
    const response = await cache.cache.match(`${BASE_URL}model.bin`);

    expect(response).toBeDefined();
    if (response === undefined) throw new Error("Cache did not return the installed artifact");
    expect(cache.snapshot()).toMatchObject({ hitArtifacts: 0, readBytes: 0 });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(HELLO);
    expect(cache.snapshot()).toMatchObject({
      expectedArtifacts: 1,
      hitArtifacts: 1,
      integrityFailures: 0,
      missArtifacts: 1,
      readBytes: 5,
      verifiedArtifacts: 1,
      writeBytes: 5,
    });
    expect([...fileSystem.files.keys()].some((name) => name.endsWith(".partial"))).toBe(false);
  });

  it("treats interrupted or malformed metadata publication as a cache miss", async () => {
    const fileSystem = new MemoryDirectory();
    const cache = createOpfsModelCache(BASE_URL, [HELLO_ARTIFACT], platform(fileSystem));

    await cache.cache.put(`${BASE_URL}model.bin`, new Response(HELLO));
    const metadata = [...fileSystem.files.entries()].find(([name]) => name.endsWith(".json"));
    if (metadata === undefined) throw new Error("Test cache did not publish metadata");
    metadata[1].bytes = new Uint8Array();

    await expect(cache.cache.match(`${BASE_URL}model.bin`)).resolves.toBeUndefined();
    expect(cache.snapshot()).toMatchObject({ hitArtifacts: 0, missArtifacts: 1 });
  });

  it("does not credit a hit or read bytes until the cached body is fully consumed", async () => {
    const fileSystem = new MemoryDirectory();
    const cache = createOpfsModelCache(BASE_URL, [HELLO_ARTIFACT], platform(fileSystem));

    await cache.cache.put(`${BASE_URL}model.bin`, new Response(HELLO));
    const response = await cache.cache.match(`${BASE_URL}model.bin`);
    if (response === undefined) throw new Error("Cache did not return the installed artifact");
    await response.body?.cancel();

    expect(cache.snapshot()).toMatchObject({ hitArtifacts: 0, missArtifacts: 1, readBytes: 0 });
  });

  it("rejects bytes that do not match the pinned artifact", async () => {
    const fileSystem = new MemoryDirectory();
    const cache = createOpfsModelCache(BASE_URL, [HELLO_ARTIFACT], platform(fileSystem));

    await expect(
      cache.cache.put(`${BASE_URL}model.bin`, new Response(new TextEncoder().encode("wrong"))),
    ).rejects.toThrow("Model artifact integrity mismatch");
    expect(cache.snapshot()).toMatchObject({ integrityFailures: 1, verifiedArtifacts: 0 });
    expect(await cache.cache.match(`${BASE_URL}model.bin`)).toBeUndefined();
  });

  it("refuses an artifact outside the pinned manifest", async () => {
    const cache = createOpfsModelCache(BASE_URL, [HELLO_ARTIFACT], platform(new MemoryDirectory()));

    await expect(cache.cache.put(`${BASE_URL}other.bin`, new Response(HELLO))).rejects.toThrow(
      "Refusing to cache an unpinned model artifact",
    );
  });
});

function platform(directory: MemoryDirectory): OpfsModelCachePlatform {
  return Object.freeze({ getRoot: async () => directory.asHandle(), now: () => 0 });
}

class MemoryDirectory {
  readonly files = new Map<string, MemoryFile>();

  asHandle(): FileSystemDirectoryHandle {
    return {
      getDirectoryHandle: async () => this.asHandle(),
      getFileHandle: async (name: string, options?: FileSystemGetFileOptions) => {
        let file = this.files.get(name);
        if (file === undefined && options?.create === true) {
          file = new MemoryFile(name, this);
          this.files.set(name, file);
        }
        if (file === undefined) throw new DOMException("missing", "NotFoundError");
        return file.asHandle();
      },
      removeEntry: async (name: string) => {
        if (!this.files.delete(name)) throw new DOMException("missing", "NotFoundError");
      },
    } as unknown as FileSystemDirectoryHandle;
  }
}

class MemoryFile {
  bytes = new Uint8Array();

  constructor(
    private name: string,
    private readonly directory: MemoryDirectory,
  ) {}

  asHandle(): FileSystemFileHandle {
    const self = this;
    return {
      async createWritable() {
        const chunks: Uint8Array[] = [];
        return {
          async abort() {},
          async close() {
            const bytes = new Uint8Array(
              chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
            );
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            self.bytes = bytes;
          },
          async write(value: FileSystemWriteChunkType) {
            if (typeof value === "string") chunks.push(new TextEncoder().encode(value));
            else if (value instanceof Blob) chunks.push(new Uint8Array(await value.arrayBuffer()));
            else if (ArrayBuffer.isView(value)) {
              chunks.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice());
            } else if (value instanceof ArrayBuffer) chunks.push(new Uint8Array(value).slice());
            else throw new Error("Memory writable received an unsupported command");
          },
        } as unknown as FileSystemWritableFileStream;
      },
      async getFile() {
        return new File([self.bytes], self.name);
      },
      async move(name: string) {
        self.directory.files.delete(self.name);
        self.name = name;
        self.directory.files.set(name, self);
      },
    } as unknown as FileSystemFileHandle;
  }
}
