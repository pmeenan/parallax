import { isSanitizedEvidenceText, sanitizeEvidenceText } from "./evidence-redaction.js";

const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9]{0,79}$/;
const SENSITIVE_NAME = /authorization|password|passwd|secret|token|api|access|session|cookie|user/i;

export function sanitizeAssetUpdateDiagnostic(input: unknown): string {
  return sanitizeEvidenceText(input, { fallback: "Unknown failure", maximumLength: 400 });
}

export function sanitizedAssetUpdateErrorName(error: Error): string {
  return isSanitizedAssetUpdateErrorName(error.name) ? error.name : "Error";
}

export function isSanitizedAssetUpdateDiagnostic(input: unknown): input is string {
  return isSanitizedEvidenceText(input, { fallback: "Unknown failure", maximumLength: 400 });
}

export function isSanitizedAssetUpdateErrorName(input: unknown): input is string {
  return typeof input === "string" && SAFE_ERROR_NAME.test(input) && !SENSITIVE_NAME.test(input);
}
