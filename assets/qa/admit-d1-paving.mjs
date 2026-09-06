import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { readPavingProvenance } from "./paving-provenance.mjs";
import { PAVING_SEAM_NORMAL_DEGREES, PAVING_SEAM_POSITION_TOLERANCE } from "./paving-seams.mjs";
import { validateStoneVariantSet } from "./stone-variant-geometry.mjs";

const root = resolve(import.meta.dirname, "../..");
const candidateDirectory = resolve(process.argv[2]);
const receiptPath = resolve(process.argv[3]);
const candidateBytes = await readFile(resolve(candidateDirectory, "candidate.json"));
const candidate = JSON.parse(candidateBytes);
const receiptBytes = await readFile(receiptPath);
const receipt = JSON.parse(receiptBytes);
assert.equal(candidate.status, "structural-QA-passed-worker-roundtrip-pending");
const reviewed = await readPavingProvenance(root, candidate.source);
assert.deepEqual(
  candidate.provenance,
  reviewed.provenance,
  "Candidate provenance differs from reviewed source",
);
assert.equal(candidate.assetId, reviewed.assetId);
assert.equal(candidate.qa.rightsReviewed, true);
assert.equal(reviewed.rightsReviewed, true, "Public-build rights review remains pending");
if (candidate.mode === "individual-stone-variants") {
  const budget = JSON.parse(
    await readFile(new URL("./d1-stone-variants.json", import.meta.url), "utf8"),
  );
  validateStoneVariantSet(candidate.source, budget);
  assert.equal(candidate.source.mode, candidate.mode);
  assert.equal(reviewed.sourceKind, "original-geometry-generated-surface");
  assert.deepEqual(candidate.variants, candidate.source.variants);
  assert.deepEqual(candidate.materials, candidate.source.materials);
  assert.equal(candidate.qa.rootClearance.roots, candidate.source.layout.grassRoots.length);
  assert(
    candidate.qa.rootClearance.roots > 0 && candidate.qa.rootClearance.minimumMarginMetres >= -1e-6,
  );
  assert.equal(candidate.qa.closedGeometryAndSurfaceUvs.length, candidate.meshes.length);
  for (const mesh of candidate.meshes) {
    const check = candidate.qa.closedGeometryAndSurfaceUvs.find(
      (entry) => entry.stem === mesh.stem,
    );
    assert(check, "Missing geometry QA");
    assert.equal(check.kind, mesh.kind);
    if (mesh.kind === "stone")
      assert(check.closedGeometricEdges > 0 && check.signedVolumeMetres3 > 0);
  }
}
if (candidate.source.periodic === true) {
  assert.equal(candidate.periodic, true);
  assert.equal(candidate.source.textureAddressMode, "repeat");
  assert.equal(candidate.textureAddressMode, "repeat");
  const seams = candidate.qa.periodicSeams;
  assert.equal(seams?.positionToleranceMetres, PAVING_SEAM_POSITION_TOLERANCE);
  assert.equal(seams?.normalToleranceDegrees, PAVING_SEAM_NORMAL_DEGREES);
  assert(seams.maxHeightDeltaMetres <= PAVING_SEAM_POSITION_TOLERANCE);
  assert(seams.maxNormalDeltaDegrees <= PAVING_SEAM_NORMAL_DEGREES);
  assert(seams.comparisons > 0);
  assert.equal(candidate.qa.textureSeamDiagnostics.length, 3);
}
assert.equal(receipt.schemaVersion, 1);
assert.equal(receipt.candidateSha256, hash(candidateBytes));
assert.equal(receipt.passed, true);
assert.equal(receipt.decoder, "parallax-production-compressed-worker");
const runtime = candidate.resources.filter((resource) => !resource.file.endsWith(".glb"));
assert.equal(receipt.resources.length, runtime.length);
for (const resource of runtime) {
  const decoded = receipt.resources.find((entry) => entry.role === resource.role);
  assert.equal(decoded?.sha256, resource.sha256);
  assert.equal(decoded?.passed, true);
}
const library = resolve(root, "assets/library");
const objects = resolve(library, "objects");
await mkdir(objects, { recursive: true });
for (const resource of candidate.resources) {
  assert.match(resource.file, /^[a-f0-9]{64}\.(glb|ktx2|meshopt)$/);
  const bytes = await readFile(resolve(candidateDirectory, resource.file));
  assert.equal(bytes.length, resource.bytes);
  assert.equal(hash(bytes), resource.sha256);
  const target = resolve(objects, resource.file);
  try {
    await writeFile(target, bytes, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    assert.equal(hash(await readFile(target)), resource.sha256, "Immutable library collision");
  }
}
const manifest = {
  ...candidate,
  status: "QA-admitted-runtime-visual-acceptance-pending",
  candidateSha256: hash(candidateBytes),
  workerRoundtrip: {
    sha256: hash(receiptBytes),
    evidencePath: relative(root, receiptPath).replaceAll("\\", "/"),
  },
  resources: candidate.resources.map((resource) => ({
    ...resource,
    path: `objects/${resource.file}`,
  })),
};
await writeFile(resolve(library, "d1-paving.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await copyFile(receiptPath, resolve(candidateDirectory, "admission-worker-receipt.json"));
console.log(
  `Admitted ${candidate.resources.length} immutable objects; source-art approval does not approve runtime visuals.`,
);
function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
