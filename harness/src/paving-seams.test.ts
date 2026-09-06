import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const moduleUrl = new URL("../../assets/qa/paving-seams.mjs", import.meta.url).href;
const setup = `import assert from 'node:assert/strict';import {validatePeriodicPavingSeams,periodicTextureGradientDiagnostics} from ${JSON.stringify(moduleUrl)};
function grid(n){const attributes=[],indices=[];for(let z=0;z<=n;z++)for(let x=0;x<=n;x++)attributes.push(x/n*2-1,0,z/n*2-1,0,1,0,x/n,z/n,1,0,0,1);for(let z=0;z<n;z++)for(let x=0;x<n;x++){const a=z*(n+1)+x,b=a+1,c=a+n+1,d=c+1;indices.push(a,b,c,b,d,c);}return{attributes:new Float32Array(attributes),indices:new Uint32Array(indices)};}`;

describe("periodic paving seam gate", () => {
  it("checks continuous profiles across different LOD boundary tessellations", async () => {
    const { stdout } = await run(process.execPath, [
      "--input-type=module",
      "-e",
      setup +
        `
      assert.equal(validatePeriodicPavingSeams([grid(4),grid(2),grid(1)]).maxHeightDeltaMetres,0);
      const high=grid(2);high.attributes[3*12+1]=0.001;high.attributes[5*12+1]=0.001;
      assert.throws(()=>validatePeriodicPavingSeams([high,grid(1),grid(1)]),/height seam/);
      const normals=grid(1);normals.attributes[3]=0.2;assert.throws(()=>validatePeriodicPavingSeams([normals,grid(1),grid(1)]),/normal seam/);
      const disconnected=grid(1);disconnected.indices=new Uint32Array([0,1,2]);assert.throws(()=>validatePeriodicPavingSeams([disconnected,grid(1),grid(1)]),/disconnected/);
      const uv=grid(1);uv.attributes[6]=0.2;assert.throws(()=>validatePeriodicPavingSeams([uv,grid(1),grid(1)]),/planar/);
      console.log('passed');`,
    ]);
    expect(stdout.trim()).toBe("passed");
  });

  it("reports wrap-neighbor gradients without demanding identical edge pixels", async () => {
    const { stdout } = await run(process.execPath, [
      "--input-type=module",
      "-e",
      setup +
        `
      const rgba=Buffer.alloc(4*4*4);for(let y=0;y<4;y++)for(let x=0;x<4;x++)rgba.set([100+x*10,100+x*10,100+x*10,255],(y*4+x)*4);
      const stats=periodicTextureGradientDiagnostics(rgba,4,4,'orm');
      assert(Math.abs(stats.seamX.mean-30/255*Math.sqrt(3))<1e-12);
      assert(Math.abs(stats.interiorX.mean-10/255*Math.sqrt(3))<1e-12);
      assert.equal(stats.seamY.mean,0);assert.equal(stats.status,'diagnostic-not-artistic-acceptance');
      console.log('passed');`,
    ]);
    expect(stdout.trim()).toBe("passed");
  });
});
