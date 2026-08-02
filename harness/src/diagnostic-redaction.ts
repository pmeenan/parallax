import { INSTALLER_FAILURE_RULES } from "@parallax/engine";
import { isSanitizedEvidenceText, sanitizeEvidenceText } from "./evidence-redaction.js";

const MAX_DIAGNOSTIC_TEXT = 500;
const MAX_CAUSE_NAME = 80;
const REDACTED_INVALID_STRUCTURED_FIELD = "<redacted-invalid>";
const INSTALLER_RESOURCE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const STRUCTURED_FAILURE_ATOMS = Object.freeze({
  code: new Set<string>([
    ...INSTALLER_FAILURE_RULES.map((rule) => rule.code),
    "launch",
    "persistence",
    "shell-contract",
    "shell-release-mismatch",
    "shell-unavailable",
  ]),
  failureClass: new Set<string>([
    ...INSTALLER_FAILURE_RULES.map((rule) => rule.failureClass),
    "offline-shell",
    "ui",
  ]),
  failureEvidence: new Set<string>([
    ...INSTALLER_FAILURE_RULES.map((rule) => rule.failureEvidence),
    "offline-shell",
    "ui",
  ]),
  operation: new Set<string>(INSTALLER_FAILURE_RULES.flatMap((rule) => rule.operations)),
  recovery: new Set<string>(INSTALLER_FAILURE_RULES.map((rule) => rule.recoveryAction)),
});
const STRUCTURED_FAILURE_FIELDS = Object.freeze([
  { key: "code", maximumLength: 32 },
  { key: "failureClass", maximumLength: 32 },
  { key: "failureEvidence", maximumLength: 32 },
  { key: "operation", maximumLength: 32 },
  { key: "recovery", maximumLength: 16 },
  { key: "resourceId", maximumLength: 128 },
] as const);
const STRUCTURED_MESSAGE_SEPARATOR = "; message=";

export interface SanitizedDiagnosticCause {
  readonly message: string;
  readonly name: string;
}

export function redactDiagnosticText(value: string, maximumLength = MAX_DIAGNOSTIC_TEXT): string {
  return sanitizeEvidenceText(value, { fallback: "", maximumLength });
}

export function sanitizeDiagnosticCause(value: unknown): Readonly<SanitizedDiagnosticCause> {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  const rawName =
    value instanceof Error
      ? value.name || "Error"
      : typeof record?.name === "string" && record.name !== ""
        ? record.name
        : "Error";
  const primaryMessage =
    value instanceof Error
      ? value.message || String(value)
      : typeof record?.message === "string" && record.message !== ""
        ? record.message
        : typeof value === "string" && value !== ""
          ? value
          : String(value);
  const structuredFields =
    record === null
      ? []
      : STRUCTURED_FAILURE_FIELDS.flatMap(({ key }) => {
          const field = record[key];
          if (typeof field !== "string") return [];
          const atom = isStructuredFailureAtom(key, field)
            ? field
            : REDACTED_INVALID_STRUCTURED_FIELD;
          return [`${key}=${atom}`];
        });
  const message =
    structuredFields.length === 0
      ? redactDiagnosticText(primaryMessage)
      : composeStructuredDiagnosticMessage(structuredFields, primaryMessage);
  return Object.freeze({
    message,
    name: redactDiagnosticText(rawName, MAX_CAUSE_NAME),
  });
}

export function isSanitizedDiagnosticCause(
  value: unknown,
): value is Readonly<SanitizedDiagnosticCause> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "message,name" ||
    typeof record.message !== "string" ||
    typeof record.name !== "string"
  ) {
    return false;
  }
  return (
    isSanitizedEvidenceText(record.message, {
      fallback: "Unknown failure",
      maximumLength: MAX_DIAGNOSTIC_TEXT,
    }) &&
    isSanitizedEvidenceText(record.name, {
      fallback: "Unknown failure",
      maximumLength: MAX_CAUSE_NAME,
    })
  );
}

function isStructuredFailureAtom(
  key: (typeof STRUCTURED_FAILURE_FIELDS)[number]["key"],
  value: string,
): boolean {
  if (key === "resourceId") return INSTALLER_RESOURCE_ID.test(value);
  return STRUCTURED_FAILURE_ATOMS[key].has(value);
}

function composeStructuredDiagnosticMessage(
  structuredFields: readonly string[],
  primaryMessage: string,
): string {
  const structuredMessage = structuredFields.join("; ");
  const remainingMessageLength =
    MAX_DIAGNOSTIC_TEXT - structuredMessage.length - STRUCTURED_MESSAGE_SEPARATOR.length;
  if (remainingMessageLength < 1) {
    throw new Error("Structured diagnostic fields exceed their reserved evidence bound");
  }
  const freeformMessage = redactDiagnosticText(primaryMessage, remainingMessageLength);
  return `${structuredMessage}${STRUCTURED_MESSAGE_SEPARATOR}${freeformMessage}`;
}
