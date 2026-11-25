import { LOCAL_MODEL_CATALOG, ONNX_BONSAI_CATALOG } from "@builderforce/local-inference";
import { describe, expect, it } from "vitest";
import { formatLocalModelRef, routeCatalogEngine } from "./models/catalogEngine";

describe("routeCatalogEngine", () => {
  it("sends a GGUF Bonsai to bfi and an ONNX q4 Bonsai to onnx", () => {
    const gguf = LOCAL_MODEL_CATALOG.find((row) => row.format === "gguf");
    const onnx = ONNX_BONSAI_CATALOG.find((row) => row.format === "onnx");
    expect(gguf).toBeDefined();
    expect(onnx).toBeDefined();
    expect(routeCatalogEngine(gguf!.ref)).toBe("bfi");
    expect(routeCatalogEngine(onnx!.ref)).toBe("onnx");
    expect(routeCatalogEngine(formatLocalModelRef("bfi", "missing"))).toBeNull();
  });
});
