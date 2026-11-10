import { describe, expect, it } from "vitest";
import { contentHash, sha256Hex } from "@seanhogg/builderforce-memory/knowledge";
import { nodeContentHash } from "./nodeSha256";

const enc = (text: string) => new TextEncoder().encode(text);

describe("nodeContentHash", () => {
  it("is memory's contentHash on CRLF, lone-CR, mixed, LF, binary and empty input", () => {
    const binaryWithCr = new Uint8Array([0x41, 0x0d, 0x0a, 0x00, 0x0d, 0x42, 0x0d]);
    const nulPastSniff = new Uint8Array(9000).fill(0x61);
    nulPastSniff[8500] = 0;
    nulPastSniff[10] = 0x0d;
    const nulAtSniffEdge = new Uint8Array(9000).fill(0x61);
    nulAtSniffEdge[8191] = 0;
    nulAtSniffEdge[20] = 0x0d;
    const inputs = [
      new Uint8Array(0), enc(""), enc("abc"), enc("a\r\nb\r\n"), enc("a\rb\rc"), enc("a\r\n\rb\n\r\r\n"), enc("\r"), enc("\r\n"), enc("x\r"),
      enc("héllo wörld\r\n".repeat(1000)), enc("héllo wörld\n".repeat(1000)),
      binaryWithCr, nulPastSniff, nulAtSniffEdge, new Uint8Array(70_000).fill(255),
    ];
    for (const bytes of inputs) expect(nodeContentHash(bytes)).toBe(contentHash(bytes));
  });

  it("a CRLF checkout and an LF checkout of one file hash identically, and an LF file keeps its raw sha256", () => {
    expect(nodeContentHash(enc("one\r\ntwo\r\n"))).toBe(nodeContentHash(enc("one\ntwo\n")));
    expect(nodeContentHash(enc("one\ntwo\n"))).toBe(sha256Hex(enc("one\ntwo\n")));
  });
});
