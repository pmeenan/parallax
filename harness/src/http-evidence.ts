import type { LocalServerMetrics } from "./server.js";

export interface HttpServingObservation {
  readonly description: string;
  readonly satisfied: boolean;
}

// Informational-only HTTP serving discipline observations over a per-run server-metrics
// delta. These never enter the blocking budget facet: they describe whether the run's
// observed traffic matched the serving discipline under test (immutable-URL caching,
// document revalidation), and a miss is a diagnostic lead, not a budget failure.
export function evaluateHttpServingEvidence(
  profile: "fresh" | "warm",
  repeat: number,
  delta: LocalServerMetrics,
): readonly HttpServingObservation[] {
  const errorStatuses = Object.entries(delta.statuses)
    .filter(([status, count]) => Number(status) >= 400 && count > 0)
    .map(([status, count]) => `${count}x ${status}`);
  const observations: HttpServingObservation[] = [
    Object.freeze({
      description: `${profile} repeat ${repeat}: HTTP error responses expected zero during the run window; the delta shows ${errorStatuses.length === 0 ? "none" : errorStatuses.join(", ")}`,
      satisfied: errorStatuses.length === 0,
    }),
  ];
  const immutableRequests = delta.pathClasses.immutable;
  if (profile === "fresh") {
    // Correlated evidence: the immutable-class statuses and bytes prove the artifact
    // bodies themselves were served fresh — document bytes or immutable 304s cannot
    // satisfy this check.
    const immutableBytes = delta.bytesServedByPathClass.immutable;
    const immutableStatuses = nonZeroStatusCounts(delta.statusesByPathClass.immutable);
    observations.push(
      Object.freeze({
        description: `fresh repeat ${repeat}: fresh-profile immutable artifacts expected to be fetched from the server as 200s with response bodies; the delta shows ${immutableRequests} immutable request${immutableRequests === 1 ? "" : "s"} with statuses ${formatStatusCounts(immutableStatuses)} and ${immutableBytes} immutable bytes served`,
        satisfied:
          immutableRequests > 0 &&
          immutableStatuses.every(([status]) => status === "200") &&
          immutableBytes > 0,
      }),
    );
  } else {
    const documentRequests = delta.pathClasses.document;
    const documentStatuses = nonZeroStatusCounts(delta.statusesByPathClass.document);
    observations.push(
      Object.freeze({
        description: `warm repeat ${repeat}: warm-profile immutable requests reaching the server expected zero (immutable URLs are served from the browser HTTP cache without revalidation); the delta shows ${immutableRequests}`,
        satisfied: immutableRequests === 0,
      }),
      // A warm run with no document request never demonstrated revalidation at all, so
      // zero documents is a failed observation, not a vacuous pass; and only
      // document-class 304s count — an unrelated 304 cannot satisfy this check.
      Object.freeze({
        description: `warm repeat ${repeat}: warm-profile document loads expected to revalidate via 304 (at least one document request, every document response a 304); the delta shows ${documentRequests} document request${documentRequests === 1 ? "" : "s"} with statuses ${formatStatusCounts(documentStatuses)}`,
        satisfied: documentRequests > 0 && documentStatuses.every(([status]) => status === "304"),
      }),
    );
  }
  return Object.freeze(observations);
}

function nonZeroStatusCounts(
  statuses: Readonly<Record<string, number>>,
): readonly (readonly [string, number])[] {
  return Object.entries(statuses)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right));
}

function formatStatusCounts(statuses: readonly (readonly [string, number])[]): string {
  return statuses.length === 0
    ? "none"
    : statuses.map(([status, count]) => `${count}x ${status}`).join(", ");
}

export function formatHttpServingEvidence(
  profile: string,
  repeat: number,
  delta: LocalServerMetrics,
): string {
  const statuses = Object.entries(delta.statuses)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${count}x ${status}`);
  return `- ${profile} repeat ${repeat}: ${delta.requests} request${delta.requests === 1 ? "" : "s"} (${delta.pathClasses.document} document / ${delta.pathClasses.immutable} immutable / ${delta.pathClasses.other} other); statuses ${statuses.length === 0 ? "none" : statuses.join(", ")}; ${delta.bytesServed} bytes served; metadata cache ${delta.metadataCacheHits} hit${delta.metadataCacheHits === 1 ? "" : "s"} / ${delta.metadataCacheMisses} miss${delta.metadataCacheMisses === 1 ? "" : "es"}`;
}
