import { describe, expect, it } from "vitest";
import { fallbackDetail, redactFallbackText } from "./modelFallbackDetail";

describe("redactFallbackText", () => {
  it("replaces the home directory in either slash form, any case", () => {
    const home = "C:\Users\Sean";
    expect(redactFallbackText("ENOENT C:\Users\Sean\.kimi\creds", home)).toBe("ENOENT ~\.kimi\creds");
    expect(redactFallbackText("ENOENT c:/users/sean/.kimi/creds", home)).toBe("ENOENT ~/.kimi/creds");
  });

  it("strips URL query strings", () => {
    expect(redactFallbackText("HTTP 502 from https://api.example/v1/x?key=abc&u=1 failed", "/home/zz")).toBe("HTTP 502 from https://api.example/v1/x failed");
  });

  it("strips Bearer values and key=value secrets", () => {
    expect(redactFallbackText("401 Authorization: Bearer abc.def-123 rejected", "/home/zz")).toBe("401 Authorization: Bearer [redacted] rejected");
    expect(redactFallbackText("bad token=sk-123 here", "/home/zz")).toBe("bad token=[redacted] here");
  });
});

describe("fallbackDetail", () => {
  it("clamps to one short line", () => {
    const out = fallbackDetail({ from: "m", reason: `a\n${"x".repeat(400)}` });
    expect(out.startsWith("a x")).toBe(true);
    expect(out.length).toBe(160);
  });
});
