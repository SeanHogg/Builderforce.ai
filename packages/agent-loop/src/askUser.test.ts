import { describe, it, expect } from "vitest";
import {
  askUserAnchorId,
  askUserBlock,
  coerceAskUserPayload,
  parseAskUser,
  selectPendingAskUser,
  serializeAskUser,
  stripAskUser,
} from "./index";

/** A message in the shape selectPendingAskUser reads (id/role/content). */
const msg = (id: number, role: string, content: string) => ({ id, role, content });

const QUESTION = serializeAskUser({
  question: "Which database?",
  options: [{ label: "Postgres" }, { label: "SQLite" }],
});

describe("askUserBlock — the producer half", () => {
  it("round-trips raw tool arguments through the fence the transcript parses", () => {
    const block = askUserBlock({
      question: "  Which database?  ",
      options: [{ label: " Postgres ", description: " Managed " }, "SQLite"],
    });
    expect(block).not.toBeNull();
    expect(parseAskUser(block!)).toEqual({
      question: "Which database?",
      options: [{ label: "Postgres", description: "Managed" }, { label: "SQLite" }],
      multiSelect: false,
    });
  });

  it("declines a question with fewer than two choices, so the caller keeps its prose", () => {
    expect(askUserBlock({ question: "Which database?", options: [{ label: "Postgres" }] })).toBeNull();
    expect(askUserBlock({ question: "", options: [{ label: "a" }, { label: "b" }] })).toBeNull();
    expect(askUserBlock(null)).toBeNull();
    expect(askUserBlock("ask me something")).toBeNull();
  });

  it("carries multiSelect through so the card renders checkboxes, not buttons", () => {
    const block = askUserBlock({ question: "Which suites?", options: ["unit", "e2e"], multiSelect: true });
    expect(parseAskUser(block!)?.multiSelect).toBe(true);
  });

  it("coerces on ONE threshold — what the producer emits is exactly what the reader accepts", () => {
    const args = { question: "Which?", options: ["a", "b"] };
    expect(parseAskUser(askUserBlock(args)!)).toEqual(coerceAskUserPayload(args));
  });
});

describe("stripAskUser", () => {
  it("leaves the lead-in prose readable beside the rendered card", () => {
    expect(stripAskUser(`Two ways to do this.\n\n${QUESTION}`)).toBe("Two ways to do this.");
  });

  it("leaves text without a block untouched", () => {
    expect(stripAskUser("just prose")).toBe("just prose");
  });
});

describe("selectPendingAskUser", () => {
  it("returns null for an empty transcript", () => {
    expect(selectPendingAskUser([])).toBeNull();
  });

  it("returns null when no assistant turn asked anything", () => {
    expect(selectPendingAskUser([msg(1, "user", "hi"), msg(2, "assistant", "hello")])).toBeNull();
  });

  it("finds the question the chat is blocked on", () => {
    const pending = selectPendingAskUser([
      msg(1, "user", "set up the db"),
      msg(2, "assistant", `Sure.\n\n${QUESTION}`),
    ]);
    expect(pending?.messageId).toBe(2);
    expect(pending?.payload.question).toBe("Which database?");
    expect(pending?.payload.options.map((o) => o.label)).toEqual(["Postgres", "SQLite"]);
  });

  it("is answered once a user turn follows it — nothing pending", () => {
    expect(
      selectPendingAskUser([
        msg(1, "user", "set up the db"),
        msg(2, "assistant", QUESTION),
        msg(3, "user", "Postgres"),
      ]),
    ).toBeNull();
  });

  it("re-blocks on a NEWER question asked after an earlier one was answered", () => {
    const second = serializeAskUser({ question: "Which ORM?", options: [{ label: "Drizzle" }, { label: "Prisma" }] });
    const pending = selectPendingAskUser([
      msg(1, "assistant", QUESTION),
      msg(2, "user", "Postgres"),
      msg(3, "assistant", second),
    ]);
    expect(pending?.messageId).toBe(3);
    expect(pending?.payload.question).toBe("Which ORM?");
  });

  it("looks past non-user turns (tool/step) that follow the question", () => {
    const pending = selectPendingAskUser([
      msg(1, "assistant", QUESTION),
      msg(2, "tool", "some tool output"),
    ]);
    expect(pending?.messageId).toBe(1);
  });

  it("ignores an assistant turn whose ask-user block is malformed", () => {
    expect(selectPendingAskUser([msg(1, "assistant", "```ask-user\nnot json\n```")])).toBeNull();
  });

  it("anchors a card to its message so a host can scroll to exactly that question", () => {
    const pending = selectPendingAskUser([msg(7, "assistant", QUESTION)]);
    expect(askUserAnchorId(pending!.messageId)).toBe("bf-ask-7");
  });
});
