import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const text = (value) => typeof value === "string" && value.trim() !== "";
const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const sha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** Procedural paving provenance (D-196): project scripts generate every texel and vertex;
 * references are compared by eye only. Earlier scan/generated-image kinds are superseded
 * source history and no longer admissible. */
export function validatePavingProvenance(provenance) {
  assert(provenance && typeof provenance === "object", "Paving provenance is absent");
  assert.equal(provenance.schemaVersion, 1);
  assert.equal(provenance.sourceKind, "procedural-original");
  assert.equal(provenance.assetId, "d1-photoreal-paving");
  assert.equal(provenance.license, "Apache-2.0");
  assert(text(provenance.generation?.tool) && text(provenance.generation.lineage));
  assert(Number.isSafeInteger(provenance.generation.seed));
  assert(Array.isArray(provenance.inputs) && provenance.inputs.length > 0);
  assert(provenance.inputs.some((input) => input.role === "generator"));
  for (const input of provenance.inputs)
    assert(text(input.role) && text(input.path) && sha(input.sha256), "Input identity is invalid");
  assert.equal(provenance.visualReferences?.use, "comparison only; no pixels sampled");
  for (const reference of provenance.visualReferences.references)
    assert(text(reference.id) && text(reference.path) && sha(reference.sha256));
  assert.equal(provenance.rightsReview?.scope, "public-build");
  assert(["approved", "pending"].includes(provenance.rightsReview.status));
  if (provenance.rightsReview.status === "approved")
    assert(
      date(provenance.rightsReview.reviewedAt) &&
        text(provenance.rightsReview.reviewedBy) &&
        text(provenance.rightsReview.basis),
    );
  return {
    assetId: provenance.assetId,
    sourceKind: provenance.sourceKind,
    rightsReviewed: provenance.rightsReview.status === "approved",
  };
}

export async function readPavingProvenance(root, source) {
  const path = source.sourceProvenancePath;
  assert(typeof path === "string" && path.startsWith("assets/source/"), "Provenance path");
  const bytes = await readFile(containedAssetPath(root, path));
  assert.equal(digest(bytes), source.sourceProvenanceSha256, "Source provenance SHA-256 drifted");
  const provenance = JSON.parse(bytes);
  const review = validatePavingProvenance(provenance);
  for (const input of [...provenance.inputs, ...provenance.visualReferences.references])
    assert.equal(
      digest(await readFile(containedAssetPath(root, input.path))),
      input.sha256,
      `Provenance input SHA-256 drifted: ${input.path}`,
    );
  return { provenance, ...review };
}

function containedAssetPath(root, path) {
  assert(typeof path === "string" && !isAbsolute(path) && path.startsWith("assets/"));
  const absolute = resolve(root, path);
  const local = relative(resolve(root, "assets"), absolute);
  assert(
    local !== "" && !local.startsWith("..") && !isAbsolute(local),
    "Asset input escapes assets",
  );
  return absolute;
}
