/**
 * Coding evals — does the agent loop actually change code?
 *
 * Each case runs the REAL `Agent` loop over the REAL shared `@builderforce/agent-tools`
 * core tools, bound to the REAL `buildNodeCapabilityProvider` over a REAL temp git repo,
 * and asserts on the filesystem afterwards. Nothing here asserts on model prose.
 *
 * Deterministic by construction: the model turns come from a scripted plan (no network,
 * no clock), but every tool call, every path resolution and every byte written is the
 * production code path. The live counterpart (`coding-eval.live.test.ts`) swaps in a real
 * model and grades by running the produced project.
 */

import { access } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runCodingEval,
  runInWorkspace,
  type CodingEvalResult,
  type PlanStep,
  type ToolTrace,
} from "./helpers/coding-eval.js";

/** Track the run so every case tears its temp workspace down even on failure. */
let active: CodingEvalResult | undefined;
afterEach(async () => {
  await active?.cleanup();
  active = undefined;
});

const traceFor = (trace: readonly ToolTrace[], name: string): ToolTrace => {
  const hit = trace.find((t) => t.name === name);
  if (!hit) throw new Error(`no ${name} call in trace: ${trace.map((t) => t.name).join(", ")}`);
  return hit;
};

describe("coding eval · tool surface", () => {
  it("offers exactly the tools the on-prem disk surface can back (capability gating)", async () => {
    active = await runCodingEval({
      files: { "README.md": "# fixture\n" },
      task: "do nothing",
      plan: [{ text: "nothing to do" }],
    });

    // Every file tool the disk provider backs is offered...
    expect(active.offeredTools).toEqual(
      expect.arrayContaining([
        "list_files",
        "search_code",
        "read_file",
        "write_file",
        "edit_file",
        "delete_file",
        "ask_human",
      ]),
    );
    // ...and nothing requiring a capability it does NOT advertise. The node provider has
    // no `shell`, so run_command and the git tools must be absent — a surface's toolset is
    // derived from capabilities, never a curated list.
    for (const absent of ["run_command", "git_status", "git_diff", "git_sync_latest", "web_fetch", "run_checks"]) {
      expect(active.offeredTools).not.toContain(absent);
    }
  });
});

describe("coding eval · create", () => {
  it("writes a new file whose code actually runs", async () => {
    active = await runCodingEval({
      files: {
        "README.md": "# calc\nA tiny calculator project.\n",
        "src/index.mjs": "export const VERSION = '1.0.0';\n",
      },
      task: "Add src/add.mjs exporting add(a, b), and a main.mjs that prints add(2, 3).",
      plan: [
        {
          tool: "write_file",
          args: {
            path: "src/add.mjs",
            content: "export function add(a, b) {\n  return a + b;\n}\n",
            summary: "add() helper",
          },
        },
        {
          tool: "write_file",
          args: {
            path: "main.mjs",
            content: "import { add } from './src/add.mjs';\nconsole.log(add(2, 3));\n",
            summary: "entrypoint",
          },
        },
        { text: "Added src/add.mjs and main.mjs." },
      ],
    });

    expect(traceFor(active.trace, "write_file").data.ok).toBe(true);
    expect(active.files["src/add.mjs"]).toContain("export function add(a, b)");

    // The pass criterion is EXECUTION, not string matching: run the file the agent wrote.
    const run = await runInWorkspace(active.root, process.execPath, ["main.mjs"]);
    expect(run.ok).toBe(true);
    expect(run.output.trim()).toBe("5");
  });
});

describe("coding eval · edit", () => {
  const ORIGINAL = [
    "export const TAX_RATE = 0.1;",
    "",
    "export function subtotal(items) {",
    "  return items.reduce((sum, i) => sum + i.price, 0);",
    "}",
    "",
    "export function total(items) {",
    "  return subtotal(items) * (1 + TAX_RATE);",
    "}",
    "",
  ].join("\n");

  it("applies an exact-string edit and leaves the surrounding code byte-identical", async () => {
    active = await runCodingEval({
      files: { "src/pricing.mjs": ORIGINAL },
      task: "Change the tax rate from 10% to 20%.",
      plan: [
        { tool: "read_file", args: { path: "src/pricing.mjs" } },
        {
          tool: "edit_file",
          args: {
            path: "src/pricing.mjs",
            old_string: "export const TAX_RATE = 0.1;",
            new_string: "export const TAX_RATE = 0.2;",
          },
        },
        { text: "Tax rate updated." },
      ],
    });

    const edit = traceFor(active.trace, "edit_file");
    expect(edit.data.ok).toBe(true);
    expect(edit.data.replaced).toBe(1);

    // The whole file, asserted exactly: only the intended line differs. This is what
    // catches an "edit" that silently rewrites, reorders or reformats the rest.
    expect(active.files["src/pricing.mjs"]).toBe(ORIGINAL.replace("0.1", "0.2"));
  });

  it("rejects a non-unique old_string instead of editing the wrong occurrence", async () => {
    active = await runCodingEval({
      files: { "src/dup.mjs": "const a = 1;\nconst b = 1;\n" },
      task: "Change the first 1 to 2.",
      plan: [
        { tool: "edit_file", args: { path: "src/dup.mjs", old_string: "= 1;", new_string: "= 2;" } },
        { text: "Could not disambiguate." },
      ],
    });

    const edit = traceFor(active.trace, "edit_file");
    expect(edit.data.ok).toBe(false);
    expect(String(edit.data.error)).toMatch(/not unique/i);
    // Ambiguity must be a no-op, never a coin-flip edit.
    expect(active.files).toEqual(active.filesBefore);
  });
});

describe("coding eval · search then edit", () => {
  it("locates a symbol with search_code and edits the file it actually found", async () => {
    active = await runCodingEval({
      files: {
        "README.md": "# shop\n",
        "src/pricing.ts": [
          "export function computeTotalPrice(items: { price: number }[]): number {",
          "  return items.reduce((sum, i) => sum + i.price, 0);",
          "}",
          "",
        ].join("\n"),
        "src/unrelated.ts": "export const NOOP = 0;\n",
      },
      task: "Make computeTotalPrice round the result to 2 decimal places.",
      plan: [
        { tool: "search_code", args: { query: "computeTotalPrice" } },
        // The edit target is DERIVED from the search result — if search_code returns the
        // wrong path (or a path the provider can't resolve), this step fails for real.
        (prior: readonly ToolTrace[]): PlanStep => {
          const search = traceFor(prior, "search_code").data;
          const matches = (search.matches ?? []) as { path: string }[];
          if (matches.length === 0) {
            throw new Error(`search_code found no match for computeTotalPrice: ${JSON.stringify(search)}`);
          }
          return {
            tool: "edit_file",
            args: {
              path: matches[0].path,
              old_string: "  return items.reduce((sum, i) => sum + i.price, 0);",
              new_string: "  return Math.round(items.reduce((sum, i) => sum + i.price, 0) * 100) / 100;",
            },
          };
        },
        { text: "Rounded the total." },
      ],
    });

    const search = traceFor(active.trace, "search_code");
    expect(search.data.ok).toBe(true);
    const matches = search.data.matches as { path: string }[];
    // The symbol's file is found, and the unrelated file is not the top hit.
    const found = matches.map((m) => m.path.split("\\").join("/"));
    expect(found).toContain("src/pricing.ts");
    expect(found[0]).toBe("src/pricing.ts");

    // Feeding the search result straight into edit_file must work end-to-end.
    expect(traceFor(active.trace, "edit_file").data.ok).toBe(true);
    expect(active.files["src/pricing.ts"]).toContain("Math.round(");
    expect(active.files["src/unrelated.ts"]).toBe(active.filesBefore["src/unrelated.ts"]);
  });
});

describe("coding eval · multi-file change", () => {
  it("renames an exported symbol consistently across the definition and its caller", async () => {
    active = await runCodingEval({
      files: {
        "src/lib.mjs": "export function oldName(x) {\n  return x * 2;\n}\n",
        "src/main.mjs": "import { oldName } from './lib.mjs';\nconsole.log(oldName(21));\n",
      },
      task: "Rename oldName to doubleValue everywhere.",
      plan: [
        {
          tool: "edit_file",
          args: { path: "src/lib.mjs", old_string: "export function oldName(x)", new_string: "export function doubleValue(x)" },
        },
        {
          tool: "edit_file",
          args: { path: "src/main.mjs", old_string: "oldName", new_string: "doubleValue", replace_all: true },
        },
        { text: "Renamed." },
      ],
    });

    for (const t of active.trace.filter((x) => x.name === "edit_file")) expect(t.data.ok).toBe(true);
    expect(active.files["src/lib.mjs"]).toContain("export function doubleValue(x)");
    expect(active.files["src/main.mjs"]).not.toContain("oldName");

    // Consistency is graded by RUNNING the multi-file result: a rename that missed one
    // side would throw a SyntaxError / undefined import here.
    const run = await runInWorkspace(active.root, process.execPath, ["src/main.mjs"]);
    expect(run.ok).toBe(true);
    expect(run.output.trim()).toBe("42");
  });
});

describe("coding eval · sandboxing", () => {
  it("refuses to write outside the workspace root and the loop continues afterwards", async () => {
    active = await runCodingEval({
      files: { "src/app.mjs": "export const OK = true;\n" },
      task: "Write a config file.",
      plan: [
        { tool: "write_file", args: { path: "../escaped.txt", content: "pwned", summary: "escape" } },
        { tool: "write_file", args: { path: "src/../../escaped2.txt", content: "pwned", summary: "escape" } },
        { tool: "read_file", args: { path: "../../../etc/passwd" } },
        // The loop must survive three rejected tool calls and still do useful work.
        { tool: "write_file", args: { path: "src/config.mjs", content: "export const PORT = 3000;\n", summary: "config" } },
        { text: "Wrote the config inside the workspace." },
      ],
    });

    const [w1, w2, r1, w3] = active.trace;
    expect(w1.data.ok).toBe(false);
    expect(String(w1.data.error)).toMatch(/outside the workspace/);
    expect(w2.data.ok).toBe(false);
    expect(String(w2.data.error)).toMatch(/outside the workspace/);
    expect(r1.data.ok).toBe(false);
    expect(String(r1.data.error)).toMatch(/outside the workspace/);

    // Nothing escaped onto disk.
    await expect(access(join(active.root, "..", "escaped.txt"))).rejects.toThrow();
    await expect(access(join(active.root, "..", "..", "escaped2.txt"))).rejects.toThrow();

    // The loop recovered: the fourth call succeeded and the run reached its final turn.
    expect(w3.data.ok).toBe(true);
    expect(active.files["src/config.mjs"]).toBe("export const PORT = 3000;\n");
    expect(active.events.some((e) => e.type === "agent_end")).toBe(true);
  });

  it("refuses to delete outside the workspace root", async () => {
    active = await runCodingEval({
      files: { "keep.mjs": "export const KEEP = 1;\n" },
      task: "Clean up.",
      plan: [
        { tool: "delete_file", args: { path: "../../keep.mjs", reason: "cleanup" } },
        { text: "Nothing to clean." },
      ],
    });

    const del = traceFor(active.trace, "delete_file");
    expect(del.data.ok).toBe(false);
    expect(String(del.data.error)).toMatch(/outside the workspace/);
    expect(active.files).toEqual(active.filesBefore);
  });
});

describe("coding eval · no change needed", () => {
  it("reports an absent symbol as 'nothing to change' and leaves the tree untouched", async () => {
    active = await runCodingEval({
      files: {
        "src/auth.ts": "export function login(user: string): string {\n  return `hi ${user}`;\n}\n",
        "src/util.ts": "export const ONE = 1;\n",
      },
      task: "Remove all references to OAuthLegacyShim.",
      plan: [
        { tool: "search_code", args: { query: "OAuthLegacyShim" } },
        { text: "OAuthLegacyShim is not referenced anywhere, so there is nothing to remove." },
      ],
    });

    const search = traceFor(active.trace, "search_code");
    expect(search.data.ok).toBe(true);
    expect(search.data.total).toBe(0);
    // The tool must hand the model the explicit anti-fabrication instruction — this is the
    // affordance that stops a "remove X" task from inventing an edit.
    expect(String(search.data.note)).toMatch(/nothing to change/i);
    expect(String(search.data.note)).toMatch(/instead of inventing an edit/i);

    // Byte-for-byte unchanged working tree.
    expect(active.files).toEqual(active.filesBefore);
  });
});
