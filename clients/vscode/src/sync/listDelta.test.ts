import { describe, expect, it } from "vitest";
import { applyListDelta, listDelta, sentOf } from "./listDelta";

// The VS Code chat lagged on every keystroke and every streamed token in a 1,572-message
// chat: each 32 ms frame resent the run's appended messages and handed the transcript a
// new trace array, and a trace at its 500-event bound was resent whole on every event.

const items = (...labels: string[]) => labels.map((label) => ({ label }));

/** Relays `next` to a receiver holding `held`, as the host and the webview do. */
function relay<T>(held: T[], sent: T[], next: T[]): T[] {
  const out = applyListDelta(held, listDelta(next, sentOf(sent)));
  if (!out) throw new Error("out of step");
  return out;
}

describe("listDelta", () => {
  it("sends only what was appended", () => {
    const list = items("a", "b");
    const grown = [...list, ...items("c")];
    expect(listDelta(grown, sentOf(list))).toEqual({ drop: 0, from: 2, items: [grown[2]] });
  });

  it("sends a head trim as a drop, not the whole bounded list", () => {
    const list = items("a", "b", "c");
    const trimmed = [list[1], list[2], ...items("d")];
    expect(listDelta(trimmed, sentOf(list))).toEqual({ drop: 1, from: 2, items: [trimmed[2]] });
  });

  it("resends a list that was replaced, and to a new receiver", () => {
    const list = items("a", "b");
    expect(listDelta(items("x", "y"), sentOf(list))).toMatchObject({ drop: 0, from: 0 });
    expect(listDelta(list, undefined)).toEqual({ drop: 0, from: 0, items: list });
  });

  it("resends when the head survived but the tail it was sent with did not", () => {
    const list = items("a", "b");
    expect(listDelta([list[0], ...items("other")], sentOf(list))).toMatchObject({ from: 0 });
  });
});

describe("applyListDelta", () => {
  it("keeps the SAME array when nothing changed", () => {
    const held = items("a", "b");
    expect(relay(held, held, held)).toBe(held);
    const empty: Array<{ label: string }> = [];
    expect(relay(empty, [], [])).toBe(empty);
  });

  it("rebuilds the sender's list across growth, trims and a resend", () => {
    const base = items("a", "b", "c");
    const grown = [...base, ...items("d")];
    const trimmed = [...grown.slice(2), ...items("e")];
    let held = relay([], [], base);
    expect(held).toEqual(base);
    held = relay(held, base, grown);
    expect(held).toEqual(grown);
    held = relay(held, grown, trimmed);
    expect(held).toEqual(trimmed);
    const replaced = items("z");
    expect(relay(held, trimmed, replaced)).toEqual(replaced);
  });

  it("refuses a delta the receiver cannot be in step with, instead of building a short list", () => {
    const sent = items("a", "b", "c");
    const grown = [...sent, ...items("d")];
    // The receiver's store evicted its copy between runs: it holds nothing.
    expect(applyListDelta([], listDelta(grown, sentOf(sent)))).toBeNull();
  });
});
