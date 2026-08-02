export const ASSET_UPDATE_V8_FAILURE_PHASES = Object.freeze([
  "authority",
  "browser",
  "companion-format",
  "companion-write",
  "fixture",
  "fresh",
  "initial-install",
  "post-validation",
  "post-diagnostic",
  "post-warm",
  "pre-install",
  "pre-diagnostic",
  "pre-warm",
  "produce",
  "publication",
  "result-close",
  "target",
  "update",
] as const);

export type AssetUpdateV8FailurePhase = (typeof ASSET_UPDATE_V8_FAILURE_PHASES)[number];
