/**
 * GGUF and ONNX share one routing function. GGUF stays on bfi. ONNX does not.
 * This module does not import the extension host, so the catalog test can load it.
 */
import { formatLocalModelRef, LOCAL_MODEL_CATALOG, localCatalogModel, localEngineFor } from "@builderforce/local-inference";

export function routeCatalogEngine(ref: string): "bfi" | "onnx" | null {
  const row = localCatalogModel(ref) ?? LOCAL_MODEL_CATALOG.find((entry) => entry.model === ref || entry.ref === ref);
  if (!row?.format) return null;
  const engine = localEngineFor(row);
  return engine === "bfi" || engine === "onnx" ? engine : null;
}

export { formatLocalModelRef };
