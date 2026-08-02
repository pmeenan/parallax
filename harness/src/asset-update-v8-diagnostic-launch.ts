import { sanitizeAssetUpdateDiagnostic } from "./asset-update-v8-sanitization.js";

export async function requireAssetUpdateDiagnosticLaunch<T>(
  phase: "post-warm" | "pre-warm" | "produce",
  launch: () => Promise<T>,
): Promise<T> {
  try {
    return await launch();
  } catch (error: unknown) {
    throw new Error(
      `Required ${phase} diagnostic launch failed: ${sanitizeAssetUpdateDiagnostic(error)}`,
      { cause: error },
    );
  }
}
