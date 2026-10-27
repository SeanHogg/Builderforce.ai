import { describe, expect, it } from "vitest";
import { ABORT_TRIGGERS, isAbortTrigger, stopIntent } from "../../src/policy/steering/index.js";

/** PRD 35 E10: a message typed mid-run that IS a stop command equals the Stop button. */
describe("stopIntent", () => {
  it.each([
    "stop",
    "STOP",
    "STOP executing",
    "stop now",
    "Stop now!",
    "stop the run",
    "please stop",
    "halt",
    "abort",
    "cancel the run",
    "/stop",
    "esc",
    "stop stop stop",
    "stop it right now",
  ])("matches %j", (text) => {
    expect(stopIntent(text)).toBe(true);
  });

  it.each([
    "don't stop",
    "do not stop",
    "stop the server",
    "stop using X",
    "how do I stop the dev server?",
    "cancel",
    "cancel the subscription",
    "stopwatch",
    "write the update now",
    "",
    "   ",
  ])("ignores %j", (text) => {
    expect(stopIntent(text)).toBe(false);
  });

  it("ignores missing text", () => {
    expect(stopIntent(undefined)).toBe(false);
    expect(stopIntent(null)).toBe(false);
  });
});

describe("isAbortTrigger — the exact-word layer (on-prem auto-reply)", () => {
  it("matches the bare trigger words, case- and space-insensitively", () => {
    for (const w of ["stop", "esc", "abort", "wait", "exit", "interrupt", "  STOP  "]) expect(isAbortTrigger(w)).toBe(true);
  });

  it("is exact: no slash command, no tail, no prose", () => {
    for (const w of ["/stop", "stop please", "hello", "", undefined, null]) expect(isAbortTrigger(w)).toBe(false);
  });

  it("is a separate layer from stopIntent: 'wait' aborts a channel reply, not an editor run", () => {
    expect(ABORT_TRIGGERS.has("wait")).toBe(true);
    expect(stopIntent("wait")).toBe(false);
  });
});
