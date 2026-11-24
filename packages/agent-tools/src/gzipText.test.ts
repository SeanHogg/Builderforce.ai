import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { gzipText, isGzipPath, latin1Bytes, readGzipText } from "./gzipText";

describe("readGzipText", () => {
  it("inflates gzip bytes to the original text", async () => {
    const packed = gzipSync(Buffer.from("a sentence from prd.md", "utf8"));
    const text = await readGzipText(packed);
    expect(text).toBe("a sentence from prd.md");
    expect(isGzipPath("packs/methodology.bfpack.gz")).toBe(true);
    expect(latin1Bytes("ab")).toEqual(new Uint8Array([97, 98]));
  });
});

describe("gzipText", () => {
  it("writes gzip that the one inflater reads back unchanged", async () => {
    const text = "méthodologie — prd.md\n";
    const packed = await gzipText(text);
    expect([packed[0], packed[1]]).toEqual([0x1f, 0x8b]);
    expect(await readGzipText(packed)).toBe(text);
  });
});
