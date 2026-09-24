// Admit a prepared periodic-surface-module candidate into the immutable library (D-186).
// node assets/qa/admit-d1-paving.mjs <candidate dir> <production decode receipt.json>
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { readPavingProvenance } from "./paving-provenance.mjs";

const root = resolve(import.meta.dirname, "../..");
const candidateDirectory = resolve(process.argv[2]);
const receiptPath = resolve(process.argv[3]);
const candidateBytes = await readFile(resolve(candidateDirectory, "candidate.json"));
const candidate = JSON.parse(candidateBytes);
const receiptBytes = await readFile(receiptPath);
const receipt = JSON.parse(receiptBytes);
assert.equal(candidate.status, "structural-QA-passed-worker-roundtrip-pending");
assert.equal(candidate.mode, "periodic-surface-module");
const reviewed = await readPavingProvenance(root, candidate.source);
assert.deepEqual(candidate.provenance, reviewed.provenance, "Provenance differs from review");
assert.equal(candidate.assetId, reviewed.assetId);
assert.equal(candidate.qa.rightsReviewed, true);
assert.equal(reviewed.rightsReviewed, true, "Public-build rights review remains pending");
assert.equal(receipt.schemaVersion, 1);
assert.equal(receipt.candidateSha256, hash(candidateBytes));
assert.equal(receipt.passed, true);
assert.equal(receipt.decoder, "parallax-production-compressed-worker");
assert.equal(receipt.externalRequestCount, 0);
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
  `Admitted ${candidate.resources.length} immutable objects; installed visual acceptance is separate.`,
);
function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
