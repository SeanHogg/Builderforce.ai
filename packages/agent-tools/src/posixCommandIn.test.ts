import { describe, expect, it } from "vitest";
import { posixCommandIn } from "./git-repo-scope.js";

/**
 * The fallback for a host whose exec transport takes only a command line (the cloud sandbox, the
 * in-browser runtime): the directory goes in as a guarded leading line, an unsafe one is refused.
 */
describe("posixCommandIn", () => {
  it("leaves the command alone with no directory, or the root", () => {
    expect(posixCommandIn(undefined, "npm test")).toBe("npm test");
    expect(posixCommandIn(".", "npm test")).toBe("npm test");
  });

  it("puts the directory in as a guarded leading line — a failed cd must not run the rest at the root", () => {
    expect(posixCommandIn("app", "npm test")).toBe('cd -- "./app" || exit 1\nnpm test');
    expect(posixCommandIn("app", "a; b")).toBe('cd -- "./app" || exit 1\na; b');
    expect(posixCommandIn("Builderforce.ai", "set -e\nnpm test")).toBe('cd -- "./Builderforce.ai" || exit 1\nset -e\nnpm test');
  });

  it("refuses a directory that leaves the workspace, reads as an option, or carries shell syntax", () => {
    for (const dir of ["..", "../x", "a/../../x", "/etc", "-L", "-P", "a;rm -rf /", "a b", '"x"', "$(x)"]) {
      expect(posixCommandIn(dir, "ls")).toBeNull();
    }
  });
});
