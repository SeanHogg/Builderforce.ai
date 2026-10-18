import { describe, expect, it } from "vitest";
import { flattenErrorMessage } from "./builderforce-api.js";

describe("flattenErrorMessage", () => {
  it("reads the flat envelope", () => {
    expect(flattenErrorMessage({ error: "nope" })).toBe("nope");
  });
  it("reads the nested envelope instead of rendering [object Object]", () => {
    expect(flattenErrorMessage({ error: { message: "bad", code: "X" } })).toBe("bad");
  });
  it("prefers the human message and tolerates empties", () => {
    expect(flattenErrorMessage({ error: "code_x", message: "Explained" })).toBe("Explained");
    expect(flattenErrorMessage({})).toBeUndefined();
  });
});
