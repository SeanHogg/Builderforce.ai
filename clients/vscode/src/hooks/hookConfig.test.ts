import { describe, expect, it } from "vitest";
import { commandsDigest, matchesTool, parseHooksFile, STARTER_HOOKS_FILE, DEFAULT_HOOK_TIMEOUT_S, MAX_HOOK_TIMEOUT_S } from "./hookConfig";

const parse = (hooks: unknown[]) => parseHooksFile(JSON.stringify({ hooks }));

describe("parseHooksFile", () => {
  it("parses the starter file cleanly", () => {
    const { hooks, problems } = parseHooksFile(STARTER_HOOKS_FILE);
    expect(problems).toEqual([]);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]).toMatchObject({ id: "docs", on: "stop", when: "codeChanged", blockOnFailure: true });
  });

  it("applies defaults: id, tool, when, blocking, timeout", () => {
    const { hooks } = parse([{ on: "preTool", command: "npm test" }]);
    expect(hooks[0]).toMatchObject({
      id: "preTool#0",
      tool: "*",
      when: "codeChanged",
      blockOnFailure: true,
      timeoutMs: DEFAULT_HOOK_TIMEOUT_S * 1000,
    });
  });

  it("caps the timeout", () => {
    const { hooks } = parse([{ on: "stop", command: "x", timeoutSeconds: 99_999 }]);
    expect(hooks[0]!.timeoutMs).toBe(MAX_HOOK_TIMEOUT_S * 1000);
  });

  it("reports, and skips, invalid entries without dropping valid ones", () => {
    const { hooks, problems } = parse([
      { on: "nope", command: "x" },
      { on: "stop" },
      { on: "stop", prompt: "a", command: "b" },
      { on: "preTool", prompt: "only stop takes prompts" },
      { on: "stop", tool: "write_file", command: "x" },
      { on: "stop", when: "sometimes", command: "x" },
      { id: "dup", on: "runEnd", command: "x" },
      { id: "dup", on: "runEnd", command: "y" },
      { on: "stop", prompt: "kept" },
    ]);
    expect(problems).toHaveLength(7);
    expect(hooks.map((h) => h.id)).toEqual(["dup", "stop#8"]);
  });

  it("reports a broken file instead of throwing", () => {
    expect(parseHooksFile("{ nope").problems[0]).toMatch(/not valid JSON/);
    expect(parseHooksFile("[]").problems[0]).toMatch(/"hooks" array/);
  });
});

describe("matchesTool", () => {
  const hook = (tool: string) => parse([{ on: "postTool", tool, command: "x" }]).hooks[0]!;
  it("matches *, an exact name, and |-joined names", () => {
    expect(matchesTool(hook("*"), "anything")).toBe(true);
    expect(matchesTool(hook("git_push"), "git_push")).toBe(true);
    expect(matchesTool(hook("git_push"), "git_commit")).toBe(false);
    expect(matchesTool(hook("write_file | edit_file"), "edit_file")).toBe(true);
  });
});

describe("commandsDigest", () => {
  it("is empty with no commands and ignores prompt edits", () => {
    expect(commandsDigest(parse([{ on: "stop", prompt: "a" }]).hooks)).toBe("");
    const a = commandsDigest(parse([{ on: "stop", prompt: "a" }, { on: "stop", command: "lint" }]).hooks);
    const b = commandsDigest(parse([{ on: "stop", prompt: "b" }, { on: "stop", command: "lint" }]).hooks);
    expect(a).toBe(b);
    expect(a).not.toBe("");
  });

  it("changes when a command changes", () => {
    const a = commandsDigest(parse([{ on: "stop", command: "lint" }]).hooks);
    const b = commandsDigest(parse([{ on: "stop", command: "lint --fix" }]).hooks);
    expect(a).not.toBe(b);
  });
});
