// Landmark rewards are persisted as a derived nominal total. Bump this rules
// version whenever an existing landmark reward changes so stale saves fail with
// an explicit rules-version mismatch instead of looking corrupt.
export const LANDMARK_RULES_VERSION = 1;
export const LANDMARK_DISCOVERY_EXPERIENCE = 25;

// Discovery applies to every named-landmark kind. It is intentionally distinct
// from the smaller waystone interaction radius used for reshape commands.
export const LANDMARK_DISCOVERY_RADIUS_METERS = 24;
