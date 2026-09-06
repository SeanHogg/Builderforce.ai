import { describe, expect, it } from "vitest";
import { compileSearchPattern } from "./localCapabilities";

/**
 * `search_code` takes the model's query as a regex — and the model reaches for it with
 * text it just read. `?task=` (from a URL), `foo(bar` (a call site), `a[0]` (an index)
 * all used to come back as "invalid regex: Nothing to repeat", and the agent then
 * spent a whole turn retrying the same words. A query that is not a regex is a
 * literal.
 */
describe("compileSearchPattern", () => {
  it("keeps a valid regex as a regex", () => {
    const re = compileSearchPattern("task=\\d+");
    expect(re.test("?task=2395")).toBe(true);
    expect(re.test("task=abc")).toBe(false);
  });

  it("falls back to a literal match for a query that is not a valid regex", () => {
    expect(compileSearchPattern("?task=").test("/projects?task=2395")).toBe(true);
    expect(compileSearchPattern("?task=").test("/projects?tab=tasks&task=1")).toBe(false);
    expect(compileSearchPattern("foo(bar").test("const x = foo(bar, 1)")).toBe(true);
    expect(compileSearchPattern("a[0").test("return a[0]")).toBe(true);
  });

  it("matches case-insensitively either way", () => {
    expect(compileSearchPattern("?Task=").test("?task=")).toBe(true);
  });
});
