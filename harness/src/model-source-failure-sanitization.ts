import { sanitizeEvidenceText } from "./evidence-redaction.js";

export const MODEL_SOURCE_FAILURE_TEXT_OPTIONS = Object.freeze({
  fallback: "operation failed without details",
  maximumLength: 512,
});

const REMOTE_URL = /\b(?:https?|ssh):\/\/[^\s"'`()<>]+/giu;
const SSH_USER_TARGET =
  /\b[a-z0-9._-]+@(?:\[[0-9a-f:.%]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::[^\s"'`()<>]*)?/giu;
const BRACKETED_IPV6_TARGET = /\[[0-9a-f:.%]+\](?::\d+)?/giu;
const IPV4_TARGET = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/gu;
const HOST_WITH_PORT = /\b[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?:\d+\b/giu;
const QUALIFIED_HOSTNAME =
  /\b[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+(?::\d+)?\b/giu;
const FIXED_INTERNAL_HOSTNAME = /\b(?:localhost|plex)\b/giu;
const LABELED_INTERNAL_HOSTNAME =
  /(\b(?:host|hostname|node|server|target)\s*(?:=|:)\s*)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\b/giu;
const CONNECTION_INTERNAL_HOSTNAME =
  /(\bconnect(?:ed|ing)?\s+to\s+)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\b/giu;
const GETADDRINFO_HOSTNAME =
  /(\bgetaddrinfo\s+(?:eai_again|enotfound)\s+)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\b/giu;
const DIAL_TCP_HOSTNAME = /(\bdial\s+tcp\s+)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?::\d+)?\b/giu;
const SSH_LABELED_HOSTNAME = /(\bssh:\s*)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?=\s*:|\s|$)/giu;
const HOST_SENTINEL = "\u{e000}";
const TARGET_SENTINEL = "\u{e001}";
const RAW_CONTROL_OR_PRIVATE_USE = /[\p{Cc}\p{Co}]/gu;
const HAS_RAW_CONTROL_OR_PRIVATE_USE = /[\p{Cc}\p{Co}]/u;
const MALFORMED_REMOTE_MARKER = /<remote(?!(?:-host|-target)>)[^\s]*/u;

export function sanitizeModelSourceFailureText(input: unknown): string {
  const raw = input instanceof Error && input.message !== "" ? input.message : String(input);
  const protectedInput = raw
    .replaceAll(RAW_CONTROL_OR_PRIVATE_USE, "x")
    .replaceAll("<remote-host>", HOST_SENTINEL)
    .replaceAll("<remote-target>", TARGET_SENTINEL);
  const withoutRemoteTargets = protectedInput
    .replaceAll(REMOTE_URL, "<remote-target>")
    .replaceAll(SSH_USER_TARGET, "<remote-target>")
    .replaceAll(BRACKETED_IPV6_TARGET, "<remote-host>")
    .replaceAll(IPV4_TARGET, "<remote-host>")
    .replaceAll(QUALIFIED_HOSTNAME, "<remote-host>")
    .replaceAll(HOST_WITH_PORT, "<remote-host>")
    .replaceAll(FIXED_INTERNAL_HOSTNAME, "<remote-host>")
    .replaceAll(LABELED_INTERNAL_HOSTNAME, "$1<remote-host>")
    .replaceAll(CONNECTION_INTERNAL_HOSTNAME, "$1<remote-host>")
    .replaceAll(GETADDRINFO_HOSTNAME, "$1<remote-host>")
    .replaceAll(DIAL_TCP_HOSTNAME, "$1<remote-host>")
    .replaceAll(SSH_LABELED_HOSTNAME, "$1<remote-host>");
  const redacted = sanitizeEvidenceText(withoutRemoteTargets, {
    ...MODEL_SOURCE_FAILURE_TEXT_OPTIONS,
    maximumLength: MODEL_SOURCE_FAILURE_TEXT_OPTIONS.maximumLength * 2,
  })
    .replaceAll(HOST_SENTINEL, "<remote-host>")
    .replaceAll(TARGET_SENTINEL, "<remote-target>");
  return atomicModelSourceFailureBound(redacted);
}

export function isSanitizedModelSourceFailureText(input: unknown): input is string {
  return (
    typeof input === "string" &&
    input !== "" &&
    input.length <= MODEL_SOURCE_FAILURE_TEXT_OPTIONS.maximumLength &&
    !MALFORMED_REMOTE_MARKER.test(input) &&
    !HAS_RAW_CONTROL_OR_PRIVATE_USE.test(input) &&
    sanitizeModelSourceFailureText(input) === input
  );
}

function atomicModelSourceFailureBound(input: string): string {
  const maximumLength = MODEL_SOURCE_FAILURE_TEXT_OPTIONS.maximumLength;
  if (input.length <= maximumLength) return input.trim();
  let end: number = maximumLength;
  let changed = true;
  while (changed) {
    changed = false;
    for (const marker of ["<remote-host>", "<remote-target>"]) {
      const markerStart = input.lastIndexOf(marker, end);
      if (markerStart >= 0 && markerStart < end && markerStart + marker.length > end) {
        end = markerStart;
        changed = true;
      }
    }
  }
  const bounded = input.slice(0, end).trim();
  return bounded === ""
    ? MODEL_SOURCE_FAILURE_TEXT_OPTIONS.fallback.slice(0, maximumLength).trim()
    : bounded;
}
