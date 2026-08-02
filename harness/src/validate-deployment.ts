import { resolve } from "node:path";
import { readAndValidateBuildManifest } from "./build-manifest.js";

const root = process.argv[2];
if (root === undefined || process.argv.length !== 3) {
  throw new Error("Usage: validate-deployment <dist-root>");
}
await readAndValidateBuildManifest(resolve(root));
