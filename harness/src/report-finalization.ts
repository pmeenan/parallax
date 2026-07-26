import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import type { SourceIdentity } from "./source-identity.js";
import { errorMessage } from "./value-utils.js";

export interface FinalizationEvidence {
  readonly reason?: string;
  readonly state: "invalid" | "measured";
}

export interface PostRunIdentityDependencies {
  readonly readArtifactDigest: () => Promise<string>;
  readonly readSourceIdentity: () => Promise<SourceIdentity>;
}

export interface ReportPersistenceDependencies {
  readonly publishMarkdown: (pendingPath: string, finalPath: string) => Promise<void>;
  readonly removePendingMarkdown: (path: string) => Promise<void>;
  readonly writeJson: (path: string, contents: string) => Promise<void>;
  readonly writePendingMarkdown: (path: string, contents: string) => Promise<void>;
}

export interface JsonPrimaryReportPersistence<T> {
  readonly finalReport: T;
  readonly markdown: string | null;
  readonly secondaryFailure: string | null;
}

const defaultPersistenceDependencies: ReportPersistenceDependencies = Object.freeze({
  publishMarkdown: (pendingPath: string, finalPath: string) => rename(pendingPath, finalPath),
  removePendingMarkdown: (path: string) => rm(path, { force: true }),
  writeJson: (path: string, contents: string) => writeFile(path, contents),
  writePendingMarkdown: (path: string, contents: string) =>
    writeFile(path, contents, { flag: "wx" }),
});

export function measuredFinalizationEvidence(): FinalizationEvidence {
  return Object.freeze({ state: "measured" });
}

export function invalidFinalizationEvidence(reason: string): FinalizationEvidence {
  return Object.freeze({ reason, state: "invalid" });
}

export async function evaluatePostRunIdentity(
  expectedArtifactDigest: string,
  expectedSource: SourceIdentity,
  dependencies: PostRunIdentityDependencies,
): Promise<FinalizationEvidence> {
  const failures: string[] = [];
  try {
    const actualArtifactDigest = await dependencies.readArtifactDigest();
    if (actualArtifactDigest !== expectedArtifactDigest) {
      failures.push(
        `Built artifact identity changed during the run: expected ${expectedArtifactDigest}, received ${actualArtifactDigest}`,
      );
    }
  } catch (error) {
    failures.push(`Post-run artifact identity revalidation failed: ${errorMessage(error)}`);
  }
  try {
    const actualSource = await dependencies.readSourceIdentity();
    if (
      actualSource.commit !== expectedSource.commit ||
      actualSource.dirtyTreeDigest !== expectedSource.dirtyTreeDigest
    ) {
      failures.push(
        `Source identity changed during the run: expected ${formatSourceIdentity(expectedSource)}, received ${formatSourceIdentity(actualSource)}`,
      );
    }
  } catch (error) {
    failures.push(`Post-run source identity revalidation failed: ${errorMessage(error)}`);
  }
  return failures.length === 0
    ? measuredFinalizationEvidence()
    : invalidFinalizationEvidence(failures.join(" | "));
}

export async function persistJsonPrimaryReport<T>(options: {
  readonly dependencies?: ReportPersistenceDependencies;
  readonly failedReport: (reason: string) => T;
  readonly formatMarkdown: (report: T) => string;
  readonly jsonPath: string;
  readonly markdownPath: string;
  readonly pendingReport: T;
  readonly successfulReport: T;
}): Promise<JsonPrimaryReportPersistence<T>> {
  const dependencies = options.dependencies ?? defaultPersistenceDependencies;
  await dependencies.writeJson(options.jsonPath, serializeReport(options.pendingReport));

  let markdown: string;
  try {
    markdown = options.formatMarkdown(options.successfulReport);
  } catch (error) {
    return retainSecondaryFailure(
      options,
      `Human-readable report formatting failed: ${errorMessage(error)}`,
      dependencies,
    );
  }

  const pendingMarkdownPath = `${options.markdownPath}.pending-${randomUUID()}`;
  try {
    await dependencies.writePendingMarkdown(pendingMarkdownPath, markdown);
  } catch (error) {
    await removePendingMarkdownBestEffort(dependencies, pendingMarkdownPath);
    return retainSecondaryFailure(
      options,
      `Human-readable report write failed: ${errorMessage(error)}`,
      dependencies,
    );
  }

  try {
    await dependencies.writeJson(options.jsonPath, serializeReport(options.successfulReport));
  } catch (error) {
    await removePendingMarkdownBestEffort(dependencies, pendingMarkdownPath);
    throw error;
  }

  try {
    await dependencies.publishMarkdown(pendingMarkdownPath, options.markdownPath);
  } catch (error) {
    await removePendingMarkdownBestEffort(dependencies, pendingMarkdownPath);
    return retainSecondaryFailure(
      options,
      `Human-readable report publish failed: ${errorMessage(error)}`,
      dependencies,
    );
  }

  return Object.freeze({
    finalReport: options.successfulReport,
    markdown,
    secondaryFailure: null,
  });
}

async function removePendingMarkdownBestEffort(
  dependencies: ReportPersistenceDependencies,
  pendingPath: string,
): Promise<void> {
  try {
    await dependencies.removePendingMarkdown(pendingPath);
  } catch {
    // The primary JSON failure state must survive even if temporary-file cleanup fails.
  }
}

async function retainSecondaryFailure<T>(
  options: Parameters<typeof persistJsonPrimaryReport<T>>[0],
  reason: string,
  dependencies: ReportPersistenceDependencies,
): Promise<JsonPrimaryReportPersistence<T>> {
  const finalReport = options.failedReport(reason);
  await dependencies.writeJson(options.jsonPath, serializeReport(finalReport));
  return Object.freeze({
    finalReport,
    markdown: null,
    secondaryFailure: reason,
  });
}

function serializeReport(report: unknown): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function formatSourceIdentity(source: SourceIdentity): string {
  return `${source.commit}/${source.dirtyTreeDigest ?? "clean"}`;
}
