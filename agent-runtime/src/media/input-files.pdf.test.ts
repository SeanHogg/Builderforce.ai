import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractFileContentFromSource, resolveInputFileLimits } from "./input-files.js";

const fixtureUrl = new URL("./__fixtures__/probe.pdf", import.meta.url);
const pdfBase64 = readFileSync(fileURLToPath(fixtureUrl)).toString("base64");

describe("extractFileContentFromSource — application/pdf", () => {
  it("extracts embedded text from a real PDF via pdfjs-dist", async () => {
    const result = await extractFileContentFromSource({
      source: { type: "base64", data: pdfBase64, mediaType: "application/pdf" },
      limits: resolveInputFileLimits(),
    });

    expect(result.filename).toBe("file");
    expect(result.text).toContain("Hello BuilderForce PDF probe");
  }, 30_000);
});
