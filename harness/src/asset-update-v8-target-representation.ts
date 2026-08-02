import { extname } from "node:path";
import type { InstallResourceKind } from "./install-manifest.js";

export function assetUpdateResourceContentType(
  kind: InstallResourceKind,
  source: string,
):
  | "application/javascript"
  | "application/json; charset=utf-8"
  | "application/octet-stream"
  | "application/wasm"
  | "image/ktx2"
  | "text/html; charset=utf-8" {
  if (kind === "wasm") return "application/wasm";
  if (kind === "module" || kind === "worker") return "application/javascript";
  if (kind === "document") return "text/html; charset=utf-8";
  if (kind === "district-index" || kind === "world-cell" || source.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (kind === "asset-pack" && extname(source) === ".ktx2") return "image/ktx2";
  return "application/octet-stream";
}
