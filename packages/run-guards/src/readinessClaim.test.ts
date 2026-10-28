import { describe, expect, it } from "vitest";
import { ProgressDetector } from "./progressDetector.js";
import { NO_PROGRESS_TURNS } from "./noProgress.js";
import { UNKEPT_READY_AT, UnkeptClaimTracker, claimsReady } from "./readinessClaim.js";

// PRD 35 WS8p: VS Code chat #6 said "Now I have everything I need" and read one more new
// file, turn after turn. A new file is progress to every other window, so nothing tripped.

describe("claimsReady", () => {
  it.each([
    "Now I have everything I need.",
    "I have everything I need to write the update.",
    "Good — I now have enough context.",
    "I've got all the context, so here goes.",
    "We now have a clear picture of the gap.",
    "One final check, then I write the PRD update.",
    "One more look at the ledger before I implement it.",
    "Now I'll write the change.",
    "Let me now implement WS8p.",
    "Time to make the edit.",
    "Let me write the update now.",
    "Now I have a clear picture.",
    "Now I have the full picture, let me check one more file.",
    "I have a complete understanding of the loop.",
    "Now I have everything I need — the parser doesn't handle X yet, so I'll fix that.",
  ])("matches the model's own claim: %s", (text) => {
    expect(claimsReady(text)).toBe(true);
  });

  it.each([
    "I don't have everything I need yet — the ledger is missing.",
    "I still need to read the adapter before I have enough.",
    "Once I have everything I need, I'll write it.",
    'The user wrote "now I have everything I need" in the ticket.',
    "> Now I have everything I need.",
    "```\n// Now I have everything I need\n```",
    "Let me read the contract first.",
    "Reading `runAgent.ts` next.",
    "Now let me make sure the tests cover it.",
    "Time to make sure nothing else calls it.",
    "Now let me update my understanding of the hook order.",
    "Do I have everything I need?",
    "When I have everything I need I will write the PRD.",
    "If I had the full picture I could start.",
    "Let me now read the adapter.",
    "I'll now search for the callers.",
    "",
  ])("does not match a quotation, a denial or a plan to read: %s", (text) => {
    expect(claimsReady(text)).toBe(false);
  });
});

describe("UnkeptClaimTracker", () => {
  it("counts a claim followed by reads only, and clears on any other call", () => {
    const t = new UnkeptClaimTracker();
    t.noteText("Now I have everything I need.");
    t.observe(true);
    expect(t.endTurn()).toBe(1);
    t.noteText("Now I have everything I need.");
    t.observe(true);
    t.observe(false);
    expect(t.endTurn()).toBe(0);
  });

  it("ignores a turn with no calls and a read with no claim", () => {
    const t = new UnkeptClaimTracker({ unkept: 1 });
    t.noteText("Now I have everything I need.");
    expect(t.endTurn()).toBe(1);
    t.observe(true);
    expect(t.endTurn()).toBe(1);
    expect(t.snapshot()).toEqual({ unkept: 1 });
  });
});

const READ_ONLY = new Set(["read_file", "search_code", "list_files"]);
const detector = () => new ProgressDetector({}, { isReadOnly: (tool) => READ_ONLY.has(tool) });

function turn(d: ProgressDetector, text: string, calls: Array<[string, Record<string, unknown>]>) {
  d.noteTurnText(text);
  for (const [tool, args] of calls) d.observe(tool, args, { data: { ok: true } });
  return d.endTurn();
}

describe("ProgressDetector: unkept_ready", () => {
  it("trips on the second unkept claim even though every turn reads a new file", () => {
    const d = detector();
    const first = turn(d, "Now I have everything I need.", [["read_file", { path: "a.md" }]]);
    expect(first).toBeNull();
    const second = turn(d, "One final check, then I write.", [["read_file", { path: "b.md" }]]);
    expect(second).toMatchObject({ kind: "steer", trip: 1, signal: { kind: "unkept_ready", count: UNKEPT_READY_AT } });
    expect(d.steerNote()).toContain("you have said 2 times that you have what you need");
  });

  it("the windows that existed before WS8p never fill on that loop: new files reset no_progress", () => {
    const d = new ProgressDetector({}, { isReadOnly: (tool) => READ_ONLY.has(tool) });
    // The same reads with no claim — exactly what the run did, minus what it said.
    for (let i = 0; i < NO_PROGRESS_TURNS * 5; i++) {
      expect(turn(d, "", [["read_file", { path: `docs/file-${i}.md` }]])).toBeNull();
    }
  });

  it("escalates, then pauses, as every other signal does", () => {
    const d = detector();
    const actions = [];
    for (let i = 0; i < 6; i++) actions.push(turn(d, "Now I have everything I need.", [["read_file", { path: `f${i}.md` }]]));
    expect(actions.filter(Boolean).map((a) => a!.kind)).toEqual(["steer", "escalate", "pause"]);
    expect(actions[5]).toMatchObject({ kind: "pause", question: expect.stringContaining("keeps saying it has everything it needs") });
  });

  it("a claim kept by an edit clears the count", () => {
    const d = detector();
    for (let i = 0; i < 10; i++) {
      const calls: Array<[string, Record<string, unknown>]> = i % 2
        ? [["edit_file", { path: `src/f${i}.ts`, old_string: "a", new_string: "b" }]]
        : [["read_file", { path: `src/f${i}.ts` }]];
      expect(turn(d, "Now I have everything I need.", calls)).toBeNull();
    }
  });

  it("a host with no read-only classifier judges no claim", () => {
    const d = new ProgressDetector();
    for (let i = 0; i < 4; i++) expect(turn(d, "Now I have everything I need.", [["read_file", { path: `f${i}.md` }]])).toBeNull();
  });

  it("carries the count across a step boundary in its JSON state", () => {
    const d = detector();
    turn(d, "Now I have everything I need.", [["read_file", { path: "a.md" }]]);
    const resumed = new ProgressDetector(JSON.parse(JSON.stringify(d.snapshot())), { isReadOnly: (tool) => READ_ONLY.has(tool) });
    expect(turn(resumed, "Now I have everything I need.", [["read_file", { path: "b.md" }]])).toMatchObject({ signal: { kind: "unkept_ready" } });
  });
});
