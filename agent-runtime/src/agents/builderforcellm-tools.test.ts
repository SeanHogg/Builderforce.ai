import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractCodeBlocks,
  formatToolResults,
  parseToolCalls,
  executeToolCall,
  type ToolResult,
} from "./builderforcellm-tools.js";

// ── parseToolCalls ────────────────────────────────────────────────────────────

describe("parseToolCalls", () => {
  it("extracts a single tool call", () => {
    const text = `Let me read that.\n{"tool": "read_file", "path": "src/index.ts"}`;
    expect(parseToolCalls(text)).toEqual([{ tool: "read_file", path: "src/index.ts" }]);
  });

  it("extracts multiple tool calls on separate lines", () => {
    const text = [
      '{"tool": "list_files", "dir": "src/"}',
      '{"tool": "grep_files", "pattern": "useState", "dir": "src/"}',
    ].join("\n");
    expect(parseToolCalls(text)).toHaveLength(2);
    expect(parseToolCalls(text)[0]).toMatchObject({ tool: "list_files" });
    expect(parseToolCalls(text)[1]).toMatchObject({ tool: "grep_files" });
  });

  it("returns empty array when no tool calls present", () => {
    expect(parseToolCalls("Just a normal response with no JSON.")).toEqual([]);
  });

  it("skips malformed JSON", () => {
    const text = '{"tool": "read_file", "path": BROKEN}';
    expect(parseToolCalls(text)).toEqual([]);
  });

  it("skips JSON objects without a 'tool' key", () => {
    const text = '{"action": "read_file", "path": "src/index.ts"}';
    expect(parseToolCalls(text)).toEqual([]);
  });
});

// ── formatToolResults ─────────────────────────────────────────────────────────

describe("formatToolResults", () => {
  it("formats a single result", () => {
    const results: ToolResult[] = [{ tool: "read_file", output: "const x = 1;" }];
    const out = formatToolResults(results);
    expect(out).toContain("[Tool: read_file]");
    expect(out).toContain("const x = 1;");
  });

  it("joins multiple results with blank lines", () => {
    const results: ToolResult[] = [
      { tool: "list_files", output: "index.ts\nutils.ts" },
      { tool: "grep_files", output: "src/index.ts:3: useEffect" },
    ];
    const out = formatToolResults(results);
    expect(out).toContain("[Tool: list_files]");
    expect(out).toContain("[Tool: grep_files]");
  });
});

// ── extractCodeBlocks ─────────────────────────────────────────────────────────

describe("extractCodeBlocks", () => {
  it("extracts a TypeScript code block", () => {
    const text = "Here is the code:\n```ts\nconst x = 1;\n```";
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe("const x = 1;");
    expect(blocks[0].lang).toBe("ts");
  });

  it("extracts a JavaScript code block", () => {
    const text = "```javascript\nconsole.log('hi');\n```";
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe("javascript");
  });

  it("returns empty array when no fenced blocks present", () => {
    expect(extractCodeBlocks("No code here.")).toEqual([]);
  });

  it("ignores non-code fences (e.g. shell, python)", () => {
    const text = "```shell\nls -la\n```";
    expect(extractCodeBlocks(text)).toEqual([]);
  });
});

// ── sandboxedPath (via executeToolCall) ───────────────────────────────────────

describe("executeToolCall — path traversal protection", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-tools-test-"));
    await fs.writeFile(path.join(tmpDir, "hello.txt"), "hello world", "utf-8");
    // Also create a .ts file so the grep tool (which only scans source files) can match.
    await fs.writeFile(path.join(tmpDir, "hello.ts"), "// hello world", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("reads a file inside the workspace", async () => {
    const result = await executeToolCall({ tool: "read_file", path: "hello.txt" }, tmpDir);
    expect(result.output).toBe("hello world");
  });

  it("blocks path traversal with ../", async () => {
    const result = await executeToolCall({ tool: "read_file", path: "../etc/passwd" }, tmpDir);
    expect(result.output).toMatch(/Error:.*traversal/i);
  });

  it("blocks sibling-directory bypass (startsWith edge case)", async () => {
    // <workspaceDir>-sibling should NOT be accessible
    const siblingDir = `${tmpDir}-sibling`;
    await fs.mkdir(siblingDir, { recursive: true });
    await fs.writeFile(path.join(siblingDir, "secret.txt"), "secret", "utf-8");
    try {
      const result = await executeToolCall(
        { tool: "read_file", path: path.join(siblingDir, "secret.txt") },
        tmpDir,
      );
      expect(result.output).toMatch(/Error:/);
    } finally {
      await fs.rm(siblingDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("lists files inside the workspace", async () => {
    const result = await executeToolCall({ tool: "list_files", dir: "." }, tmpDir);
    expect(result.output).toContain("hello.txt");
  });

  it("greps source files inside the workspace", async () => {
    // grep_files only scans source file extensions (.ts, .tsx, .js, .jsx, .md, .json)
    const result = await executeToolCall({ tool: "grep_files", pattern: "hello" }, tmpDir);
    expect(result.output).toContain("hello.ts");
  });

  it("does not grep non-source files (.txt)", async () => {
    // hello.txt has content "hello world" but .txt is not a scanned extension
    const result = await executeToolCall({ tool: "grep_files", pattern: "hello world" }, tmpDir);
    // The .ts file contains "// hello world" so it will match; the .txt will not appear as path
    expect(result.output).not.toMatch(/hello\.txt/);
  });
});

// ── run_code ──────────────────────────────────────────────────────────────────

describe("executeToolCall — run_code blocked by default", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-run-blocked-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("blocks run_code when allowRunCode is not set (default)", async () => {
    const result = await executeToolCall(
      { tool: "run_code", code: "process.stdout.write('should not run')", lang: "js" },
      tmpDir,
    );
    expect(result.output).toMatch(/disabled/i);
    expect(result.output).toMatch(/allowRunCode/i);
    expect(result.output).not.toContain("should not run");
  });

  it("blocks run_code when allowRunCode is explicitly false", async () => {
    const result = await executeToolCall(
      { tool: "run_code", code: "process.stdout.write('blocked')", lang: "js" },
      tmpDir,
      { allowRunCode: false },
    );
    expect(result.output).toMatch(/disabled/i);
  });
});

describe("executeToolCall — run_code (JavaScript)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-run-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("executes a simple JS snippet and returns stdout when allowRunCode is true", async () => {
    const result = await executeToolCall(
      { tool: "run_code", code: "process.stdout.write('42')", lang: "js" },
      tmpDir,
      { allowRunCode: true },
    );
    expect(result.output).toContain("42");
  });

  it("captures stderr in output", async () => {
    const result = await executeToolCall(
      { tool: "run_code", code: "process.stderr.write('err')", lang: "js" },
      tmpDir,
      { allowRunCode: true },
    );
    expect(result.output).toContain("err");
  });

  it("returns error message on syntax error", async () => {
    const result = await executeToolCall(
      { tool: "run_code", code: "const x = {{{", lang: "js" },
      tmpDir,
      { allowRunCode: true },
    );
    expect(result.output).toMatch(/error/i);
  });
});
