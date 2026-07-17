import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type {
  AppOwnedLlmCacheTelemetry,
  AppOwnedLlmModelArtifact,
} from "./app-owned-llm-spike-protocol";

const CACHE_DIRECTORY = "parallax-model-cache-v1";

interface MovableFileHandle extends FileSystemFileHandle {
  move(name: string): Promise<void>;
}

interface VerifiedMetadata {
  readonly bytes: number;
  readonly request: string;
  readonly sha256: string;
}

export interface OpfsModelCache {
  readonly cache: Readonly<{
    match(request: string): Promise<Response | undefined>;
    put(
      request: string,
      response: Response,
      progress?: (data: { loaded: number; progress: number; total: number }) => void,
    ): Promise<void>;
  }>;
  snapshot(): AppOwnedLlmCacheTelemetry;
}

export interface OpfsModelCachePlatform {
  getRoot(): Promise<FileSystemDirectoryHandle>;
  now(): number;
}

export function createOpfsModelCache(
  modelBaseUrl: string,
  artifacts: readonly AppOwnedLlmModelArtifact[],
  platform: OpfsModelCachePlatform = browserPlatform(),
): OpfsModelCache {
  const expectedByRequest = new Map(
    artifacts.map((artifact) => [`${modelBaseUrl}${artifact.path}`, artifact] as const),
  );
  const hits = new Set<string>();
  const misses = new Set<string>();
  const verified = new Set<string>();
  let integrityFailures = 0;
  let readBytes = 0;
  let readElapsedMs = 0;
  let writeBytes = 0;
  let writeElapsedMs = 0;
  let directoryPromise: Promise<FileSystemDirectoryHandle> | null = null;

  const directory = (): Promise<FileSystemDirectoryHandle> => {
    directoryPromise ??= platform
      .getRoot()
      .then((root) => root.getDirectoryHandle(CACHE_DIRECTORY, { create: true }));
    return directoryPromise;
  };

  const namesFor = async (
    request: string,
  ): Promise<
    Readonly<{ data: string; metadata: string; metadataPartial: string; partial: string }>
  > => {
    const digest = bytesToHex(sha256(new TextEncoder().encode(request)));
    return Object.freeze({
      data: `${digest}.bin`,
      metadata: `${digest}.json`,
      metadataPartial: `${digest}.json.partial`,
      partial: `${digest}.partial`,
    });
  };

  const match = async (request: string): Promise<Response | undefined> => {
    const expected = expectedByRequest.get(request);
    if (expected === undefined) return undefined;
    const names = await namesFor(request);
    try {
      const cacheDirectory = await directory();
      const metadataFile = await (await cacheDirectory.getFileHandle(names.metadata)).getFile();
      const metadata = JSON.parse(await metadataFile.text()) as VerifiedMetadata;
      if (
        metadata.request !== request ||
        metadata.bytes !== expected.bytes ||
        metadata.sha256 !== expected.sha256
      ) {
        misses.add(expected.path);
        return undefined;
      }
      const file = await (await cacheDirectory.getFileHandle(names.data)).getFile();
      if (file.size !== expected.bytes) {
        misses.add(expected.path);
        return undefined;
      }
      // Warm reads trust the hash that was checked before the data and metadata were
      // atomically published. Re-hashing here would read every multi-GB artifact twice;
      // the later M2 lifecycle work owns post-install corruption detection and repair.
      const startedAt = platform.now();
      let consumed = 0;
      let completed = false;
      const reader = file.stream().getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller): Promise<void> {
          const next = await reader.read();
          if (next.done) {
            completed = true;
            readBytes += consumed;
            readElapsedMs += Math.max(0, platform.now() - startedAt);
            hits.add(expected.path);
            verified.add(expected.path);
            controller.close();
            return;
          }
          consumed += next.value.byteLength;
          controller.enqueue(next.value);
        },
        async cancel(reason): Promise<void> {
          await reader.cancel(reason);
          if (!completed) misses.add(expected.path);
        },
      });
      return new Response(body, {
        headers: { "content-length": String(file.size) },
      });
    } catch (error: unknown) {
      if (
        error instanceof SyntaxError ||
        (error instanceof DOMException &&
          (error.name === "NotFoundError" || error.name === "NotReadableError"))
      ) {
        misses.add(expected.path);
        return undefined;
      }
      throw error;
    }
  };

  const put = async (
    request: string,
    response: Response,
    progress?: (data: { loaded: number; progress: number; total: number }) => void,
  ): Promise<void> => {
    const expected = expectedByRequest.get(request);
    if (expected === undefined) {
      throw new Error(`Refusing to cache an unpinned model artifact: ${request}`);
    }
    if (response.body === null)
      throw new Error(`Model artifact response had no body: ${expected.path}`);
    const cacheDirectory = await directory();
    const names = await namesFor(request);
    const partial = await cacheDirectory.getFileHandle(names.partial, { create: true });
    const writable = await partial.createWritable();
    const reader = response.body.getReader();
    const hasher = sha256.create();
    const startedAt = platform.now();
    let bytes = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        hasher.update(next.value);
        await writable.write(next.value);
        progress?.({
          loaded: bytes,
          progress: expected.bytes === 0 ? 100 : (bytes / expected.bytes) * 100,
          total: expected.bytes,
        });
      }
      await writable.close();
    } catch (error: unknown) {
      await reader.cancel().catch(() => undefined);
      await writable.abort().catch(() => undefined);
      throw error;
    }
    writeBytes += bytes;
    writeElapsedMs += Math.max(0, platform.now() - startedAt);
    const actualHash = bytesToHex(hasher.digest());
    if (bytes !== expected.bytes || actualHash !== expected.sha256) {
      integrityFailures += 1;
      await cacheDirectory.removeEntry(names.partial).catch(() => undefined);
      throw new Error(
        `Model artifact integrity mismatch for ${expected.path}: expected ${expected.bytes} bytes/${expected.sha256}, got ${bytes} bytes/${actualHash}`,
      );
    }
    if (typeof (partial as Partial<MovableFileHandle>).move !== "function") {
      throw new Error(
        "OPFS FileSystemFileHandle.move() is unavailable for atomic model installation",
      );
    }
    await (partial as MovableFileHandle).move(names.data);
    const metadataPartial = await cacheDirectory.getFileHandle(names.metadataPartial, {
      create: true,
    });
    if (typeof (metadataPartial as Partial<MovableFileHandle>).move !== "function") {
      throw new Error(
        "OPFS FileSystemFileHandle.move() is unavailable for atomic model metadata installation",
      );
    }
    const metadataWritable = await metadataPartial.createWritable();
    try {
      await metadataWritable.write(JSON.stringify({ bytes, request, sha256: actualHash }));
      await metadataWritable.close();
      await (metadataPartial as MovableFileHandle).move(names.metadata);
    } catch (error: unknown) {
      await metadataWritable.abort().catch(() => undefined);
      await cacheDirectory.removeEntry(names.metadataPartial).catch(() => undefined);
      throw error;
    }
    verified.add(expected.path);
  };

  return Object.freeze({
    cache: Object.freeze({ match, put }),
    snapshot(): AppOwnedLlmCacheTelemetry {
      return Object.freeze({
        expectedArtifacts: artifacts.length,
        hitArtifacts: hits.size,
        integrityFailures,
        missArtifacts: misses.size,
        readBytes,
        readElapsedMs,
        verifiedArtifacts: verified.size,
        writeBytes,
        writeElapsedMs,
      });
    },
  });
}

function browserPlatform(): OpfsModelCachePlatform {
  return Object.freeze({
    getRoot: () => navigator.storage.getDirectory(),
    now: () => performance.now(),
  });
}
