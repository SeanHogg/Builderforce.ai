import { describe, expect, it } from "vitest";
import { sameFile, type FileIdentity } from "./localFirstJournalIo";

const identity = (ino: bigint, generation?: string, birthtimeNs = 5n): FileIdentity =>
  generation === undefined ? { ino, birthtimeNs } : { ino, birthtimeNs, generation };

describe("sameFile", () => {
  it("is not the same file when the generation differs, even with the same ino and birth time", () => {
    expect(sameFile(identity(7n, "gen-a"), identity(7n, "gen-b"))).toBe(false);
  });

  it("is the same file when the generation matches", () => {
    expect(sameFile(identity(7n, "gen-a"), identity(7n, "gen-a"))).toBe(true);
  });

  it("compares an ino beyond 2^53 exactly", () => {
    const big = 2n ** 53n;
    expect(Number(big)).toBe(Number(big + 1n)); // a number ino could not tell these apart
    expect(sameFile(identity(big), identity(big + 1n))).toBe(false);
    expect(sameFile(identity(big + 1n), identity(big + 1n))).toBe(true);
  });

  it("falls back to stat identity when either side has no generation", () => {
    expect(sameFile(identity(7n), identity(7n, "gen-a"))).toBe(true);
    expect(sameFile(identity(7n, "gen-a"), identity(7n))).toBe(true);
    expect(sameFile(identity(7n), identity(8n, "gen-a"))).toBe(false);
    expect(sameFile(identity(7n), identity(7n, undefined, 6n))).toBe(false);
  });

  it("treats a missing identity as the same only as another missing one", () => {
    expect(sameFile(undefined, undefined)).toBe(true);
    expect(sameFile(identity(7n), undefined)).toBe(false);
  });
});
