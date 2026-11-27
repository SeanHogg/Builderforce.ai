import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  l10n: { t: (s: string, ...a: unknown[]) => a.reduce<string>((acc, v, i) => acc.replace(`{${i}}`, String(v)), s) },
}));

import { explainError } from "./skillsErrors";
import { HelperError } from "./teachHelperProtocol";

describe("explainError", () => {
  it("words each helper code, never echoing the helper's English message (except where it carries detail)", () => {
    expect(explainError(new HelperError("busy", "a run is active"))).toBe("Synapse is already recording or running something.");
    expect(explainError(new HelperError("missing_value", "pin"))).toMatch(/secret value is missing/);
    expect(explainError(new HelperError("helper_gone", "exited (1)"))).toBe("The Teach helper stopped unexpectedly.");
    expect(explainError(new HelperError("record_failed", "no such file"))).toBe("Recording could not start: no such file");
  });

  it("maps the approvals client's signed-out error", () => {
    expect(explainError(new Error("not signed in"))).toBe("Sign in to BuilderForce first.");
  });

  it("keeps any other message", () => {
    expect(explainError(new Error("disk full"))).toBe("disk full");
    expect(explainError(new HelperError("bad_params", "oops"))).toBe("oops");
  });
});
