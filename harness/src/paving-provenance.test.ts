import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const moduleUrl = new URL("../../assets/qa/paving-provenance.mjs", import.meta.url).href;
const provenanceUrl = new URL(
  "../../assets/source/d1-paving/proof-2026-09-24/provenance.json",
  import.meta.url,
).href;
const rootPath = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const setup = `import assert from 'node:assert/strict'; import {readFile} from 'node:fs/promises'; import {createHash} from 'node:crypto'; import {validatePavingProvenance,readPavingProvenance} from ${JSON.stringify(moduleUrl)}; const bytes=await readFile(new URL(${JSON.stringify(provenanceUrl)})); const p=JSON.parse(bytes);`;

async function check(body: string): Promise<string> {
  const { stdout } = await run(process.execPath, [
    "--input-type=module",
    "-e",
    `${setup}${body}; console.log('passed');`,
  ]);
  return stdout.trim();
}

describe("procedural paving provenance and rights gate", () => {
  it("accepts the reviewed procedural source and binds every input hash", async () => {
    expect(
      await check(`
      assert.equal(validatePavingProvenance(p).rightsReviewed, true);
      const source={sourceProvenancePath:'assets/source/d1-paving/proof-2026-09-24/provenance.json',sourceProvenanceSha256:createHash('sha256').update(bytes).digest('hex')};
      const review=await readPavingProvenance(${JSON.stringify(rootPath)}, source);
      assert.equal(review.assetId,'d1-photoreal-paving');
      await assert.rejects(readPavingProvenance(${JSON.stringify(rootPath)}, {...source,sourceProvenanceSha256:'0'.repeat(64)}));`),
    ).toBe("passed");
  });

  it("rejects superseded kinds, sampled references and incomplete rights reviews", async () => {
    expect(
      await check(`
      assert.throws(()=>validatePavingProvenance({...p,sourceKind:'original-geometry-generated-surface'}));
      assert.throws(()=>validatePavingProvenance({...p,license:'CC0-1.0'}));
      assert.throws(()=>validatePavingProvenance({...p,visualReferences:{...p.visualReferences,use:'sampled'}}));
      assert.throws(()=>validatePavingProvenance({...p,inputs:p.inputs.filter(i=>i.role!=='generator')}));
      assert.throws(()=>validatePavingProvenance({...p,rightsReview:{scope:'public-build',status:'approved'}}));
      assert.equal(validatePavingProvenance({...p,rightsReview:{...p.rightsReview,status:'pending'}}).rightsReviewed,false);`),
    ).toBe("passed");
  });
});
