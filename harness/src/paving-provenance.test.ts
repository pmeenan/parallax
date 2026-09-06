import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const moduleUrl = new URL("../../assets/qa/paving-provenance.mjs", import.meta.url).href;
const provenanceUrl = new URL(
  "../../assets/source/d1-paving/clean-provenance.json",
  import.meta.url,
).href;
const setup = `import assert from 'node:assert/strict'; import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises'; import {tmpdir} from 'node:os'; import {join} from 'node:path'; import {createHash} from 'node:crypto'; import {validatePavingProvenance,readPavingProvenance} from ${JSON.stringify(moduleUrl)}; const p=JSON.parse(await readFile(new URL(${JSON.stringify(provenanceUrl)}),'utf8'));`;

describe("paving generated-art rights and lineage gate", () => {
  it("preserves original geometry and generated surface rights separately", async () => {
    const { stdout } = await run(process.execPath, [
      "--input-type=module",
      "-e",
      setup +
        `
      const surface={...p,sourceKind:'original-geometry-generated-surface',assetId:'d1-individual-limestone-stones',geometryLicense:'Apache-2.0',generatedImagePixelsSampled:true,thirdPartySampledMaterial:false,measuredMaterial:false,inputs:[...p.inputs,{path:'assets/source/generator.py',sha256:'a'.repeat(64),role:'generator',rights:'Original project Apache-2.0 source'}]};
      assert.equal(validatePavingProvenance(surface).rightsReviewed,true);
      assert.throws(()=>validatePavingProvenance({...surface,generatedImagePixelsSampled:false}));
      assert.throws(()=>validatePavingProvenance({...surface,thirdPartySampledMaterial:true}));
      assert.throws(()=>validatePavingProvenance({...surface,measuredMaterial:true}));
      assert.throws(()=>validatePavingProvenance({...surface,license:'CC0-1.0'}));
      console.log('passed');`,
    ]);
    expect(stdout.trim()).toBe("passed");
  });
  it("keeps generated output distinct from CC0 and requires explicit review fields", async () => {
    const { stdout } = await run(process.execPath, [
      "--input-type=module",
      "-e",
      setup +
        `
      assert.equal(validatePavingProvenance(p).rightsReviewed,true);
      assert.equal(validatePavingProvenance({...p,rightsReview:{...p.rightsReview,status:'pending'}}).rightsReviewed,false);
      assert.throws(()=>validatePavingProvenance({...p,license:'CC0-1.0'}));
      assert.throws(()=>validatePavingProvenance({...p,rightsReview:{status:'approved',scope:'public-build'}}));
      assert.throws(()=>validatePavingProvenance({...p,generation:{...p.generation,model:'invented-model'}}));
      assert.throws(()=>validatePavingProvenance({...p,outputTerms:{...p.outputTerms,url:'https://example.com'}}));
      console.log('passed');`,
    ]);
    expect(stdout.trim()).toBe("passed");
  });

  it("rejects changed reference bytes and stale provenance before admission", async () => {
    const { stdout } = await run(process.execPath, [
      "--input-type=module",
      "-e",
      setup +
        `
      const root=await mkdtemp(join(tmpdir(),'parallax-provenance-test-'));
      const sha=b=>createHash('sha256').update(b).digest('hex');
      try {
        await mkdir(join(root,'assets/source'),{recursive:true});
        const input='assets/input.txt';await writeFile(join(root,input),'reference');
        p.inputs=[{path:input,sha256:sha('reference'),role:'material-reference',rights:'OpenAI output'}];
        p.generation.prompts=[{path:input,sha256:sha('reference')}];
        const bytes=JSON.stringify(p);await writeFile(join(root,'assets/source/provenance.json'),bytes);
        const source={sourceProvenancePath:'assets/source/provenance.json',sourceProvenanceSha256:sha(bytes)};
        assert.equal((await readPavingProvenance(root,source)).rightsReviewed,true);
        await assert.rejects(readPavingProvenance(root,{...source,sourceProvenanceSha256:'0'.repeat(64)}),/provenance SHA/);
        await writeFile(join(root,input),'changed');
        await assert.rejects(readPavingProvenance(root,source),/Reference.*SHA/);
        console.log('passed');
      } finally {await rm(root,{recursive:true,force:true});}`,
    ]);
    expect(stdout.trim()).toBe("passed");
  });
});
