/**
 * GGUF and ONNX share one routing function. GGUF stays on bfi. ONNX does not.
 * This module does not import the extension host, so the catalog test can load it.
 */
import { formatLocalModelRef, LOCAL_MODEL_CATALOG, localCatalogModel, localEngineFor, ONNX_BONSAI_CATALOG } from "@builderforce/local-inference";

export function routeCatalogEngine(ref: string): "bfi" | "onnx" | null {
  // ONNX rows are held out of the runnable catalog (MK-49-ONNX) but still route to their engine. Read at call time, so a
  // module that mocks the package without the catalogs can still import this one.
  const matches = (entry: { model: string; ref: string }) => entry.model === ref || entry.ref === ref;
  const row = localCatalogModel(ref) ?? LOCAL_MODEL_CATALOG.find(matches) ?? ONNX_BONSAI_CATALOG.find(matches);
  if (!row?.format) return null;
  const engine = localEngineFor(row);
  return engine === "bfi" || engine === "onnx" ? engine : null;
}

export { formatLocalModelRef };
