import { describe, expect, it } from "vitest";
import { singleReadsOf } from "./multiRead.js";

/** `read_file` reads `paths[]` whenever `path` is empty or absent (`!path`); the guard
 *  must split the call the same way, or an empty `path` hides every file it read. */
describe("singleReadsOf — `path` as read_file reads it", () => {
  it("splits a paths[] read with no path", () => {
    expect(singleReadsOf("read_file", { paths: ["a.ts", "b.ts"], limit: 50 })).toEqual([
      { path: "a.ts", limit: 50 },
      { path: "b.ts", limit: 50 },
    ]);
  });

  it("splits a paths[] read whose path is the empty string", () => {
    expect(singleReadsOf("read_file", { path: "", paths: ["a.ts", "b.ts"] })).toEqual([{ path: "a.ts" }, { path: "b.ts" }]);
  });

  it("a non-empty path wins over paths[]", () => {
    expect(singleReadsOf("read_file", { path: "a.ts", paths: ["b.ts"] })).toBeNull();
  });
});
