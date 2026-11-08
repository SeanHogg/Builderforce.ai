import { describe, expect, it } from "vitest";
import { baseGenerationOf } from "./localFirstJournalHeader";

const bytesOf = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "latin1"));
/** A frame header stand-in (magic + length + crc) followed by the body. */
const withHeader = (body: string, padding = 12): Uint8Array => bytesOf("x".repeat(padding) + body);

describe("baseGenerationOf", () => {
  it("returns undefined for an empty buffer", () => {
    expect(baseGenerationOf(new Uint8Array(0))).toBeUndefined();
  });

  it("returns undefined when the buffer ends mid-id", () => {
    expect(baseGenerationOf(withHeader('{"reset":true,"generation":"abc-12'))).toBeUndefined();
  });

  it("returns undefined for non-JSON bytes", () => {
    expect(baseGenerationOf(new Uint8Array([0xff, 0x00, 0x13, 0x7f, 0xc3, 0x28, 0x01, 0x02]))).toBeUndefined();
  });

  it("returns undefined for a BFJF1 snapshot first frame", () => {
    expect(baseGenerationOf(bytesOf("BFJF1" + '{"records":[],"events":[]}'))).toBeUndefined();
  });

  it("returns undefined for a base with no generation", () => {
    expect(baseGenerationOf(withHeader('{"reset":true,"records":[]}'))).toBeUndefined();
  });

  it("returns undefined when the generation starts past the 32-byte window", () => {
    expect(baseGenerationOf(withHeader('{"reset":true,"generation":"late-id"}', 40))).toBeUndefined();
  });

  it("returns a well-formed id", () => {
    expect(baseGenerationOf(withHeader('{"reset":true,"generation":"4f1c-aa90","records":[]}'))).toBe("4f1c-aa90");
  });
});
