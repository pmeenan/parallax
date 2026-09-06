import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const text = (value) => typeof value === "string" && value.trim() !== "";
const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const sha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function validatePavingProvenance(provenance) {
  assert(provenance && typeof provenance === "object", "Paving provenance is absent");
  const generatedSurface = provenance.sourceKind === "original-geometry-generated-surface";
  if (!generatedSurface) assert.equal(provenance.sourcePhysicalWidthMetres, 2);
  if (provenance.sourceKind === undefined) {
    assert.equal(provenance.license, "CC0-1.0");
    assert.equal(provenance.licenseUrl, "https://polyhaven.com/license");
    assert(date(provenance.reviewedAt));
    assert(provenance.rightsReview?.startsWith("source-provider-CC0-verified"));
    return { assetId: "d1-scanned-paving", sourceKind: "cc0-scan", rightsReviewed: true };
  }
  assert.equal(provenance.schemaVersion, 1);
  assert(["generated-art", "original-geometry-generated-surface"].includes(provenance.sourceKind));
  if (generatedSurface) {
    assert.equal(provenance.geometryLicense, "Apache-2.0");
    assert.equal(provenance.generatedImagePixelsSampled, true);
    assert.equal(provenance.thirdPartySampledMaterial, false);
    assert.equal(provenance.measuredMaterial, false);
    assert(
      Array.isArray(provenance.inputs) &&
        provenance.inputs.some((input) => input.role === "generator"),
    );
  }
  assert.equal(
    provenance.assetId,
    generatedSurface ? "d1-individual-limestone-stones" : "d1-clean-limestone-paving",
  );
  assert.equal(provenance.license, undefined, "Generated output must not inherit the scan license");
  assert.equal(provenance.generation?.provider, "OpenAI built-in imagegen");
  assert.equal(provenance.generation.model, "unspecified");
  assert.equal(provenance.generation.seed, null);
  assert(text(provenance.generation.lineage));
  assert(Array.isArray(provenance.inputs) && provenance.inputs.length > 0);
  assert(Array.isArray(provenance.generation.prompts) && provenance.generation.prompts.length > 0);
  for (const input of [...provenance.inputs, ...provenance.generation.prompts]) {
    assert(text(input.path) && sha(input.sha256), "Reference/prompt identity is invalid");
  }
  for (const input of provenance.inputs) assert(text(input.role) && text(input.rights));
  assert.equal(provenance.outputTerms?.url, "https://openai.com/policies/row-terms-of-use/");
  assert(date(provenance.outputTerms.effectiveDate) && date(provenance.outputTerms.reviewedAt));
  assert(text(provenance.outputTerms.basis));
  assert.equal(provenance.rightsReview?.scope, "public-build");
  assert(["approved", "pending"].includes(provenance.rightsReview.status));
  if (provenance.rightsReview.status === "approved") {
    assert(date(provenance.rightsReview.reviewedAt) && text(provenance.rightsReview.reviewedBy));
  }
  return {
    assetId: provenance.assetId,
    sourceKind: provenance.sourceKind,
    rightsReviewed: provenance.rightsReview.status === "approved",
  };
}

export async function readPavingProvenance(root, source) {
  const path = source.sourceProvenancePath ?? "assets/source/d1-paving/provenance.json";
  assert(path.startsWith("assets/source/"), "Provenance must be in assets/source");
  const bytes = await readFile(containedAssetPath(root, path));
  assert.equal(digest(bytes), source.sourceProvenanceSha256, "Source provenance SHA-256 drifted");
  const provenance = JSON.parse(bytes);
  const review = validatePavingProvenance(provenance);
  if (
    review.sourceKind === "generated-art" ||
    review.sourceKind === "original-geometry-generated-surface"
  ) {
    for (const input of [...provenance.inputs, ...(provenance.generation.prompts ?? [])]) {
      assert.equal(
        digest(await readFile(containedAssetPath(root, input.path))),
        input.sha256,
        `Reference/prompt SHA-256 drifted: ${input.path}`,
      );
    }
  }
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
