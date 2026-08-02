import {
  assertCompatibleInstallerShellEntrypoint,
  INSTALLER_BUILD_MANIFEST_PATH,
  INSTALLER_TARGET_REQUEST_HEADER,
  INSTALLER_TARGET_REQUEST_VALUE,
  InstallerManifestDocumentError,
  type InstallerManifestIdentity,
  InstallerManifestIdentityError,
  parseInstallerBuildManifest,
  resolveInstallerBuildRootUrl,
  resolveInstallerManifestUrl,
  validateInstallerManifestBytes,
} from "./installer-build-manifest";
import type { InstallerFailureCode } from "./installer-protocol";
import { InstallerTransferError } from "./installer-transfer";

export interface InstallerTargetIdentity {
  readonly buildRootUrl: string;
  readonly identity: InstallerManifestIdentity;
}

export interface InstallerTargetPlatform {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export class InstallerShellCompatibilityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InstallerShellCompatibilityError";
  }
}

export class InstallerManifestContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InstallerManifestContractError";
  }
}

export class InstallerRepairTargetMismatchError extends Error {
  public constructor(
    public readonly expectedReleaseDigest: string,
    public readonly discoveredReleaseDigest: string,
  ) {
    super(
      `Repair expected release ${expectedReleaseDigest} but target discovery selected ${discoveredReleaseDigest}`,
    );
    this.name = "InstallerRepairTargetMismatchError";
  }
}

export function assertInstallerRepairExpectedRelease(
  expectedReleaseDigest: string,
  discoveredReleaseDigest: string,
): void {
  if (expectedReleaseDigest !== discoveredReleaseDigest) {
    throw new InstallerRepairTargetMismatchError(expectedReleaseDigest, discoveredReleaseDigest);
  }
}

export async function loadInstallerTargetIdentity(input: {
  readonly locationUrl: string;
  readonly platform?: InstallerTargetPlatform;
  readonly shellEntrypointPath: string;
  readonly signal?: AbortSignal;
}): Promise<InstallerTargetIdentity> {
  const platform = input.platform ?? browserTargetPlatform();
  const buildUrl = new URL(`/${INSTALLER_BUILD_MANIFEST_PATH}`, input.locationUrl).href;
  const buildResponse = await fetchExactTargetDocument(
    platform,
    buildUrl,
    "Build manifest",
    input.signal,
  );
  let buildInput: unknown;
  try {
    buildInput = await buildResponse.json();
  } catch (error: unknown) {
    throw bodyReadFailure("Build manifest", error, input.signal);
  }
  let build: ReturnType<typeof parseInstallerBuildManifest>;
  try {
    build = parseInstallerBuildManifest(buildInput);
  } catch (error: unknown) {
    throw new InstallerManifestContractError(message(error));
  }
  try {
    assertCompatibleInstallerShellEntrypoint(build, input.shellEntrypointPath);
  } catch (error: unknown) {
    throw new InstallerShellCompatibilityError(message(error));
  }
  const buildRootUrl = resolveInstallerBuildRootUrl(buildUrl);
  const installArtifact = build.artifacts.find(({ path }) => path === "install-manifest.json");
  if (installArtifact === undefined) {
    throw new InstallerManifestContractError("Build manifest omits install manifest");
  }
  const installUrl = resolveInstallerManifestUrl(buildUrl, build.installManifestEntrypoint.path);
  const manifestResponse = await fetchExactTargetDocument(
    platform,
    installUrl,
    "Install manifest",
    input.signal,
  );
  let manifestBytes: Uint8Array;
  try {
    manifestBytes = new Uint8Array(await manifestResponse.arrayBuffer());
  } catch (error: unknown) {
    throw bodyReadFailure("Install manifest", error, input.signal);
  }
  let identity: InstallerManifestIdentity;
  try {
    identity = validateInstallerManifestBytes(build, manifestBytes);
  } catch (error: unknown) {
    if (error instanceof InstallerManifestIdentityError) {
      throw new InstallerTransferError("integrity", error.message, null);
    }
    if (error instanceof InstallerManifestDocumentError) {
      throw new InstallerManifestContractError(error.message);
    }
    throw error;
  }
  return Object.freeze({ buildRootUrl, identity });
}

export function installerTargetFailureCode(error: unknown): InstallerFailureCode | null {
  if (error instanceof InstallerRepairTargetMismatchError) return "repair-target-mismatch";
  if (error instanceof InstallerManifestContractError) return "install-manifest-invalid";
  if (error instanceof InstallerShellCompatibilityError) return "shell-incompatible";
  if (error instanceof DOMException && error.name === "TimeoutError") return "transport";
  return null;
}

async function fetchExactTargetDocument(
  platform: InstallerTargetPlatform,
  url: string,
  label: string,
  signal?: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await platform.fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { [INSTALLER_TARGET_REQUEST_HEADER]: INSTALLER_TARGET_REQUEST_VALUE },
      redirect: "error",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (signal?.aborted === true) throw signal.reason;
    throw new InstallerTransferError("transport", `${label} fetch failed: ${message(error)}`, null);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new InstallerTransferError(
      "transport",
      `${label} fetch returned HTTP ${response.status}`,
      null,
    );
  }
  if (response.url !== url) {
    await response.body?.cancel().catch(() => undefined);
    throw new InstallerTransferError(
      "validator",
      `${label} fetch did not return the exact same-origin representation`,
      null,
    );
  }
  return response;
}

function bodyReadFailure(label: string, error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted === true) {
    return signal.reason instanceof Error
      ? signal.reason
      : new DOMException(`${label} request was aborted`, "AbortError");
  }
  if (error instanceof SyntaxError) {
    return new InstallerManifestContractError(`${label} body is not valid JSON`);
  }
  return new InstallerTransferError(
    "transport",
    `${label} body read failed: ${message(error)}`,
    null,
  );
}

function browserTargetPlatform(): InstallerTargetPlatform {
  return Object.freeze({
    fetch: (input: string, init: RequestInit) => globalThis.fetch(input, init),
  });
}

function message(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}
