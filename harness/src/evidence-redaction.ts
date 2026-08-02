const URL_QUERY = /\b(https?):\/\/([^/\s"'`:@]+(?::[^/\s"'`@]*)?@)?([^?\s"'`]+)\?[^#\s"'`]*/giu;
const URL_USER_INFO = /\b(https?):\/\/[^/\s"'`:@]+(?::[^/\s"'`@]*)?@/giu;
const CREDENTIAL =
  /\b(authorization|password|passwd|secret|token|api[_-]?key|access[_-]?token|session|cookie|user(?:name)?)\s*["']?\s*[:=]\s*["']?\s*[^&,\s;}"']+/giu;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu;
const FILE_URL =
  /\bfile:\/\/\/?[^"'();\r\n]+?(?=\s+(?:https?:\/\/|file:\/\/|Bearer\b|(?:authorization|password|passwd|secret|token|api[_-]?key|access[_-]?token|session|cookie|user(?:name)?)\s*["']?\s*[:=])|["'();\r\n]|$)/giu;
const UNC_PATH =
  /\\\\[^"'();\r\n]+?(?=\s+(?:https?:\/\/|file:\/\/|Bearer\b|(?:authorization|password|passwd|secret|token|api[_-]?key|access[_-]?token|session|cookie|user(?:name)?)\s*["']?\s*[:=])|["'();\r\n]|$)/giu;
const WINDOWS_PATH =
  /\b[A-Za-z]:[\\/][^"'();\r\n]+?(?=\s+(?:https?:\/\/|file:\/\/|Bearer\b|(?:authorization|password|passwd|secret|token|api[_-]?key|access[_-]?token|session|cookie|user(?:name)?)\s*["']?\s*[:=])|["'();\r\n]|$)/giu;
const POSIX_PATH =
  /(^|[\s=("'`:])\/(?!\/)[^"'();\r\n]+?(?=\s+(?:https?:\/\/|file:\/\/|Bearer\b|(?:authorization|password|passwd|secret|token|api[_-]?key|access[_-]?token|session|cookie|user(?:name)?)\s*["']?\s*[:=])|["'();\r\n]|$)/giu;

const SENSITIVE_CREDENTIAL =
  /\b(?:authorization|password|passwd|secret|token|api[_-]?key|access[_-]?token|session|cookie|user(?:name)?)\s*["']?\s*[:=]\s*["']?\s*(?!<redacted>)[^&,\s;}"']+/iu;
const SENSITIVE_FILE_URL = /\bfile:\/\//iu;
const SENSITIVE_UNC_PATH = /\\\\[^\s"'();]+/u;
const SENSITIVE_WINDOWS_PATH = /\b[A-Za-z]:[\\/]/u;
const SENSITIVE_POSIX_PATH = /(^|[\s=("'`:])\/(?!\/)[A-Za-z0-9._~-]/u;

export function sanitizeEvidenceText(
  input: unknown,
  options: Readonly<{ readonly fallback: string; readonly maximumLength: number }>,
): string {
  if (!Number.isSafeInteger(options.maximumLength) || options.maximumLength < 1) {
    throw new Error("Evidence redaction length must be a positive safe integer");
  }
  const raw = input instanceof Error && input.message !== "" ? input.message : String(input);
  const sanitized = Array.from(raw, (character) => {
    const code = character.codePointAt(0);
    return code === 9 ||
      code === 10 ||
      code === 13 ||
      (code !== undefined && code >= 32 && code !== 127)
      ? character
      : " ";
  })
    .join("")
    .replaceAll(/\s+/g, " ")
    .replaceAll(URL_QUERY, "$1://$3?<redacted-query>")
    .replaceAll(URL_USER_INFO, "$1://<redacted>@")
    .replaceAll(BEARER, "Bearer <redacted>")
    .replaceAll(CREDENTIAL, "$1=<redacted>")
    .replaceAll(FILE_URL, "<local-path>")
    .replaceAll(UNC_PATH, "<local-path>")
    .replaceAll(WINDOWS_PATH, "<local-path>")
    .replaceAll(POSIX_PATH, "$1<local-path>")
    .slice(0, options.maximumLength)
    .trim();
  if (sanitized !== "") return sanitized;
  return options.fallback.slice(0, options.maximumLength).trim();
}

export function containsSensitiveEvidenceText(input: string): boolean {
  return (
    SENSITIVE_CREDENTIAL.test(input) ||
    SENSITIVE_FILE_URL.test(input) ||
    SENSITIVE_UNC_PATH.test(input) ||
    SENSITIVE_WINDOWS_PATH.test(input) ||
    SENSITIVE_POSIX_PATH.test(input)
  );
}

export function isSanitizedEvidenceText(
  input: unknown,
  options: Readonly<{ readonly fallback: string; readonly maximumLength: number }>,
): input is string {
  return (
    typeof input === "string" &&
    input !== "" &&
    input.length <= options.maximumLength &&
    !containsSensitiveEvidenceText(input) &&
    sanitizeEvidenceText(input, options) === input
  );
}
