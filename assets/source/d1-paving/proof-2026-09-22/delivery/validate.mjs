import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(new URL("../../../../package.json", import.meta.url));
const { validateBytes, version } = require("gltf-validator");
const root = resolve(process.argv[2]);
const reports = [];
for (let lod = 0; lod < 3; lod++) {
  const file = `lod${lod}.glb`;
  const report = await validateBytes(await readFile(resolve(root, file)), {
    uri: file,
    maxIssues: 1000,
  });
  reports.push({ file, report });
  console.log(file, JSON.stringify(report.issues));
}
await writeFile(
  resolve(root, "validation.json"),
  `${JSON.stringify({ validator: version(), reports }, null, 2)}\n`,
  { flag: "wx" },
);
if (reports.some((r) => r.report.issues.numErrors > 0)) process.exitCode = 1;
