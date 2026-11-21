/**
 * GGUF and ONNX share one routing function. GGUF stays on bfi. ONNX does not.
 * This module does not import the extension host, so the catalog test can load it.
 */
import { formatLocalModelRef, LOCAL_MODEL_CATALOG, localCatalogModel, localEngineFor, ONNX_BONSAI_CATALOG } from "@builderforce/local-inference";

/** ONNX rows are held out of the runnable catalog (MK-49-ONNX) but still route to their engine. */
const ROUTABLE_CATALOG = [...LOCAL_MODEL_CATALOG, ...ONNX_BONSAI_CATALOG];

export function routeCatalogEngine(ref: string): "bfi" | "onnx" | null {
  const row = localCatalogModel(ref) ?? ROUTABLE_CATALOG.find((entry) => entry.model === ref || entry.ref === ref);
  if (!row?.format) return null;
  const engine = localEngineFor(row);
  return engine === "bfi" || engine === "onnx" ? engine : null;
}

export { formatLocalModelRef };
