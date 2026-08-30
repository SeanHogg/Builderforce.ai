import { describe, it, expect, beforeEach } from "vitest";
import { autoApprovePersistence } from "./autoApprove";

/**
 * The rule that reconciles `builderforce.permissionMode` with the panel's Auto-mode
 * switch.
 *
 * The bug: the panel defaulted the switch off in its own code and persisted only the
 * override, so it never consulted the setting. Switching the setting to `acceptEdits`
 * moved the `@builderforce` participant — which reads it per turn — and left the panel
 * asking for every edit. One product question, answered two ways, exactly as the scanner
 * and the participant once disagreed about which model to run.
 *
 * The cases below pin both halves of the fix, because either alone is wrong: adopting
 * the setting on EVERY read would revert a hand-flipped switch on the next render, and
 * adopting it NEVER (the old behaviour, once anything was stored) is the bug itself.
 */

let store: Record<string, string>;

/** Both spellings, because in a browser they are the same object: this module's
 *  guarded helper reads `window.localStorage`, the shared override accessor reads the
 *  bare global. Stubbing only one would test a split that does not exist in a webview. */
function useStore(impl: { getItem(k: string): string | null; setItem(k: string, v: string): void }): void {
  (globalThis as Record<string, unknown>).localStorage = impl;
  (globalThis as Record<string, unknown>).window = { localStorage: impl };
}

beforeEach(() => {
  store = {};
  useStore({
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  });
});

describe("auto-approve reconciliation", () => {
  it("starts from the setting when the panel has never been toggled", () => {
    expect(autoApprovePersistence(true).read()).toBe(true);
    store = {};
    expect(autoApprovePersistence(false).read()).toBe(false);
  });

  it("keeps a hand-flipped switch across reloads while the setting is unchanged", () => {
    const p = autoApprovePersistence(false);
    p.read();      // first look: adopts `ask`
    p.write(true); // the user turns Auto mode on for this panel
    // A reload builds a new accessor over the same storage.
    expect(autoApprovePersistence(false).read()).toBe(true);
  });

  it("lets a CHANGED setting override a stale stored switch", () => {
    // The reported bug: the setting moved to acceptEdits and the panel stayed on ask.
    const p = autoApprovePersistence(false);
    p.read();
    p.write(false);
    expect(autoApprovePersistence(true).read()).toBe(true);
  });

  it("adopts a changed setting once, not on every read", () => {
    // Re-adopting would revert the user's next flip on the following render.
    const p = autoApprovePersistence(true);
    expect(p.read()).toBe(true);
    p.write(false); // they turn it back off after the setting change
    expect(autoApprovePersistence(true).read()).toBe(false);
  });

  it("follows the setting back down again", () => {
    const on = autoApprovePersistence(true);
    on.read();
    // Switching the setting to `ask` must disarm a panel left on auto — the direction
    // that matters most, since it is the one that stops touching files unasked.
    expect(autoApprovePersistence(false).read()).toBe(false);
  });

  it("degrades to the setting when storage is blocked", () => {
    // A partitioned webview store throws on access; the gate must still answer, and
    // must answer with the user's standing instruction rather than a hardcoded off.
    useStore({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    expect(autoApprovePersistence(true).read()).toBe(true);
    expect(autoApprovePersistence(false).read()).toBe(false);
  });
});
