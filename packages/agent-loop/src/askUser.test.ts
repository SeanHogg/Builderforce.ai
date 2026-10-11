import { describe, it, expect } from "vitest";
import {
  askUserAnchorId,
  askUserBlock,
  coerceAskUserPayload,
  liftProseAskUser,
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

describe("liftProseAskUser — a question asked in prose still becomes the card", () => {
  // Chat #133: MiniMax-M1 ended the run on this instead of calling ask_user.
  const MINIMAX = [
    "2860 | S2 | CDN | 2861 | S3 | Canvas surface |",
    "",
    "**Blocker:** Agent execution is disabled in this workspace. When I tried to delegate, I got:",
    "",
    '> "No run: agent execution is switched off for this workspace."',
    "",
    "**Options:**",
    "",
    "- **Enable agent execution** — A manager needs to turn it on in Settings",
    "- **Do the work directly** — I can work on one slice myself in this session",
    "- **You assign manually** — You assign these tasks to agents/people through the board",
    "",
    "What would you like to do?",
  ].join("\n");

  it("lifts the trailing options + question into the block, keeping the lead-in prose", () => {
    const lifted = liftProseAskUser(MINIMAX);
    expect(parseAskUser(lifted)).toEqual({
      question: "What would you like to do?",
      options: [
        { label: "Enable agent execution", description: "A manager needs to turn it on in Settings" },
        { label: "Do the work directly", description: "I can work on one slice myself in this session" },
        { label: "You assign manually", description: "You assign these tasks to agents/people through the board" },
      ],
      multiSelect: false,
    });
    const prose = stripAskUser(lifted);
    expect(prose).toContain("**Blocker:**");
    expect(prose).not.toContain("**Options:**");
    expect(prose).not.toContain("What would you like to do?");
  });

  it("lifts a question that introduces a numbered list", () => {
    const lifted = liftProseAskUser("Two ways to go.\n\nWhich approach should I take?\n1. Postgres: managed\n2. SQLite");
    expect(parseAskUser(lifted)?.options).toEqual([{ label: "Postgres", description: "managed" }, { label: "SQLite" }]);
    expect(stripAskUser(lifted)).toBe("Two ways to go.");
  });

  it("leaves a status list ending in a yes/no question as prose", () => {
    const text = "Next steps:\n- Run tests\n- Deploy\n\nWant me to proceed?";
    expect(liftProseAskUser(text)).toBe(text);
  });

  it("leaves prose without a trailing question, or with one option, untouched", () => {
    expect(liftProseAskUser("Options:\n- A\n- B")).toBe("Options:\n- A\n- B");
    expect(liftProseAskUser("Options:\n- A\n\nWhich one?")).toBe("Options:\n- A\n\nWhich one?");
    expect(liftProseAskUser("Done.")).toBe("Done.");
  });

  it("never touches a reply that already carries a block", () => {
    expect(liftProseAskUser(`Sure.\n\n${QUESTION}`)).toBe(`Sure.\n\n${QUESTION}`);
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
