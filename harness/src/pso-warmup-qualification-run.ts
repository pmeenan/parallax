import { createHash, randomUUID } from "node:crypto";
import { type FileHandle, lstat, mkdir, open, readFile } from "node:fs/promises";
import { basename, dirname, extname, join, parse, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PSO_WARMUP_QUALIFICATION_CONTRACT,
  PSO_WARMUP_QUALIFICATION_SCHEMA_VERSION,
  type PsoWarmupQualificationResult,
  qualifyPsoWarmupLaunchPairs,
} from "./pso-warmup-qualification.js";
import {
  assertPsoWarmupQualificationPreflightUnchanged,
  type PsoWarmupQualificationPreflight,
  readPsoWarmupQualificationPreflight,
} from "./pso-warmup-qualification-preflight.js";

const MAX_RESULT_COLLISIONS = 100;
const MAX_FAILURE_MESSAGE_LENGTH = 500;

type QualificationPhase =
  | "companion-format"
  | "companion-write"
  | "input-read"
  | "post-validation"
  | "preflight"
  | "qualification"
  | "result-close";

export interface PsoWarmupQualificationEvidenceHandle {
  close(): Promise<void>;
  readText(): Promise<string>;
  stat(): Promise<PsoWarmupQualificationFileIdentity>;
  writeText(value: string): Promise<void>;
}

export interface PsoWarmupQualificationFileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly nlink: bigint;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface PsoWarmupQualificationRunIo {
  readonly createExclusive: (path: string) => Promise<PsoWarmupQualificationEvidenceHandle>;
  readonly mkdir: (path: string) => Promise<void>;
  readonly openExisting: (path: string) => Promise<PsoWarmupQualificationEvidenceHandle>;
  readonly pathStat: (path: string) => Promise<PsoWarmupQualificationFileIdentity>;
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly readOwnedFile: (path: string) => Promise<Uint8Array>;
}

export interface PsoWarmupQualificationRunDependencies {
  readonly assertPreflightUnchanged: (preflight: PsoWarmupQualificationPreflight) => Promise<void>;
  readonly formatCompanion: (report: PsoWarmupQualificationEvidence) => string;
  readonly io: PsoWarmupQualificationRunIo;
  readonly now: () => Date;
  readonly qualify: typeof qualifyPsoWarmupLaunchPairs;
  readonly readPreflight: typeof readPsoWarmupQualificationPreflight;
}

interface IndependentAuthority {
  readonly artifactDigest: string;
  readonly browser: Readonly<{
    readonly executableSha256: string;
    readonly pin: PsoWarmupQualificationPreflight["authority"]["chromePin"];
    readonly product: string;
    readonly revision: string;
  }>;
  readonly build: Readonly<{
    readonly compatibilityDigest: string;
    readonly manifestSchemaVersion: number;
  }>;
  readonly machine: PsoWarmupQualificationPreflight["authority"]["machineDescriptor"];
  readonly releaseDigest: string;
  readonly source: PsoWarmupQualificationPreflight["authority"]["repositorySource"];
  readonly traceSha256: string;
  readonly target: PsoWarmupQualificationResult["target"] | null;
}

export interface PsoWarmupQualificationEvidenceExpectedAuthority {
  readonly authority: IndependentAuthority;
  readonly qualification?: PsoWarmupQualificationResult;
}

interface EvidenceBase {
  readonly authority: IndependentAuthority | null;
  readonly companion: Readonly<{
    readonly path: string;
    readonly state: "failed" | "passed" | "pending";
  }>;
  readonly contract: typeof PSO_WARMUP_QUALIFICATION_CONTRACT;
  readonly postValidation: Readonly<{
    readonly passed: boolean | null;
    readonly performed: boolean;
  }>;
  readonly ownership: Readonly<{
    readonly publicationState: "failed" | "passed" | "pending";
    readonly reservationId: string;
  }>;
  readonly schemaVersion: typeof PSO_WARMUP_QUALIFICATION_SCHEMA_VERSION;
  readonly smokeReport: Readonly<{
    readonly path: string;
    readonly sha256: string | null;
  }>;
  readonly startedAt: string;
}

export type PsoWarmupQualificationEvidence =
  | (EvidenceBase & Readonly<{ readonly state: "pending" }>)
  | (EvidenceBase &
      Readonly<{
        readonly completedAt: string;
        readonly failure: Readonly<{
          readonly message: string;
          readonly name: string;
          readonly phase: QualificationPhase;
        }>;
        readonly state: "failed";
      }>)
  | (EvidenceBase &
      Readonly<{
        readonly completedAt: string;
        readonly qualification: PsoWarmupQualificationResult;
        readonly state: "passed";
      }>);

export interface PsoWarmupQualificationRunOutcome {
  readonly jsonPath: string;
  readonly markdownPath: string;
  readonly state: "failed" | "passed";
}

interface ReservedEvidence {
  readonly json: OwnedEvidenceFile;
  readonly jsonPath: string;
  readonly markdown: OwnedEvidenceFile;
  readonly markdownPath: string;
}

interface OwnedEvidenceFile {
  closeState: "closed" | "open";
  handle: PsoWarmupQualificationEvidenceHandle;
  identity: Readonly<{ readonly dev: bigint; readonly ino: bigint }>;
  lastWrittenBytes: Uint8Array | null;
  lastWrittenSha256: string | null;
  readonly logicalPath: "result-json" | "result-markdown";
  readonly path: string;
  readonly reservationId: string;
  tokenWritten: boolean;
}

const defaultDependencies: PsoWarmupQualificationRunDependencies = {
  assertPreflightUnchanged: assertPsoWarmupQualificationPreflightUnchanged,
  formatCompanion: formatPsoWarmupQualificationCompanion,
  io: {
    createExclusive: async (path) => nodeEvidenceHandle(await open(path, "wx+")),
    mkdir: async (path) => {
      await mkdir(path, { recursive: true });
    },
    openExisting: async (path) => nodeEvidenceHandle(await open(path, "r+")),
    pathStat: (path) => lstat(path, { bigint: true }),
    readFile,
    readOwnedFile: readFile,
  },
  now: () => new Date(),
  qualify: qualifyPsoWarmupLaunchPairs,
  readPreflight: readPsoWarmupQualificationPreflight,
};

export function createPsoWarmupQualificationRunDependencies(): PsoWarmupQualificationRunDependencies {
  return defaultDependencies;
}

export async function runPsoWarmupQualification(
  input: {
    readonly buildRoot: string;
    readonly inputPath: string;
    readonly outputPath: string;
    readonly repositoryRoot: string;
  },
  dependencies: PsoWarmupQualificationRunDependencies = defaultDependencies,
): Promise<PsoWarmupQualificationRunOutcome> {
  const inputPath = resolve(input.inputPath);
  const requestedOutputPath = resolve(input.outputPath);
  if (extname(requestedOutputPath) !== ".json") {
    throw new Error("PSO warmup qualification output must have the exact .json extension");
  }
  if (inputPath === requestedOutputPath) {
    throw new Error("PSO warmup qualification input and output paths must be distinct");
  }
  await dependencies.io.mkdir(dirname(requestedOutputPath));
  const startedAt = dependencies.now().toISOString();
  const logicalInputPath = repositoryLogicalPath(input.repositoryRoot, inputPath);
  const reservationId = randomUUID();
  const initialEvidence: PsoWarmupQualificationEvidence = pendingEvidence({
    authority: null,
    companionPath: `${parse(requestedOutputPath).name}.md`,
    smokeReportPath: logicalInputPath,
    startedAt,
    reservationId,
  });
  const reservation = await reserveEvidence(
    requestedOutputPath,
    initialEvidence,
    dependencies.io.createExclusive,
    dependencies.io.pathStat,
  );

  let phase: QualificationPhase = "input-read";
  let authority: IndependentAuthority | null = null;
  let qualification: PsoWarmupQualificationResult | null = null;
  let sourceSha256: string | null = null;
  let postValidationPerformed = false;
  try {
    const independentlyReadInput = await dependencies.io.readFile(inputPath);
    sourceSha256 = sha256(independentlyReadInput);
    const inputPending = pendingEvidence({
      authority,
      companionPath: basename(reservation.markdownPath),
      smokeReportPath: logicalInputPath,
      sourceSha256,
      startedAt,
      reservationId,
    });
    await persistAndValidateJson(reservation.json, inputPending, dependencies.io.pathStat);

    phase = "preflight";
    const preflight = await dependencies.readPreflight({
      buildRoot: resolve(input.buildRoot),
      repositoryRoot: resolve(input.repositoryRoot),
      smokeReportPath: inputPath,
    });
    if (sha256(preflight.inputBytes) !== sourceSha256) {
      throw new Error("PSO warmup qualification input changed during preflight");
    }
    authority = independentAuthority(preflight);
    const authorityPending = pendingEvidence({
      authority,
      companionPath: basename(reservation.markdownPath),
      smokeReportPath: logicalInputPath,
      sourceSha256,
      startedAt,
      reservationId,
    });
    await persistAndValidateJson(reservation.json, authorityPending, dependencies.io.pathStat, {
      authority,
    });

    phase = "qualification";
    qualification = dependencies.qualify(preflight.inputBytes, preflight.authority);
    authority = independentAuthority(preflight, qualification);
    phase = "post-validation";
    postValidationPerformed = true;
    await dependencies.assertPreflightUnchanged(preflight);

    const passed = passedEvidence({
      authority,
      companionPath: basename(reservation.markdownPath),
      completedAt: dependencies.now().toISOString(),
      postValidationPassed: true,
      qualification,
      smokeReportPath: logicalInputPath,
      sourceSha256,
      startedAt,
      reservationId,
    });
    phase = "companion-format";
    const companion = dependencies.formatCompanion(passed);
    phase = "companion-write";
    await writeOwnedFile(
      reservation.markdown,
      formatOwnedMarkdown(companion, reservationId, "passed"),
      dependencies.io.pathStat,
    );

    phase = "post-validation";
    await dependencies.assertPreflightUnchanged(preflight);
    await persistAndValidateJson(reservation.json, passed, dependencies.io.pathStat, {
      authority,
      qualification,
    });
    phase = "result-close";
    // The companion must be conclusively settled before the primary can close as passed.
    // A companion close failure therefore always leaves the JSON handle recoverable.
    await closeOwnedFile(reservation.markdown, dependencies.io);
    await closeOwnedFile(reservation.json, dependencies.io);
    return Object.freeze({
      jsonPath: reservation.jsonPath,
      markdownPath: reservation.markdownPath,
      state: "passed",
    });
  } catch (error: unknown) {
    const failed = failedEvidence({
      authority,
      companionPath: basename(reservation.markdownPath),
      completedAt: dependencies.now().toISOString(),
      error,
      phase,
      postValidationPerformed,
      smokeReportPath: logicalInputPath,
      sourceSha256,
      startedAt,
      reservationId,
    });
    const recoveryFailures: unknown[] = [];
    if (reservation.json.closeState === "closed") {
      await reopenOwnedJsonForFailureRecovery(reservation.json, dependencies.io).catch(
        (failure: unknown) => {
          recoveryFailures.push(failure);
        },
      );
    }
    if (reservation.json.closeState === "open") {
      await persistAndValidateJson(
        reservation.json,
        failed,
        dependencies.io.pathStat,
        authority === null
          ? undefined
          : {
              authority,
              ...(qualification === null ? {} : { qualification }),
            },
      ).catch((failure: unknown) => {
        recoveryFailures.push(failure);
      });
    }
    if (
      phase !== "companion-format" &&
      phase !== "companion-write" &&
      reservation.markdown.closeState === "open"
    ) {
      await Promise.resolve()
        .then(() => dependencies.formatCompanion(failed))
        .then((markdown) =>
          writeOwnedFile(
            reservation.markdown,
            formatOwnedMarkdown(markdown, reservationId, "failed"),
            dependencies.io.pathStat,
          ),
        )
        .catch((failure: unknown) => {
          recoveryFailures.push(failure);
        });
    }
    // Close ordering is deliberate: all companion terminal conditions are known before
    // the truthful failed primary is closed. Both close failures are still collected.
    await closeOwnedFile(reservation.markdown, dependencies.io).catch((failure: unknown) => {
      recoveryFailures.push(failure);
    });
    await closeOwnedFile(reservation.json, dependencies.io).catch((failure: unknown) => {
      recoveryFailures.push(failure);
    });
    if (recoveryFailures.length !== 0) {
      await closeOpenOwnedHandles([reservation.markdown, reservation.json]).catch(
        (failure: unknown) => {
          recoveryFailures.push(failure);
        },
      );
      throw new AggregateError(
        [error, ...recoveryFailures],
        "PSO warmup qualification result close and failure evidence finalization failed",
      );
    }
    return Object.freeze({
      jsonPath: reservation.jsonPath,
      markdownPath: reservation.markdownPath,
      state: "failed",
    });
  }
}

export function formatPsoWarmupQualificationCompanion(
  report: PsoWarmupQualificationEvidence,
): string {
  return [
    "# PSO warmup launch-pair qualification",
    "",
    `- State: \`${report.state}\``,
    `- Contract: \`${report.contract}\``,
    `- Started: \`${report.startedAt}\``,
    `- Completed: \`${"completedAt" in report ? report.completedAt : "pending"}\``,
    `- Smoke report: \`${report.smokeReport.path}\``,
    `- Smoke SHA-256: \`${report.smokeReport.sha256 ?? "pending"}\``,
    `- Artifact: \`${report.authority?.artifactDigest ?? "pending"}\``,
    `- Release: \`${report.authority?.releaseDigest ?? "pending"}\``,
    `- Trace: \`${report.authority?.traceSha256 ?? "pending"}\``,
    ...("failure" in report
      ? [
          `- Failure phase: \`${report.failure.phase}\``,
          `- Failure: ${report.failure.name}: ${report.failure.message}`,
        ]
      : []),
    "",
  ].join("\n");
}

export function validatePsoWarmupQualificationEvidence(
  value: unknown,
  expected?: PsoWarmupQualificationEvidenceExpectedAuthority,
): asserts value is PsoWarmupQualificationEvidence {
  const report = evidenceRecord(value, "qualification evidence");
  const commonKeys = [
    "authority",
    "companion",
    "contract",
    "ownership",
    "postValidation",
    "schemaVersion",
    "smokeReport",
    "startedAt",
    "state",
  ];
  if (
    report.contract !== PSO_WARMUP_QUALIFICATION_CONTRACT ||
    report.schemaVersion !== PSO_WARMUP_QUALIFICATION_SCHEMA_VERSION ||
    (report.state !== "pending" && report.state !== "failed" && report.state !== "passed") ||
    typeof report.startedAt !== "string" ||
    !Number.isFinite(Date.parse(report.startedAt))
  ) {
    throw new Error("PSO warmup qualification evidence identity or state is invalid");
  }
  requireExactEvidenceKeys(
    report,
    report.state === "pending"
      ? commonKeys
      : report.state === "failed"
        ? [...commonKeys, "completedAt", "failure"]
        : [...commonKeys, "completedAt", "qualification"],
    "qualification evidence",
  );
  const smokeReport = evidenceRecord(report.smokeReport, "smokeReport");
  requireExactEvidenceKeys(smokeReport, ["path", "sha256"], "smokeReport");
  if (
    typeof smokeReport.path !== "string" ||
    smokeReport.path === "" ||
    (smokeReport.sha256 !== null && !/^[a-f0-9]{64}$/u.test(String(smokeReport.sha256)))
  ) {
    throw new Error("PSO warmup qualification smoke-report evidence is invalid");
  }
  const companion = evidenceRecord(report.companion, "companion");
  requireExactEvidenceKeys(companion, ["path", "state"], "companion");
  if (
    typeof companion.path !== "string" ||
    basename(companion.path) !== companion.path ||
    extname(companion.path) !== ".md" ||
    companion.state !== report.state
  ) {
    throw new Error("PSO warmup qualification companion evidence is invalid");
  }
  const postValidation = evidenceRecord(report.postValidation, "postValidation");
  requireExactEvidenceKeys(postValidation, ["passed", "performed"], "postValidation");
  if (
    (report.state === "pending" &&
      (postValidation.performed !== false || postValidation.passed !== null)) ||
    (report.state === "failed" &&
      (typeof postValidation.performed !== "boolean" || postValidation.passed !== false)) ||
    (report.state === "passed" &&
      (postValidation.performed !== true || postValidation.passed !== true))
  ) {
    throw new Error("PSO warmup qualification post-validation evidence is contradictory");
  }
  const ownership = evidenceRecord(report.ownership, "ownership");
  requireExactEvidenceKeys(ownership, ["publicationState", "reservationId"], "ownership");
  if (
    ownership.publicationState !== report.state ||
    typeof ownership.reservationId !== "string" ||
    !/^[a-f0-9-]{36}$/u.test(ownership.reservationId)
  ) {
    throw new Error("PSO warmup qualification ownership evidence is contradictory");
  }
  const authority = validateIndependentAuthority(report.authority);
  if (expected !== undefined && JSON.stringify(authority) !== JSON.stringify(expected.authority)) {
    throw new Error("PSO warmup qualification evidence authority differs from preflight");
  }
  if (report.state === "pending") return;
  if (typeof report.completedAt !== "string" || !Number.isFinite(Date.parse(report.completedAt))) {
    throw new Error("PSO warmup qualification terminal evidence is incomplete");
  }
  if (report.state === "failed") {
    const failure = evidenceRecord(report.failure, "failure");
    requireExactEvidenceKeys(failure, ["message", "name", "phase"], "failure");
    if (
      !isQualificationPhase(failure.phase) ||
      typeof failure.message !== "string" ||
      typeof failure.name !== "string"
    ) {
      throw new Error("PSO warmup qualification failure evidence is invalid");
    }
    const sanitized = sanitizeCause(failure);
    if (sanitized.message !== failure.message || sanitized.name !== failure.name) {
      throw new Error("PSO warmup qualification failure evidence is not sanitized");
    }
    return;
  }
  if (smokeReport.sha256 === null) {
    throw new Error("PSO warmup qualification passed evidence omits the input digest");
  }
  if (authority === null || authority.target === null) {
    throw new Error("PSO warmup qualification passed evidence omits independent authority");
  }
  const qualification = evidenceRecord(report.qualification, "qualification");
  requireExactEvidenceKeys(
    qualification,
    [
      "artifactDigest",
      "browser",
      "buildCompatibilityDigest",
      "contract",
      "pairs",
      "passed",
      "releaseDigest",
      "schemaVersion",
      "smokeReport",
      "source",
      "target",
      "trace",
      "traceSha256",
    ],
    "qualification",
  );
  if (
    qualification.passed !== true ||
    qualification.artifactDigest !== authority.artifactDigest ||
    qualification.releaseDigest !== authority.releaseDigest ||
    qualification.buildCompatibilityDigest !== authority.build.compatibilityDigest ||
    qualification.traceSha256 !== authority.traceSha256 ||
    JSON.stringify(qualification.browser) !== JSON.stringify(authority.browser) ||
    JSON.stringify(qualification.source) !== JSON.stringify(authority.source) ||
    JSON.stringify(qualification.target) !== JSON.stringify(authority.target) ||
    JSON.stringify(qualification.trace) !==
      JSON.stringify({
        buildCompatibilityDigest: authority.build.compatibilityDigest,
        sha256: authority.traceSha256,
        state: "ready",
      }) ||
    evidenceRecord(qualification.smokeReport, "qualification.smokeReport").sha256 !==
      smokeReport.sha256 ||
    evidenceRecord(qualification.smokeReport, "qualification.smokeReport").path !== smokeReport.path
  ) {
    throw new Error("PSO warmup qualification passed evidence contradicts its authority");
  }
  if (
    expected?.qualification !== undefined &&
    JSON.stringify(qualification) !== JSON.stringify(expected.qualification)
  ) {
    throw new Error("PSO warmup qualification result differs from validated qualification");
  }
}

function validateIndependentAuthority(value: unknown): IndependentAuthority | null {
  if (value === null) return null;
  const authority = evidenceRecord(value, "authority");
  requireExactEvidenceKeys(
    authority,
    [
      "artifactDigest",
      "browser",
      "build",
      "machine",
      "releaseDigest",
      "source",
      "target",
      "traceSha256",
    ],
    "authority",
  );
  if (
    !/^[a-f0-9]{64}$/u.test(String(authority.artifactDigest)) ||
    !/^[a-f0-9]{64}$/u.test(String(authority.releaseDigest)) ||
    !/^[a-f0-9]{64}$/u.test(String(authority.traceSha256))
  ) {
    throw new Error("PSO warmup qualification independent authority is invalid");
  }
  const browser = evidenceRecord(authority.browser, "authority.browser");
  requireExactEvidenceKeys(
    browser,
    ["executableSha256", "pin", "product", "revision"],
    "authority.browser",
  );
  const pin = evidenceRecord(browser.pin, "authority.browser.pin");
  requireExactEvidenceKeys(
    pin,
    ["browserRevision", "channel", "downloads", "executableSha256", "revision", "version"],
    "authority.browser.pin",
  );
  if (
    browser.product !== `Chrome/${String(pin.version)}` ||
    browser.revision !== pin.browserRevision ||
    !Object.values(
      evidenceRecord(pin.executableSha256, "authority.browser.pin executable"),
    ).includes(browser.executableSha256)
  ) {
    throw new Error("PSO warmup qualification browser authority is contradictory");
  }
  const build = evidenceRecord(authority.build, "authority.build");
  requireExactEvidenceKeys(
    build,
    ["compatibilityDigest", "manifestSchemaVersion"],
    "authority.build",
  );
  if (
    !/^[a-f0-9]{64}$/u.test(String(build.compatibilityDigest)) ||
    !Number.isSafeInteger(build.manifestSchemaVersion)
  ) {
    throw new Error("PSO warmup qualification build authority is invalid");
  }
  evidenceRecord(authority.machine, "authority.machine");
  const source = evidenceRecord(authority.source, "authority.source");
  requireExactEvidenceKeys(source, ["commit", "dirtyTreeDigest"], "authority.source");
  if (
    !/^[a-f0-9]{40}$/u.test(String(source.commit)) ||
    (source.dirtyTreeDigest !== null && !/^[a-f0-9]{64}$/u.test(String(source.dirtyTreeDigest)))
  ) {
    throw new Error("PSO warmup qualification source authority is invalid");
  }
  if (authority.target !== null) evidenceRecord(authority.target, "authority.target");
  return authority as unknown as IndependentAuthority;
}

function requireExactEvidenceKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`PSO warmup qualification ${label} fields are invalid`);
  }
}

async function reserveEvidence(
  requestedJsonPath: string,
  pending: PsoWarmupQualificationEvidence,
  createExclusive: PsoWarmupQualificationRunIo["createExclusive"],
  pathStat: PsoWarmupQualificationRunIo["pathStat"],
): Promise<ReservedEvidence> {
  const requested = parse(requestedJsonPath);
  for (let ordinal = 0; ordinal < MAX_RESULT_COLLISIONS; ordinal += 1) {
    const stem = ordinal === 0 ? requested.name : `${requested.name}-${ordinal}`;
    const jsonPath = join(requested.dir, `${stem}.json`);
    const markdownPath = join(requested.dir, `${stem}.md`);
    const candidatePending = Object.freeze({
      ...pending,
      companion: Object.freeze({ path: basename(markdownPath), state: "pending" as const }),
    }) as PsoWarmupQualificationEvidence;
    const reservationId = pending.ownership.reservationId;
    let json: OwnedEvidenceFile | null = null;
    let markdown: OwnedEvidenceFile | null = null;
    try {
      json = await createOwnedFile(
        jsonPath,
        "result-json",
        reservationId,
        createExclusive,
        pathStat,
      );
    } catch (error: unknown) {
      if (isCollision(error)) continue;
      throw error;
    }
    try {
      await persistAndValidateJson(json, candidatePending, pathStat);
      markdown = await createOwnedFile(
        markdownPath,
        "result-markdown",
        reservationId,
        createExclusive,
        pathStat,
      );
      assertDistinctOwnedFiles(json, markdown);
      await writeOwnedFile(
        markdown,
        formatOwnedMarkdown(
          "# PSO warmup launch-pair qualification\n\n- State: `pending`\n",
          reservationId,
          "pending",
        ),
        pathStat,
      );
      return Object.freeze({
        json,
        jsonPath,
        markdown,
        markdownPath,
      });
    } catch (error: unknown) {
      const failed = failedEvidence({
        authority: null,
        companionPath: basename(markdownPath),
        completedAt: new Date().toISOString(),
        error,
        phase: "companion-write",
        postValidationPerformed: false,
        smokeReportPath: pending.smokeReport.path,
        sourceSha256: null,
        startedAt: pending.startedAt,
        reservationId,
      });
      const failures: unknown[] = [error];
      await persistAndValidateJson(json, failed, pathStat).catch((failure: unknown) => {
        failures.push(failure);
      });
      await closeOwnedFiles([markdown, json], {
        pathStat,
        readOwnedFile: readFile,
      }).catch((failure: unknown) => {
        failures.push(failure);
      });
      await closeOpenOwnedHandles(
        [markdown, json].filter((file): file is OwnedEvidenceFile => file !== null),
      ).catch((failure: unknown) => {
        failures.push(failure);
      });
      if (isCollision(error) && failures.length === 1) continue;
      throw new AggregateError(failures, "PSO warmup qualification result reservation failed");
    }
  }
  throw new Error(
    `PSO warmup qualification exhausted ${MAX_RESULT_COLLISIONS} collision-safe output suffixes`,
  );
}

function pendingEvidence(input: {
  readonly authority: IndependentAuthority | null;
  readonly companionPath: string;
  readonly smokeReportPath: string;
  readonly sourceSha256?: string | null;
  readonly startedAt: string;
  readonly reservationId: string;
}): PsoWarmupQualificationEvidence {
  return Object.freeze({
    authority: input.authority,
    companion: Object.freeze({ path: input.companionPath, state: "pending" as const }),
    contract: PSO_WARMUP_QUALIFICATION_CONTRACT,
    postValidation: Object.freeze({ passed: null, performed: false }),
    ownership: Object.freeze({
      publicationState: "pending" as const,
      reservationId: input.reservationId,
    }),
    schemaVersion: PSO_WARMUP_QUALIFICATION_SCHEMA_VERSION,
    smokeReport: Object.freeze({
      path: input.smokeReportPath,
      sha256: input.sourceSha256 ?? null,
    }),
    startedAt: input.startedAt,
    state: "pending" as const,
  });
}

function failedEvidence(input: {
  readonly authority: IndependentAuthority | null;
  readonly companionPath: string;
  readonly completedAt: string;
  readonly error: unknown;
  readonly phase: QualificationPhase;
  readonly postValidationPerformed: boolean;
  readonly smokeReportPath: string;
  readonly sourceSha256: string | null;
  readonly startedAt: string;
  readonly reservationId: string;
}): PsoWarmupQualificationEvidence {
  return Object.freeze({
    authority: input.authority,
    companion: Object.freeze({ path: input.companionPath, state: "failed" as const }),
    completedAt: input.completedAt,
    contract: PSO_WARMUP_QUALIFICATION_CONTRACT,
    failure: Object.freeze({ ...sanitizeCause(input.error), phase: input.phase }),
    postValidation: Object.freeze({
      passed: false,
      performed: input.postValidationPerformed,
    }),
    ownership: Object.freeze({
      publicationState: "failed" as const,
      reservationId: input.reservationId,
    }),
    schemaVersion: PSO_WARMUP_QUALIFICATION_SCHEMA_VERSION,
    smokeReport: Object.freeze({ path: input.smokeReportPath, sha256: input.sourceSha256 }),
    startedAt: input.startedAt,
    state: "failed" as const,
  });
}

function passedEvidence(input: {
  readonly authority: IndependentAuthority;
  readonly companionPath: string;
  readonly completedAt: string;
  readonly postValidationPassed: boolean;
  readonly qualification: PsoWarmupQualificationResult;
  readonly smokeReportPath: string;
  readonly sourceSha256: string;
  readonly startedAt: string;
  readonly reservationId: string;
}): PsoWarmupQualificationEvidence {
  return Object.freeze({
    authority: input.authority,
    companion: Object.freeze({ path: input.companionPath, state: "passed" as const }),
    completedAt: input.completedAt,
    contract: PSO_WARMUP_QUALIFICATION_CONTRACT,
    postValidation: Object.freeze({
      passed: input.postValidationPassed,
      performed: input.postValidationPassed,
    }),
    ownership: Object.freeze({
      publicationState: "passed" as const,
      reservationId: input.reservationId,
    }),
    qualification: input.qualification,
    schemaVersion: PSO_WARMUP_QUALIFICATION_SCHEMA_VERSION,
    smokeReport: Object.freeze({ path: input.smokeReportPath, sha256: input.sourceSha256 }),
    startedAt: input.startedAt,
    state: "passed" as const,
  });
}

function independentAuthority(
  preflight: PsoWarmupQualificationPreflight,
  qualification?: PsoWarmupQualificationResult,
): IndependentAuthority {
  const trace = preflight.authority.build.psoWarmupTrace;
  const pin = preflight.authority.chromePin;
  if (pin.browserRevision === "") {
    throw new Error("Checked-in Chrome pin omits exact browser revision authority");
  }
  return Object.freeze({
    artifactDigest: preflight.authority.build.artifactDigest,
    browser: Object.freeze({
      executableSha256: preflight.authority.chromeExecutableSha256,
      pin,
      product: `Chrome/${pin.version}`,
      revision: pin.browserRevision,
    }),
    build: Object.freeze({
      compatibilityDigest: trace.buildCompatibilityDigest,
      manifestSchemaVersion: preflight.authority.build.manifest.schemaVersion,
    }),
    machine: preflight.authority.machineDescriptor,
    releaseDigest: preflight.authority.build.releaseDigest,
    source: preflight.authority.repositorySource,
    traceSha256: trace.sha256,
    target: qualification?.target ?? null,
  });
}

async function persistAndValidateJson(
  file: OwnedEvidenceFile,
  evidence: PsoWarmupQualificationEvidence,
  pathStat: PsoWarmupQualificationRunIo["pathStat"],
  expected?: PsoWarmupQualificationEvidenceExpectedAuthority,
): Promise<void> {
  validatePsoWarmupQualificationEvidence(evidence, expected);
  const text = formatJson(evidence);
  await writeOwnedFile(file, text, pathStat);
  const persisted = await file.handle.readText();
  const parsed = JSON.parse(persisted) as unknown;
  validatePsoWarmupQualificationEvidence(parsed, expected);
}

async function createOwnedFile(
  path: string,
  logicalPath: OwnedEvidenceFile["logicalPath"],
  reservationId: string,
  createExclusive: PsoWarmupQualificationRunIo["createExclusive"],
  pathStat: PsoWarmupQualificationRunIo["pathStat"],
): Promise<OwnedEvidenceFile> {
  const handle = await createExclusive(path);
  const file: OwnedEvidenceFile = {
    closeState: "open",
    handle,
    identity: Object.freeze({ dev: 0n, ino: 0n }),
    lastWrittenBytes: null,
    lastWrittenSha256: null,
    logicalPath,
    path,
    reservationId,
    tokenWritten: false,
  };
  try {
    const handleIdentity = await handle.stat();
    const pathIdentity = await pathStat(path);
    requireDirectIdentity(handleIdentity, logicalPath);
    requireDirectIdentity(pathIdentity, logicalPath);
    if (handleIdentity.dev !== pathIdentity.dev || handleIdentity.ino !== pathIdentity.ino) {
      throw new Error(`PSO warmup qualification ${logicalPath} pathname identity changed`);
    }
    file.identity = Object.freeze({ dev: handleIdentity.dev, ino: handleIdentity.ino });
    return file;
  } catch (error: unknown) {
    await handle.close().catch((closeError: unknown) => {
      throw new AggregateError(
        [error, closeError],
        `PSO warmup qualification ${logicalPath} initial identity and close failed`,
      );
    });
    throw error;
  }
}

async function reopenOwnedJsonForFailureRecovery(
  file: OwnedEvidenceFile,
  io: Pick<PsoWarmupQualificationRunIo, "openExisting" | "pathStat" | "readOwnedFile">,
): Promise<void> {
  if (file.logicalPath !== "result-json" || file.closeState !== "closed") {
    throw new Error("PSO warmup qualification recovery reopen requires closed primary JSON");
  }
  const reopened = await io.openExisting(file.path);
  try {
    const handleIdentity = await reopened.stat();
    const pathIdentityBefore = await io.pathStat(file.path);
    requireOwnedIdentity(file, handleIdentity);
    requireOwnedIdentity(file, pathIdentityBefore);

    const handleBytes = Buffer.from(await reopened.readText(), "utf8");
    assertExactLastWrittenBytes(file, handleBytes, "handle");
    requireOwnershipToken(file, handleBytes, "reopened handle");

    const pathBytes = await io.readOwnedFile(file.path);
    const pathIdentityAfter = await io.pathStat(file.path);
    requireOwnedIdentity(file, pathIdentityAfter);
    assertExactLastWrittenBytes(file, pathBytes, "pathname");
    requireOwnershipToken(file, pathBytes, "reopened pathname");

    // Do not expose the recovery descriptor to a writer until every independent
    // handle/path identity and exact-byte check has passed.
    file.handle = reopened;
    file.closeState = "open";
  } catch (error: unknown) {
    await reopened.close().catch((closeError: unknown) => {
      throw new AggregateError(
        [error, closeError],
        "PSO warmup qualification primary recovery reopen validation and close failed",
      );
    });
    throw error;
  }
}

async function writeOwnedFile(
  file: OwnedEvidenceFile,
  value: string,
  pathStat: PsoWarmupQualificationRunIo["pathStat"],
): Promise<void> {
  await assertOwnedFile(file, pathStat);
  if (file.lastWrittenBytes !== null) {
    await assertHandleBytesExact(file);
  }
  if (!value.includes(file.reservationId)) {
    throw new Error(`PSO warmup qualification ${file.logicalPath} write omits ownership token`);
  }
  await file.handle.writeText(value);
  file.tokenWritten = true;
  await assertOwnedFile(file, pathStat);
  const persisted = await file.handle.readText();
  if (persisted !== value) {
    throw new Error(`PSO warmup qualification ${file.logicalPath} post-write validation failed`);
  }
  const bytes = Buffer.from(value, "utf8");
  file.lastWrittenBytes = bytes;
  file.lastWrittenSha256 = sha256(bytes);
}

async function assertOwnedFile(
  file: OwnedEvidenceFile,
  pathStat: PsoWarmupQualificationRunIo["pathStat"],
): Promise<void> {
  if (file.closeState === "closed") {
    throw new Error(`PSO warmup qualification ${file.logicalPath} is closed`);
  }
  const [handleIdentity, pathIdentity] = await Promise.all([
    file.handle.stat(),
    pathStat(file.path),
  ]);
  requireDirectIdentity(handleIdentity, file.logicalPath);
  requireDirectIdentity(pathIdentity, file.logicalPath);
  if (
    handleIdentity.dev !== file.identity.dev ||
    handleIdentity.ino !== file.identity.ino ||
    pathIdentity.dev !== file.identity.dev ||
    pathIdentity.ino !== file.identity.ino
  ) {
    throw new Error(`PSO warmup qualification ${file.logicalPath} pathname identity changed`);
  }
}

function requireDirectIdentity(
  identity: PsoWarmupQualificationFileIdentity,
  logicalPath: OwnedEvidenceFile["logicalPath"],
): void {
  if (!identity.isFile() || identity.isSymbolicLink()) {
    throw new Error(`PSO warmup qualification ${logicalPath} is not a direct regular file`);
  }
  if (identity.nlink !== 1n) {
    throw new Error(`PSO warmup qualification ${logicalPath} link count is not one`);
  }
}

function assertDistinctOwnedFiles(left: OwnedEvidenceFile, right: OwnedEvidenceFile): void {
  if (left.identity.dev === right.identity.dev && left.identity.ino === right.identity.ino) {
    throw new Error("PSO warmup qualification JSON and Markdown reservations alias");
  }
}

async function closeOwnedFiles(
  files: readonly (OwnedEvidenceFile | null)[],
  io: Pick<PsoWarmupQualificationRunIo, "pathStat" | "readOwnedFile">,
): Promise<void> {
  const failures: unknown[] = [];
  for (const file of files) {
    if (file === null || file.closeState === "closed") continue;
    await closeOwnedFile(file, io).catch((error: unknown) => failures.push(error));
  }
  if (failures.length !== 0) {
    throw new AggregateError(failures, "PSO warmup qualification result close failed");
  }
}

async function closeOpenOwnedHandles(files: readonly OwnedEvidenceFile[]): Promise<void> {
  const failures: unknown[] = [];
  for (const file of files) {
    if (file.closeState === "closed") continue;
    try {
      await file.handle.close();
      file.closeState = "closed";
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length !== 0) {
    throw new AggregateError(
      failures,
      "PSO warmup qualification terminal owned-handle cleanup failed",
    );
  }
}

async function closeOwnedFile(
  file: OwnedEvidenceFile,
  io: Pick<PsoWarmupQualificationRunIo, "pathStat" | "readOwnedFile">,
): Promise<void> {
  if (file.closeState === "closed") return;
  await assertOwnedFile(file, io.pathStat);
  await assertHandleBytesExact(file);
  await assertPathBytesExact(file, io);

  const failures: unknown[] = [];
  try {
    await file.handle.close();
    file.closeState = "closed";
  } catch (error: unknown) {
    failures.push(error);
    try {
      await file.handle.stat();
    } catch {
      file.closeState = "closed";
    }
  }

  if (file.closeState === "closed") {
    await assertPathBytesExact(file, io).catch((error: unknown) => failures.push(error));
  } else {
    await assertOwnedFile(file, io.pathStat).catch((error: unknown) => failures.push(error));
    await assertHandleBytesExact(file).catch((error: unknown) => failures.push(error));
    await assertPathBytesExact(file, io).catch((error: unknown) => failures.push(error));
  }
  if (failures.length !== 0) {
    throw new AggregateError(failures, `PSO warmup qualification ${file.logicalPath} close failed`);
  }
}

async function assertHandleBytesExact(file: OwnedEvidenceFile): Promise<void> {
  if (file.lastWrittenBytes === null || file.lastWrittenSha256 === null) {
    throw new Error(`PSO warmup qualification ${file.logicalPath} has no validated bytes`);
  }
  const actual = Buffer.from(await file.handle.readText(), "utf8");
  assertExactLastWrittenBytes(file, actual, "handle");
}

async function assertPathBytesExact(
  file: OwnedEvidenceFile,
  io: Pick<PsoWarmupQualificationRunIo, "pathStat" | "readOwnedFile">,
): Promise<void> {
  const before = await io.pathStat(file.path);
  requireOwnedIdentity(file, before);
  const actual = await io.readOwnedFile(file.path);
  const after = await io.pathStat(file.path);
  requireOwnedIdentity(file, after);
  assertExactLastWrittenBytes(file, actual, "pathname");
}

function requireOwnedIdentity(
  file: OwnedEvidenceFile,
  identity: PsoWarmupQualificationFileIdentity,
): void {
  requireDirectIdentity(identity, file.logicalPath);
  if (identity.dev !== file.identity.dev || identity.ino !== file.identity.ino) {
    throw new Error(`PSO warmup qualification ${file.logicalPath} pathname identity changed`);
  }
}

function assertExactLastWrittenBytes(
  file: OwnedEvidenceFile,
  actual: Uint8Array,
  source: "handle" | "pathname",
): void {
  if (file.lastWrittenBytes === null || file.lastWrittenSha256 === null) {
    throw new Error(`PSO warmup qualification ${file.logicalPath} has no validated bytes`);
  }
  const actualSha256 = sha256(actual);
  if (
    actualSha256 !== file.lastWrittenSha256 ||
    !Buffer.from(actual).equals(Buffer.from(file.lastWrittenBytes))
  ) {
    throw new Error(
      `PSO warmup qualification ${file.logicalPath} ${source} bytes changed after the last validated write`,
    );
  }
}

function requireOwnershipToken(file: OwnedEvidenceFile, actual: Uint8Array, source: string): void {
  if (!Buffer.from(actual).toString("utf8").includes(file.reservationId)) {
    throw new Error(
      `PSO warmup qualification ${file.logicalPath} ${source} ownership token changed`,
    );
  }
}

function formatOwnedMarkdown(
  markdown: string,
  reservationId: string,
  publicationState: "failed" | "passed" | "pending",
): string {
  return `<!-- parallax-qualification-owner:${reservationId}:${publicationState} -->\n${markdown}`;
}

function nodeEvidenceHandle(handle: FileHandle): PsoWarmupQualificationEvidenceHandle {
  return {
    close: () => handle.close(),
    readText: async () => {
      const size = Number((await handle.stat()).size);
      const bytes = Buffer.alloc(size);
      if (size > 0) await handle.read(bytes, 0, size, 0);
      return bytes.toString("utf8");
    },
    stat: () => handle.stat({ bigint: true }),
    writeText: async (value) => {
      await handle.truncate(0);
      await handle.write(value, 0, "utf8");
      await handle.sync();
    },
  };
}

function repositoryLogicalPath(repositoryRoot: string, path: string): string {
  const candidate = relative(resolve(repositoryRoot), resolve(path));
  if (
    candidate !== "" &&
    candidate !== ".." &&
    !candidate.startsWith(`..${sep}`) &&
    !candidate.includes(":")
  ) {
    return candidate.replaceAll("\\", "/");
  }
  return `external/${basename(path)}`;
}

function sanitizeCause(error: unknown): Readonly<{ message: string; name: string }> {
  const candidate =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
  const rawName =
    error instanceof Error && error.name !== ""
      ? error.name
      : typeof candidate?.name === "string" && candidate.name !== ""
        ? candidate.name
        : "Error";
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof candidate?.message === "string"
        ? candidate.message
        : String(error);
  const sanitize = (value: string, maximum: number): string =>
    Array.from(value, (character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
        ? character
        : " ";
    })
      .join("")
      .replaceAll(/\\\\[^\s"'`]+/gu, "<local-path>")
      .replaceAll(/[A-Za-z]:\\[^\s"'`]*/gu, "<local-path>")
      .replaceAll(/\b(token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/giu, "$1=<redacted>")
      .trim()
      .slice(0, maximum);
  return Object.freeze({
    message: sanitize(rawMessage, MAX_FAILURE_MESSAGE_LENGTH),
    name: sanitize(rawName, 80),
  });
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isCollision(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "EEXIST"
  );
}

function isQualificationPhase(value: unknown): value is QualificationPhase {
  return (
    value === "companion-format" ||
    value === "companion-write" ||
    value === "input-read" ||
    value === "post-validation" ||
    value === "preflight" ||
    value === "qualification" ||
    value === "result-close"
  );
}

function evidenceRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`PSO warmup qualification ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

async function main(): Promise<void> {
  const [inputArgument, outputArgument, buildRootArgument] = process.argv.slice(2);
  if (inputArgument === undefined || outputArgument === undefined) {
    throw new Error(
      "Usage: pso-warmup-qualification-run <smoke-report.json> <preferred-result.json> [build-root]",
    );
  }
  const repositoryRoot = resolve(import.meta.dirname, "../../..");
  const outcome = await runPsoWarmupQualification({
    buildRoot: resolve(buildRootArgument ?? join(repositoryRoot, "dist")),
    inputPath: inputArgument,
    outputPath: outputArgument,
    repositoryRoot,
  });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  if (outcome.state === "failed") process.exitCode = 1;
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
