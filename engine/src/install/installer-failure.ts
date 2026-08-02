export type InstallerFailureCode =
  | "cancelled"
  | "cancel-target-invalid"
  | "concurrent-install"
  | "disposed"
  | "install-manifest-invalid"
  | "integrity"
  | "protocol"
  | "quota"
  | "repair-target-mismatch"
  | "shell-incompatible"
  | "store"
  | "transport"
  | "validator"
  | "unknown";

export type InstallerFailureClass =
  | "installer-store"
  | "installer-transfer"
  | "protocol"
  | "quota"
  | "target"
  | "terminal";

export type InstallerFailureEvidence =
  | "protocol-request"
  | "quota-exceeded"
  | "store-append-partial"
  | "store-discard-partial"
  | "store-finalize-partial"
  | "store-active-selection"
  | "store-prepare-resource"
  | "store-quota-probe"
  | "store-repair-admission"
  | "store-selection-restore"
  | "store-stage-release"
  | "store-verify-release"
  | "store-verify-object"
  | "target-manifest"
  | "terminal-unclassified"
  | "transfer-integrity"
  | "transfer-transport"
  | "transfer-validator";

export type InstallerFailureRecovery = "reload" | "repair" | "retry";
export type InstallerFailureResourcePresence = "forbidden" | "optional" | "required";
export type InstallerFailureOperation = "install" | "repair" | "session" | "target-status";

export interface InstallerFailureRule {
  readonly code: InstallerFailureCode;
  readonly failureClass: InstallerFailureClass;
  readonly failureEvidence: InstallerFailureEvidence;
  readonly operations: readonly InstallerFailureOperation[];
  readonly recoveryAction: InstallerFailureRecovery;
  readonly resourcePresence: InstallerFailureResourcePresence;
}

export interface InstallerFailureDiagnostic {
  readonly code: InstallerFailureCode;
  readonly failureClass: InstallerFailureClass;
  readonly failureEvidence: InstallerFailureEvidence;
  readonly message: string;
  readonly operation: InstallerFailureOperation;
  readonly resourceId: string | null;
}

const session = Object.freeze(["session"] as const);
const operations = Object.freeze(["install", "repair"] as const);
const storeOperations = Object.freeze(["install", "repair", "session"] as const);
const targetStatus = Object.freeze(["target-status"] as const);
const targetOperations = Object.freeze(["install", "repair", "target-status"] as const);
const repair = Object.freeze(["repair"] as const);

/**
 * Sole product-failure tuple authority. Every parser and consumer validates
 * against these complete tuples rather than independently accepting enum
 * members and accidentally permitting their cross-product.
 */
export const INSTALLER_FAILURE_RULES: readonly InstallerFailureRule[] = Object.freeze([
  rule("cancelled", "terminal", "terminal-unclassified", "retry", "forbidden", operations),
  rule("cancel-target-invalid", "terminal", "terminal-unclassified", "retry", "forbidden", session),
  rule("concurrent-install", "terminal", "terminal-unclassified", "retry", "forbidden", session),
  rule("disposed", "terminal", "terminal-unclassified", "reload", "forbidden", session),
  rule(
    "install-manifest-invalid",
    "target",
    "target-manifest",
    "retry",
    "forbidden",
    targetOperations,
  ),
  rule("shell-incompatible", "target", "target-manifest", "reload", "forbidden", targetOperations),
  rule("integrity", "installer-transfer", "transfer-integrity", "repair", "optional", operations),
  rule("protocol", "protocol", "protocol-request", "reload", "forbidden", session),
  rule("quota", "quota", "quota-exceeded", "retry", "optional", operations),
  rule("repair-target-mismatch", "target", "target-manifest", "retry", "forbidden", repair),
  rule("store", "installer-store", "store-append-partial", "retry", "required", storeOperations),
  rule("store", "installer-store", "store-discard-partial", "retry", "required", storeOperations),
  rule("store", "installer-store", "store-finalize-partial", "retry", "required", storeOperations),
  rule("store", "installer-store", "store-prepare-resource", "retry", "required", storeOperations),
  rule("store", "installer-store", "store-verify-object", "retry", "required", storeOperations),
  rule("store", "installer-store", "store-verify-release", "retry", "optional", operations),
  rule("store", "installer-store", "store-active-selection", "retry", "forbidden", repair),
  rule("store", "installer-store", "store-quota-probe", "retry", "forbidden", repair),
  rule("store", "installer-store", "store-repair-admission", "retry", "optional", repair),
  rule("store", "installer-store", "store-selection-restore", "retry", "required", repair),
  rule("store", "installer-store", "store-stage-release", "retry", "forbidden", repair),
  rule("integrity", "installer-store", "store-active-selection", "repair", "forbidden", repair),
  rule("integrity", "installer-store", "store-quota-probe", "repair", "forbidden", repair),
  rule("integrity", "installer-store", "store-repair-admission", "repair", "optional", repair),
  rule("integrity", "installer-store", "store-selection-restore", "repair", "required", repair),
  rule("integrity", "installer-store", "store-stage-release", "repair", "forbidden", repair),
  rule("integrity", "installer-store", "store-verify-release", "repair", "optional", repair),
  rule("transport", "installer-transfer", "transfer-transport", "retry", "optional", operations),
  rule("transport", "target", "target-manifest", "retry", "forbidden", targetStatus),
  rule("validator", "installer-transfer", "transfer-validator", "retry", "optional", operations),
  rule("unknown", "terminal", "terminal-unclassified", "retry", "forbidden", operations),
  rule("unknown", "terminal", "terminal-unclassified", "retry", "forbidden", targetStatus),
  rule("unknown", "terminal", "terminal-unclassified", "retry", "forbidden", session),
]);

export function installerFailureRule(
  code: InstallerFailureCode,
  failureClass: InstallerFailureClass,
  failureEvidence: InstallerFailureEvidence,
  resourceId: string | null,
  operation: InstallerFailureOperation,
): InstallerFailureRule {
  const matches = INSTALLER_FAILURE_RULES.filter(
    (candidate) =>
      candidate.code === code &&
      candidate.failureClass === failureClass &&
      candidate.failureEvidence === failureEvidence &&
      candidate.operations.includes(operation),
  );
  if (matches.length !== 1) {
    throw new Error("Installer failure tuple is not authoritative");
  }
  const match = matches[0];
  if (match === undefined || !resourcePresenceMatches(match.resourcePresence, resourceId)) {
    throw new Error("Installer failure resource presence contradicts its tuple");
  }
  return match;
}

export function createInstallerFailureDiagnostic(
  code: InstallerFailureCode,
  failureClass: InstallerFailureClass,
  failureEvidence: InstallerFailureEvidence,
  message: unknown,
  resourceId: string | null,
  operation: InstallerFailureOperation,
): InstallerFailureDiagnostic {
  installerFailureRule(code, failureClass, failureEvidence, resourceId, operation);
  return Object.freeze({
    code,
    failureClass,
    failureEvidence,
    message: sanitizeInstallerFailureMessage(message),
    operation,
    resourceId,
  });
}

export function assertCanonicalInstallerFailureDiagnostic(
  diagnostic: InstallerFailureDiagnostic,
): InstallerFailureRule {
  const rule_ = installerFailureRule(
    diagnostic.code,
    diagnostic.failureClass,
    diagnostic.failureEvidence,
    diagnostic.resourceId,
    diagnostic.operation,
  );
  if (!isCanonicalInstallerFailureMessage(diagnostic.message)) {
    throw new Error("Installer failure message is not canonically sanitized");
  }
  return rule_;
}

export function installerFailureRecoveryAction(
  diagnostic: Pick<
    InstallerFailureDiagnostic,
    "code" | "failureClass" | "failureEvidence" | "operation" | "resourceId"
  >,
): InstallerFailureRecovery {
  return installerFailureRule(
    diagnostic.code,
    diagnostic.failureClass,
    diagnostic.failureEvidence,
    diagnostic.resourceId,
    diagnostic.operation,
  ).recoveryAction;
}

const MAX_INSTALLER_FAILURE_SOURCE_LENGTH = 4_096;
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(?:access[-_]?token|refresh[-_]?token|client[-_]?secret|api[-_]?key|password|secret|token)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/giu;
const SECRET_QUERY_PATTERN =
  /([?&])(?:access[-_]?token|refresh[-_]?token|client[-_]?secret|api[-_]?key|password|secret|token)=([^&#\s]*)/giu;

export function sanitizeInstallerFailureMessage(input: unknown): string {
  const source =
    input instanceof Error && input.message !== ""
      ? input.message
      : typeof input === "string"
        ? input
        : String(input);
  const bounded = source.slice(0, MAX_INSTALLER_FAILURE_SOURCE_LENGTH).normalize("NFKC");
  const authorizationRedacted = redactBoundedAuthorizationCredentials(bounded);
  const secretsRedacted = redactControlJoinedSecrets(authorizationRedacted);
  const boundaryNormalized = secretsRedacted.replaceAll(/[\p{Cc}\p{Cf}]+/gu, " ");
  const redacted = redactJoinedInstallerFailureMessage(boundaryNormalized)
    .replaceAll(/\s+/gu, " ")
    .trim();
  return (redacted === "" ? "Installer operation failed" : redacted).slice(0, 256);
}

export function isCanonicalInstallerFailureMessage(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    return false;
  }
  const normalized = value.normalize("NFKC");
  const controlBoundaryShadow = normalized.replaceAll(/[\p{Cc}\p{Cf}]+/gu, " ");
  const controlJoinedShadow = normalized.replaceAll(/[\p{Cc}\p{Cf}]+/gu, "");
  const hasCanonicalRawMessage = sanitizeInstallerFailureMessage(normalized) === normalized;
  const hasCanonicalBoundaryShadow =
    sanitizeInstallerFailureMessage(controlBoundaryShadow) === controlBoundaryShadow;
  const hasCanonicalJoinedShadow =
    sanitizeInstallerFailureMessage(controlJoinedShadow) === controlJoinedShadow;
  return (
    normalized === value &&
    hasCanonicalRawMessage &&
    hasCanonicalBoundaryShadow &&
    hasCanonicalJoinedShadow &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function redactBoundedAuthorizationCredentials(value: string): string {
  const headerPattern =
    /a[\p{Cc}\p{Cf}]*u[\p{Cc}\p{Cf}]*t[\p{Cc}\p{Cf}]*h[\p{Cc}\p{Cf}]*o[\p{Cc}\p{Cf}]*r[\p{Cc}\p{Cf}]*i[\p{Cc}\p{Cf}]*z[\p{Cc}\p{Cf}]*a[\p{Cc}\p{Cf}]*t[\p{Cc}\p{Cf}]*i[\p{Cc}\p{Cf}]*o[\p{Cc}\p{Cf}]*n[\s\p{Cc}\p{Cf}]*:/giu;
  let cursor = 0;
  let redacted = "";
  for (const match of value.matchAll(headerPattern)) {
    const headerStart = match.index;
    if (headerStart < cursor) continue;
    const headerEnd = headerStart + match[0].length;
    const schemeStart = skipFailureBoundaries(value, headerEnd);
    const scheme = matchAuthorizationScheme(value, schemeStart);
    if (scheme === null) continue;
    const credentialStart = skipFailureBoundaries(value, scheme.end);
    const cause =
      scheme.scheme === "digest"
        ? findDigestAuthorizationCause(value, credentialStart)
        : findInstallerFailureCause(value, credentialStart);
    redacted += value.slice(cursor, headerStart);
    redacted += "Authorization: <credential>";
    if (cause === null) {
      cursor = value.length;
      break;
    }
    redacted += " ";
    cursor = cause.clauseStart;
  }
  return redacted + value.slice(cursor);
}

function findDigestAuthorizationCause(
  value: string,
  start: number,
): { boundaryStart: number; clauseStart: number } | null {
  let cursor = skipFailureBoundaries(value, start);
  while (cursor < value.length) {
    const nameStart = cursor;
    while (cursor < value.length) {
      const character = codePointAt(value, cursor);
      if (isFailureBoundary(character) || character === "=" || character === ",") break;
      cursor += character.length;
    }
    if (cursor === nameStart) return null;
    cursor = skipFailureBoundaries(value, cursor);
    if (value[cursor] !== "=") return null;
    cursor = skipFailureBoundaries(value, cursor + 1);
    if (value[cursor] === '"') {
      const quotedEnd = consumeDigestQuotedString(value, cursor);
      if (quotedEnd === null) return null;
      cursor = quotedEnd;
    } else {
      const valueStart = cursor;
      while (cursor < value.length) {
        const character = codePointAt(value, cursor);
        if (isFailureBoundary(character) || character === ",") break;
        cursor += character.length;
      }
      if (cursor === valueStart) return null;
    }
    if (cursor >= value.length) return null;
    if (value[cursor] === ",") {
      cursor = skipFailureBoundaries(value, cursor + 1);
      continue;
    }
    const boundaryStart = cursor;
    const clauseStart = skipFailureBoundaries(value, cursor);
    const causeEnd = matchInstallerFailureCauseEnd(value, clauseStart);
    if (causeEnd !== null && !containsEqualsAfterDigestCause(value, causeEnd)) {
      return { boundaryStart, clauseStart };
    }
    if (value[clauseStart] !== ",") return null;
    cursor = skipFailureBoundaries(value, clauseStart + 1);
  }
  return null;
}

function containsEqualsAfterDigestCause(value: string, start: number): boolean {
  return value.indexOf("=", start) !== -1;
}

function consumeDigestQuotedString(value: string, start: number): number | null {
  let cursor = start + 1;
  let escaped = false;
  while (cursor < value.length) {
    const character = codePointAt(value, cursor);
    cursor += character.length;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') return cursor;
  }
  return null;
}

function redactControlJoinedSecrets(value: string): string {
  return replaceControlJoinedSecrets(
    replaceControlJoinedSecrets(value, SECRET_ASSIGNMENT_PATTERN, () => "<secret>"),
    SECRET_QUERY_PATTERN,
    (match) => `${match[1] ?? ""}<secret>`,
  );
}

function replaceControlJoinedSecrets(
  value: string,
  pattern: RegExp,
  replacement: (match: RegExpMatchArray) => string,
): string {
  const shadow = createControlJoinedShadow(value);
  const replacements: Array<{ end: number; replacement: string; start: number }> = [];
  for (const match of shadow.value.matchAll(pattern)) {
    const shadowStart = match.index;
    const shadowEnd = shadowStart + match[0].length;
    const start = shadow.originalOffsets[shadowStart];
    const mappedEnd = shadow.originalOffsets[shadowEnd];
    if (start === undefined || mappedEnd === undefined) return "<secret>";
    let end = mappedEnd;
    const cause = findInstallerFailureCause(value, start);
    if (cause !== null && cause.boundaryStart < end) end = cause.boundaryStart;
    replacements.push({ end, replacement: replacement(match), start });
  }
  let redacted = value;
  for (const current of replacements.reverse()) {
    redacted = redacted.slice(0, current.start) + current.replacement + redacted.slice(current.end);
  }
  return redacted;
}

function createControlJoinedShadow(value: string): {
  originalOffsets: number[];
  value: string;
} {
  const originalOffsets: number[] = [0];
  let joined = "";
  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    if (!CONTROL_CHARACTER_PATTERN.test(character)) {
      const shadowStart = joined.length;
      joined += character;
      for (let offset = 0; offset <= character.length; offset += 1) {
        originalOffsets[shadowStart + offset] = index + offset;
      }
    }
    index += character.length;
  }
  return { originalOffsets, value: joined };
}

function matchAuthorizationScheme(
  value: string,
  start: number,
): { end: number; scheme: "basic" | "bearer" | "digest" } | null {
  for (const scheme of ["basic", "bearer", "digest"] as const) {
    let cursor = start;
    let matched = true;
    for (const expected of scheme) {
      while (cursor < value.length) {
        const character = codePointAt(value, cursor);
        if (!CONTROL_CHARACTER_PATTERN.test(character)) break;
        cursor += character.length;
      }
      if (value[cursor]?.toLowerCase() !== expected) {
        matched = false;
        break;
      }
      cursor += 1;
    }
    if (matched) return { end: cursor, scheme };
  }
  return null;
}

function findInstallerFailureCause(
  value: string,
  start: number,
): { boundaryStart: number; clauseStart: number } | null {
  let cursor = start;
  while (cursor < value.length) {
    const character = codePointAt(value, cursor);
    if (!isFailureBoundary(character)) {
      cursor += character.length;
      continue;
    }
    const boundaryStart = cursor;
    const clauseStart = skipFailureBoundaries(value, cursor);
    if (startsInstallerFailureCause(value, clauseStart)) {
      return { boundaryStart, clauseStart };
    }
    cursor = clauseStart;
  }
  return null;
}

function startsInstallerFailureCause(value: string, start: number): boolean {
  return matchInstallerFailureCauseEnd(value, start) !== null;
}

function matchInstallerFailureCauseEnd(value: string, start: number): number | null {
  for (const word of [
    "because",
    "after",
    "while",
    "when",
    "during",
    "reason",
    "quota",
    "since",
    "until",
  ]) {
    if (startsAsciiWord(value, start, word)) return start + word.length;
  }
  for (const [first, second] of [
    ["due", "to"],
    ["caused", "by"],
    ["on", "account"],
  ] as const) {
    if (!startsAsciiWord(value, start, first)) continue;
    const secondStart = skipFailureBoundaries(value, start + first.length);
    if (startsAsciiWord(value, secondStart, second)) return secondStart + second.length;
  }
  return null;
}

function startsAsciiWord(value: string, start: number, word: string): boolean {
  if (value.slice(start, start + word.length).toLowerCase() !== word) return false;
  return !/[A-Za-z0-9_-]/u.test(value[start + word.length] ?? "");
}

function skipFailureBoundaries(value: string, start: number): number {
  let cursor = start;
  while (cursor < value.length) {
    const character = codePointAt(value, cursor);
    if (!isFailureBoundary(character)) break;
    cursor += character.length;
  }
  return cursor;
}

function isFailureBoundary(character: string): boolean {
  return /\s/u.test(character) || CONTROL_CHARACTER_PATTERN.test(character);
}

function codePointAt(value: string, index: number): string {
  const codePoint = value.codePointAt(index);
  return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
}

function redactJoinedInstallerFailureMessage(value: string): string {
  return value
    .replaceAll(
      /authorization\s*:\s*(?:basic|bearer)\s*[^\s,;]+|authorization\s*:\s*digest[^\r\n]*?(?=\s+(?:because|due\s+to|after|while)\b|$)/giu,
      "Authorization: <credential>",
    )
    .replaceAll(SECRET_ASSIGNMENT_PATTERN, "<secret>")
    .replaceAll(SECRET_QUERY_PATTERN, "$1<secret>")
    .replaceAll(/(["'])https?:\/\/.*?\1/giu, "$1<url>$1")
    .replaceAll(/(["'])file:\/\/.*?\1/giu, "$1<local-path>$1")
    .replaceAll(/(["'])(?:[A-Za-z]:\\|\\\\|\/(?!\/)).*?\1/gu, "$1<local-path>$1")
    .replaceAll(/\bhttps?:\/\/.*?(?=\s+(?:because|due\s+to|after|while)\b|$)/giu, "<url>")
    .replaceAll(/\bfile:\/\/.*?(?=\s+(?:because|due\s+to|after|while)\b|$)/giu, "<local-path>")
    .replaceAll(/\b[A-Za-z]:\\.*?(?=\s+(?:because|due\s+to|after|while)\b|$)/gu, "<local-path>")
    .replaceAll(/\\\\.*?(?=\s+(?:because|due\s+to|after|while)\b|$)/gu, "<local-path>")
    .replaceAll(
      /(^|[\s("'=])\/(?!\/).*?(?=\s+(?:because|due\s+to|after|while)\b|$)/gu,
      "$1<local-path>",
    )
    .replaceAll(/https?:\/\/[^\s"'`<>{}]+/giu, "<url>")
    .replaceAll(/file:\/\/[^\s"'`<>{}]+/giu, "<local-path>")
    .replaceAll(/\\\\[^\s"'`,;]+/gu, "<local-path>")
    .replaceAll(/\b[A-Za-z]:\\[^\s"'`,;]+/gu, "<local-path>")
    .replaceAll(/(^|[\s("'=])\/(?!\/)[^\s"'`,;]+/gu, "$1<local-path>")
    .replaceAll(/\b[A-Za-z0-9._-]+[\\/][A-Za-z0-9._\\/-]+\b/gu, "<local-path>");
}

function rule(
  code: InstallerFailureCode,
  failureClass: InstallerFailureClass,
  failureEvidence: InstallerFailureEvidence,
  recoveryAction: InstallerFailureRecovery,
  resourcePresence: InstallerFailureResourcePresence,
  allowedOperations: readonly InstallerFailureOperation[],
): InstallerFailureRule {
  return Object.freeze({
    code,
    failureClass,
    failureEvidence,
    operations: allowedOperations,
    recoveryAction,
    resourcePresence,
  });
}

function resourcePresenceMatches(
  presence: InstallerFailureResourcePresence,
  resourceId: string | null,
): boolean {
  return (
    presence === "optional" ||
    (presence === "required" && resourceId !== null) ||
    (presence === "forbidden" && resourceId === null)
  );
}
