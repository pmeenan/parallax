import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { readAndValidateBuildManifest, sha256File } from "./build-manifest.js";
import {
  readFixedRemoteModelIdentity,
  verifyModelSourceResource,
} from "./model-source-verification.js";
import {
  runModelSourceVerificationCommand,
  sanitizeModelSourceFailure,
} from "./model-source-verification-command.js";
import {
  publishModelSourceVerificationResult,
  validatePersistedModelSourceVerificationResult,
} from "./model-source-verification-publication.js";
import {
  formatModelSourceVerificationMarkdown,
  type ModelSourceVerificationResource,
  validateModelSourceVerificationResult,
} from "./model-source-verification-result.js";
import { readSourceIdentity } from "./source-identity.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildRoot = join(repositoryRoot, "dist");
const testOverridesEnabled = process.env.NODE_ENV === "test";
const resultRoot =
  testOverridesEnabled && process.env.PARALLAX_MODEL_SOURCE_RESULT_ROOT !== undefined
    ? resolve(process.env.PARALLAX_MODEL_SOURCE_RESULT_ROOT)
    : join(repositoryRoot, "harness/results/model-source-verification");
const registryPath =
  testOverridesEnabled && process.env.PARALLAX_MODEL_SOURCE_REGISTRY_PATH !== undefined
    ? resolve(process.env.PARALLAX_MODEL_SOURCE_REGISTRY_PATH)
    : join(repositoryRoot, ".parallax-toolchain.local.json");
const origin = "https://parallax-web.com";
const execFileAsync = promisify(execFile);

await runModelSourceVerificationCommand(main);

async function main(): Promise<void> {
  const build = await readAndValidateBuildManifest(buildRoot);
  const source = await readSourceIdentity(repositoryRoot);
  const models = build.installManifest.resources.filter((resource) => resource.kind === "model");
  if (models.length !== 5) throw new Error("Install manifest must contain five model shards");
  const startedAt = new Date().toISOString();
  const stem = `model-source-v2-${startedAt.replaceAll(/[:.]/g, "-")}`;
  const jsonPath = join(resultRoot, `${stem}.json`);
  const markdownPath = join(resultRoot, `${stem}.md`);
  const temporaryPath = `${jsonPath}.tmp`;
  const markdownTemporaryPath = `${markdownPath}.tmp`;
  const nodeIdentity = await sha256File(process.execPath);
  const base = {
    artifactDigest: build.artifactDigest,
    node: {
      executable: basename(process.execPath),
      executableSha256: nodeIdentity.sha256,
      version: process.version,
    },
    releaseDigest: build.releaseDigest,
    schemaVersion: 2,
    source,
    startedAt,
  } as const;
  await mkdir(resultRoot, { recursive: true });
  const pending = { ...base, state: "pending" } as const;
  validateModelSourceVerificationResult(pending);
  await writeFile(jsonPath, `${JSON.stringify(pending, null, 2)}\n`, {
    flag: "wx",
  });
  await validatePersistedModelSourceVerificationResult(jsonPath, "pending");
  try {
    const localContract = await readLocalContract(registryPath);
    const remoteIdentity = await readFixedRemoteModelIdentity();
    const resources: ModelSourceVerificationResource[] = [];
    for (const model of models) {
      const local = localContract.get(model.sha256);
      if (
        local === undefined ||
        local.bytes !== model.bytes ||
        model.source !== `immutable/model-${model.sha256}.gguf`
      ) {
        throw new Error(`Local/deployed model identity mismatch for ${model.id}`);
      }
      const localDigest = await sha256File(local.path).catch(() => {
        throw new Error(`Local model shard could not be read: ${local.source}`);
      });
      if (localDigest.bytes !== model.bytes || localDigest.sha256 !== model.sha256) {
        throw new Error(`Local model shard failed exact identity: ${local.source}`);
      }
      const remote = remoteIdentity.resources.get(model.sha256);
      if (remote === undefined || remote.bytes !== model.bytes || remote.sha256 !== model.sha256) {
        throw new Error(`Remote SSH model identity mismatch for ${model.id}`);
      }
      resources.push(
        await verifyModelSourceResource({
          bytes: model.bytes,
          id: model.id,
          localSource: local.source,
          remote,
          sha256: model.sha256,
          url: `${origin}/${model.source}`,
        }),
      );
    }
    const finalBuild = await readAndValidateBuildManifest(buildRoot);
    const finalSource = await readSourceIdentity(repositoryRoot);
    if (
      finalBuild.artifactDigest !== build.artifactDigest ||
      finalBuild.releaseDigest !== build.releaseDigest ||
      finalSource.commit !== source.commit ||
      finalSource.dirtyTreeDigest !== source.dirtyTreeDigest
    ) {
      throw new Error("Build or source identity changed during model-source verification");
    }
    const report = {
      ...base,
      completedAt: new Date().toISOString(),
      remote: remoteIdentity.root,
      resources,
      state: "passed",
    } as const;
    validateModelSourceVerificationResult(report);
    await publishModelSourceVerificationResult({
      jsonPath,
      jsonTemporaryPath: temporaryPath,
      markdown: formatModelSourceVerificationMarkdown(report),
      markdownPath,
      markdownTemporaryPath,
      report,
    });
    const [jsonDigest, markdownDigest] = await Promise.all([
      sha256File(jsonPath),
      sha256File(markdownPath),
    ]);
    process.stdout.write(
      `${jsonPath}\n${markdownPath}\n` +
        `JSON SHA-256 ${jsonDigest.sha256}\nMarkdown SHA-256 ${markdownDigest.sha256}\n`,
    );
  } catch (error: unknown) {
    const failure = sanitizeModelSourceFailure(error);
    const report = {
      ...base,
      completedAt: new Date().toISOString(),
      failure,
      state: "failed",
    } as const;
    validateModelSourceVerificationResult(report);
    await publishModelSourceVerificationResult({
      jsonPath,
      jsonTemporaryPath: temporaryPath,
      markdown: formatModelSourceVerificationMarkdown(report),
      markdownPath,
      markdownTemporaryPath,
      report,
    });
    throw new Error(failure);
  }
}

async function readLocalContract(
  registry: string,
): Promise<
  ReadonlyMap<string, { readonly bytes: number; readonly path: string; readonly source: string }>
> {
  const path = join(repositoryRoot, "deploy/model-content.json");
  const parsed = JSON.parse(await readFile(path, "utf8")) as {
    readonly resources?: unknown;
    readonly schemaVersion?: unknown;
    readonly source?: unknown;
  };
  if (
    parsed.schemaVersion !== 2 ||
    Object.keys(parsed).length !== 3 ||
    !isRecord(parsed.source) ||
    Object.keys(parsed.source).length !== 2 ||
    parsed.source.id !== "gemma-4-E2B-it-qat-GGUF-66a399f6" ||
    parsed.source.registryKey !== "production-model-content" ||
    !Array.isArray(parsed.resources) ||
    parsed.resources.length !== 5
  ) {
    throw new Error("Invalid D-130 local model-content contract");
  }
  const localDirectory = await resolveLocalModelDirectory(
    parsed.source.registryKey,
    parsed.source.id,
    registry,
  );
  const result = new Map<string, { bytes: number; path: string; source: string }>();
  for (const candidate of parsed.resources) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof (candidate as { sha256?: unknown }).sha256 !== "string" ||
      typeof (candidate as { bytes?: unknown }).bytes !== "number" ||
      typeof (candidate as { localName?: unknown }).localName !== "string" ||
      typeof (candidate as { remoteName?: unknown }).remoteName !== "string" ||
      Object.keys(candidate).length !== 4
    ) {
      throw new Error("Invalid local model-content resource");
    }
    const resource = candidate as {
      bytes: number;
      localName: string;
      remoteName: string;
      sha256: string;
    };
    if (
      !Number.isSafeInteger(resource.bytes) ||
      resource.bytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(resource.sha256) ||
      !/^gemma-4-E2B-it-qat-UD-Q4_K_XL-split-0000[1-5]-of-00005\.gguf$/.test(resource.localName) ||
      resource.remoteName !== `model-${resource.sha256}.gguf`
    ) {
      throw new Error("Invalid local model-content resource identity");
    }
    const localPath = resolve(localDirectory, resource.localName);
    const relativePath = relative(localDirectory, localPath);
    if (relativePath === "" || isAbsolute(relativePath) || relativePath.startsWith("..")) {
      throw new Error("Local model-content resource escapes its source root");
    }
    result.set(resource.sha256, {
      bytes: resource.bytes,
      path: localPath,
      source: `${parsed.source.registryKey}/${resource.localName}`,
    });
  }
  if (result.size !== 5) throw new Error("Duplicate local model-content hash");
  return result;
}

async function resolveLocalModelDirectory(
  sourceKey: string,
  sourceId: string,
  registry: string,
): Promise<string> {
  const resolver = join(repositoryRoot, "deploy/Resolve-ModelContentSource.ps1");
  const stdout = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      resolver,
      "-RegistryPath",
      registry,
      "-SourceKey",
      sourceKey,
      "-ExpectedVersion",
      sourceId,
      "-RepositoryRoot",
      repositoryRoot,
    ],
    { cwd: repositoryRoot, maxBuffer: 16_384, timeout: 10_000, windowsHide: true },
  )
    .then((result) => result.stdout)
    .catch(() => {
      throw new Error("Machine-local model-content source resolution failed");
    });
  const resolved = JSON.parse(stdout) as unknown;
  if (
    !isRecord(resolved) ||
    Object.keys(resolved).length !== 3 ||
    typeof resolved.Directory !== "string" ||
    resolved.SourceKey !== sourceKey ||
    resolved.SourceId !== sourceId
  ) {
    throw new Error("Model-content source resolver returned an invalid response");
  }
  return resolved.Directory;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
