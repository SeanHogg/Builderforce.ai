import { describe, it, expect, vi, beforeEach } from "vitest";

// `permissionMode.ts` is the ONE place the `builderforce.permissionMode` setting is read.
// These tests pin its default: a user who never set the mode must STOP and confirm, and
// only an explicit `acceptEdits` opts into auto-execution.

// The configured mode for the current test. `undefined` models "the user never set it".
// Hoisted so it can be referenced inside the vi.mock factory (which runs before imports).
const state = vi.hoisted(() => ({ configured: undefined as "ask" | "acceptEdits" | undefined }));

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      // Mirrors VS Code's real behavior: with no configured value the declared default
      // is returned, so an explicit `undefined` yields the `??` fallback in permissionMode().
      get: <T>(_key: string, fallback?: T) =>
        state.configured === undefined ? fallback : (state.configured as unknown as T),
    }),
  },
}));

import { permissionMode, autoApproveDefault } from "./permissionMode";

beforeEach(() => {
  state.configured = undefined;
});

describe("permissionMode", () => {
  it("defaults to `ask` (stop and confirm) when the setting is unset", () => {
    expect(permissionMode()).toBe("ask");
  });

  it("honours an explicit `ask`", () => {
    state.configured = "ask";
    expect(permissionMode()).toBe("ask");
  });

  it("honours an explicit `acceptEdits` opt-in", () => {
    state.configured = "acceptEdits";
    expect(permissionMode()).toBe("acceptEdits");
  });
});

describe("autoApproveDefault", () => {
  it("is false by default — the runtime stops to confirm", () => {
    expect(autoApproveDefault()).toBe(false);
  });

  it("is true only when the user explicitly sets `acceptEdits`", () => {
    state.configured = "acceptEdits";
    expect(autoApproveDefault()).toBe(true);
  });
});
