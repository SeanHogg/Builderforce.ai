"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/runFindings/index.ts
var runFindings_exports = {};
__export(runFindings_exports, {
  RUN_FINDING_POLICY: () => RUN_FINDING_POLICY,
  RUN_FINDING_REGISTRY: () => RUN_FINDING_REGISTRY,
  buildRunView: () => buildRunView,
  compareFindings: () => compareFindings,
  detectRunFindings: () => detectRunFindings,
  traceWithPersistedSteps: () => traceWithPersistedSteps
});
module.exports = __toCommonJS(runFindings_exports);

// src/runFindings/policy.ts
var import_working = require("@seanhogg/builderforce-memory/working");
var RUN_FINDING_POLICY = Object.freeze({
  /** Read-only turns before the first write that make an analysis overrun. */
  analysisReadTurns: 8,
  /** Read-only turns after a readiness claim that leave it unkept. */
  unkeptReadTurns: 2,
  /** Turns that each made exactly one write, at which the run is writing serially. */
  serialSingleWriteTurns: 4,
  /** Prompt : completion ratio and prompt total at which the run's prompt is bloated. */
  promptBloatRatio: 50,
  promptBloatMinTokens: 5e5,
  /** Writes of one path that make churn. */
  editChurnWrites: 4,
  /** Argument bytes of one non-write call that are oversized. */
  oversizedArgBytes: 4 * 1024,
  /** Identical text (bytes) two calls of one tool must share to count as a copied block. */
  sharedArgBytes: 1024,
  /** A turn this slow (ms) is slow. */
  slowTurnMs: 6e4,
  /** Word-set overlap at which a pre-call text repeats the last kept one: memory's B7 fold threshold, so the
   *  diagnostic and the fold agree (`NARRATION_OVERLAP`, `@seanhogg/builderforce-memory/working`). */
  narrationOverlap: import_working.NARRATION_OVERLAP,
  /** Longest excerpt an evidence row quotes. */
  excerptChars: 160
});
var CHECK_TOOL = /diagnostic|typecheck|type[_-]check|(^|[_.-])tests?($|[_.-])|lint|(^|[_.-])verify($|[_.-])/i;
var CHECK_COMMAND = /\b(?:tsc|tsgo|vitest|jest|mocha|playwright|eslint|biome|oxlint|pytest|cargo\s+(?:check|test|clippy)|go\s+(?:test|vet))\b|\b(?:npm|pnpm|yarn|bun|npx)\b[^|;&\n]*?\b(?:test|lint|check|typecheck|type-check)\b/i;
var SHELL_TOOLS = /* @__PURE__ */ new Set(["run_command", "shell", "bash", "exec"]);

// src/runFindings/findingParts.ts
function finding(kind, severity, params, evidence) {
  const first = evidence.reduce((min, e) => Math.min(min, e.step), Number.POSITIVE_INFINITY);
  const subject = params.path ?? params.tool;
  const id = `${kind}:${subject !== void 0 ? `${subject}:` : ""}${Number.isFinite(first) ? first : 0}`;
  return { id, kind, severity, params, evidence };
}
function withUniqueIds(findings) {
  const seen = /* @__PURE__ */ new Map();
  return findings.map((f) => {
    const n = (seen.get(f.id) ?? 0) + 1;
    seen.set(f.id, n);
    return n === 1 ? f : { ...f, id: `${f.id}#${n}` };
  });
}
function excerpt(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  const max = RUN_FINDING_POLICY.excerptChars;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}\u2026` : flat;
}
function turnEvidence(t, label = "llm.complete", text) {
  return { step: t.step, turn: t.index, label, ...text ? { excerpt: excerpt(text) } : {} };
}
function callEvidence(c, path2, text) {
  return {
    step: c.step,
    ...c.turn > 0 ? { turn: c.turn } : {},
    label: c.name,
    ...path2 ? { path: path2 } : {},
    ...text ? { excerpt: excerpt(text) } : {}
  };
}
function fileLedger(view) {
  const rows = /* @__PURE__ */ new Map();
  for (const c of view.calls) {
    if (c.check) for (const row of rows.values()) row.checked = true;
    for (const path2 of c.paths) {
      const row = rows.get(path2);
      if (row) {
        row.writes += 1;
        row.lastWrite = c;
        row.checked = false;
      } else {
        rows.set(path2, { path: path2, writes: 1, lastWrite: c, checked: false });
      }
    }
  }
  return [...rows.values()];
}
function unverifiedFiles(view) {
  return fileLedger(view).filter((r) => !r.checked);
}
function writeCalls(view) {
  return view.calls.filter((c) => c.write);
}

// src/runFindings/detectors/analysisOverrun.ts
function analysisOverrun(view) {
  const firstWrite = view.turns.find((t) => t.kind === "write");
  const before = firstWrite ? view.turns.filter((t) => t.index < firstWrite.index) : view.turns;
  const reads = before.filter((t) => t.kind === "read");
  const forced = before.find((t) => t.forced);
  const forcedByBudget = !!forced && view.routing.handOffsForced > 0;
  if (reads.length < RUN_FINDING_POLICY.analysisReadTurns && !forcedByBudget) return [];
  const evidence = [
    ...reads[0] ? [turnEvidence(reads[0])] : [],
    ...reads.length > 1 ? [turnEvidence(reads[reads.length - 1])] : [],
    ...forced ? [turnEvidence(forced, "loop.hand_off_due")] : []
  ];
  return [finding("analysis_overrun", forcedByBudget ? "error" : "warn", {
    readTurns: reads.length,
    firstWriteTurn: firstWrite?.index ?? 0
  }, evidence)];
}

// ../packages/agent-tools/src/modelRoles.ts
var MODEL_ROLES = ["plan", "code", "verify", "explore", "chat", "utility"];
var MODEL_ROLE_DESCRIPTIONS = {
  plan: "Deciding an approach or breaking work down \u2014 no code written yet.",
  code: "Writing or editing code. The default when no role is named.",
  verify: "Checking work already done \u2014 reading test/build output, reviewing a diff.",
  explore: "Investigation \u2014 locating, searching, summarising.",
  chat: "A conversational answer with no task-shaped work behind it.",
  utility: "Small, mechanical, low-stakes work \u2014 formatting, extraction, a lookup."
};
var ROLE_SET = new Set(MODEL_ROLES);
function isModelRole(value) {
  return typeof value === "string" && ROLE_SET.has(value);
}
function delegationRole(raw) {
  return isModelRole(raw) ? raw : "code";
}

// ../packages/agent-tools/src/edit.ts
var toLF = (s) => s.replace(/\r\n/g, "\n");
var countNewlines = (s) => s.split("\n").length - 1;
function dominantEol(content) {
  const all = countNewlines(content);
  if (all === 0) return null;
  const crlf = content.split("\r\n").length - 1;
  return crlf >= all - crlf ? "\r\n" : "\n";
}
function withEol(text, eol) {
  if (!eol) return text;
  const lf = toLF(text);
  return eol === "\n" ? lf : lf.replace(/\n/g, "\r\n");
}
function foldToLF(content) {
  const lf = toLF(content);
  const at = new Int32Array(lf.length + 1);
  let j = 0;
  for (let i = 0; i < content.length; i += 1) {
    at[j] = i;
    if (content.charCodeAt(i) === 13 && content.charCodeAt(i + 1) === 10) i += 1;
    j += 1;
  }
  at[j] = content.length;
  return { lf, at };
}
function spansOf(hay, needle, all) {
  const spans = [];
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
    spans.push([at, at + needle.length]);
    if (!all && spans.length === 2) break;
  }
  return spans;
}
var MIN_CONTAINS_NEEDLE = 8;
var EXCERPT_RADIUS = 3;
var EDIT_EXCERPT_CONTEXT = 2;
var EDIT_EXCERPT_MAX_LINES = 40;
function numberedLines(lines, from, to) {
  return lines.slice(from, to).map((l, i) => `${from + i + 1}: ${l}`).join("\n");
}
function excerptAfterEdit(content, region) {
  const lines = content.split(/\r?\n/);
  const from = Math.max(0, region.startLine - 1 - EDIT_EXCERPT_CONTEXT);
  const to = Math.min(lines.length, region.endLine + EDIT_EXCERPT_CONTEXT);
  if (to - from <= EDIT_EXCERPT_MAX_LINES) return numberedLines(lines, from, to);
  const half = Math.floor(EDIT_EXCERPT_MAX_LINES / 2);
  return `${numberedLines(lines, from, from + half)}
\u2026
${numberedLines(lines, to - half, to)}`;
}
function regionAt(content, offset, newS) {
  const startLine = countNewlines(content.slice(0, offset)) + 1;
  return { startLine, endLine: startLine + countNewlines(newS) };
}
function findNearest(content, oldString) {
  const needle = oldString.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (!needle) return void 0;
  const lines = content.split(/\r?\n/);
  let index = lines.findIndex((l) => l.trim() === needle);
  if (index === -1 && needle.length >= MIN_CONTAINS_NEEDLE) index = lines.findIndex((l) => l.includes(needle));
  if (index === -1) return void 0;
  const from = Math.max(0, index - EXCERPT_RADIUS);
  const to = Math.min(lines.length, index + EXCERPT_RADIUS + 1);
  return { line: index + 1, excerpt: numberedLines(lines, from, to) };
}
function applyStringEdit(content, oldString, newString, replaceAll = false) {
  if (typeof oldString !== "string" || oldString.length === 0) {
    return { ok: false, error: "oldString is required" };
  }
  const newS = withEol(newString, dominantEol(content));
  const { lf, at } = foldToLF(content);
  let spans = spansOf(lf, toLF(oldString), replaceAll).map(([s, e]) => [at[s], at[e]]);
  if (spans.length === 0) spans = spansOf(content, oldString, replaceAll);
  if (spans.length > 1 && !replaceAll) {
    return {
      ok: false,
      error: "oldString is not unique; add more surrounding context or set replaceAll"
    };
  }
  if (spans.length > 0) {
    const parts = [];
    let from = 0;
    for (const [s, e] of spans) {
      parts.push(content.slice(from, s), newS);
      from = e;
    }
    parts.push(content.slice(from));
    const next = parts.join("");
    const region = regionAt(content, spans[0][0], newS);
    return { ok: true, content: next, replaced: spans.length, region, excerpt: excerptAfterEdit(next, region) };
  }
  const nearest = findNearest(content, oldString);
  return {
    ok: false,
    error: "oldString not found in file \u2014 read_file and copy the exact text (including indentation)",
    ...nearest ? { nearest } : {}
  };
}
var editStr = (v) => typeof v === "string" ? v : void 0;
function editPathOf(a) {
  const p = a.path ?? a.file_path ?? a.filePath;
  return typeof p === "string" && p.trim() ? p.trim().replace(/\\/g, "/").replace(/^\.\//, "") : null;
}
function editedFilesOf(toolName, args) {
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const top = editPathOf(a);
  const out = [];
  if (toolName === "edit_file") {
    const replacement = (e, fallback) => {
      const path2 = editPathOf(e) ?? fallback;
      const before = editStr(e.old_string);
      const after = editStr(e.new_string);
      if (path2 && (before !== void 0 || after !== void 0)) {
        out.push({ path: path2, ...before !== void 0 ? { before } : {}, ...after !== void 0 ? { after } : {} });
      } else if (path2 && e !== a) {
        out.push({ path: path2 });
      }
    };
    if ("old_string" in a || "new_string" in a) replacement(a, null);
    if (Array.isArray(a.edits)) {
      for (const raw of a.edits) {
        if (raw && typeof raw === "object") replacement(raw, top);
      }
    }
  } else if (toolName === "write_file" && top) {
    const after = editStr(a.content);
    out.push({ path: top, ...after !== void 0 ? { after } : {} });
  }
  if (out.length === 0 && top) out.push({ path: top });
  return out;
}
function editedPathsOf(toolName, args) {
  return [...new Set(editedFilesOf(toolName, args).map((f) => f.path))];
}
var EDIT_BATCH_MAX = 20;
function entryProblem(e) {
  if (typeof e.path !== "string" || e.path.trim() === "") return "path is required";
  if (typeof e.old_string !== "string" || e.old_string.length === 0) return "old_string is required";
  if (typeof e.new_string !== "string") return "new_string is required";
  return null;
}
function planBatchEdits(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { edits: [], error: "edits must be a non-empty array" };
  if (raw.length > EDIT_BATCH_MAX) return { edits: [], error: `edits takes at most ${EDIT_BATCH_MAX} edits per call \u2014 split the rest into another edit_file` };
  const edits = raw;
  for (let i = 0; i < edits.length; i += 1) {
    const problem = entryProblem(edits[i]);
    if (problem) return { edits: [], error: `edit ${i + 1} (${edits[i].path ?? "?"}): ${problem}`, invalidAt: i };
  }
  return { edits };
}
async function applyBatchEdits(plan, io) {
  if (plan.error || plan.invalidAt !== void 0) {
    return { ok: false, files: [{ path: "", ok: false, error: plan.error ?? "invalid edits" }] };
  }
  const overlay = /* @__PURE__ */ new Map();
  const outcomes = [];
  for (let i = 0; i < plan.edits.length; i += 1) {
    const e = plan.edits[i];
    const base = overlay.has(e.path) ? overlay.get(e.path) : await io.read(e.path) ?? null;
    if (base === null || base === void 0) {
      return { ok: false, files: [...outcomes, { path: e.path, ok: false, error: `edit ${i + 1}: file not found \u2014 ${e.path}` }] };
    }
    const r = applyStringEdit(overlay.get(e.path) ?? base, e.old_string, e.new_string, e.replace_all === true);
    if (!r.ok || r.content == null) {
      return {
        ok: false,
        files: [...outcomes, { path: e.path, ok: false, error: `edit ${i + 1} (${e.path}): ${r.error ?? "did not match"}`, ...r.nearest ? { nearest: r.nearest } : {} }]
      };
    }
    overlay.set(e.path, r.content);
    outcomes.push({
      path: e.path,
      ok: true,
      content: r.content,
      ...r.replaced != null ? { replaced: r.replaced } : {},
      ...r.region ? { region: r.region } : {},
      ...r.excerpt ? { excerpt: r.excerpt } : {}
    });
  }
  const written = /* @__PURE__ */ new Set();
  for (const o of outcomes) {
    if (written.has(o.path)) continue;
    written.add(o.path);
    await io.write(o.path, overlay.get(o.path));
  }
  return { ok: true, files: outcomes.map(({ content: _c, ...rest }) => rest) };
}

// ../packages/agent-tools/src/editBalance.ts
var LEXED_EXTENSIONS = /* @__PURE__ */ new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "json",
  "jsonc"
]);
var JSX_EXTENSIONS = /* @__PURE__ */ new Set(["jsx", "tsx"]);
var EXPRESSION_KEYWORDS = /* @__PURE__ */ new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await"
]);
var ZERO = Object.freeze({ curly: 0, paren: 0, square: 0 });
var WORD_START = /[A-Za-z_$]/;
var WORD_CHAR = /[\w$]/;
var JSX_NAME = /^[A-Za-z_$][\w$.:-]*/;
function extensionOf(ext) {
  const dot = ext.lastIndexOf(".");
  return (dot >= 0 ? ext.slice(dot + 1) : ext).toLowerCase();
}
function bracketBalance(text, options = {}) {
  const jsx = options.jsx === true;
  const out = { curly: 0, paren: 0, square: 0 };
  const n = text.length;
  let i = 0;
  let expr = true;
  const skipQuoted = (quote, multiline) => {
    i += 1;
    while (i < n && text[i] !== quote && (multiline || text[i] !== "\n")) i += !multiline && text[i] === "\\" ? 2 : 1;
    i += 1;
  };
  const tryRegex = () => {
    let j = i + 1;
    let inClass = false;
    while (j < n) {
      const c = text[j];
      if (c === "\n") return false;
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        j += 1;
        while (j < n && /[a-z]/i.test(text[j])) j += 1;
        i = j;
        return true;
      }
      j += 1;
    }
    return false;
  };
  const container = () => {
    out.curly += 1;
    i += 1;
    code(true);
    if (text[i] === "}") {
      out.curly -= 1;
      i += 1;
    }
  };
  const skipSpace = () => {
    while (i < n && /\s/.test(text[i])) i += 1;
  };
  const jsxChildren = () => {
    while (i < n) {
      const c = text[i];
      if (c === "{") {
        container();
        continue;
      }
      if (c === "<") {
        if (text[i + 1] === "/") {
          const end = text.indexOf(">", i);
          i = end < 0 ? n : end + 1;
          return;
        }
        if (tryJsxElement()) continue;
      }
      i += 1;
    }
  };
  const tryJsxElement = () => {
    const start = i;
    i += 1;
    if (text[i] === ">") {
      i += 1;
      jsxChildren();
      return true;
    }
    const name = JSX_NAME.exec(text.slice(i, i + 200));
    if (!name) {
      i = start;
      return false;
    }
    i += name[0].length;
    let first = true;
    while (i < n) {
      skipSpace();
      if (i >= n) return true;
      const c = text[i];
      if (c === "/" && text[i + 1] === ">") {
        i += 2;
        return true;
      }
      if (c === ">") {
        i += 1;
        jsxChildren();
        return true;
      }
      if (c === "{") {
        container();
        first = false;
        continue;
      }
      const attr = JSX_NAME.exec(text.slice(i, i + 200));
      if (!attr || first && attr[0] === "extends") {
        i = start;
        return false;
      }
      first = false;
      i += attr[0].length;
      skipSpace();
      if (text[i] !== "=") continue;
      i += 1;
      skipSpace();
      if (text[i] === '"' || text[i] === "'") skipQuoted(text[i], true);
      else if (text[i] === "{") container();
    }
    return true;
  };
  function code(nested) {
    let depth = 0;
    while (i < n) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === "\n") {
        expr = true;
        i += 1;
        continue;
      }
      if (/\s/.test(ch)) {
        i += 1;
        continue;
      }
      if (ch === "/" && next === "/") {
        const end = text.indexOf("\n", i);
        i = end < 0 ? n : end;
        continue;
      }
      if (ch === "/" && next === "*") {
        const end = text.indexOf("*/", i + 2);
        i = end < 0 ? n : end + 2;
        continue;
      }
      if (ch === "/" && expr && tryRegex()) {
        expr = false;
        continue;
      }
      if (ch === '"' || ch === "'") {
        skipQuoted(ch, false);
        expr = false;
        continue;
      }
      if (ch === "`") {
        i += 1;
        template();
        expr = false;
        continue;
      }
      if (ch === "<" && jsx && expr && tryJsxElement()) {
        expr = false;
        continue;
      }
      if (WORD_START.test(ch) || /\d/.test(ch)) {
        const start = i;
        while (i < n && WORD_CHAR.test(text[i])) i += 1;
        expr = EXPRESSION_KEYWORDS.has(text.slice(start, i));
        continue;
      }
      if (ch === "{") {
        out.curly += 1;
        depth += 1;
        expr = true;
      } else if (ch === "}") {
        if (nested && depth === 0) return;
        out.curly -= 1;
        if (depth > 0) depth -= 1;
        expr = true;
      } else if (ch === "(" || ch === "[") {
        out[ch === "(" ? "paren" : "square"] += 1;
        expr = true;
      } else if (ch === ")" || ch === "]") {
        out[ch === ")" ? "paren" : "square"] -= 1;
        expr = false;
      } else expr = ch !== ".";
      i += 1;
    }
  }
  function template() {
    while (i < n) {
      const ch = text[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "`") {
        i += 1;
        return;
      }
      if (ch === "$" && text[i + 1] === "{") {
        i += 2;
        expr = true;
        code(true);
        if (text[i] === "}") i += 1;
        continue;
      }
      i += 1;
    }
  }
  code(false);
  return out;
}
function bracketDelta(before, after, ext) {
  const e = extensionOf(ext);
  if (!LEXED_EXTENSIONS.has(e)) return { ...ZERO };
  const options = { jsx: JSX_EXTENSIONS.has(e) };
  const b = bracketBalance(before, options);
  const a = bracketBalance(after, options);
  return { curly: a.curly - b.curly, paren: a.paren - b.paren, square: a.square - b.square };
}
function changesBalance(delta) {
  return delta.curly !== 0 || delta.paren !== 0 || delta.square !== 0;
}
function describeBracketDelta(d, style = "name") {
  const glyph = { curly: "`{}`", paren: "`()`", square: "`[]`" };
  return ["curly", "paren", "square"].filter((k) => d[k] !== 0).map((k) => `${style === "glyph" ? glyph[k] : k} ${d[k] > 0 ? "+" : ""}${d[k]}`).join(style === "glyph" ? ", " : " \xB7 ");
}

// ../packages/agent-tools/src/jsonKeyRead.ts
var JSON_KEY_READ_MAX_CHARS = 12e3;
var MAX_LISTED_KEYS = 60;
function keysOf(value) {
  return value !== null && typeof value === "object" ? Object.keys(value) : [];
}
function readJsonKey(text, key) {
  let root;
  try {
    root = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, error: "the file is not valid JSON, so `key` cannot be used \u2014 read it by line window instead" };
  }
  const segments = key.split(".").filter((s) => s.length > 0);
  if (segments.length === 0) return { ok: false, error: '`key` is empty \u2014 name a dot path such as "admin.visitorFlow"' };
  let node = root;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const container = node !== null && typeof node === "object" ? node : null;
    if (!container || !Object.prototype.hasOwnProperty.call(container, segment)) {
      const at = segments.slice(0, i).join(".") || "(root)";
      return {
        ok: false,
        error: `key "${segments.slice(0, i + 1).join(".")}" not found \u2014 ${at} has no "${segment}"`,
        availableKeys: keysOf(node).slice(0, MAX_LISTED_KEYS)
      };
    }
    node = container[segment];
  }
  const content = JSON.stringify(node, null, 2) ?? "null";
  if (content.length <= JSON_KEY_READ_MAX_CHARS) return { ok: true, key: segments.join("."), content };
  return { ok: true, key: segments.join("."), tooLarge: true, size: content.length, childKeys: keysOf(node).slice(0, MAX_LISTED_KEYS) };
}

// ../packages/agent-tools/src/glob.ts
function normalizeScopeDir(raw) {
  return (raw ?? "").split("\\").join("/").trim().replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
}
function emptyGlobListingNote(glob, scopeDir, truncated) {
  const scope = normalizeScopeDir(scopeDir);
  const base = `No file matches glob "${glob}"${scope ? ` under "${scope}"` : ""}.`;
  if (truncated) {
    return `${base} This is NOT proof the file does not exist: the search was cut off before the tree was fully scanned, so this only means "not among the paths scanned so far". Narrow \`path\` to a smaller folder and re-run, or use \`search_code\`/\`find_symbol\` for a specific name, before concluding anything is missing.`;
  }
  return `${base} Try a broader pattern (e.g. "*${glob.replace(/[*?/]/g, "")}*"), or list_files without a glob to see the tree. 0 matches means no such file exists in the paths scanned \u2014 do not claim one is missing without trying a broader glob first.`;
}

// ../packages/agent-tools/src/tool.ts
function defineTool(def) {
  return {
    name: def.name,
    requires: def.requires ?? [],
    schema: {
      type: "function",
      function: { name: def.name, description: def.description, parameters: def.parameters }
    },
    execute: def.execute
  };
}

// ../packages/agent-tools/src/tool-side-effect.ts
var CONTROL_TOOL_NAMES = ["finish", "ask_human", "ask_user"];

// ../packages/agent-tools/src/gate-lowering.ts
var CONTROL = new Set(CONTROL_TOOL_NAMES);

// ../packages/agent-tools/src/fileWindow.ts
var READ_DEFAULT_LINE_LIMIT = 2e3;
function windowFileContent(content, opts) {
  const lines = content.split("\n");
  const totalLines = lines.length;
  const start = opts?.offset && opts.offset > 1 ? Math.min(Math.floor(opts.offset), totalLines + 1) : 1;
  const limit = opts?.limit && opts.limit > 0 ? Math.floor(opts.limit) : READ_DEFAULT_LINE_LIMIT;
  const slice = lines.slice(start - 1, start - 1 + limit);
  const end = start - 1 + slice.length;
  return { content: slice.join("\n"), truncated: end < totalLines, totalLines, offset: start, returnedLines: slice.length };
}
function fileWindowNote(win) {
  if (!win.truncated) return void 0;
  const lastLine = win.offset + win.returnedLines - 1;
  return `Showing lines ${win.offset}\u2013${lastLine} of ${win.totalLines}. To continue, call read_file again with offset ${lastLine + 1}.`;
}

// ../packages/agent-tools/src/preSearch.ts
var DEFAULTS = {
  maxIdentifiers: 6,
  definitionsPerIdentifier: 3,
  referencesPerIdentifier: 4,
  maxChars: 3e3
};
var TOKEN = /[A-Za-z_$][\w$]*/g;
var REFERENCE_TEXT_MAX = 140;
function looksLikeIdentifier(word) {
  if (word.length < 3) return false;
  if (/^_+$/.test(word)) return false;
  if (word.includes("_") || word.includes("$")) return true;
  if (/[a-z][A-Z]/.test(word)) return true;
  if (/[0-9][A-Z]/.test(word) && /[a-z]/.test(word)) return true;
  if (/^[A-Z][A-Z0-9]*\d$/.test(word)) return true;
  return false;
}
function extractIdentifiers(request, max = DEFAULTS.maxIdentifiers) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (word) => {
    if (!word || seen.has(word) || out.length >= max) return;
    seen.add(word);
    out.push(word);
  };
  const text = request ?? "";
  for (const span of text.matchAll(/`([^`\n]{1,120})`/g)) {
    const words = span[1].match(TOKEN) ?? [];
    const last = words[words.length - 1];
    if (last && last.length >= 2) add(last);
  }
  for (const m of text.matchAll(/([A-Za-z_$][\w$]*)(\s*\()?/g)) {
    const word = m[1];
    const after = text.charAt((m.index ?? 0) + word.length);
    if (after === "." && /[A-Za-z]/.test(text.charAt((m.index ?? 0) + word.length + 1)) && !looksLikeIdentifier(word)) continue;
    if (m[2] && word.length >= 3 && /[a-z]/.test(word)) add(word);
    else if (looksLikeIdentifier(word)) add(word);
  }
  return out;
}
function escapeRegex(identifier) {
  return identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clip(s, n) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}\u2026` : t;
}
function renderPreSearchBlock(r, maxChars = DEFAULTS.maxChars) {
  if (r.definitions.length === 0 && r.references.length === 0) return "";
  const lines = [
    "## Pre-search (symbol index + text search, gathered before this run with no model call)",
    `Identifiers in the request: ${r.identifiers.map((i) => `\`${i}\``).join(", ")}`
  ];
  for (const id of r.identifiers) {
    for (const d of r.definitions.filter((x) => x.identifier === id)) {
      lines.push(`- \`${id}\` defined at ${d.path}:${d.line} (${d.kind}${d.exported ? ", exported" : ""})`);
    }
    for (const ref of r.references.filter((x) => x.identifier === id)) {
      lines.push(`- \`${id}\` at ${ref.path}:${ref.line} \u2014 ${clip(ref.text, REFERENCE_TEXT_MAX)}`);
    }
  }
  lines.push("Start from these locations (read_file with a line range) instead of searching for them again.");
  let out = lines.join("\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars).replace(/\n[^\n]*$/, "")}
- \u2026`;
  return out;
}
async function preSearch(request, ports, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const { signal } = options;
  const identifiers = extractIdentifiers(request, o.maxIdentifiers);
  const empty = { identifiers, definitions: [], references: [], block: "" };
  if (identifiers.length === 0 || signal?.aborted) return empty;
  const perId = await Promise.all(identifiers.map(async (identifier) => {
    const [defs, refs] = await Promise.all([
      ports.findSymbol ? ports.findSymbol(identifier).catch(() => ({ ok: false })) : Promise.resolve({ ok: false }),
      ports.searchText ? ports.searchText(escapeRegex(identifier), signal).catch(() => ({ ok: false })) : Promise.resolve({ ok: false })
    ]);
    const exact = (defs.ok ? defs.matches ?? [] : []).filter((m) => m.name === identifier && m.kind !== "heading");
    const definitions2 = exact.slice(0, o.definitionsPerIdentifier).map((m) => ({
      identifier,
      path: m.path,
      line: m.line,
      kind: m.kind,
      exported: m.exported
    }));
    const defined = new Set(definitions2.map((d) => `${d.path}:${d.line}`));
    const references2 = [];
    for (const m of refs.ok ? refs.matches ?? [] : []) {
      if (references2.length >= o.referencesPerIdentifier) break;
      const line = typeof m.line === "number" ? m.line : Number(m.line);
      if (!Number.isFinite(line) || defined.has(`${m.path}:${line}`)) continue;
      references2.push({ identifier, path: m.path, line, text: typeof m.text === "string" ? m.text : "" });
    }
    return { definitions: definitions2, references: references2 };
  }));
  const definitions = perId.flatMap((p) => p.definitions);
  const references = perId.flatMap((p) => p.references);
  const result = { identifiers, definitions, references };
  return { ...result, block: renderPreSearchBlock(result, o.maxChars) };
}
function preSearchFiles(r, max = 6) {
  const out = [];
  for (const p of [...r.definitions.map((d) => d.path), ...r.references.map((x) => x.path)]) {
    if (!out.includes(p)) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

// ../packages/agent-tools/src/knowledge/codeMask.ts
var SPACES = " ".repeat(256);

// ../packages/agent-tools/src/callScan.ts
var ID = "[A-Za-z_$][\\w$]*";
var MAX_SCANNED_LINE = 2048;
var JSX_TAG = new RegExp(`<(\\/?)([A-Z][\\w$]*(?:\\.${ID})*)(?=[\\s/>]|$)`, "g");

// ../packages/agent-tools/src/testPaths.ts
var TEST_SOURCE_PATH = /(?:^|\/)(?:__tests__|tests?|spec|e2e)\/|(?:^|\/)(?:test|spec)\.[^/]+$|\.(?:test|spec|e2e|e2e-spec)\.[^/]+$/i;
function isTestSourcePath(path2) {
  return TEST_SOURCE_PATH.test(path2.replace(/\\/g, "/"));
}

// ../packages/agent-tools/src/callbackOwners.ts
var MAX_OWNER_LITERAL = 80;
var STATEMENT = new RegExp(`^([ \\t]*)(${ID}(?:\\??\\.${ID})*)\\s*\\(`);
var CALLBACK_AT_END = new RegExp(`(?:\\([^()]*\\)(?:\\s*:\\s*[^=()]+)?\\s*=>|\\b${ID}\\s*=>|\\bfunction\\b[^(]*\\([^()]*\\))\\s*\\{\\s*$`);
var TOP_BLOCK = /^(?:if\s*\(.*\)|\}?\s*else(?:\s+if\s*\(.*\))?|try|\}?\s*finally|\{)\s*\{\s*$/;
var NOT_OWNERS = /* @__PURE__ */ new Set([
  "describe",
  "it",
  "test",
  "suite",
  "bench",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "requestAnimationFrame",
  "void",
  "await",
  "return",
  "new",
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "with",
  "do",
  "else",
  "try",
  "typeof",
  "yield"
]);
function owningOpen(line, at) {
  const open = [];
  for (let i = 0; i < at; i += 1) {
    const c = line[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i += 1; i < at && line[i] !== c; i += 1) if (line[i] === "\\") i += 1;
    } else if (c === "(") open.push(i);
    else if (c === ")") open.pop();
  }
  return open.length ? open[open.length - 1] : -1;
}
function callbackOwnerName(line) {
  if (line.length > MAX_SCANNED_LINE) return void 0;
  const st = STATEMENT.exec(line);
  const cb = st ? CALLBACK_AT_END.exec(line) : null;
  if (!st || !cb) return void 0;
  const lead = st[2].replace(/\?/g, "");
  const root = lead.split(".")[0];
  if (NOT_OWNERS.has(root)) return void 0;
  let open = owningOpen(line, cb.index);
  if (open < 0) return void 0;
  const before = line.slice(0, open).trimEnd();
  const member = /(?:^|[^\w$])([A-Za-z_$][\w$]*)$/.exec(before)?.[1];
  let callee;
  if (open === st[0].length - 1) callee = lead;
  else if (member && /\)\s*\.\s*$/.test(before.slice(0, before.length - member.length))) callee = `${root}.${member}`;
  else {
    callee = lead;
    open = st[0].length - 1;
  }
  if (member && NOT_OWNERS.has(member) && callee !== lead) return void 0;
  const first = /^\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/.exec(line.slice(open + 1));
  const literal = first && !first[2].includes("${") ? first[2].slice(0, MAX_OWNER_LITERAL) : void 0;
  return literal !== void 0 ? `${callee} "${literal}"` : callee;
}
var CallbackOwnerScan = class {
  enabled;
  /** The indent of the first-level statements of a column-0 non-declaration block ("" before its first one is seen). */
  topBlock;
  /** The indent of the owner whose body we are in, until a line at that indent closes it. */
  inside;
  named = /* @__PURE__ */ new Map();
  constructor(path2) {
    this.enabled = !isTestSourcePath(path2);
  }
  /** True while the line is inside an owner's body (no definition is read there). Call for EVERY line, in order. */
  inBody(line) {
    if (this.inside === void 0) return false;
    const rest = line.startsWith(this.inside) ? line.slice(this.inside.length) : void 0;
    if (rest !== void 0 && /^[})]/.test(rest)) {
      this.inside = void 0;
      return true;
    }
    if (!/^\S/.test(line) || /^[})\]`]/.test(line)) return true;
    this.inside = void 0;
    return false;
  }
  /** Tracks the column-0 blocks; call for every line outside an owner's body, before the definitions are read. */
  track(line) {
    if (/^\S/.test(line)) this.topBlock = TOP_BLOCK.test(line) ? "" : void 0;
    else if (this.topBlock === "" && line.trim()) this.topBlock = /^[ \t]*/.exec(line)[0];
  }
  /** The owner a line outside any class declares, if any. */
  ownerAt(line, lineNo) {
    if (!this.enabled) return void 0;
    const indent = /^[ \t]*/.exec(line)[0];
    if (indent !== "" && indent !== this.topBlock) return void 0;
    const base = callbackOwnerName(line);
    if (!base) return void 0;
    const n = (this.named.get(base) ?? 0) + 1;
    this.named.set(base, n);
    this.inside = indent;
    return { name: n === 1 ? base : `${base} #${n}`, kind: "function", line: lineNo, exported: false, callback: true };
  }
};

// ../packages/agent-tools/src/symbols.ts
var SYMBOL_KINDS = [
  "function",
  "method",
  "class",
  "interface",
  "type",
  "enum",
  "const",
  "struct",
  "trait",
  "module",
  "table",
  "heading"
];
var MAX_SYMBOLS_PER_FILE = 400;
var LANGUAGE_BY_EXT = {
  ts: "js",
  tsx: "js",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  mts: "js",
  cts: "js",
  py: "python",
  go: "go",
  rs: "rust",
  java: "oo",
  kt: "oo",
  kts: "oo",
  cs: "oo",
  swift: "oo",
  php: "oo",
  scala: "oo",
  rb: "ruby",
  sql: "sql",
  md: "markdown",
  mdx: "markdown"
};
function extensionOf2(path2) {
  const base = path2.slice(path2.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}
function languageOf(path2) {
  return LANGUAGE_BY_EXT[extensionOf2(path2.replace(/\\/g, "/"))];
}
function group(m, n) {
  return m[n] ?? "";
}
var symbolCap = MAX_SYMBOLS_PER_FILE;
function eachLine(lines, out, visit) {
  for (let i = 0; i < lines.length && out.length < symbolCap; i += 1) {
    visit(lines[i] ?? "", i + 1);
  }
}
var ID2 = "[A-Za-z_$][\\w$]*";
var JS_RULES = [
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${ID2})`), kind: "function" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+(${ID2})`), kind: "class" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?interface\\s+(${ID2})`), kind: "interface" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?type\\s+(${ID2})\\s*[<=]`), kind: "type" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:const\\s+)?enum\\s+(${ID2})`), kind: "enum" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+(${ID2})`), kind: "const" },
  // `namespace A.B {`, `declare module "x" {` — the module's name, its quotes dropped.
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:namespace|module)\\s+(${ID2}(?:\\.${ID2})*|"[^"]+"|'[^']+')\\s*\\{`), kind: "module" }
];
var JS_METHOD = new RegExp(
  `^(?:\\t|  |    )(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set)\\s+)*\\*?\\s*(${ID2})\\s*(?:<[^>]*>)?\\s*\\(.*\\)?[^;]*\\{\\s*$`
);
var JS_ABSTRACT_METHOD = new RegExp(
  `^(?:\\t|  |    )(?:(?:public|private|protected|static|readonly|override)\\s+)*abstract\\s+(?:(?:public|private|protected|static|readonly|override|async)\\s+)*(${ID2})\\s*\\??\\s*(?:<[^>]*>)?\\s*\\(`
);
var JS_METHOD_OPEN = new RegExp(
  `^(?:\\t|  |    )(?:(?:public|private|protected|static|readonly|override|async|get|set)\\s+)*\\*?\\s*(${ID2})\\s*(?:<[^>]*>)?\\s*\\(\\s*$`
);
var JS_SIGNATURE_CLOSE = /^\s*\)\s*(?::[^;=]*)?\{\s*$/;
var MAX_SIGNATURE_LINES = 40;
var JS_KEYWORDS = /* @__PURE__ */ new Set(["if", "for", "while", "switch", "catch", "return", "function", "with", "do", "else", "try"]);
function closesWithBody(lines, at) {
  for (let i = at + 1; i < Math.min(lines.length, at + MAX_SIGNATURE_LINES); i += 1) {
    const line = lines[i] ?? "";
    if (/^\s*\)/.test(line)) return JS_SIGNATURE_CLOSE.test(line);
  }
  return false;
}
function extractJs(lines, out, path2 = "") {
  let cls;
  const owners = new CallbackOwnerScan(path2);
  eachLine(lines, out, (line, lineNo) => {
    if (/^\}/.test(line)) cls = void 0;
    if (owners.inBody(line)) return;
    owners.track(line);
    for (const rule of JS_RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      const exported = !!m[1];
      if (!exported && /^\s/.test(line)) continue;
      const name2 = group(m, 2).replace(/^["']|["']$/g, "");
      out.push({ name: name2, kind: rule.kind, line: lineNo, exported });
      if (rule.kind === "class") cls = name2;
      return;
    }
    if (cls === void 0) {
      const owner = owners.ownerAt(line, lineNo);
      if (owner) out.push(owner);
      return;
    }
    const open = JS_METHOD_OPEN.exec(line);
    const method = JS_METHOD.exec(line) ?? JS_ABSTRACT_METHOD.exec(line) ?? (open && closesWithBody(lines, lineNo - 1) ? open : null);
    const name = method ? group(method, 1) : "";
    if (name && !JS_KEYWORDS.has(name)) out.push({ name, kind: "method", line: lineNo, exported: false, container: cls });
  });
}
function extractPython(lines, out) {
  let cls;
  let memberIndent;
  eachLine(lines, out, (line, lineNo) => {
    const m = /^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(line);
    const indent = m ? group(m, 1) : /^(\s*)\S/.exec(line)?.[1] ?? "";
    if (indent === "" && /^[^\s@#)\]}]/.test(line) && !(m && group(m, 2) === "class")) {
      cls = void 0;
      memberIndent = void 0;
    }
    if (!m) return;
    const name = group(m, 3);
    if (group(m, 2) === "class") {
      if (indent === "") {
        cls = name;
        memberIndent = void 0;
        out.push({ name, kind: "class", line: lineNo, exported: !name.startsWith("_") });
        return;
      }
      if (cls !== void 0 && (memberIndent === void 0 || indent === memberIndent)) {
        memberIndent ??= indent;
        out.push({ name, kind: "class", line: lineNo, exported: !name.startsWith("_"), container: cls });
      }
      return;
    }
    if (indent === "") {
      out.push({ name, kind: "function", line: lineNo, exported: !name.startsWith("_") });
      return;
    }
    if (cls === void 0) return;
    memberIndent ??= indent;
    if (indent === memberIndent) out.push({ name, kind: "method", line: lineNo, exported: !name.startsWith("_"), container: cls });
  });
}
var goReceiver = (receiver) => /\(\s*(?:[A-Za-z_]\w*\s+)?\*?\s*([A-Za-z_]\w*)/.exec(receiver)?.[1];
function extractGo(lines, out) {
  eachLine(lines, out, (line, lineNo) => {
    const fn = /^func\s+(\([^)]*\)\s*)?([A-Za-z_]\w*)/.exec(line);
    if (fn) {
      const name2 = group(fn, 2);
      const container = fn[1] ? goReceiver(fn[1]) : void 0;
      out.push({ name: name2, kind: fn[1] ? "method" : "function", line: lineNo, exported: /^[A-Z]/.test(name2), ...container ? { container } : {} });
      return;
    }
    const ty = /^type\s+([A-Za-z_]\w*)\s+(struct|interface)?/.exec(line);
    if (!ty) return;
    const name = group(ty, 1);
    const word = group(ty, 2);
    const kind = word === "struct" ? "struct" : word === "interface" ? "interface" : "type";
    out.push({ name, kind, line: lineNo, exported: /^[A-Z]/.test(name) });
  });
}
function rustImplTarget(line) {
  const m = /^\s*(?:unsafe\s+)?impl\b(?:\s*<[^>]*>)?\s+([^{]*)/.exec(line);
  if (!m) return void 0;
  const text = group(m, 1).replace(/\bwhere\b.*$/, "");
  const target = text.includes(" for ") ? text.slice(text.indexOf(" for ") + 5) : text;
  return /(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*)/.exec(target.replace(/^[\s&]+(?:mut\s+|dyn\s+)?/, ""))?.[1];
}
function extractRust(lines, out) {
  let block;
  eachLine(lines, out, (line, lineNo) => {
    if (/^\}/.test(line)) block = void 0;
    const target = rustImplTarget(line);
    if (target) {
      block = target;
      return;
    }
    const m = /^(\s*)(pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const|extern(?:\s+"[^"]*")?)\s+)*(fn|struct|enum|trait|mod|type)\s+([A-Za-z_]\w*)/.exec(line);
    if (!m) return;
    const word = group(m, 3);
    const indented = group(m, 1).length > 0;
    const kind = word === "fn" ? indented ? "method" : "function" : word === "mod" ? "module" : word;
    const name = group(m, 4);
    const container = kind === "method" ? block : void 0;
    out.push({ name, kind, line: lineNo, exported: !!m[2], ...container ? { container } : {} });
    if (word === "trait" && !indented) block = name;
  });
}
var OO_TYPE = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|export|inline|value)\s+)*(class|interface|enum|record|object|struct|protocol|trait)\s+([A-Za-z_]\w*)/;
var OO_FUNC = /^\s*(?:(?:public|private|protected|internal|static|final|override|open|suspend|inline|abstract)\s+)*(?:fun|func|function)\s+([A-Za-z_]\w*)/;
function extractOo(lines, out) {
  eachLine(lines, out, (line, lineNo) => {
    const exported = !/\bprivate\b/.test(line);
    const ty = OO_TYPE.exec(line);
    if (ty) {
      const word = group(ty, 1);
      const kind = word === "interface" || word === "protocol" ? "interface" : word === "enum" ? "enum" : word === "struct" ? "struct" : word === "trait" ? "trait" : "class";
      out.push({ name: group(ty, 2), kind, line: lineNo, exported });
      return;
    }
    const fn = OO_FUNC.exec(line);
    if (fn) out.push({ name: group(fn, 1), kind: /^\s/.test(line) ? "method" : "function", line: lineNo, exported });
  });
}
function extractRuby(lines, out) {
  eachLine(lines, out, (line, lineNo) => {
    const ty = /^\s*(class|module)\s+([A-Z]\w*(?:::\w+)*)/.exec(line);
    if (ty) {
      out.push({ name: group(ty, 2), kind: group(ty, 1) === "module" ? "module" : "class", line: lineNo, exported: true });
      return;
    }
    const fn = /^(\s*)def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/.exec(line);
    if (fn) out.push({ name: group(fn, 2), kind: group(fn, 1).length > 0 ? "method" : "function", line: lineNo, exported: true });
  });
}
var SQL_CREATE = /^\s*create\s+(?:or\s+replace\s+)?(?:unique\s+)?(table|view|materialized\s+view|function|procedure|index|type|trigger)\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([\w."]+)/i;
function extractSql(lines, out) {
  eachLine(lines, out, (line, lineNo) => {
    const m = SQL_CREATE.exec(line);
    if (!m) return;
    const word = group(m, 1).toLowerCase();
    const kind = word === "function" || word === "procedure" || word === "trigger" ? "function" : word === "index" || word === "type" ? "type" : "table";
    out.push({ name: group(m, 2).replace(/"/g, ""), kind, line: lineNo, exported: true });
  });
}
function extractMarkdown(lines, out) {
  let fenced2 = false;
  eachLine(lines, out, (line, lineNo) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced2 = !fenced2;
      return;
    }
    if (fenced2) return;
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ name: `${group(m, 1)} ${group(m, 2).slice(0, 120)}`, kind: "heading", line: lineNo, exported: true });
  });
}
var EXTRACTORS = {
  js: extractJs,
  python: extractPython,
  go: extractGo,
  rust: extractRust,
  oo: extractOo,
  ruby: extractRuby,
  sql: extractSql,
  markdown: extractMarkdown
};
function extractSymbols(path2, content, cap = MAX_SYMBOLS_PER_FILE) {
  const language = languageOf(path2);
  if (!language) return [];
  const out = [];
  const outer = symbolCap;
  symbolCap = cap;
  try {
    EXTRACTORS[language](content.split(/\r?\n/), out, path2.replace(/\\/g, "/"));
  } finally {
    symbolCap = outer;
  }
  return out;
}
function formatSymbol(symbol) {
  return `L${symbol.line} ${symbol.kind} ${symbol.name}${symbol.exported && symbol.kind !== "heading" ? " (export)" : ""}`;
}

// ../packages/agent-tools/src/symbol-tools.ts
var FIND_DEFAULT_LIMIT = 20;
var FIND_MAX_LIMIT = 50;
var OUTLINE_MAX_ENTRIES = 150;
function asKind(v) {
  return typeof v === "string" && SYMBOL_KINDS.includes(v) ? v : void 0;
}
var findSymbolTool = defineTool({
  name: "find_symbol",
  description: "Find where a function, class, method, type, constant, SQL table or Markdown heading is DEFINED, from the workspace's symbol index \u2014 one instant call instead of search_code plus reading files to tell the definition from its call sites. Pass `query` as the symbol name or part of it (case-insensitive; exact matches rank first). Each match is `path:line kind name`; then read_file with `offset` a few lines above that line and a small `limit`. Narrow with `path` (a subdirectory) or `kind`. For USAGES, string literals or config values (not definitions), use search_code instead.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: 'Symbol name or a distinctive part of it, e.g. "buildGitCommand" or "GitCommand".' },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict to, e.g. "api/src".' },
      kind: { type: "string", enum: [...SYMBOL_KINDS], description: "Optional: only this kind of definition." },
      limit: { type: "number", description: `Max matches (default ${FIND_DEFAULT_LIMIT}, max ${FIND_MAX_LIMIT}).` }
    },
    required: ["query"]
  },
  requires: ["repo.symbols"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return { data: { ok: false, error: "query is required" } };
    const scope = typeof args.path === "string" && args.path.trim() ? args.path.trim() : void 0;
    const kind = asKind(args.kind);
    const requested = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.floor(args.limit) : FIND_DEFAULT_LIMIT;
    const limit = Math.min(FIND_MAX_LIMIT, Math.max(1, requested));
    const r = await ctx.caps.symbols.find(query, { scope, kind, limit });
    if (!r.ok) return { data: r };
    const data = {
      ok: true,
      query,
      total: r.total ?? 0,
      truncated: r.truncated === true,
      matches: (r.matches ?? []).map((m) => `${m.path}:${m.line} ${m.kind} ${m.name}${m.exported && m.kind !== "heading" ? " (export)" : ""}`),
      indexedFiles: r.indexedFiles
    };
    if ((r.total ?? 0) === 0) {
      data.note = r.partialIndex ? `No definition named like "${query}" in the indexed files \u2014 but the index is PARTIAL (file cap reached), so this is not proof it does not exist. Try search_code${scope ? "" : " with a `path`"}.` : `No definition named like "${query}"${scope ? ` under "${scope}"` : ""}. It may be defined in a form the index does not recognise (a re-export, an object property, a generated file) \u2014 use search_code for the exact text.`;
    } else if (r.truncated) {
      data.note = `Showing ${r.matches?.length ?? 0} of ${r.total} matches \u2014 pass a longer \`query\`, a \`path\` or a \`kind\` to narrow.`;
    }
    return { data };
  }
});
var fileOutlineTool = defineTool({
  name: "file_outline",
  description: "List what a file DEFINES \u2014 functions, classes, methods, types, constants, or a Markdown file's headings \u2014 each with its line number, without reading the file's contents. Call this BEFORE paging through a large file: find the symbol you need, then read_file with `offset` at its line and a small `limit`, instead of reading 2,000-line windows until you reach it. Pass `kind` to list only one kind of definition.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative file path, e.g. "api/src/service.ts".' },
      kind: { type: "string", enum: [...SYMBOL_KINDS], description: "Optional: only this kind of definition." }
    },
    required: ["path"]
  },
  requires: ["repo.read", "repo.symbols"],
  async execute(args, ctx) {
    const path2 = typeof args.path === "string" ? args.path.trim() : "";
    if (!path2) return { data: { ok: false, error: "path is required" } };
    const kind = asKind(args.kind);
    const file = await ctx.caps.repoRead.readFile(path2);
    if (!file.ok) return { data: file };
    const content = file.content ?? "";
    const all = extractSymbols(path2, content).filter((s) => !kind || s.kind === kind);
    const shown = all.slice(0, OUTLINE_MAX_ENTRIES);
    const data = {
      ok: true,
      path: file.path ?? path2,
      totalLines: content.split("\n").length,
      total: all.length,
      symbols: shown.map(formatSymbol)
    };
    if (all.length === 0) {
      data.note = kind ? `No ${kind} definitions found in ${path2}.` : `No definitions recognised in ${path2} (unsupported language, or a data/config file) \u2014 read_file it directly.`;
    } else if (all.length > shown.length) {
      const lastLine = shown.at(-1)?.line ?? 0;
      data.note = `Showing the first ${shown.length} of ${all.length} definitions (through line ${lastLine}). Pass \`kind\` to list one kind, or find_symbol for a specific name.`;
    }
    return { data };
  }
});
function markdownOutline(path2, content) {
  return extractSymbols(path2, content).filter((s) => s.kind === "heading").slice(0, OUTLINE_MAX_ENTRIES).map((s) => ({ heading: s.name, line: s.line }));
}
var SYMBOL_TOOLS = [findSymbolTool, fileOutlineTool];

// ../packages/agent-tools/src/fileRead.ts
var OUTLINE_FIRST_MIN_CHARS = 16e3;
var OUTLINE_FIRST_MIN_LINES = 300;
var OUTLINE_FIRST_PREFIX_LINES = 40;
function outlineFirstApplies(content, leverOn) {
  if (leverOn !== true) return false;
  const lines = content.split("\n").length;
  return content.length >= OUTLINE_FIRST_MIN_CHARS || lines >= OUTLINE_FIRST_MIN_LINES;
}
var READ_FILE_MAX_PATHS = 8;
var MARKDOWN_OUTLINE_MIN_CHARS = 16e3;
function readFileKey(path2, file, key) {
  if (file.truncated === true) {
    return { ok: false, path: path2, key, error: "the file is too large to load whole, so `key` cannot be used \u2014 page it with offset/limit" };
  }
  const read = readJsonKey(file.content ?? "", key);
  if (!read.ok) return { path: path2, key, ...read };
  if ("tooLarge" in read) {
    return {
      ok: true,
      path: path2,
      key: read.key,
      childKeys: read.childKeys,
      note: `"${read.key}" is ${read.size} characters \u2014 too large to return whole. Read one of its childKeys, e.g. key "${read.key}.${read.childKeys[0] ?? "\u2026"}".`
    };
  }
  return { ok: true, path: path2, key: read.key, content: read.content };
}
var isMarkdown = (path2) => /\.mdx?$/i.test(path2);
async function readOneFile(path2, opts, caps, leverOn) {
  const r = await caps.repoRead.readFile(path2);
  if (!r.ok) return r;
  if (opts.key) return readFileKey(r.path ?? path2, r, opts.key);
  const content = r.content ?? "";
  if (opts.offset === void 0 && opts.limit === void 0 && outlineFirstApplies(content, leverOn) && r.truncated !== true) {
    const symbols = extractSymbols(path2, content).slice(0, 150).map((s) => `L${s.line} ${s.kind} ${s.name}${s.exported && s.kind !== "heading" ? " (export)" : ""}`);
    const head = windowFileContent(content, { offset: 1, limit: OUTLINE_FIRST_PREFIX_LINES });
    return {
      ok: true,
      path: r.path ?? path2,
      outline: symbols,
      totalLines: head.totalLines,
      content: head.content,
      truncated: true,
      offset: 1,
      note: (symbols.length > 0 ? `This file is larger than one read: \`outline\` lists its ${symbols.length} definitions with line numbers. ` : "This file is larger than one read. ") + `The first ${OUTLINE_FIRST_PREFIX_LINES} lines follow. To read a specific span, call read_file again with \`offset\` (1-based line) and a small \`limit\`.`
    };
  }
  const win = windowFileContent(content, { offset: opts.offset, limit: opts.limit });
  const data = {
    ok: true,
    path: r.path ?? path2,
    content: win.content,
    truncated: win.truncated || r.truncated === true,
    totalLines: win.totalLines,
    offset: win.offset
  };
  let note = fileWindowNote(win);
  if (opts.offset === void 0 && isMarkdown(data.path ?? path2) && (content.length > MARKDOWN_OUTLINE_MIN_CHARS || win.truncated)) {
    const outline = markdownOutline(data.path ?? path2, content);
    if (outline.length > 0) {
      data.outline = outline;
      const pointer = "This document is larger than one read: `outline` lists its headings with their line numbers \u2014 page by heading line with offset (and a small limit) instead of reading it window by window.";
      note = note ? `${note} ${pointer}` : pointer;
    }
  }
  if (note) data.note = note;
  return data;
}
async function readManyFiles(paths, opts, caps, leverOn) {
  return Promise.all(
    paths.map(
      (path2) => readOneFile(path2, opts, caps, leverOn).catch((err) => ({ ok: false, path: path2, error: err instanceof Error ? err.message : String(err) }))
    )
  );
}

// ../packages/agent-tools/src/compress.ts
var DEFAULT_COMPRESS_MIN_CHARS = 4e3;
var DEFAULT_COMPRESS_RATE = 0.5;
var FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
function fenceRun(line) {
  return FENCE_OPEN.exec(line)?.[1] ?? null;
}
function splitFences(text) {
  const out = [];
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let buf = "";
  let fence = null;
  const flush = (kind) => {
    if (buf) out.push({ kind, text: buf });
    buf = "";
  };
  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, "");
    if (!fence) {
      const run2 = fenceRun(bare);
      if (run2) {
        flush("prose");
        fence = { ch: run2.charAt(0), len: run2.length };
      }
      buf += line;
      continue;
    }
    buf += line;
    const run = fenceRun(bare);
    const open = fence;
    if (run && run.charAt(0) === open.ch && run.length >= open.len && [...bare.trim()].every((c) => c === open.ch)) {
      flush("fence");
      fence = null;
    }
  }
  flush(fence ? "fence" : "prose");
  return out;
}
async function compressLargeContext(text, opts = {}) {
  const minChars = opts.minChars ?? DEFAULT_COMPRESS_MIN_CHARS;
  const rate = opts.rate ?? DEFAULT_COMPRESS_RATE;
  const unchanged = { text, compressed: false, originalTokens: 0, keptTokens: 0 };
  if (!opts.compress || text.length < minChars || !(rate > 0 && rate < 1)) return unchanged;
  let compressed = false;
  let originalTokens = 0;
  let keptTokens = 0;
  const parts = [];
  for (const seg of splitFences(text)) {
    if (seg.kind === "fence" || seg.text.trim().length < minChars) {
      parts.push(seg.text);
      continue;
    }
    let r;
    try {
      r = await opts.compress(seg.text, rate);
    } catch {
      r = { ok: false };
    }
    if (r.ok && typeof r.text === "string" && r.text.length < seg.text.length) {
      parts.push(r.text);
      compressed = true;
      originalTokens += r.originalTokens ?? 0;
      keptTokens += r.keptTokens ?? 0;
    } else {
      parts.push(seg.text);
    }
  }
  return compressed ? { text: parts.join(""), compressed, originalTokens, keptTokens } : unchanged;
}
async function compressToolOutput(text, ctx, tool) {
  const semantic = ctx.caps.semantic;
  if (ctx.compressLargeOutputs !== true || !semantic?.compress) {
    return { text, compressed: false, originalTokens: 0, keptTokens: 0 };
  }
  const r = await compressLargeContext(text, { compress: (t, rate) => semantic.compress(t, rate) });
  if (r.compressed) {
    ctx.emit?.({ level: "debug", message: `${tool}: output compressed (C8)`, detail: { originalTokens: r.originalTokens, keptTokens: r.keptTokens } });
  }
  return r;
}
async function compressShellResult(r, ctx) {
  if (!r.ok || r.exitCode !== void 0 && r.exitCode !== 0 || typeof r.stdout !== "string") return r;
  const c = await compressToolOutput(r.stdout, ctx, "run_command");
  return c.compressed ? { ...r, stdout: c.text, compressed: true } : r;
}
async function compressWebFetchResult(r, ctx) {
  if (!r.ok || typeof r.content !== "string") return r;
  const c = await compressToolOutput(r.content, ctx, "web_fetch");
  return c.compressed ? { ...r, content: c.text, compressed: true } : r;
}

// ../packages/agent-tools/src/git-repo-scope.ts
function safeGitArg(v) {
  return typeof v === "string" && /^[\w./@-]+$/.test(v) && !v.startsWith("-") ? v : null;
}
function shellQuote(v) {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}
function safeRepoArg(repo) {
  const arg = safeGitArg(typeof repo === "string" ? repo.replace(/\\/g, "/") : repo);
  return arg && !arg.split("/").includes("..") && !arg.startsWith("/") ? arg : null;
}
function invalidRepoResult(action, repo) {
  if (typeof repo !== "string" || repo === "" || safeRepoArg(repo) !== null) return null;
  return { data: { ok: false, action, error: `repo '${repo}' must be a directory inside the workspace (no '..', not absolute), so nothing was run` } };
}
function inferRepoFromPath(path2) {
  if (typeof path2 !== "string" || !path2.trim()) return null;
  const parts = path2.split(/[\\/]/).filter((s) => s.length > 0 && s !== ".");
  if (parts.length < 2) return null;
  return safeRepoArg(parts[0]);
}
function buildListCheckoutsCommand() {
  return 'for d in */; do [ -e "$d.git" ] && printf "%s\\n" "${d%/}"; done';
}
function parseCheckoutList(stdout) {
  if (!stdout) return [];
  const names = [];
  for (const line of stdout.split(/\r?\n/)) {
    const name = line.trim().replace(/\/+$/, "");
    if (!name || name === "*" || name === "." || name === "..") continue;
    const safe = safeRepoArg(name);
    if (safe) names.push(safe);
  }
  return names;
}
function notARepoResult(action, candidates = []) {
  const named = candidates.filter(Boolean);
  const extra = named.length ? `Candidate repositories: ${named.map((c) => `"${c}"`).join(", ")}. Re-run this tool with \`repo\` set to the one holding the code you are working on (e.g. { "repo": "${named[0]}" }).` : "No git checkouts were found at the top level of the open folder. File edits still work; only the git tools need a repository.";
  return {
    data: {
      ok: false,
      action,
      error: "not a git repository at the workspace root \u2014 this usually means the open folder CONTAINS the repositories rather than being one (several checkouts side by side). " + extra,
      ...named.length ? { candidates: named } : {}
    }
  };
}
function shellRunWithStop(ctx, command, cwd) {
  const shell = ctx.caps.shell;
  const opts = { ...ctx.signal ? { signal: ctx.signal } : {}, ...cwd ? { cwd } : {} };
  return Object.keys(opts).length > 0 ? shell.run(command, opts) : shell.run(command);
}
function defaultRepoOf(ctx) {
  return safeRepoArg(ctx.caps.shell?.defaultRepo);
}
function pathInRepo(path2, repo) {
  if (!path2) return path2;
  const inner = commitPathCandidates(path2, repo);
  return inner.length > 0 ? inner[inner.length - 1] : void 0;
}
async function notARepoWithCandidates(action, ctx) {
  const listed = await shellRunWithStop(ctx, buildListCheckoutsCommand());
  return notARepoResult(action, parseCheckoutList(listed.stdout));
}
var NOT_A_REPO = /not a git repository/i;
function isNotARepo(r) {
  return NOT_A_REPO.test(`${r.stdout ?? ""} ${r.error ?? ""}`);
}
function commitPathCandidates(path2, repo) {
  const out = [path2];
  const dir = safeRepoArg(repo);
  if (dir) {
    const prefix = `${dir.replace(/\/+$/, "")}/`;
    if (path2.startsWith(prefix)) out.push(path2.slice(prefix.length));
    const leaf = dir.split("/").filter(Boolean).pop();
    if (leaf && path2.startsWith(`${leaf}/`)) out.push(path2.slice(leaf.length + 1));
  }
  return [...new Set(out)].filter((p) => p.trim() !== "");
}
var rootNotARepo = /* @__PURE__ */ new WeakSet();
function scopeAttempts(ctx, path2) {
  const fallback = defaultRepoOf(ctx);
  const shell = ctx.caps.shell;
  const attempts = [];
  if (!(fallback && shell && rootNotARepo.has(shell))) attempts.push({ path: path2 });
  const inferred = inferRepoFromPath(path2);
  if (inferred) attempts.push({ repo: inferred, path: pathInRepo(path2, inferred) });
  if (fallback && fallback !== inferred) attempts.push({ repo: fallback, path: pathInRepo(path2, fallback) });
  return attempts;
}
async function runInRepoScope(ctx, scope, run) {
  if (scope.repo) return { r: await run(scope.repo, scope.path), repo: scope.repo };
  for (const attempt of scopeAttempts(ctx, scope.path)) {
    const r = await run(attempt.repo, attempt.path);
    if (!isNotARepo(r)) return attempt.repo ? { r, repo: attempt.repo } : { r };
    if (!attempt.repo && ctx.caps.shell) rootNotARepo.add(ctx.caps.shell);
  }
  return null;
}

// ../packages/agent-tools/src/shell-command-shape.ts
function withoutQuoted(command) {
  return command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
}
function isChained(bare) {
  return /&&|\|\||;|\n/.test(bare);
}
function stages(bare) {
  return bare.split(/(?<!\|)\|(?!\|)/).map((s) => s.trim());
}
function verbOf(stage) {
  const word = /^[\w./-]+/.exec(stage.replace(/^(?:\w+=\S*\s+)+/, ""))?.[0] ?? "";
  return word.slice(word.lastIndexOf("/") + 1).toLowerCase().replace(/\.exe$/, "");
}
var SEARCH_VERBS = /* @__PURE__ */ new Set(["grep", "egrep", "fgrep", "rg", "findstr", "ag", "ack"]);
function isSearchStage(stage) {
  const verb = verbOf(stage);
  if (SEARCH_VERBS.has(verb)) return true;
  if (verb === "git") return /^\S+\s+(?:-\S+\s+)*grep\b/.test(stage.replace(/^(?:\w+=\S*\s+)+/, ""));
  return verb === "select-string" || verb === "sls";
}
function isSearchCommand(command) {
  const bare = withoutQuoted(command);
  if (isChained(bare)) return false;
  return isSearchStage(stages(bare).pop() ?? "");
}
var NO_OUTPUT = /^\s*(\(no output\))?\s*$/;
function searchNoMatch(command, result) {
  if (result.ok || result.exitCode !== 1 || result.aborted || result.error) return result;
  if (!NO_OUTPUT.test(result.stdout ?? "") || !isSearchCommand(command)) return result;
  const { exitCode: _exit, ...rest } = result;
  return { ...rest, ok: true, matches: 0, stdout: "(no matches \u2014 the search exited 1 with no output)" };
}

// ../packages/agent-tools/src/shell-pipe.ts
var TRAILING_TAIL = /\s*\|\s*(?:2>&1\s*\|\s*)?tail\s+(?:-\s*(?:n\s+)?)?(\d+)\s*$/;
function stripTailLimit(command) {
  const m = TRAILING_TAIL.exec(command);
  if (!m) return { command, stripped: false };
  const n = Number.parseInt(m[1] ?? "", 10);
  return { command: command.slice(0, m.index).trimEnd(), tail: Number.isFinite(n) ? n : void 0, stripped: true };
}

// ../packages/agent-tools/src/shell-output-filter.ts
var DEFAULT_WINDOW = 200;
var MAX_LINE_CHARS = 2e3;
function lineCount(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : void 0;
}
function matcher(grep, ignoreCase) {
  try {
    const re = new RegExp(grep, ignoreCase ? "i" : "");
    return (line) => re.test(line);
  } catch {
    const needle = ignoreCase ? grep.toLowerCase() : grep;
    return (line) => (ignoreCase ? line.toLowerCase() : line).includes(needle);
  }
}
function filterShellOutput(text, filter) {
  const all = text.split("\n");
  const numbered = all.map((line, i) => ({ n: i + 1, line }));
  const test = filter.grep ? matcher(filter.grep, filter.ignoreCase === true) : void 0;
  const matched = test ? numbered.filter((l) => test(l.line)) : numbered;
  let head = lineCount(filter.head);
  let tail = lineCount(filter.tail);
  if (head === void 0 && tail === void 0 && matched.length > DEFAULT_WINDOW) {
    head = DEFAULT_WINDOW / 2;
    tail = DEFAULT_WINDOW / 2;
  }
  let kept = matched;
  if (head !== void 0 || tail !== void 0) {
    const first = matched.slice(0, head ?? 0);
    const last = tail ? matched.slice(Math.max(first.length, matched.length - tail)) : [];
    kept = [...first, ...last];
  }
  const cut = (line) => line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}\u2026` : line;
  const output = kept.map((l) => test ? `${l.n}: ${cut(l.line)}` : cut(l.line)).join("\n");
  return { totalLines: all.length, matchedLines: matched.length, output, truncated: kept.length < matched.length };
}
var outputFilterTool = defineTool({
  name: "output_filter",
  description: "Filter the FULL output of a command you already ran \u2014 by the outputId run_command / command_status returned \u2014 with grep / head / tail. Nothing is re-run. Use this instead of running a command again to grep, head or tail its output.",
  parameters: {
    type: "object",
    properties: {
      outputId: { type: "string", description: "The outputId a run_command or command_status result returned." },
      grep: { type: "string", description: "Optional: keep only lines matching this regular expression (each kept line is prefixed with its line number)." },
      head: { type: "number", description: "Optional: keep the first N (matching) lines." },
      tail: { type: "number", description: "Optional: keep the last N (matching) lines." },
      ignoreCase: { type: "boolean", description: "Optional: case-insensitive grep." }
    },
    required: ["outputId"]
  },
  requires: ["shell.outputs"],
  async execute(args, ctx) {
    const outputId = typeof args.outputId === "string" ? args.outputId.trim() : "";
    if (!outputId) return { data: { ok: false, error: "outputId is required" } };
    const read = ctx.caps.shell?.output;
    if (!read) return { data: { ok: false, error: "retained command outputs are not available on this surface" } };
    const text = await read.call(ctx.caps.shell, outputId);
    if (text === void 0) {
      return { data: { ok: false, outputId, error: `no retained output "${outputId}" in this run (only the last commands are kept) \u2014 run the command again` } };
    }
    const filter = {
      ...typeof args.grep === "string" && args.grep ? { grep: args.grep } : {},
      ...lineCount(args.head) !== void 0 ? { head: lineCount(args.head) } : {},
      ...lineCount(args.tail) !== void 0 ? { tail: lineCount(args.tail) } : {},
      ...args.ignoreCase === true ? { ignoreCase: true } : {}
    };
    const r = filterShellOutput(text, filter);
    return { data: { ok: true, outputId, ...r, ...filter.grep ? { matches: r.matchedLines } : {} } };
  }
});

// ../packages/agent-tools/src/shell-tools.ts
var SHELL_WAIT_MAX_MS = 10 * 60 * 1e3;
function waitArg(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), SHELL_WAIT_MAX_MS) : void 0;
}
function cwdArg(v) {
  if (v == null || v === "") return void 0;
  if (typeof v !== "string") return null;
  const dir = v.trim().split("\\").join("/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (dir === "" || dir === ".") return ".";
  return safeRepoArg(dir);
}
function commandDir(command, cwd, defaultRepo) {
  if (cwd) return cwd === "." ? void 0 : cwd;
  if (/^\s*(cd|pushd)\s/i.test(command)) return void 0;
  return safeRepoArg(defaultRepo) ?? void 0;
}
var jobNote = (id) => `Running in the background (job ${id}). Keep working; check it with command_status { "id": "${id}" } (pass waitMs to wait for it), stop it with command_stop { "id": "${id}" }.`;
function finishedJob(st) {
  return {
    ok: st.status === "exited" && st.exitCode === 0,
    ...st.exitCode !== void 0 ? { exitCode: st.exitCode } : {},
    stdout: st.output ?? "",
    ...st.outputId ? { outputId: st.outputId } : {},
    ...st.status === "killed" ? { aborted: true, error: st.error ?? "the job was stopped" } : st.error ? { error: st.error } : {}
  };
}
function shapeResult(command, r) {
  return searchNoMatch(command, r);
}
async function runShellCommand(args, ctx) {
  const stripped = stripTailLimit(typeof args.command === "string" ? args.command : "");
  const command = stripped.command;
  const tailNote = stripped.stripped ? `ran without the trailing \`| tail -${stripped.tail}\` \u2014 the full output is retained under \`outputId\`; read its head with output_filter { outputId, head: \u2026 }. ` : "";
  if (!command.trim()) return { data: { ok: false, error: "command is required" } };
  const cwd = cwdArg(args.cwd);
  if (cwd === null) {
    return { data: { ok: false, error: "`cwd` must be a directory inside the workspace, relative to its root (no `..`, no absolute path)." } };
  }
  const shell = ctx.caps.shell;
  const dir = commandDir(command, cwd, shell.defaultRepo);
  const where = dir ? { cwd: dir } : {};
  const background = args.background === true;
  const yieldMs = waitArg(args.yieldMs);
  let note;
  if (background || yieldMs !== void 0) {
    if (shell.start && shell.poll) {
      if (ctx.signal?.aborted) return { data: { ok: false, aborted: true, error: "stopped before the command started", ...where } };
      const started = await (dir ? shell.start(command, { cwd: dir }) : shell.start(command));
      if (!started.ok || !started.id) return { data: { ok: false, error: started.error ?? "the background job did not start", ...where } };
      const id = started.id;
      if (background) return { data: { ok: true, background: true, id, status: "running", note: jobNote(id), ...where } };
      const st = await shell.poll(id, { waitMs: yieldMs, ...ctx.signal ? { signal: ctx.signal } : {} });
      if (st.status === "running") {
        const why = ctx.signal?.aborted ? "The wait was interrupted" : `Still running after ${yieldMs}ms`;
        return { data: { ok: true, background: true, id, status: "running", output: st.output ?? "", note: `${why}, so it moved to the background. ${jobNote(id)}`, ...where } };
      }
      const r2 = await compressShellResult(shapeResult(command, finishedJob(st)), ctx);
      return { data: { ...r2, ...st.status === "unknown" ? { id } : {}, ...where } };
    }
    note = "This surface has no background shell, so the command ran in the foreground.";
  }
  const ran = args.fresh === true ? await shell.run(command, { ...ctx.signal ? { signal: ctx.signal } : {}, ...where, fresh: true }) : await shellRunWithStop(ctx, command, dir);
  const r = await compressShellResult(shapeResult(command, ran), ctx);
  const notes = [tailNote, r.note, note].filter(Boolean).join(" ");
  return { data: { ...r, ...where, ...notes ? { note: notes } : {} } };
}
async function compressedJobStatus(st, ctx) {
  if (st.status === "running" || typeof st.output !== "string") return st;
  const r = await compressShellResult(finishedJob(st), ctx);
  return r.compressed && typeof r.stdout === "string" ? { ...st, output: r.stdout } : st;
}
function jobId(args) {
  return typeof args.id === "string" ? args.id.trim() : "";
}
var commandStatusTool = defineTool({
  name: "command_status",
  description: "Check a BACKGROUND command started by run_command (background:true, or one that outlived its yieldMs): whether it is still running, its exit code, and the tail of its output. Pass waitMs to wait up to that long for it to finish first. Use this instead of re-running a long command.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "The job id run_command returned." },
      waitMs: { type: "number", description: "Optional: wait up to this many milliseconds for the job to finish before answering (max 600000)." }
    },
    required: ["id"]
  },
  requires: ["shell.jobs"],
  async execute(args, ctx) {
    const id = jobId(args);
    if (!id) return { data: { ok: false, error: "id is required" } };
    const poll = ctx.caps.shell?.poll;
    if (!poll) return { data: { ok: false, error: "background commands are not available on this surface" } };
    const waitMs = waitArg(args.waitMs);
    const st = await poll.call(ctx.caps.shell, id, { ...waitMs !== void 0 ? { waitMs } : {}, ...ctx.signal ? { signal: ctx.signal } : {} });
    return { data: await compressedJobStatus(st, ctx) };
  }
});
var commandStopTool = defineTool({
  name: "command_stop",
  description: "Stop a BACKGROUND command started by run_command \u2014 it and every process it started are killed. Returns its final output tail.",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "The job id run_command returned." } },
    required: ["id"]
  },
  requires: ["shell.jobs"],
  async execute(args, ctx) {
    const id = jobId(args);
    if (!id) return { data: { ok: false, error: "id is required" } };
    const kill = ctx.caps.shell?.kill;
    if (!kill) return { data: { ok: false, error: "background commands are not available on this surface" } };
    const st = await kill.call(ctx.caps.shell, id);
    return { data: await compressedJobStatus(st, ctx) };
  }
});
var SHELL_JOB_TOOLS = [commandStatusTool, commandStopTool, outputFilterTool];

// ../packages/agent-tools/src/git-status.ts
var GIT_STATUS_COMMAND = "git status --short --branch";
var GIT_STATUS_MAX_PATHS = 20;
var MAX_ENTRIES = 200;
var PATH_MARK = "@@bf-path";
var PUSHED_MARK = "@@bf-pushed";
var LOG_FORMAT = "%H %an%x1f%ae%x1f%aI%x1f%s";
var US = "";
function statusPaths(paths) {
  const clean = (paths ?? []).filter((p) => typeof p === "string").map((p) => p.trim()).filter(Boolean);
  return [...new Set(clean)].slice(0, GIT_STATUS_MAX_PATHS);
}
function buildStatusCommand(paths, repo) {
  const wanted = statusPaths(paths);
  if (wanted.length === 0) return GIT_STATUS_COMMAND;
  const candidatesOf = (p) => commitPathCandidates(p, repo);
  const spec2 = [...new Set(wanted.flatMap(candidatesOf))].map(shellQuote).join(" ");
  const log = (p) => `"$(git --no-pager log -1 --format='${LOG_FORMAT}' -- ${shellQuote(p)} 2>/dev/null)"`;
  const lines = [`${GIT_STATUS_COMMAND} -- ${spec2} || exit $?`];
  wanted.forEach((p, i) => {
    const [first, ...rest] = candidatesOf(p);
    lines.push(`echo "${PATH_MARK} ${i}"`);
    lines.push(`L=${log(first ?? p)}`);
    for (const c of rest) lines.push(`[ -n "$L" ] || L=${log(c)}`);
    lines.push(
      `[ -z "$L" ] || { printf '%s\\n' "$L"; git merge-base --is-ancestor "\${L%% *}" '@{u}' 2>/dev/null && echo "${PUSHED_MARK} yes" || echo "${PUSHED_MARK} no"; }`
    );
  });
  return lines.join("\n");
}
function unquoteGitPath(s) {
  if (s.length < 2 || !s.startsWith('"') || !s.endsWith('"')) return s;
  const body = s.slice(1, -1);
  const enc = new TextEncoder();
  const bytes = [];
  const simple = { n: "\n", t: "	", r: "\r", '"': '"', "\\": "\\", a: "\x07", b: "\b", f: "\f", v: "\v" };
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c !== "\\" || i === body.length - 1) {
      bytes.push(...enc.encode(c));
      continue;
    }
    const next = body[i + 1];
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else {
      bytes.push(...enc.encode(simple[next] ?? next));
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
function parseHeader(line) {
  const header = { branch: null, upstream: null, ahead: 0, behind: 0 };
  if (!line) return header;
  const text = line.replace(/^##\s*/, "");
  const initial = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(text);
  if (initial) return { ...header, branch: initial[1].trim(), noCommits: true };
  if (/^HEAD \(no branch\)/.test(text)) return { ...header, detached: true };
  const [names = "", bracket = ""] = text.split(/ \[(.*)\]$/);
  const dots = names.indexOf("...");
  header.branch = (dots === -1 ? names : names.slice(0, dots)).trim() || null;
  if (dots !== -1) header.upstream = names.slice(dots + 3).trim() || null;
  header.ahead = Number(/ahead (\d+)/.exec(bracket)?.[1] ?? 0);
  header.behind = Number(/behind (\d+)/.exec(bracket)?.[1] ?? 0);
  if (/\bgone\b/.test(bracket)) header.upstreamGone = true;
  return header;
}
var CONFLICT = /* @__PURE__ */ new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
function parseEntries(lines) {
  const out = { staged: [], unstaged: [], untracked: [], conflicted: [] };
  for (const line of lines) {
    if (line.length < 4 || line.startsWith("##")) continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    if (xy === "!!") continue;
    if (xy === "??") {
      out.untracked.push(unquoteGitPath(rest));
      continue;
    }
    const arrow = rest.indexOf(" -> ");
    const path2 = unquoteGitPath(arrow === -1 ? rest : rest.slice(arrow + 4));
    const from = arrow === -1 ? void 0 : unquoteGitPath(rest.slice(0, arrow));
    if (CONFLICT.has(xy)) {
      out.conflicted.push(path2);
      continue;
    }
    const [x, y] = [xy[0], xy[1]];
    if (x !== " ") out.staged.push({ path: path2, status: x, ...from && (x === "R" || x === "C") ? { from } : {} });
    if (y !== " ") out.unstaged.push({ path: path2, status: y });
  }
  return out;
}
function parsePathSections(sections, paths, upstreamUsable) {
  return paths.map((path2, i) => {
    const lines = sections[i] ?? [];
    const logLine = lines.find((l) => l.includes(US));
    if (!logLine) return { path: path2, lastCommit: null, onUpstream: null };
    const space = logLine.indexOf(" ");
    const [author = "", email = "", date = "", ...subject] = logLine.slice(space + 1).split(US);
    const pushed = lines.find((l) => l.startsWith(PUSHED_MARK));
    return {
      path: path2,
      lastCommit: { sha: logLine.slice(0, space), subject: subject.join(US), author, email, date },
      onUpstream: upstreamUsable && pushed ? pushed.endsWith(" yes") : null
    };
  });
}
function parseGitStatusOutput(stdout, paths) {
  const lines = stdout.replace(/\r\n/g, "\n").split("\n");
  const firstMark = lines.findIndex((l) => l.startsWith(PATH_MARK));
  const statusLines = firstMark === -1 ? lines : lines.slice(0, firstMark);
  const sections = [];
  if (firstMark !== -1) {
    for (const line of lines.slice(firstMark)) {
      const mark = new RegExp(`^${PATH_MARK} (\\d+)$`).exec(line);
      if (mark) sections[Number(mark[1])] = [];
      else sections[sections.length - 1]?.push(line);
    }
  }
  const header = parseHeader(statusLines.find((l) => l.startsWith("##")));
  const entries = parseEntries(statusLines);
  const truncated = Object.values(entries).some((list) => list.length > MAX_ENTRIES);
  const report = {
    ...header,
    staged: entries.staged.slice(0, MAX_ENTRIES),
    unstaged: entries.unstaged.slice(0, MAX_ENTRIES),
    untracked: entries.untracked.slice(0, MAX_ENTRIES),
    conflicted: entries.conflicted.slice(0, MAX_ENTRIES),
    clean: Object.values(entries).every((list) => list.length === 0),
    ...truncated ? { truncated: true } : {}
  };
  const wanted = statusPaths(paths);
  if (wanted.length > 0) report.paths = parsePathSections(sections, wanted, !!header.upstream && !header.upstreamGone);
  return { output: statusLines.join("\n").trim(), report };
}

// ../packages/agent-tools/src/git-script-parts.ts
var RESOLVE_BASE = `BASE="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"; [ -n "$BASE" ] || BASE=main`;
var IDENTITY_EMAIL = 'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"';
var IDENTITY_NAME = 'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"';
var REPO_PARAM = {
  type: "string",
  description: 'Optional subdirectory holding the repository, when the open folder CONTAINS checkouts rather than being one (e.g. "my-project"). Omit when the workspace root is itself the repo.'
};

// ../packages/agent-tools/src/git-publish-tools.ts
function buildCommitCommand(opts) {
  const branch = safeGitArg(opts.branch);
  const resolveLines = opts.paths.map((p, i) => {
    const candidates = commitPathCandidates(p, opts.repo).map(shellQuote).join(" ");
    return `P${i}="$(pick ${candidates})" || MISSING="$MISSING "${shellQuote(p)}`;
  });
  const paths = opts.paths.map((_, i) => `"$P${i}"`).join(" ");
  return [
    "set -e",
    RESOLVE_BASE,
    'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"',
    'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"',
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    // A ticket branch was named: switch to it, creating it if new. Otherwise the base
    // branch is refused — unless the caller DECLARED it, the same declared act `git_push`
    // takes. Without that declaration "commit and push to main" had no reachable path at
    // all: push accepted `allowBaseBranch`, but the commit before it could never land on
    // main, so an explicit human instruction ended in a refusal every time.
    ...branch ? [`git rev-parse --verify --quiet "${branch}" >/dev/null && git checkout "${branch}" || git checkout -b "${branch}"`] : opts.allowBaseBranch ? [] : ['[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }'],
    // A path is "there" if it is on disk OR tracked by git — the second arm is what
    // lets a DELETION be committed, since the file is gone by definition.
    'pick() { for c in "$@"; do if [ -e "$c" ] || git ls-files --error-unmatch -- "$c" >/dev/null 2>&1; then printf %s "$c"; return 0; fi; done; return 1; }',
    'MISSING=""',
    ...resolveLines,
    '[ -z "$MISSING" ] || { echo "MISSING_PATHS:$MISSING"; exit 8; }',
    `git add -- ${paths}`,
    // Nothing staged is a fact, not a failure — say which rather than exiting 1 with
    // git's own "nothing to commit" that reads like a broken tool.
    "git diff --cached --quiet && { echo NOTHING_STAGED; exit 6; }",
    `git commit -m ${shellQuote(opts.message)}`,
    'echo "Committed on $(git rev-parse --abbrev-ref HEAD): $(git rev-parse --short HEAD)"'
  ].join("\n");
}
function buildPushCommand(opts) {
  return [
    "set -e",
    RESOLVE_BASE,
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    ...opts.allowBaseBranch ? [] : ['[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }'],
    // `-u` so a brand-new ticket branch gets its upstream on the first push.
    'git push -u origin "$CUR"',
    'echo "Pushed $CUR to origin"',
    // Report where the push LANDED — the branch header (`## main...origin/main`, with any
    // `[ahead N]` still owed) plus whatever is still uncommitted. That is the evidence a
    // host needs to call the change shipped, so the push verifies itself rather than
    // depending on the agent remembering a separate status call. Never fails the push.
    "git status --short --branch 2>/dev/null || true"
  ].join("\n");
}
function buildPullRequestCommand(opts) {
  const base = safeGitArg(opts.base);
  const reviewers = (opts.reviewers ?? []).map((r) => safeGitArg(r)).filter((r) => !!r);
  return [
    "set -e",
    "command -v gh >/dev/null 2>&1 || { echo NO_GH_CLI; exit 7; }",
    ...base ? [`BASE="${base}"`] : [RESOLVE_BASE],
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    '[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }',
    // Push first when the branch has no upstream — `gh pr create` fails on an unpushed
    // head, and "open a PR" plainly means the branch has to exist on the remote.
    'git rev-parse --abbrev-ref "@{upstream}" >/dev/null 2>&1 || git push -u origin "$CUR"',
    `gh pr create --base "$BASE" --head "$CUR" --title ${shellQuote(opts.title)} --body ${shellQuote(opts.body)}` + reviewers.map((r) => ` --reviewer "${r}"`).join("")
  ].join("\n");
}
function buildCleanupCommand(opts) {
  const branch = safeGitArg(opts.branch);
  const base = safeGitArg(opts.baseBranch);
  return [
    "set -e",
    ...base ? [`BASE="${base}"`] : [RESOLVE_BASE],
    ...branch ? [`TARGET="${branch}"`] : ['TARGET="$(git rev-parse --abbrev-ref HEAD)"'],
    '[ "$TARGET" != "$BASE" ] || { echo NOTHING_TO_CLEAN; exit 9; }',
    '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
    'git rev-parse --verify --quiet "$TARGET" >/dev/null || { echo NO_SUCH_BRANCH; exit 11; }',
    // Was this branch ever pushed? Read BEFORE the prune, which is what removes the
    // evidence — a branch that had an upstream and no longer exists on the remote was
    // merged and deleted by the host, however it was merged.
    'HAD_UPSTREAM=0; git rev-parse --verify --quiet "refs/remotes/origin/$TARGET" >/dev/null && HAD_UPSTREAM=1',
    "git fetch --prune origin",
    'REMOTE_EXISTS=0; git ls-remote --exit-code --heads origin "$TARGET" >/dev/null 2>&1 && REMOTE_EXISTS=1',
    // Get onto the base branch and bring it up to date — the state the user expects to
    // be left in. `--ff-only` so a divergent local base is reported, never merged.
    'git checkout "$BASE"',
    'git merge --ff-only "origin/$BASE" >/dev/null 2>&1 || echo "note: local $BASE has diverged from origin/$BASE and was left alone"',
    'MERGED=0; git branch --merged "origin/$BASE" | sed "s/^[* ] *//" | grep -qx "$TARGET" && MERGED=1',
    // Squash-merged: the commits are in the base under a new hash, so `--merged` says
    // no, but the host deleted the remote branch when the PR landed.
    '[ "$MERGED" = 1 ] || { [ "$HAD_UPSTREAM" = 1 ] && [ "$REMOTE_EXISTS" = 0 ] && MERGED=1; } || true',
    ...opts.force ? ["MERGED=1"] : [],
    '[ "$MERGED" = 1 ] || { echo NOT_MERGED; exit 10; }',
    // `-D`, not `-d`: the merged-ness check above is STRICTER than git's own (it also
    // accepts the squash-merge case git cannot see), so `-d` would refuse exactly the
    // branches this tool exists to remove. Nothing reaches this line unmerged.
    'git branch -D "$TARGET"',
    // The remote branch is usually ALREADY gone (the host deletes it on merge). That is
    // the goal state, not an error, so it is only pushed when it is actually there.
    '[ "$REMOTE_EXISTS" = 0 ] || git push origin --delete "$TARGET"',
    "git remote prune origin >/dev/null 2>&1 || true",
    'echo "Cleaned up $TARGET \u2014 on $BASE (updated), branch deleted locally and on origin"'
  ].join("\n");
}
function publishToolResult(action, r) {
  const out = (r.stdout ?? "").trim();
  const fail = (error) => ({ data: { ok: false, action, error, output: out } });
  if (r.exitCode === 5 || /\bON_BASE_BRANCH\b/.test(out)) {
    return fail(
      action === "push" ? "you are on the BASE branch (main/master) and `allowBaseBranch` was not set \u2014 pushing here bypasses pull-request review. Open a pull request instead (git_commit with a `branch`, then open_pull_request). If the human has explicitly asked you to push the base branch, or your session instructions make you the reviewer of your own change and you have self-reviewed it, re-call with allowBaseBranch:true; they will be prompted to approve it." : "you are on the BASE branch (main/master) and `allowBaseBranch` was not set \u2014 committing here bypasses pull-request review. Pass `branch` to git_commit to work on a ticket branch (it is created for you), then open_pull_request. If the human has explicitly asked you to commit to the base branch directly, or your session instructions make you the reviewer of your own change and you have self-reviewed it, re-call with allowBaseBranch:true; they will be prompted to approve it."
    );
  }
  if (r.exitCode === 6 || /\bNOTHING_STAGED\b/.test(out)) {
    return fail("none of the named paths have uncommitted changes \u2014 nothing was committed. Run git_status to see what actually differs; do not report a commit that did not happen.");
  }
  const missing = /MISSING_PATHS:([^\n]*)/.exec(out);
  if (r.exitCode === 8 || missing) {
    const named = (missing?.[1] ?? "").trim();
    return fail(
      `these paths do not exist in the repository, so nothing was committed:${named ? ` ${named}` : ""}. \`paths\` are relative to the REPOSITORY root \u2014 when you pass \`repo\`, that means relative to the repo directory, NOT to the workspace root your file tools use. Run git_status (with the same \`repo\`) and copy the paths it prints.`
    );
  }
  if (r.exitCode === 9 || /\bNOTHING_TO_CLEAN\b/.test(out)) {
    return fail("you are already on the base branch and no ticket branch was named \u2014 there is nothing to clean up. Pass `branch` to name the merged branch to delete.");
  }
  if (r.exitCode === 10 || /\bNOT_MERGED\b/.test(out)) {
    return fail(
      "that branch's commits are NOT in the base branch, so it was left alone \u2014 deleting it would destroy unmerged work. If the pull request was SQUASH-merged (the commits are in main under a new hash and the remote branch still exists), re-call with force:true to delete it anyway."
    );
  }
  if (r.exitCode === 11 || /\bNO_SUCH_BRANCH\b/.test(out)) {
    return fail("no local branch by that name \u2014 it has already been deleted. Nothing to do.");
  }
  if (r.exitCode === 4 || /\bDIRTY\b/.test(out)) {
    return fail("you have uncommitted changes \u2014 commit or discard them before cleaning up (this refuses to discard uncommitted work).");
  }
  if (r.exitCode === 7 || /\bNO_GH_CLI\b/.test(out)) {
    return fail("the GitHub CLI (`gh`) is not installed or not on PATH, so a pull request cannot be opened from here. The branch is committed and pushed; tell the human to open the PR, and give them the branch name.");
  }
  return { data: { ok: r.ok, action, output: out.slice(0, 2e4), ...r.error ? { error: r.error } : {} } };
}
function invalidRefResult(action, refs) {
  for (const [name, value] of Object.entries(refs)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v !== "string" || v === "" || safeGitArg(v) !== null) continue;
      return {
        data: {
          ok: false,
          action,
          error: `${name} '${v}' is not a valid name \u2014 use only letters, digits and . _ / @ - (no spaces, no shell characters, not starting with '-'), so nothing was run`
        }
      };
    }
  }
  return null;
}
async function runPublishTool(action, command, repo, ctx) {
  const refused = invalidRepoResult(action, repo);
  if (refused) return refused;
  const build = (scope) => typeof command === "string" ? command : command(scope);
  const ran = await runInRepoScope(ctx, repo ? { repo } : {}, (scope) => shellRunWithStop(ctx, build(scope), safeRepoArg(scope) ?? void 0));
  if (!ran) return notARepoWithCandidates(action, ctx);
  const result = publishToolResult(action, ran.r);
  if (ran.repo && result.data.ok) result.data.repo = ran.repo;
  return result;
}
var gitCommitTool = defineTool({
  name: "git_commit",
  description: "Commit the files you changed. You must list the exact `paths` to commit \u2014 the working tree is shared with the human using it, so committing everything would sweep up their unrelated in-flight work; run git_status/git_diff first if you are unsure what you touched. The DEFAULT route is a TICKET BRANCH: pass `branch` to name it (created for you if it does not exist), then use open_pull_request so the work is reviewed. Without `branch`, a commit is refused while you are on the base branch (main/master) \u2014 unless the human has EXPLICITLY asked you to commit to main directly, or your session instructions make you the reviewer of your own change (a local editor session, after you have verified and self-reviewed it); then pass allowBaseBranch:true (the human is prompted to approve it) and follow with git_push allowBaseBranch:true.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Commit message. One line saying what changed and why." },
      paths: { type: "array", items: { type: "string" }, description: "Repo-relative paths to commit. Exactly the files YOU changed \u2014 never a catch-all." },
      branch: { type: "string", description: 'Ticket branch to commit on, created if new (e.g. "ticket/2394-mobile-board-height"). The default route; required when on the base branch unless allowBaseBranch is set.' },
      allowBaseBranch: { type: "boolean", description: "Set ONLY when the human explicitly asked to commit to the base branch (main/master) directly. Default false, which refuses on the base branch and tells you to use a ticket branch." },
      repo: REPO_PARAM
    },
    required: ["message", "paths"]
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) return Promise.resolve({ data: { ok: false, action: "commit", error: "message is required" } });
    const paths = Array.isArray(args.paths) ? args.paths.filter((p) => typeof p === "string" && p.trim() !== "") : [];
    if (paths.length === 0) {
      return Promise.resolve({ data: { ok: false, action: "commit", error: "paths is required \u2014 list the exact files you changed. Run git_status to see them. Do not pass '.' or '-A': the working tree may hold changes that are not yours." } });
    }
    const badRef = invalidRefResult("commit", { branch: args.branch });
    if (badRef) return Promise.resolve(badRef);
    const repo = typeof args.repo === "string" ? args.repo : void 0;
    return runPublishTool(
      "commit",
      (scope) => buildCommitCommand({ message, paths, branch: typeof args.branch === "string" ? args.branch : void 0, allowBaseBranch: args.allowBaseBranch === true, repo: scope }),
      repo,
      ctx
    );
  }
});
var gitPushTool = defineTool({
  name: "git_push",
  description: "Push the current branch to origin (setting its upstream on the first push), then report where it landed (`git status --short --branch`). Pushing the BASE branch (main/master) is refused unless you pass allowBaseBranch \u2014 that path skips pull-request review, so only set it when the human has explicitly asked for it, or when your session instructions make you the reviewer of your own change (a local editor session, after verifying and self-reviewing it); the human is prompted to approve it either way. Otherwise the route is a ticket branch: git_commit with a `branch`, git_push, then open_pull_request.",
  parameters: {
    type: "object",
    properties: {
      allowBaseBranch: { type: "boolean", description: "Set ONLY when the human explicitly asked to push the base branch directly. Default false, which refuses and tells you to open a pull request." },
      repo: REPO_PARAM
    }
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const repo = typeof args.repo === "string" ? args.repo : void 0;
    return runPublishTool("push", buildPushCommand({ allowBaseBranch: args.allowBaseBranch === true }), repo, ctx);
  }
});
var openPullRequestTool = defineTool({
  name: "open_pull_request",
  description: "Open a pull request for the current ticket branch against the base branch, pushing it first if it has no upstream yet. This is how a change gets REVIEWED \u2014 prefer it over pushing the base branch, and say so when someone asks you to push directly. Pass `reviewers` to request review from specific people or teams. Returns the pull request URL; report that URL rather than claiming the work is shipped, because it is not until the PR is merged.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Pull request title \u2014 what this change does, in one line." },
      body: { type: "string", description: "Pull request description: what changed, why, and how a reviewer can verify it." },
      base: { type: "string", description: "Base branch to target. Defaults to the remote's default branch (usually main)." },
      reviewers: { type: "array", items: { type: "string" }, description: "GitHub usernames or org/team slugs to request review from." },
      repo: REPO_PARAM
    },
    required: ["title", "body"]
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const body = typeof args.body === "string" ? args.body : "";
    if (!title) return Promise.resolve({ data: { ok: false, action: "pull_request", error: "title is required" } });
    const repo = typeof args.repo === "string" ? args.repo : void 0;
    const reviewers = Array.isArray(args.reviewers) ? args.reviewers.filter((r) => typeof r === "string") : void 0;
    const badRef = invalidRefResult("pull_request", { base: args.base, reviewers });
    if (badRef) return Promise.resolve(badRef);
    return runPublishTool(
      "pull_request",
      buildPullRequestCommand({ title, body, base: typeof args.base === "string" ? args.base : void 0, reviewers }),
      repo,
      ctx
    );
  }
});
var gitCleanupMergedTool = defineTool({
  name: "git_cleanup_merged",
  description: "Clean up after work that has LANDED: switch to the base branch, fast-forward it to origin, and delete the merged ticket branch locally and on origin. Call it once the pull request is merged (or once you have pushed the base branch directly) so the checkout is not left sitting on a dead branch with a stale base \u2014 do not hand-roll this with run_command. It is IDEMPOTENT: a remote branch the host already deleted on merge is the expected state, not an error. It REFUSES to delete a branch whose commits are not in the base branch, and refuses to run on a dirty working tree, so it can never destroy unmerged or uncommitted work. If the pull request was SQUASH-merged and the remote branch still exists, git cannot see the merge \u2014 re-call with force:true.",
  parameters: {
    type: "object",
    properties: {
      branch: { type: "string", description: "The merged branch to delete. Defaults to the branch you are currently on." },
      baseBranch: { type: "string", description: "Branch to return to and update. Defaults to the remote's default branch (usually main)." },
      force: { type: "boolean", description: "Delete the branch even though git cannot see its commits in the base branch. ONLY for a squash-merged pull request you have confirmed is merged." },
      repo: REPO_PARAM
    }
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const badRef = invalidRefResult("cleanup", { branch: args.branch, baseBranch: args.baseBranch });
    if (badRef) return Promise.resolve(badRef);
    const repo = typeof args.repo === "string" ? args.repo : void 0;
    return runPublishTool(
      "cleanup",
      buildCleanupCommand({
        branch: typeof args.branch === "string" ? args.branch : void 0,
        baseBranch: typeof args.baseBranch === "string" ? args.baseBranch : void 0,
        force: args.force === true
      }),
      repo,
      ctx
    );
  }
});

// ../packages/agent-tools/src/git-tools.ts
function buildGitCommand(action, opts) {
  const path2 = safeGitArg(opts?.path);
  const pathArg = path2 ? ` -- "${path2}"` : "";
  const tracked = safeGitArg(opts?.trackedBranch);
  const viaSandbox = opts?.remoteViaSandbox === true;
  const fetchTracked = viaSandbox ? "" : `git fetch origin "${tracked}" 2>/dev/null && `;
  const absorb = tracked ? ["set -e", IDENTITY_EMAIL, IDENTITY_NAME, `${fetchTracked}git merge --ff-only "origin/${tracked}" 2>/dev/null || true`] : [];
  const publish = (force) => tracked && !viaSandbox ? [force ? "git push --force-with-lease origin HEAD" : "git push origin HEAD"] : [];
  switch (action) {
    case "status":
      return buildStatusCommand(opts?.paths, opts?.repo);
    case "diff":
      return `git --no-pager diff${pathArg}`;
    case "history": {
      const limit = Number.isFinite(opts?.limit) && opts.limit > 0 ? Math.min(Math.floor(opts.limit), 200) : 30;
      return `git --no-pager log --oneline -n ${limit}${pathArg}`;
    }
    case "sync_latest": {
      const base = safeGitArg(opts?.baseBranch);
      const resolveBase = base ? `BASE="${base}"` : RESOLVE_BASE;
      return [
        ...tracked ? absorb : ["set -e"],
        resolveBase,
        ...tracked ? [] : [IDENTITY_EMAIL, IDENTITY_NAME],
        ...viaSandbox ? [] : ['git fetch origin "$BASE"'],
        'git merge --no-edit "origin/$BASE" || { git merge --abort; echo MERGE_CONFLICT; exit 3; }',
        ...publish(false),
        'echo "Synced with origin/$BASE"'
      ].join("\n");
    }
    case "undo":
      return [
        ...absorb,
        '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
        "git reset --hard HEAD~1",
        ...publish(true),
        'echo "Undid the last commit (use git_redo to reapply)"'
      ].join("\n");
    case "redo":
      return [
        ...absorb,
        '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
        'git reset --hard "HEAD@{1}"',
        ...publish(true),
        'echo "Reapplied the last undone change"'
      ].join("\n");
  }
}
function gitToolResult(action, r, paths) {
  const out = (r.stdout ?? "").trim();
  if (action === "status" && r.ok) {
    const { output, report } = parseGitStatusOutput(out, paths);
    return { data: { ok: true, action, output: output.slice(0, 2e4), ...report, ...r.error ? { error: r.error } : {} } };
  }
  if (r.exitCode === 3 || /MERGE_CONFLICT/.test(out)) {
    return { data: { ok: false, action, error: "merge conflict \u2014 the base branch has changes that conflict with your branch; the merge was aborted (working tree is clean). Resolve by editing the conflicting files, or ask a human.", output: out } };
  }
  if (r.exitCode === 4 || /\bDIRTY\b/.test(out)) {
    return { data: { ok: false, action, error: "you have uncommitted changes \u2014 commit or discard them before git_" + action + " (it refuses to discard uncommitted work)." } };
  }
  return { data: { ok: r.ok, action, output: out.slice(0, 2e4), ...r.error ? { error: r.error } : {} } };
}
async function runGitTool(action, opts, ctx) {
  const refused = invalidRepoResult(action, opts.repo);
  if (refused) return refused;
  const trackedBranch = ctx.caps.shell?.trackedBranch;
  const remote = trackedBranch && (action === "sync_latest" || action === "undo" || action === "redo") ? ctx.caps.shell?.git : void 0;
  let baseBranch = opts.baseBranch;
  if (remote) {
    const synced = await remote.sync({ baseBranch: opts.baseBranch });
    if (!synced.ok) return { data: { ok: false, action, error: `could not fetch from the remote: ${synced.error ?? "unknown error"}` } };
    baseBranch = synced.baseBranch ?? baseBranch;
  }
  const scope = { repo: opts.repo, path: opts.path ?? opts.paths?.[0] };
  const ran = await runInRepoScope(ctx, scope, (repo, path2) => shellRunWithStop(ctx, buildGitCommand(action, {
    baseBranch,
    limit: opts.limit,
    path: path2,
    ...opts.paths?.length ? { paths: opts.paths, ...repo ? { repo } : {} } : {},
    ...trackedBranch ? { trackedBranch } : {},
    ...remote ? { remoteViaSandbox: true } : {}
  }), safeRepoArg(repo) ?? void 0));
  if (!ran) return notARepoWithCandidates(action, ctx);
  if (remote && ran.r.ok) {
    const published = await remote.publish({ force: action !== "sync_latest" });
    if (!published.ok) return { data: { ok: false, action, error: `the change was made locally but could not be published: ${published.error ?? "unknown error"}` } };
  }
  const result = gitToolResult(action, ran.r, opts.paths);
  if (ran.repo && result.data.ok) {
    result.data.repo = ran.repo;
  }
  return result;
}
var gitStatusTool = defineTool({
  name: "git_status",
  description: 'ONE call answers "is it committed? is it pushed? by whom?" \u2014 do not chain git_diff / git_history / run_command `git log` for that. Returns the branch, its upstream, ahead/behind counts, and the staged / unstaged / untracked / conflicted files. Pass `paths` to limit it to those files AND get, for each, the last commit that touched it (sha, subject, author, date) and `onUpstream` (true = already pushed). A path with no uncommitted entry and `onUpstream: true` is committed and pushed \u2014 possibly by someone else; the author says who. If the open folder contains several checkouts rather than being one repo, pass `repo` to name the one you mean.',
  parameters: {
    type: "object",
    properties: {
      paths: { type: "array", items: { type: "string" }, description: `Optional files/dirs to ask about (at most ${GIT_STATUS_MAX_PATHS}): limits the entries to them and reports each one's last commit and whether it is pushed.` },
      repo: REPO_PARAM
    }
  },
  requires: ["shell"],
  execute: (args, ctx) => {
    const paths = statusPaths(Array.isArray(args.paths) ? args.paths : void 0);
    return runGitTool("status", { repo: typeof args.repo === "string" ? args.repo : void 0, ...paths.length ? { paths } : {} }, ctx);
  }
});
var gitDiffTool = defineTool({
  name: "git_diff",
  description: "Show the uncommitted diff of your working tree (optionally for one path). Use it to review exactly what you changed before finishing.",
  parameters: { type: "object", properties: { path: { type: "string", description: "Optional repo-relative file/dir to scope the diff to." }, repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("diff", { path: typeof args.path === "string" ? args.path : void 0, repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var gitHistoryTool = defineTool({
  name: "git_history",
  description: "Show recent commit history (git log --oneline), optionally scoped to a path. Use it to understand how a file evolved before changing it.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional repo-relative file/dir to scope history to." },
      limit: { type: "number", description: "Max commits to return (default 30, max 200)." },
      repo: REPO_PARAM
    }
  },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("history", { path: typeof args.path === "string" ? args.path : void 0, limit: typeof args.limit === "number" ? args.limit : void 0, repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var gitSyncLatestTool = defineTool({
  name: "git_sync_latest",
  description: "Fetch the latest base branch (e.g. main) and merge it into your working branch so you are NOT building on stale code. Run this FIRST, before editing \u2014 a branch created earlier can be far behind main, so its build fails against old dependencies and its pull request would revert newer work. On a merge conflict it safely aborts and tells you which to resolve.",
  parameters: { type: "object", properties: { baseBranch: { type: "string", description: "Base branch to sync from. Defaults to the remote's default branch (usually main)." }, repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("sync_latest", { baseBranch: typeof args.baseBranch === "string" ? args.baseBranch : void 0, repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var gitUndoTool = defineTool({
  name: "git_undo",
  description: "Undo your most recent commit (keeps the change recoverable \u2014 use git_redo to reapply). Refuses if you have uncommitted changes, so it can never discard unsaved work. Use it to back out a change that was wrong.",
  parameters: { type: "object", properties: { repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("undo", { repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var gitRedoTool = defineTool({
  name: "git_redo",
  description: "Reapply the change you most recently undid with git_undo (reflog redo). Refuses if you have uncommitted changes.",
  parameters: { type: "object", properties: { repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("redo", { repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var GIT_TOOLS = [
  gitStatusTool,
  gitDiffTool,
  gitHistoryTool,
  gitSyncLatestTool,
  gitUndoTool,
  gitRedoTool,
  gitCommitTool,
  gitPushTool,
  openPullRequestTool,
  gitCleanupMergedTool
];

// ../packages/agent-tools/src/retrievalK.ts
var ADAPTIVE_K_START = 3;
var ADAPTIVE_K_FLOOR = 0.5;
var ADAPTIVE_K_HEAD_MARGIN = 0.15;
var positiveInt = (n, fallback) => typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
function hasClearHead(scores, start = ADAPTIVE_K_START, floor = ADAPTIVE_K_FLOOR, headMargin = ADAPTIVE_K_HEAD_MARGIN) {
  const top = Number(scores[0]);
  if (!Number.isFinite(top) || top < floor || top <= 0) return false;
  if (scores.length <= start) return true;
  const firstDropped = Number(scores[start]);
  if (!Number.isFinite(firstDropped)) return true;
  return (top - firstDropped) / top >= headMargin;
}
function chooseK(input) {
  const n = input.scores.length;
  const requested = positiveInt(input.requested, 0);
  const ceiling = Math.min(requested, positiveInt(input.max, requested), n);
  if (ceiling <= 0) return 0;
  const start = Math.max(1, Math.min(positiveInt(input.start, ADAPTIVE_K_START), ceiling));
  let k = hasClearHead(input.scores, start, input.floor ?? ADAPTIVE_K_FLOOR, input.headMargin ?? ADAPTIVE_K_HEAD_MARGIN) ? start : ceiling;
  const budget = input.budgetTokens;
  if (typeof budget === "number" && Number.isFinite(budget) && input.itemTokens?.length) {
    let used = 0;
    let fit = 0;
    for (let i = 0; i < k; i++) {
      used += Math.max(0, Number(input.itemTokens[i] ?? 0) || 0);
      if (used > budget) break;
      fit = i + 1;
    }
    k = Math.max(1, fit);
  }
  return k;
}

// ../packages/agent-tools/src/proseCompress.ts
var PROSE_BY_EXT = {
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  rst: "markdown",
  adoc: "markdown",
  asciidoc: "markdown",
  org: "markdown",
  txt: "text",
  text: "text",
  log: "log"
};
var PROSE_EXTENSIONS = Object.keys(PROSE_BY_EXT).map((e) => `.${e}`);
function proseKindOf(path2) {
  const base = path2.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  return PROSE_BY_EXT[ext] ?? "code";
}
async function compressProse(text, kind, opts = {}) {
  if (kind === "code" || !opts.compress) return { text, compressed: false, originalTokens: 0, keptTokens: 0 };
  return compressLargeContext(text, {
    compress: opts.compress,
    ...opts.minChars !== void 0 ? { minChars: opts.minChars } : {},
    ...opts.rate !== void 0 ? { rate: opts.rate } : {}
  });
}

// ../packages/agent-tools/src/read-compressed-tool.ts
var READ_COMPRESSED_MIN_CHARS = 1500;
var RATE_MIN = 0.2;
var RATE_MAX = 0.9;
var readCompressedTool = defineTool({
  name: "read_compressed",
  description: `Read a long PROSE file \u2014 docs, design notes, READMEs, logs (${PROSE_EXTENSIONS.join(" ")}) \u2014 compressed to about half its tokens (LLMLingua-2; code fences, paths and numbers kept verbatim). Use it to UNDERSTAND a big document without paying for every token; never to edit (read_file gives the exact text). Code files are refused.`,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path of the prose file, e.g. "docs/design/billing.md".' },
      rate: { type: "number", description: `Share of tokens to keep, ${RATE_MIN}\u2013${RATE_MAX} (default 0.5).` }
    },
    required: ["path"]
  },
  requires: ["repo.read", "repo.compress"],
  async execute(args, ctx) {
    const path2 = typeof args.path === "string" ? args.path.trim() : "";
    if (!path2) return { data: { ok: false, error: "path is required" } };
    const kind = proseKindOf(path2);
    if (kind === "code") {
      return { data: { ok: false, path: path2, error: `read_compressed only reads prose (${PROSE_EXTENSIONS.join(" ")}). Use read_file for code \u2014 an edit needs the exact text.` } };
    }
    const semantic = ctx.caps.semantic;
    if (!semantic?.compress) return { data: { ok: false, path: path2, error: "Compression is not available on this surface right now \u2014 use read_file." } };
    const read = await ctx.caps.repoRead.readFile(path2);
    if (!read.ok || typeof read.content !== "string") return { data: read };
    const rate = typeof args.rate === "number" && Number.isFinite(args.rate) ? Math.min(RATE_MAX, Math.max(RATE_MIN, args.rate)) : void 0;
    const r = await compressProse(read.content, kind, {
      compress: (t, k) => semantic.compress(t, k),
      minChars: READ_COMPRESSED_MIN_CHARS,
      ...rate !== void 0 ? { rate } : {}
    });
    const data = { ok: true, path: path2, content: r.text, compressed: r.compressed };
    if (r.compressed) {
      data.originalTokens = r.originalTokens;
      data.keptTokens = r.keptTokens;
      data.note = "Compressed for reading \u2014 do not quote it as the file's exact text; read_file before editing.";
    } else {
      data.note = read.content.length < READ_COMPRESSED_MIN_CHARS ? "Short enough to read as-is \u2014 returned uncompressed." : "Compression did not shorten this text \u2014 returned as-is.";
    }
    if (read.truncated) data.truncated = true;
    if (r.compressed) ctx.emit?.({ level: "debug", message: "read_compressed: compressed (C8)", detail: { originalTokens: r.originalTokens, keptTokens: r.keptTokens } });
    return { data };
  }
});

// ../packages/agent-tools/src/semantic-tools.ts
var SEARCH_DEFAULT_LIMIT = 8;
var SEARCH_MAX_LIMIT = 25;
var MAP_DEFAULT_TOKENS = 1500;
var MAP_MAX_TOKENS = 8e3;
var semanticSearchTool = defineTool({
  name: "semantic_search",
  description: `Find code by MEANING or by name in one call \u2014 returns whole functions/classes (path, line range, symbol, snippet) ranked by identifier-aware keyword match (resolveMembership matches "membership") plus local embeddings. Use it FIRST for questions phrased in words \u2014 "where is X handled", "how does Y work", "what validates Z" \u2014 where search_code needs an exact substring you do not know yet. Then read_file only the hit you will edit, at its line range. For exact strings, usages and config values use search_code; for a known symbol's definition use find_symbol.`,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: 'What you are looking for, in words or identifiers, e.g. "stripe webhook to ledger".' },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict to, e.g. "api/src".' },
      limit: { type: "number", description: `Max results (default ${SEARCH_DEFAULT_LIMIT}, max ${SEARCH_MAX_LIMIT}).` }
    },
    required: ["query"]
  },
  requires: ["repo.semantic"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return { data: { ok: false, error: "query is required" } };
    const scope = typeof args.path === "string" && args.path.trim() ? args.path.trim() : void 0;
    const explicit = typeof args.limit === "number" && Number.isFinite(args.limit);
    const requested = explicit ? Math.floor(args.limit) : SEARCH_DEFAULT_LIMIT;
    const limit = Math.min(SEARCH_MAX_LIMIT, Math.max(1, requested));
    const semantic = ctx.caps.semantic;
    const r = await semantic.search(query, { scope, limit });
    if (!r.ok) return { data: r };
    let hits = r.results ?? [];
    if (semantic.adaptive && !explicit && hits.length > 0) {
      hits = hits.slice(0, chooseK({ requested: limit, scores: hits.map((h) => typeof h.score === "number" ? h.score : Number.NaN) }));
    }
    const results = hits.map((h) => ({
      at: `${h.path}:${h.startLine}-${h.endLine}`,
      symbol: h.symbol ?? void 0,
      kind: h.kind,
      via: h.source,
      snippet: h.snippet
    }));
    const data = { ok: true, query, total: results.length, results };
    if (r.indexing) {
      data.note = "The index is still being built \u2014 these results cover only the files scanned so far. A miss is not proof of absence yet; fall back to search_code if needed.";
    } else if (results.length === 0) {
      data.note = `Nothing matched "${query}"${scope ? ` under "${scope}"` : ""}. Rephrase with likely identifier words, drop \`path\`, or use search_code for an exact string.`;
    }
    return { data };
  }
});
var repoMapTool = defineTool({
  name: "repo_map",
  description: "The repository's SHAPE in one call: files ordered by how much the rest of the code depends on them, each with its most-referenced definitions as `line: signature`. Call it once at the start of unfamiliar work instead of exploring with list_files and reads; pass `focus` (paths you are working in) to rank that area first.",
  parameters: {
    type: "object",
    properties: {
      focus: { type: "array", items: { type: "string" }, description: 'Optional repo-relative paths to rank first, e.g. ["api/src/billing"].' },
      maxTokens: { type: "number", description: `Budget for the map (default ${MAP_DEFAULT_TOKENS}, max ${MAP_MAX_TOKENS}).` },
      query: { type: "string", description: 'Optional words describing the task, e.g. "stripe webhook retries" \u2014 ranks the files that match it first.' }
    }
  },
  requires: ["repo.semantic"],
  async execute(args, ctx) {
    const focus = Array.isArray(args.focus) ? args.focus.filter((f) => typeof f === "string" && f.trim() !== "") : [];
    const requested = typeof args.maxTokens === "number" && Number.isFinite(args.maxTokens) ? Math.floor(args.maxTokens) : MAP_DEFAULT_TOKENS;
    const maxTokens = Math.min(MAP_MAX_TOKENS, Math.max(200, requested));
    const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : void 0;
    const r = await ctx.caps.semantic.repoMap({ maxTokens, focus, ...query ? { query } : {} });
    if (!r.ok) return { data: r };
    const data = { ok: true, map: r.map ?? "" };
    if (r.indexing) data.note = "The index is still being built \u2014 the map covers only the files scanned so far.";
    return { data };
  }
});
var SEMANTIC_TOOLS = [semanticSearchTool, repoMapTool, readCompressedTool];

// ../packages/agent-tools/src/researchCache.ts
function researchCacheKey(question, files) {
  const q = question.replace(/\s+/g, " ").trim();
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return JSON.stringify([q, ...sorted.map((f) => `${f.path}@${Math.round(f.mtimeMs)}:${f.size}`)]);
}

// ../packages/agent-tools/src/local-research-tool.ts
var MAX_PATHS = 8;
var DEFAULT_TIME_LIMIT_MS = 45e3;
var EXCERPT_BUDGET_CHARS = 24e3;
var HIT_WINDOW_LINES = 30;
var SYSTEM = [
  "You answer a question about a codebase using ONLY the file excerpts given.",
  "Cite every claim as path:line. Be brief and concrete: names, locations, what calls what.",
  "If the excerpts do not contain the answer, say exactly what is missing \u2014 never guess."
].join(" ");
function excerptAround(content, lines, budget, radius = HIT_WINDOW_LINES) {
  const all = content.split(/\r?\n/);
  const ranges = [];
  const anchors = lines.length > 0 ? [...lines].sort((a, b) => a - b) : [1];
  for (const line of anchors) {
    const start = Math.max(1, lines.length > 0 ? line - radius : 1);
    const end = Math.min(all.length, lines.length > 0 ? line + radius : radius * 4);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  const out = [];
  let used = 0;
  for (const [start, end] of ranges) {
    if (out.length > 0) out.push("\u2026");
    for (let n = start; n <= end; n++) {
      const row = `${n}: ${all[n - 1] ?? ""}`;
      if (used + row.length + 1 > budget) return `${out.join("\n")}
\u2026`;
      out.push(row);
      used += row.length + 1;
    }
  }
  return out.join("\n");
}
function hitLinesFor(path2, hits) {
  if (!hits) return [];
  return [...hits.definitions, ...hits.references].filter((h) => h.path === path2).map((h) => h.line);
}
async function readExcerpts(ctx, files, hits) {
  const out = [];
  const per = Math.floor(EXCERPT_BUDGET_CHARS / Math.max(1, files.length));
  for (const path2 of files) {
    const r = await ctx.caps.repoRead.readFile(path2).catch(() => null);
    if (!r?.ok || typeof r.content !== "string") continue;
    out.push({ path: path2, text: excerptAround(r.content, hitLinesFor(path2, hits), per) });
  }
  return out;
}
function researchMessages(question, excerpts) {
  const body = excerpts.map((e) => `### ${e.path}
${e.text}`).join("\n\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Question: ${question}

Excerpts (each line is "line: text"):

${body}` }
  ];
}
function deadlineSignal(limitMs, outer) {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort(new Error("local_research time limit"));
  }, limitMs);
  const onOuter = () => ctl.abort(outer?.reason);
  if (outer?.aborted) ctl.abort(outer.reason);
  else outer?.addEventListener("abort", onOuter, { once: true });
  return {
    signal: ctl.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    }
  };
}
var localResearchTool = defineTool({
  name: "local_research",
  description: 'Ask a question about this codebase and have a LOCAL model on this machine read the relevant files and answer it \u2014 free, no paid tokens. Name the files in `paths`; without them, files are chosen by a symbol-index + text search for the identifiers in the question. Use it for "how does X work", "what calls Y", "summarize these files" before reading large files yourself. Answers cite path:line and are cached until a file changes. If the local model runs out of time you get the search hits instead.',
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: 'What you want to know, naming identifiers where you can, e.g. "how does resolveMembership pick the tenant?".' },
      paths: { type: "array", items: { type: "string" }, description: `Optional repo-relative files to read (max ${MAX_PATHS}).` }
    },
    required: ["question"]
  },
  requires: ["repo.read", "local.research"],
  async execute(args, ctx) {
    const question = typeof args.question === "string" ? args.question.trim() : "";
    if (!question) return { data: { ok: false, error: "question is required" } };
    const research = ctx.caps.research;
    if (!research) return { data: { ok: false, error: "No local model is available on this machine right now." } };
    const named = Array.isArray(args.paths) ? [...new Set(args.paths.filter((p) => typeof p === "string" && p.trim() !== "").map((p) => p.trim()))].slice(0, MAX_PATHS) : [];
    const hits = await preSearch(question, {
      ...ctx.caps.symbols ? { findSymbol: (q) => ctx.caps.symbols.find(q, { limit: 20 }) } : {},
      ...ctx.caps.repoRead ? { searchText: (q, signal) => ctx.caps.repoRead.searchCode(q, void 0, signal ? { signal } : void 0) } : {}
    }, ctx.signal ? { signal: ctx.signal } : {}).catch(() => null);
    const chosen = named.length > 0 ? named : hits ? preSearchFiles(hits) : [];
    if (chosen.length === 0) {
      return { data: { ok: false, question, error: "No files matched the question \u2014 pass `paths`, or name an identifier from the code." } };
    }
    const fingerprints = await research.fingerprint(chosen);
    const files = fingerprints.map((f) => f.path);
    if (files.length === 0) return { data: { ok: false, question, error: `None of these files could be read: ${chosen.join(", ")}` } };
    const key = researchCacheKey(question, fingerprints);
    const cached = await research.cache?.get(key).catch(() => void 0);
    if (cached) return { data: { ok: true, question, files, answer: cached, cached: true } };
    const excerpts = await readExcerpts(ctx, files, hits);
    const deadline = deadlineSignal(research.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS, ctx.signal);
    const partial = (reason) => ({
      data: { ok: true, partial: true, question, files, reason, ...hits?.block ? { hits: hits.block } : {}, note: "The local model did not finish \u2014 these are the deterministic search hits. Read the files they name directly." }
    });
    try {
      const stopped = new Promise((_, reject) => {
        if (deadline.signal.aborted) reject(deadline.signal.reason ?? new Error("aborted"));
        deadline.signal.addEventListener("abort", () => reject(deadline.signal.reason ?? new Error("aborted")), { once: true });
      });
      stopped.catch(() => void 0);
      const answer = (await Promise.race([research.complete(researchMessages(question, excerpts), deadline.signal), stopped])).trim();
      if (!answer) return partial("the local model returned an empty answer");
      await research.cache?.set(key, answer).catch(() => void 0);
      return { data: { ok: true, question, files, answer } };
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      return partial(deadline.timedOut() ? "the local model ran out of time" : `the local model failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      deadline.dispose();
    }
  }
});

// ../packages/agent-tools/src/codeAnalysis.ts
var import_knowledge = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/dependencyCruiserRules.ts
var import_knowledge2 = require("@seanhogg/builderforce-memory/knowledge");
var LAYER_RULE_PREFIX = "kg-layer";
function alternation(globs) {
  if (globs.length === 0) return void 0;
  return globs.map((g) => `(?:${(0, import_knowledge2.globToRegExp)(g).source})`).join("|");
}
function matchOf(rule, earlier) {
  const not = alternation(earlier.flatMap((r) => r.match));
  return { path: alternation(rule.match), ...not ? { pathNot: not } : {} };
}
function toDependencyCruiserRules(reg) {
  if (!reg.allow) return [];
  const ordered = reg.partitions;
  const named = ordered.filter((r) => r.id !== import_knowledge2.TOP_LEVEL_FOLDER && r.match.length > 0);
  const matchById = new Map(named.map((r) => [r.id, matchOf(r, ordered.slice(0, ordered.indexOf(r)))]));
  const rules = [];
  for (const from of named) {
    for (const to of named) {
      const verdict = (0, import_knowledge2.verdictOf)(from.id, to.id, reg);
      if (verdict !== "upward" && verdict !== "skips") continue;
      rules.push({
        name: `${LAYER_RULE_PREFIX}-${from.id}-to-${to.id}`,
        comment: `${from.id} may not use ${to.id} (${verdict})`,
        severity: verdict === "upward" ? "error" : "warn",
        from: matchById.get(from.id),
        to: matchById.get(to.id)
      });
    }
  }
  return rules;
}

// ../packages/agent-tools/src/analyzerPins.ts
var TYPESCRIPT_PIN = "typescript@5.6.3";
var ANALYZER_VERSIONS = {
  "dependency-cruiser": "16.10.4",
  jscpd: "4.0.5",
  knip: "5.30.0"
};

// ../packages/agent-tools/src/knowledge/workspaceFingerprint.ts
var import_ingest = require("@seanhogg/builderforce-memory/ingest");

// ../packages/agent-tools/src/knowledge/fsDirectorySource.ts
var import_knowledge5 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/statManifest.ts
var RACY_WINDOW_NS = BigInt(2e9);

// ../packages/agent-tools/src/knowledge/documents/withDocumentText.ts
var import_knowledge4 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/documents/documentText.ts
var import_knowledge3 = require("@seanhogg/builderforce-memory/knowledge");
var PDF_MEDIA_TYPE = "application/pdf";
var DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
var XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
var PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
var ODT_MEDIA_TYPE = "application/vnd.oasis.opendocument.text";
var ODS_MEDIA_TYPE = "application/vnd.oasis.opendocument.spreadsheet";
var ODP_MEDIA_TYPE = "application/vnd.oasis.opendocument.presentation";
var EXTRACTABLE_DOCUMENT_MEDIA_TYPES = [
  PDF_MEDIA_TYPE,
  DOCX_MEDIA_TYPE,
  XLSX_MEDIA_TYPE,
  PPTX_MEDIA_TYPE,
  ODT_MEDIA_TYPE,
  ODS_MEDIA_TYPE,
  ODP_MEDIA_TYPE
];
var isExtractableDocumentType = (mediaType) => EXTRACTABLE_DOCUMENT_MEDIA_TYPES.includes(mediaType.trim().toLowerCase());
var MAX_ENTRY_BYTES = 8 * 1024 * 1024;
var MAX_TOTAL_BYTES = 16 * 1024 * 1024;

// ../packages/agent-tools/src/knowledge/fsDirectorySource.ts
var BUILDERFORCE_INPUTS = /* @__PURE__ */ new Set([".builderforce/ignore", ".builderforce/partitions.json"]);
function isBuilderforceState(rel2) {
  const path2 = rel2.replace(/\\/g, "/");
  return path2.split("/").includes(".builderforce") && !BUILDERFORCE_INPUTS.has(path2);
}

// ../packages/agent-tools/src/knowledge/shaCache.ts
function createShaCache(opts = {}) {
  const max = opts.max ?? 8;
  const now = opts.now ?? Date.now;
  const entries = /* @__PURE__ */ new Map();
  const join = (key, entry, signal) => {
    entry.waiting += 1;
    if (!signal) return;
    const stop = () => {
      entry.stopped += 1;
      if (entry.settled || entry.stopped < entry.waiting) return;
      entry.controller.abort();
      if (entries.get(key) === entry) entries.delete(key);
    };
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  };
  return {
    getOrRun(key, work, signal) {
      if (key === null) return work(signal);
      const hit = entries.get(key);
      if (hit && (hit.expires === void 0 || hit.expires > now())) {
        join(key, hit, signal);
        return hit.run;
      }
      if (hit) entries.delete(key);
      const controller = new AbortController();
      const entry = { run: void 0, waiting: 0, stopped: 0, controller, settled: false };
      entries.set(key, entry);
      while (entries.size > max) entries.delete(entries.keys().next().value);
      join(key, entry, signal);
      entry.run = work(controller.signal);
      const drop = () => {
        if (entries.get(key) === entry) entries.delete(key);
      };
      entry.run.then((value) => {
        entry.settled = true;
        const verdict = opts.keep ? opts.keep(value) : true;
        if (verdict === false) return drop();
        const lifetime = typeof verdict === "number" ? verdict : opts.ttlMs;
        if (lifetime !== void 0) entry.expires = now() + lifetime;
      }, () => {
        entry.settled = true;
        drop();
      });
      return entry.run;
    },
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    }
  };
}

// ../packages/agent-tools/src/knowledge/workspaceFingerprint.ts
var GIT = "git --no-optional-locks";
var FINGERPRINT_TTL_MS = 2e3;
var REVIEW_INPUT_FILES = [".builderforce/ignore", ".builderforce/partitions.json"];
async function gitText(ctx, command) {
  try {
    const r = await shellRunWithStop(ctx, command);
    return r.exitCode === 0 ? (r.stdout ?? "").trimEnd() : null;
  } catch {
    return null;
  }
}
var pathOfStatusLine = (line) => line.slice(3).replace(/^"|"$/g, "");
var OBJECT_ID = /^[0-9a-f]{40,64}$/;
var WORKING_TREE_SCRIPT = [
  "set -e",
  `cd "$(${GIT} rev-parse --show-toplevel)"`,
  'idx="$(mktemp -u)"',
  `trap 'rm -f "$idx"' EXIT`,
  `cp "$(${GIT} rev-parse --git-path index)" "$idx" 2>/dev/null || true`,
  'export GIT_INDEX_FILE="$idx"',
  `${GIT} add -A -- . ':(exclude,glob)**/.builderforce/**'`,
  ...REVIEW_INPUT_FILES.map((f) => `if [ -f "${f}" ]; then ${GIT} add -f -- "${f}"; fi`),
  `${GIT} write-tree`
].join("\n");
async function workingTreeId(ctx) {
  const out = await gitText(ctx, WORKING_TREE_SCRIPT);
  const id = out?.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
  return id && OBJECT_ID.test(id) ? id : null;
}
async function readFingerprint(ctx) {
  const head = await gitText(ctx, `${GIT} rev-parse --show-toplevel --show-prefix HEAD`);
  const lines = head?.split(/\r?\n/) ?? [];
  const commit = lines.at(-1)?.trim();
  if (!commit || !OBJECT_ID.test(commit)) return { commit: null, branch: null, dirty: null };
  const prefix = lines.length >= 3 ? (lines[1] ?? "").trim().replace(/\/+$/, "") : "";
  const branch = (await gitText(ctx, `${GIT} branch --show-current`))?.trim() ?? null;
  const status = await gitText(ctx, `${GIT} status --porcelain --untracked-files=all`);
  if (status === null) return { commit, branch, dirty: null, prefix };
  const changes = status.split("\n").filter((line) => line.trim() && !isBuilderforceState(pathOfStatusLine(line)));
  if (changes.length === 0) return { commit, branch, dirty: false, prefix };
  const tree = await workingTreeId(ctx);
  return { commit, branch, dirty: true, prefix, ...tree ? { dirtyHash: (0, import_ingest.hashText)(tree).slice(0, 16) } : {} };
}
var memos = /* @__PURE__ */ new WeakMap();
async function workspaceFingerprint(ctx) {
  const shell = ctx.caps.shell;
  if (!shell) return { commit: null, branch: null, dirty: null };
  let memo = memos.get(shell);
  if (!memo) memos.set(shell, memo = createShaCache({ ttlMs: FINGERPRINT_TTL_MS, max: 1 }));
  return memo.getOrRun("fingerprint", (shared) => readFingerprint({ caps: ctx.caps, ...shared ? { signal: shared } : {} }), ctx.signal);
}

// ../packages/agent-tools/src/delta/adapters/analyzer.ts
var ANALYZER_TIMEOUT_MS = 5 * 6e4;
var ignoredGlobs = (ignored) => (ignored ?? []).map((d) => `${d.replace(/\/+$/, "")}/**`);
function ignoredRegex(ignored) {
  const dirs = (ignored ?? []).map((d) => d.replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return dirs.length > 0 ? `^(?:${dirs.join("|")})(?:/|$)` : void 0;
}

// ../packages/agent-tools/src/codeAnalysisTool.ts
function spec(name, version, extraPackages, bin, args) {
  const packages = [`${name}@${version}`, ...extraPackages];
  return { name, version, packages, bin, args, command: analyzerCommand({ packages, bin, args }, ".") };
}
var ANALYZERS = [
  spec("dependency-cruiser", ANALYZER_VERSIONS["dependency-cruiser"], [TYPESCRIPT_PIN], "depcruise", "--config=.builderforce/code-analysis/dependencies.json --output-type=json {scope}"),
  spec("jscpd", ANALYZER_VERSIONS.jscpd, [], "jscpd", "--silent --reporters=json --min-lines=5 --min-tokens=50 --ignore=**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.builderforce/** --output=.builderforce/code-analysis {scope}"),
  spec("knip", ANALYZER_VERSIONS.knip, [TYPESCRIPT_PIN], "knip", "--reporter=json --no-progress")
];
var bundled;
function bundledAnalyzers() {
  return bundled;
}
function analyzerCommand(a, scope, entry) {
  const args = a.args.replace("{scope}", () => scope);
  return entry ? `node "${entry}" ${args}` : `npm exec --yes ${a.packages.map((p) => `--package=${p}`).join(" ")} --call="${a.bin} ${args}"`;
}
function parseAnalyzerJson(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("No JSON report in analyzer output");
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("Truncated analyzer JSON report");
}
function dependencyCruiserConfig(partitions) {
  const forbidden = partitions ? toDependencyCruiserRules(partitions) : [];
  return {
    ...forbidden.length ? { forbidden } : {},
    options: { exclude: { path: "(^|/)(node_modules|[.]git|[.]builderforce|dist|out|build)(/|$)" } }
  };
}
function base64Utf8(text) {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function dependencyCruiserConfigWith(partitions, ignored) {
  const config = dependencyCruiserConfig(partitions);
  const extra = ignoredRegex(ignored);
  if (!extra) return config;
  const options = config.options ?? {};
  const base = options.exclude?.path;
  return { ...config, options: { ...options, exclude: { ...options.exclude ?? {}, path: base ? `${base}|${extra}` : extra } } };
}
var jscpdArgsWith = (args, ignored) => {
  const extra = ignoredGlobs(ignored);
  return extra.length > 0 ? args.replace(/--ignore=(\S+)/, (_m, list) => `--ignore=${list},${extra.join(",")}`) : args;
};
function createAnalyzeCodebaseTool(options = {}) {
  const l3 = options.l3;
  const configOf = (ignored) => base64Utf8(JSON.stringify(dependencyCruiserConfigWith(options.partitions, ignored)));
  return defineTool({
    name: "analyze_codebase",
    description: "Measure JS/TS dependency edges and cycles with dependency-cruiser, duplicate code with jscpd, and unused-file/export/dependency candidates with Knip. Runs the analyzers bundled with the host when it ships them, else downloads the pinned packages through npm cache on first use; an analyzer that cannot start is reported not_measured, never as zero findings. Writes per-scan artifacts under .builderforce/code-analysis. The audit host saves the full snapshot for the visualizer; cloud images return a bounded summary after upload. Report findings normally after this tool. Preserve failed-tool coverage; do not claim missing results are clean.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Relative project/package directory; use a smaller package for large monorepos. Defaults to repository root." } } },
    requires: ["shell", "repo.read"],
    async execute(args, ctx) {
      const scope = typeof args.path === "string" ? args.path : ".";
      if (!/^[a-zA-Z0-9_.][a-zA-Z0-9_./-]*$/.test(scope) || scope.split("/").includes("..")) return { data: { error: "path must be a relative project directory without traversal or shell syntax" } };
      const tools = [];
      const id = crypto.randomUUID();
      const outputDir = `.builderforce/code-analysis/${id}`;
      const outputs = [];
      const ignored = l3 ? await l3.ignored().catch(() => []) : void 0;
      const entries = bundledAnalyzers();
      let settledTold = 0;
      const tellSettled = () => {
        while (settledTold < tools.length) {
          settledTold++;
          options.onToolSettled?.();
        }
      };
      for (const analyzer of ANALYZERS) {
        tellSettled();
        const l3Key = l3 ? await l3.keyOf(analyzer.name).catch(() => void 0) : void 0;
        const l3Hit = l3 && l3Key ? await l3.cache.get(l3Key, analyzer.name).catch(() => void 0) : void 0;
        if (l3Hit?.raw !== void 0) {
          outputs.push(l3Hit.raw);
          tools.push({ name: analyzer.name, version: analyzer.version, status: "complete" });
          continue;
        }
        const entry = entries?.[analyzer.name];
        if (entries && !entry) {
          outputs.push(null);
          tools.push({ name: analyzer.name, version: analyzer.version, status: "not_measured", reason: "analyzer-unavailable" });
          continue;
        }
        let launched = false;
        try {
          const setupFailed = (message) => {
            if (entry) return "unavailable";
            throw new Error(message);
          };
          let unavailable2;
          if (analyzer.name === "dependency-cruiser") {
            const config = await shellRunWithStop(ctx, `node -e "const f=require('fs');f.mkdirSync('${outputDir}',{recursive:true});f.writeFileSync('${outputDir}/dependencies.json',Buffer.from('${configOf(ignored)}','base64'))"`);
            if (!config.ok) unavailable2 = setupFailed("Could not create dependency analysis configuration");
          }
          if (analyzer.name === "jscpd") {
            const cleanup = await shellRunWithStop(ctx, `node -e "require('fs').mkdirSync('${outputDir}',{recursive:true})"`);
            if (!cleanup.ok) unavailable2 = setupFailed("Could not clear the previous duplication artifact");
          }
          if (unavailable2) {
            outputs.push(null);
            tools.push({ name: analyzer.name, version: analyzer.version, status: "not_measured", reason: "analyzer-unavailable" });
            continue;
          }
          const pinned = analyzerCommand(analyzer, scope, entry);
          const command = analyzer.name === "jscpd" ? jscpdArgsWith(pinned, ignored) : pinned;
          const result = await shellRunWithStop(ctx, command.replaceAll(".builderforce/code-analysis", outputDir), analyzer.name === "knip" && scope !== "." ? scope : void 0);
          launched = true;
          const artifact = analyzer.name === "jscpd" ? await ctx.caps.repoRead.readFile(`${outputDir}/jscpd-report.json`) : void 0;
          const text = artifact ? artifact.content : result.stdout;
          if (entry && !text) {
            outputs.push(null);
            tools.push({ name: analyzer.name, version: analyzer.version, status: "not_measured", reason: "analyzer-unavailable" });
            continue;
          }
          if (!text || artifact?.truncated) throw new Error("Analyzer output is empty or truncated; scan a smaller project");
          const value = parseAnalyzerJson(text);
          if (analyzer.name === "dependency-cruiser" && !Array.isArray(value.modules)) throw new Error("Invalid dependency report");
          if (analyzer.name === "jscpd" && !Array.isArray(value.duplicates)) throw new Error("Invalid duplication report");
          if (analyzer.name === "knip" && (!Array.isArray(value.files) || !Array.isArray(value.issues))) throw new Error("Invalid unused-code report");
          const unresolved = analyzer.name === "dependency-cruiser" ? value.modules.flatMap((m) => m.dependencies ?? []).filter((d) => d.couldNotResolve).length : 0;
          outputs.push(value);
          tools.push({ name: analyzer.name, version: analyzer.version, status: unresolved ? "failed" : "complete", ...unresolved ? { error: `${unresolved} imports could not be resolved; graph coverage is incomplete.` } : {} });
          if (l3 && l3Key && !unresolved) await l3.cache.put(l3Key, { result: l3.toResult(analyzer.name, analyzer.version, value), raw: value }).catch(() => void 0);
        } catch (error) {
          if (entry && !launched) {
            outputs.push(null);
            tools.push({ name: analyzer.name, version: analyzer.version, status: "not_measured", reason: "analyzer-unavailable" });
            continue;
          }
          outputs.push(null);
          tools.push({ name: analyzer.name, version: analyzer.version, status: "failed", error: String(error).slice(0, 1e3) });
        }
      }
      tellSettled();
      const { commit, branch, dirty, dirtyHash } = await workspaceFingerprint(ctx);
      const remote = (await gitText(ctx, `${GIT} remote get-url origin`))?.trim().replace(/^git@github.com:/, "https://github.com/").replace(/\.git$/, "");
      const repository = remote && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(remote) ? remote : void 0;
      const snapshot = {
        version: 1,
        id,
        capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
        source: { commit, branch, scope, dirty, ...dirtyHash ? { dirtyHash } : {}, ...repository ? { repository } : {} },
        tools,
        ...(0, import_knowledge.normalizeAnalysis)(outputs[0], outputs[1], outputs[2], scope)
      };
      return { data: { snapshot } };
    }
  });
}
var analyzeCodebaseTool = createAnalyzeCodebaseTool();

// ../packages/agent-tools/src/writeOverwriteGuard.ts
var WRITE_OVERWRITE_LARGE_BYTES = 2048;
var WRITE_OVERWRITE_SHRINK_RATIO = 0.5;
function utf8ByteLength(text) {
  return new TextEncoder().encode(text).length;
}
var NOT_FOUND = /not found|no such file|enoent|does not exist|404\b/i;
function isNotFoundReadError(error) {
  return !!error && NOT_FOUND.test(error);
}
function probeFromRepoRead(read) {
  if (!read.ok) {
    if (isNotFoundReadError(read.error)) return { status: "missing" };
    return { status: "unreadable", reason: read.error?.trim() || "read failed" };
  }
  const content = read.content ?? "";
  if (read.truncated) {
    const contentLines = content === "" ? 0 : content.split(/\r?\n/).length;
    const totalLines = typeof read.totalLines === "number" && Number.isFinite(read.totalLines) ? read.totalLines : null;
    if (totalLines != null && contentLines > 0) {
      const windowBytes = utf8ByteLength(content);
      return { status: "ok", bytes: Math.round(windowBytes * (totalLines / contentLines)), truncated: true };
    }
    return {
      status: "unreadable",
      reason: "read was truncated; refusing to overwrite without the full file"
    };
  }
  if (content === "") {
    if (read.totalLines === 0) return { status: "ok", bytes: 0 };
    return {
      status: "unreadable",
      reason: "read returned empty contents; refusing to treat that as an empty file"
    };
  }
  return { status: "ok", bytes: utf8ByteLength(content) };
}
function refuseWriteOverwrite(probe, incoming) {
  if (probe.status === "missing") return null;
  if (probe.status === "unreadable") {
    return `cannot overwrite: ${probe.reason}. A failed or empty read is not an empty file \u2014 use edit_file after a successful read, or create a new path.`;
  }
  const incomingBytes = utf8ByteLength(incoming);
  if (probe.bytes >= WRITE_OVERWRITE_LARGE_BYTES && incomingBytes < probe.bytes * WRITE_OVERWRITE_SHRINK_RATIO) {
    return `refusing to replace a large existing file (${probe.bytes} bytes) with a much smaller body (${incomingBytes} bytes). Use edit_file for surgical changes.`;
  }
  return null;
}

// ../packages/agent-tools/src/core-tools.ts
var listFilesTool = defineTool({
  name: "list_files",
  description: "List repo files (recursively) on the ticket branch so you can discover the existing codebase before editing. Optionally pass `path` to scope to a subdirectory. To FIND A FILE BY NAME, pass `glob` \u2014 e.g. `ROADMAP.md` (matches that filename at any depth, case-insensitive) or `src/**/*.test.ts`. Use `glob` instead of concluding a file is missing: a large repo's unfiltered listing is summarized to directories, but a `glob` always returns the matching files in full.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Optional repo-relative subdirectory to scope to, e.g. "src/components".' },
      glob: { type: "string", description: 'Optional filename/glob filter, e.g. "ROADMAP.md", "*.md", or "src/**/*.ts". Case-insensitive; a name with no "/" matches the basename at any depth.' }
    }
  },
  requires: ["repo.read"],
  async execute(args, ctx) {
    const sub = typeof args.path === "string" ? args.path : void 0;
    const glob = typeof args.glob === "string" && args.glob.trim() ? args.glob.trim() : void 0;
    const r = await ctx.caps.repoRead.listFiles(sub, glob);
    if (glob && r.ok && (r.paths?.length ?? 0) === 0) {
      return {
        data: {
          ...r,
          note: emptyGlobListingNote(glob, sub, r.truncated === true)
        }
      };
    }
    return { data: r };
  }
});
var searchCodeTool = defineTool({
  name: "search_code",
  description: 'Search the repo for a string/symbol in one call \u2014 use this FIRST to find where something is referenced instead of reading files one by one. Returns matching file paths with line fragments. Pass `query` as an EXACT substring/regex (a symbol, import path, or config key), NOT a natural-language phrase \u2014 a multi-word phrase rarely appears verbatim on one line and will match nothing. On a large monorepo, scope the search with `path` (a subdirectory) to search just that subtree. 0 results with `truncated:false` means the term does not appear (so "remove all references to X" then means there is nothing to remove \u2014 say so, do not invent a change); 0 results with `truncated:true` means the search was cut short before scanning everything \u2014 narrow it with `path` or a more specific `query` and try again, do NOT conclude the term is absent. Then read_file the matches you intend to edit.',
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Exact text or symbol to find, e.g. a model id, function name, import path, or config key. NOT a natural-language phrase." },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict the search to, e.g. "packages/brain-ui". Use this to avoid truncation on a big repo.' }
    },
    required: ["query"]
  },
  requires: ["repo.search"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return { data: { ok: false, error: "query is required" } };
    const scope = typeof args.path === "string" && args.path.trim() ? args.path.trim() : void 0;
    const r = await ctx.caps.repoRead.searchCode(query, scope);
    if (r.ok && r.total === 0) {
      const note = r.truncated ? `Search was truncated before scanning the whole${scope ? " subtree" : " repo"} \u2014 this is NOT proof the term is absent. Re-run scoped to a subdirectory via \`path\`${scope ? " (a narrower one)" : ""}, or use a more specific \`query\`.` : `No matches${scope ? ` under "${scope}"` : ""} \u2014 the term is not referenced${scope ? " there (try without `path` to search the whole repo)" : ""}. If the task was to remove/replace it, there is nothing to change; say so instead of inventing an edit.`;
      return { data: { ...r, note } };
    }
    return { data: r };
  }
});
var readFileTool = defineTool({
  name: "read_file",
  description: "Read a repo file on the ticket branch. Returns up to " + READ_DEFAULT_LINE_LIMIT + " lines at a time: a large file comes back as a paginated line window (never a hard failure), and the result's `truncated`/`totalLines` tell you when more remains \u2014 read the next chunk by calling again with `offset`. To read several files at once pass `paths` (up to " + READ_FILE_MAX_PATHS + ') instead of `path`: you get `files`, one result per path. A first read of a large Markdown document also returns its `outline` (headings with line numbers) \u2014 page by heading line with `offset`. For a large JSON file (an i18n catalog, a config) pass `key` with a dot path such as "admin.visitorFlow" to get just that subtree instead of paging line windows. Always read a file before editing it so you preserve existing code and only change what is needed.',
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      paths: {
        type: "array",
        items: { type: "string" },
        maxItems: READ_FILE_MAX_PATHS,
        description: `Instead of \`path\`: up to ${READ_FILE_MAX_PATHS} repo-relative paths read in one call. offset/limit/key apply to each.`
      },
      offset: { type: "number", description: "1-based line to start reading from (for paging through a large file). Default 1." },
      limit: { type: "number", description: `Max lines to return. Default ${READ_DEFAULT_LINE_LIMIT}. Read the next window with offset = previous offset + returned lines.` },
      key: { type: "string", description: 'JSON files only: a dot path (e.g. "admin.visitorFlow") \u2014 returns that subtree, or its child keys when it is too large. Ignores offset/limit.' }
    }
  },
  requires: ["repo.read"],
  async execute(args, ctx) {
    const path2 = typeof args.path === "string" ? args.path : "";
    const paths = !path2 && Array.isArray(args.paths) ? args.paths.filter((p) => typeof p === "string" && p.trim() !== "") : [];
    if (!path2 && paths.length === 0) return { data: { ok: false, error: "path is required (or paths: a list of up to " + READ_FILE_MAX_PATHS + ")" } };
    if (paths.length > READ_FILE_MAX_PATHS) return { data: { ok: false, error: `paths takes at most ${READ_FILE_MAX_PATHS} files per call \u2014 split the rest into another read_file` } };
    const opts = {
      offset: typeof args.offset === "number" && args.offset > 0 ? Math.floor(args.offset) : void 0,
      limit: typeof args.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : void 0,
      key: typeof args.key === "string" ? args.key.trim() : ""
    };
    if (!path2) return { data: { ok: true, files: await readManyFiles(paths, opts, ctx.caps, ctx.outlineFirstReads) } };
    return { data: await readOneFile(path2, opts, ctx.caps, ctx.outlineFirstReads) };
  }
});
var writeFileTool = defineTool({
  name: "write_file",
  description: 'Create a new file, or replace a whole file you have already read, with its complete contents. Prefer edit_file for surgical changes to an existing file \u2014 write_file refuses to replace a large existing file with a much smaller body, and a failed or empty read of a path you are about to overwrite is a hard stop (not an empty file). New-file create (read 404 / not found) is still allowed. How the write lands depends on the surface: in an editor/on-prem workspace it edits the file in place; in a cloud/review run it is staged on the ticket branch as a reviewable pending change. Do NOT narrate a specific mechanism (e.g. "opened a PR") \u2014 just state what the file now contains. Use once per deliverable file. Provide the FULL file content.',
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      content: { type: "string", description: "Complete file content (no placeholders)." },
      summary: { type: "string", description: "One-line description of the change." }
    },
    required: ["path", "content"]
  },
  requires: ["repo.write"],
  async execute(args, ctx) {
    const path2 = typeof args.path === "string" ? args.path : "";
    const content = typeof args.content === "string" ? args.content : "";
    const summary = typeof args.summary === "string" ? args.summary : void 0;
    if (!path2 || !content) return { data: { ok: false, error: "path and content are both required" } };
    if (ctx.caps.repoRead) {
      let existing;
      try {
        existing = await ctx.caps.repoRead.readFile(path2);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "read failed";
        return {
          data: {
            ok: false,
            error: `cannot overwrite: ${reason}. A failed or empty read is not an empty file \u2014 use edit_file after a successful read, or create a new path.`
          }
        };
      }
      const refusal = refuseWriteOverwrite(probeFromRepoRead(existing), content);
      if (refusal) return { data: { ok: false, error: refusal } };
    }
    const r = await ctx.caps.repoWrite.writeFile(path2, content, summary);
    return { data: r.ok ? { ok: true, branch: r.branch, commitUrl: r.commitUrl } : { ok: false, error: r.error } };
  }
});
var deleteFileTool = defineTool({
  name: "delete_file",
  description: 'Remove a file from the ticket branch so it does NOT ship in the pull request. Use this to clean up dead code: a stub/placeholder, an unreferenced file, or a file a PRIOR pass on this branch created that should not be part of the final change. The "Files already on this branch" list in your context shows what a prior pass left \u2014 reconcile against it. Verify the file is genuinely unused (search_code for its exports) before deleting. Deleting a file not on the branch is a no-op (reported back), not an error.',
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path to remove, e.g. "src/utils/email.ts".' },
      reason: { type: "string", description: 'One-line why this file should not ship (e.g. "stub superseded by existing email infra").' }
    },
    required: ["path"]
  },
  requires: ["repo.delete"],
  async execute(args, ctx) {
    const path2 = typeof args.path === "string" ? args.path : "";
    if (!path2) return { data: { ok: false, error: "path is required" } };
    const reason = typeof args.reason === "string" ? args.reason : void 0;
    const r = await ctx.caps.repoWrite.deleteFile(path2, reason);
    if (r.ok && r.deleted === false) return { data: { ok: true, deleted: false, note: r.note } };
    return { data: r.ok ? { ok: true, deleted: true, branch: r.branch, commitUrl: r.commitUrl } : { ok: false, error: r.error } };
  }
});
var editFileTool = defineTool({
  name: "edit_file",
  description: "Make a surgical in-place edit to an existing file on the ticket branch: replace an exact snippet with new text, without rewriting the whole file. Read the file first so `old_string` matches EXACTLY (including indentation). `old_string` must be unique in the file unless you set `replace_all`. Prefer this over write_file for small changes to large files. A success returns `excerpt` \u2014 the edited lines with line numbers and a little context \u2014 so do NOT re-read the file to check the edit. A miss returns `nearest` \u2014 the closest matching line and its neighbours \u2014 copy `old_string` from there. To change SEVERAL files (or several spots) in one call, pass `edits`: an array of {path, old_string, new_string, replace_all?} (up to 20). A batch is ATOMIC \u2014 all edits apply or none, and on failure the result names the FIRST edit that did not match \u2014 so a multi-file refactor is one call, not a chain that can half-apply.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      old_string: { type: "string", description: "The exact text to replace (must match the file byte-for-byte)." },
      new_string: { type: "string", description: "The replacement text." },
      replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring a unique match. Default false." },
      edits: {
        type: "array",
        maxItems: 20,
        description: "BATCH (instead of path/old_string/new_string): up to 20 {path, old_string, new_string, replace_all?} edits applied atomically in one call. All apply or none; a failure names the first edit that did not match.",
        items: {
          type: "object",
          properties: {
            path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
            old_string: { type: "string", description: "The exact text to replace (must match the file byte-for-byte)." },
            new_string: { type: "string", description: "The replacement text." },
            replace_all: { type: "boolean", description: "Replace every occurrence. Default false." }
          },
          required: ["path", "old_string", "new_string"]
        }
      }
    },
    required: []
  },
  requires: ["repo.edit"],
  async execute(args, ctx) {
    if (Array.isArray(args.edits)) {
      const plan = planBatchEdits(args.edits);
      if (plan.error) return { data: { ok: false, error: plan.error } };
      const read = async (p) => {
        const r2 = await ctx.caps.repoRead?.readFile(p);
        return r2 && r2.ok && typeof r2.content === "string" ? r2.content : null;
      };
      const batch = await applyBatchEdits(plan, {
        read,
        write: async (p, content) => {
          await ctx.caps.repoWrite.writeFile(p, content, "edit_file batch");
        }
      });
      if (!batch.ok) {
        const failed2 = batch.files[batch.files.length - 1];
        return { data: { ok: false, error: failed2.error ?? "batch failed", files: batch.files.map(({ content: _c, ...rest }) => rest) } };
      }
      return {
        data: {
          ok: true,
          batched: true,
          count: batch.files.length,
          files: batch.files.map(({ content: _c, ok, path: path3, error, nearest, ...facts }) => ({
            path: path3,
            ok,
            ...Object.keys(facts).length ? facts : {},
            ...error ? { error } : {},
            ...nearest ? { nearest } : {}
          }))
        }
      };
    }
    const path2 = typeof args.path === "string" ? args.path : "";
    const oldString = typeof args.old_string === "string" ? args.old_string : "";
    const newString = typeof args.new_string === "string" ? args.new_string : "";
    const replaceAll = args.replace_all === true;
    if (!path2 || !oldString) return { data: { ok: false, error: "path and old_string are required" } };
    const r = await ctx.caps.repoWrite.editFile(path2, oldString, newString, replaceAll);
    return {
      data: r.ok ? {
        ok: true,
        ...r.branch ? { branch: r.branch } : {},
        ...r.commitUrl ? { commitUrl: r.commitUrl } : {},
        replaced: r.replaced,
        ...r.region ? { region: r.region } : {},
        ...r.excerpt ? { excerpt: r.excerpt } : {}
      } : { ok: false, error: r.error, ...r.nearest ? { nearest: r.nearest } : {} }
    };
  }
});
var memoryRecallTool = defineTool({
  name: "memory_recall",
  description: "Recall durable facts from cross-run memory that are relevant to a query \u2014 decisions, fixes, project conventions, user preferences you (or another run) stored earlier. Call this FIRST when a task touches an area you may have worked before, instead of re-reading large files or history. Returns the most relevant stored entries (key + content); 0 results means nothing relevant is stored yet.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What you want to remember about, e.g. a subsystem, decision, or convention." },
      limit: { type: "number", description: "Max entries to return (default 5)." }
    },
    required: ["query"]
  },
  requires: ["memory"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return { data: { ok: false, error: "query is required" } };
    const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : void 0;
    const r = await ctx.caps.memory.recall(query, limit);
    return { data: r };
  }
});
var memoryRememberTool = defineTool({
  name: "memory_remember",
  description: "Store ONE durable fact in cross-run memory so a future run can recall it instead of re-deriving it \u2014 a decision, a non-obvious fix, a project constraint, or a user preference. Keep content to one tight line. Use a stable, descriptive key (e.g. 'release-checklist', 'auth-flow'); reusing a key overwrites it. Do NOT store things the repo/git already records or facts that only matter to the current turn.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Stable, descriptive identifier for the fact, e.g. 'deploy-command'." },
      content: { type: "string", description: "The fact, as one concise line." },
      tags: { type: "array", items: { type: "string" }, description: "Optional tags for grouping/filtering." },
      importance: { type: "number", description: "0\u20131; higher surfaces earlier. Default 0.5." },
      scope: {
        type: "string",
        enum: ["tenant", "project", "ticket"],
        description: "How widely this fact should be visible. 'ticket' = only this ticket's runs; 'project' (default) = every run on this project; 'tenant' = the whole workspace. Prefer the NARROWEST scope that is still true \u2014 a project convention is 'project', not 'tenant'."
      },
      ttl_days: {
        type: "number",
        description: "Forget automatically after this many days. Use it for anything time-bound (a release date, a temporary workaround, an in-flight migration). Omit only for facts that stay true indefinitely."
      }
    },
    required: ["key", "content"]
  },
  requires: ["memory"],
  async execute(args, ctx) {
    const key = typeof args.key === "string" ? args.key : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!key.trim() || !content.trim()) return { data: { ok: false, error: "key and content are required" } };
    const tags = Array.isArray(args.tags) ? args.tags.filter((t) => typeof t === "string") : void 0;
    const importance = typeof args.importance === "number" && Number.isFinite(args.importance) ? args.importance : void 0;
    const scope = MEMORY_SCOPES.includes(args.scope) ? args.scope : void 0;
    const ttlDays = typeof args.ttl_days === "number" && Number.isFinite(args.ttl_days) && args.ttl_days > 0 ? args.ttl_days : void 0;
    const r = await ctx.caps.memory.remember(key, content, { tags, importance, scope, ttlDays });
    return { data: r };
  }
});
var MEMORY_SCOPES = ["tenant", "project", "ticket"];
var memoryForgetTool = defineTool({
  name: "memory_forget",
  description: "Delete one stored fact from cross-run memory by its key. Use when a fact you (or an earlier run) stored has become WRONG \u2014 a decision was reversed, a workaround was removed, a convention changed. Correcting a fact is memory_remember with the same key; this is for facts that should no longer exist at all.",
  parameters: {
    type: "object",
    properties: { key: { type: "string", description: "The key of the fact to delete." } },
    required: ["key"]
  },
  requires: ["memory", "memory.forget"],
  async execute(args, ctx) {
    const key = typeof args.key === "string" ? args.key : "";
    if (!key.trim()) return { data: { ok: false, error: "key is required" } };
    const r = await ctx.caps.memory.forget(key);
    return { data: r };
  }
});
var claimResourceTool = defineTool({
  name: "claim_resource",
  description: "Reserve a shared resource before you work on it, so a peer agent working the same ticket does not change it underneath you. Pass a file path ('src/app.ts'), a directory ('src/api/'), or 'repo' for the whole tree. Returns granted:false with the current holder when someone else has it \u2014 then work on something else, or leave a workspace_note explaining what you need. Writes to a path held by another agent are refused whether or not you claim first.",
  parameters: {
    type: "object",
    properties: {
      resource: { type: "string", description: "What to reserve: a repo-relative file path, a directory, or 'repo'." },
      mode: {
        type: "string",
        enum: ["exclusive", "shared"],
        description: "'exclusive' (default) to write it; 'shared' to signal you are reading it and block others' exclusive claims."
      },
      reason: { type: "string", description: "One line on why you need it \u2014 shown to the peer agent that gets refused." }
    },
    required: ["resource"]
  },
  requires: ["coordinate"],
  async execute(args, ctx) {
    const resource = typeof args.resource === "string" ? args.resource : "";
    if (!resource.trim()) return { data: { ok: false, error: "resource is required" } };
    const mode = args.mode === "shared" || args.mode === "exclusive" ? args.mode : void 0;
    const reason = typeof args.reason === "string" ? args.reason : void 0;
    const r = await ctx.caps.coordination.claim(resource, { mode, reason });
    return { data: r };
  }
});
var releaseResourceTool = defineTool({
  name: "release_resource",
  description: "Release a resource you claimed, so a peer agent can take it. Do this as soon as you are finished with it rather than holding it to the end of the run. Every lease this run holds is released automatically when the run ends, so this is an optimisation, not a requirement.",
  parameters: {
    type: "object",
    properties: { resource: { type: "string", description: "The resource string you claimed." } },
    required: ["resource"]
  },
  requires: ["coordinate"],
  async execute(args, ctx) {
    const resource = typeof args.resource === "string" ? args.resource : "";
    if (!resource.trim()) return { data: { ok: false, error: "resource is required" } };
    const r = await ctx.caps.coordination.release(resource);
    return { data: r };
  }
});
var workspaceNoteTool = defineTool({
  name: "workspace_note",
  description: "Publish a short note on the shared workspace for this ticket, readable by every agent working it (now or later in the ticket's lifecycle). Use it to declare intent ('I own the DB migration'), hand off a finding, or record a decision a peer must not contradict. Reusing a key overwrites that note. This is WORKING state for the current ticket \u2014 durable cross-ticket knowledge belongs in memory_remember.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Short stable identifier, e.g. 'owns-migration' or 'api-contract'." },
      content: { type: "string", description: "The note, in one or two lines." }
    },
    required: ["key", "content"]
  },
  requires: ["coordinate"],
  async execute(args, ctx) {
    const key = typeof args.key === "string" ? args.key : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!key.trim() || !content.trim()) return { data: { ok: false, error: "key and content are required" } };
    const r = await ctx.caps.coordination.postNote(key, content);
    return { data: r };
  }
});
var workspaceReadTool = defineTool({
  name: "workspace_read",
  description: "Read the shared workspace for this ticket \u2014 notes posted by peer agents plus the resources they currently hold. Call this EARLY when a ticket may be staffed by more than one agent, so you plan around what others already own instead of colliding with them.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Optional filter; omit to read everything." },
      limit: { type: "number", description: "Max notes to return (default 20)." }
    }
  },
  requires: ["coordinate"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" && args.query.trim() ? args.query : void 0;
    const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : void 0;
    const [notes, leases] = await Promise.all([
      ctx.caps.coordination.readNotes(query, limit),
      ctx.caps.coordination.listClaims()
    ]);
    if (!notes.ok) return { data: notes };
    return { data: { ok: true, notes: notes.notes ?? [], heldResources: leases.ok ? leases.leases ?? [] : [] } };
  }
});
var webFetchTool = defineTool({
  name: "web_fetch",
  description: "Fetch a single URL and return its readable text content (HTML is reduced to text/markdown). Use to read documentation, an API spec, an issue, or any page you have an exact URL for. Returns the status and the (possibly truncated) content.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The absolute http(s) URL to fetch." }
    },
    required: ["url"]
  },
  requires: ["web"],
  async execute(args, ctx) {
    const url = typeof args.url === "string" ? args.url : "";
    if (!url.trim()) return { data: { ok: false, error: "url is required" } };
    const r = await compressWebFetchResult(await ctx.caps.web.fetch(url), ctx);
    return { data: r };
  }
});
var webSearchTool = defineTool({
  name: "web_search",
  description: 'Search the public web for a query and return ranked results (title, url, snippet) plus `coverage` and `attribution`. Use to discover sources/docs when you don\'t have an exact URL; then web_fetch the most relevant result. `coverage: "owned_index"` means this workspace\'s own previously-crawled corpus answered directly; `"web"` or `"encyclopedic"` means a vendor answered and the found pages are being indexed for next time. When `coverage` is "encyclopedic" the index behind this workspace is narrower than a general web engine \u2014 report what you actually found and say what you could not find, rather than filling the gap from memory.',
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." }
    },
    required: ["query"]
  },
  requires: ["web.search"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return { data: { ok: false, error: "query is required" } };
    if (!ctx.caps.web?.search) return { data: { ok: false, error: "web search is not available on this surface" } };
    const r = await ctx.caps.web.search(query);
    return { data: r };
  }
});
var runChecksTool = defineTool({
  name: "run_checks",
  description: "Statically validate the files you have written: it parses committed JSON/YAML and runs the platform's shell-free changed-source quality policies, returning structured path/line/rule diagnostics to fix BEFORE finishing. On the cloud Worker it ALSO polls CI (build/type-check/test) for this branch's HEAD and reports success/pending/failure \u2014 that is this executor's in-run substitute for a local shell. The same static validation runs automatically at finish, so it cannot be skipped. Never claim a build/test passed unless this tool (or run_command on a Container) reported success.",
  parameters: { type: "object", properties: {} },
  requires: ["static-check"],
  async execute(_args, ctx) {
    const r = await ctx.caps.staticCheck.verify();
    return { data: r };
  }
});
var runCommandTool = defineTool({
  name: "run_command",
  description: "Run a shell command in the checked-out repository (real shell). Use it to install dependencies and run the build, type-check, lint, and tests. Returns combined stdout/stderr and the exit code. Verify your changes this way BEFORE calling finish. Do not re-run a command to grep/head/tail its output: when the result has an outputId and the output_filter tool is available, use output_filter on it.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: 'The shell command to run, e.g. "npm install" or "npm test".' },
      cwd: { type: "string", description: 'Optional directory to run in, relative to the workspace root (e.g. "my-project"). Defaults to the run\'s repository; "." is the workspace root. Use this instead of a `cd X &&` prefix.' },
      background: { type: "boolean", description: "Run a long command (a dev server, a full test suite, a build) in the background: returns a job id at once; check it with command_status, stop it with command_stop." },
      yieldMs: { type: "number", description: "Optional: run in the foreground up to this many milliseconds, then hand back a background job id if it is still running." },
      fresh: { type: "boolean", description: "Optional: run it even if an identical read-only command (type-check, test, lint, git status\u2026) already ran with no file changed since \u2014 by default that earlier result comes back marked cached." }
    },
    required: ["command"]
  },
  requires: ["shell"],
  // Where it runs, Stop, and the background modes live in `shell-tools.ts`.
  execute: (args, ctx) => runShellCommand(args, ctx)
});
var askHumanTool = defineTool({
  name: "ask_human",
  description: `Pause and ask a human for input when you are genuinely BLOCKED \u2014 a requirement is ambiguous, you cannot find an expected file/system after searching, a decision needs product/business judgement, or you would otherwise have to guess. The run pauses (no further token spend) and the question goes to the team's human-requests queue with a notification; when someone answers, you resume automatically with their answer and continue. Prefer this over guessing or finishing with a "could not proceed" summary \u2014 a blocked task that asks gets unblocked; one that gives up silently does not. Do NOT use it for things you can determine yourself with list_files/search_code/read_file.`,
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The specific question for the human. Be concrete and self-contained \u2014 they may not have the full task context." },
      context: { type: "string", description: "Optional: what you have tried / why you are blocked, so the human can answer well." }
    },
    required: ["question"]
  },
  requires: ["human"],
  async execute(args, ctx) {
    const question = typeof args.question === "string" ? args.question.trim() : "";
    const context = typeof args.context === "string" ? args.context : void 0;
    if (!question) return { data: { ok: false, error: "question is required to ask a human" } };
    const r = await ctx.caps.human.ask(question, context);
    if (r.paused) {
      return {
        control: { kind: "ask_human", approvalId: r.approvalId, question },
        data: { ok: true, paused: true, note: r.note ?? "Question sent to a human. The run is paused until it is answered; you will resume with the answer." }
      };
    }
    return { data: { ok: true, paused: false, answer: r.answer ?? null, note: r.note } };
  }
});
var updatePrdTool = defineTool({
  name: "update_prd",
  description: `Record a change on THIS TICKET'S PRD \u2014 the shared spec you were given in your context and that every other agent on this ticket reads. Use mode "append" (the default, and the safe one) to add a dated, signed note: a decision you made, a constraint you discovered, an assumption you had to take, or work you deliberately left out of scope. Use mode "section" ONLY to correct a section that is actually WRONG \u2014 it replaces that section's whole body, so pass the full replacement text, not a fragment; name the section by its exact heading (e.g. "Acceptance criteria", "Implementation Notes"). If the heading does not exist the call fails and returns the headings that do \u2014 retry with one of those, or append instead. This is not a substitute for doing the work: keep it to what a later run genuinely needs to know.`,
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["append", "section"],
        description: `"append" adds a dated, attributed note at the end (nothing already written is lost). "section" REPLACES the named section's body \u2014 only for correcting something wrong.`
      },
      section: {
        type: "string",
        description: 'Required when mode is "section": the exact heading to replace, without the leading "##" (e.g. "Acceptance criteria").'
      },
      content: {
        type: "string",
        description: `The markdown to record. For mode "append", the note. For mode "section", the section's COMPLETE new body.`
      }
    },
    required: ["mode", "content"]
  },
  requires: ["prd.write"],
  async execute(args, ctx) {
    const mode = args.mode === "section" ? "section" : "append";
    const content = typeof args.content === "string" ? args.content.trim() : "";
    if (!content) return { data: { ok: false, error: "content is required" } };
    if (mode === "section") {
      const heading = typeof args.section === "string" ? args.section.trim() : "";
      if (!heading) {
        return {
          data: {
            ok: false,
            error: 'section is required when mode is "section" \u2014 pass the exact heading to replace, or use mode "append" to add a note instead.'
          }
        };
      }
      const edited = await ctx.caps.prd.editSection(heading, content);
      return { data: edited };
    }
    const appended = await ctx.caps.prd.append(content);
    return { data: appended };
  }
});
var finishTool = defineTool({
  name: "finish",
  description: 'Call ONLY when the task is fully complete \u2014 every deliverable file written with real, working content (no stubs/placeholders) and every task/PRD requirement implemented. Your changes open a pull request for human review, so a partial scaffold is not "done". Provide a concise summary of what was delivered. Do NOT assert that a build/type-check/lint/test passed \u2014 you cannot run those here (CI on the PR verifies). If you are blocked rather than done, call ask_human instead of finishing with a "could not proceed" summary.',
  parameters: {
    type: "object",
    properties: { summary: { type: "string", description: "What was delivered." } },
    required: ["summary"]
  },
  // No capability: every surface can finish. The engine applies the honesty +
  // anti-stub finish gates around this control signal (loop policy, not a tool).
  async execute(args) {
    const summary = typeof args.summary === "string" ? args.summary.trim() : "";
    return { control: { kind: "finish", summary }, data: { ok: true } };
  }
});
var CORE_TOOLS = [
  listFilesTool,
  searchCodeTool,
  readFileTool,
  ...SYMBOL_TOOLS,
  ...SEMANTIC_TOOLS,
  localResearchTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  runChecksTool,
  runCommandTool,
  ...SHELL_JOB_TOOLS,
  analyzeCodebaseTool,
  ...GIT_TOOLS,
  webFetchTool,
  webSearchTool,
  memoryRecallTool,
  memoryRememberTool,
  memoryForgetTool,
  claimResourceTool,
  releaseResourceTool,
  workspaceNoteTool,
  workspaceReadTool,
  askHumanTool,
  updatePrdTool,
  finishTool
];

// ../packages/agent-tools/src/knowledge-notes.ts
var import_working2 = require("@seanhogg/builderforce-memory/working");

// ../packages/agent-tools/src/run-knowledge.ts
var import_working3 = require("@seanhogg/builderforce-memory/working");

// ../packages/agent-tools/src/skill-tools.ts
var skillProposeTool = defineTool({
  name: "skill_propose",
  description: "Propose a reusable SKILL \u2014 a procedure a future agent can follow \u2014 drafted from work you just completed and verified. Use it when you worked out a repeatable way to do something non-obvious in this codebase (a migration + guard + test sequence, a release path, a debugging route) and a future run would otherwise rediscover it. Do NOT propose a skill for a one-off fix, for something the repo already documents, or for a procedure you did not actually complete. The draft goes to a human for review; it does not take effect until approved.",
  parameters: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description: "Stable kebab-case id, e.g. 'add-a-schema-column'. Re-using one revises your existing draft."
      },
      name: { type: "string", description: "Short human title, e.g. 'Add a schema column end to end'." },
      description: {
        type: "string",
        description: "One line saying WHEN to use this skill \u2014 a future agent matches on this, so name the situation, not the steps."
      },
      body: {
        type: "string",
        description: "The procedure as Markdown: ordered steps, exact commands, and how to tell it worked."
      },
      evidence: {
        type: "string",
        description: "What proves this procedure works \u2014 the graded proof, the merged PR, the passing check."
      }
    },
    required: ["slug", "name", "description", "body"]
  },
  requires: ["skill.author"],
  async execute(args, ctx) {
    const str3 = (v) => typeof v === "string" ? v.trim() : "";
    const slug = str3(args.slug);
    const name = str3(args.name);
    const description = str3(args.description);
    const body = str3(args.body);
    if (!slug || !name || !description || !body) {
      return { data: { ok: false, error: "slug, name, description and body are all required" } };
    }
    const evidence = str3(args.evidence);
    const r = await ctx.caps.skillAuthor.propose({
      slug,
      name,
      description,
      body,
      ...evidence ? { evidence } : {}
    });
    return { data: r };
  }
});
var skillListTool = defineTool({
  name: "skill_list",
  description: "List the skills this workspace already has \u2014 approved ones you can follow, and drafts awaiting review. Call it before proposing, so you revise an existing draft instead of adding a near-duplicate.",
  parameters: { type: "object", properties: {} },
  requires: ["skill.author"],
  async execute(_args, ctx) {
    const r = await ctx.caps.skillAuthor.list();
    return { data: r };
  }
});

// ../packages/agent-tools/src/live-subagent-tools.ts
var LIVE_DELEGATION_NOTE = "HERE the child runs IN THE BACKGROUND: the call returns its handle at once and you keep working \u2014 plan, code, or start more children \u2014 while it does its slice. Its messages appear in the chat under its own name, and its report reaches you on its own when it finishes (call wait_agents only when you cannot go on without it). Redirect it with message_agent; cancel it with stop_agent. Do not edit the files a child is working on while it runs.";
var BLOCKING_DELEGATION_NOTE = "HERE the call BLOCKS: you wait while the child does its slice, and its report is the call's result. There is no background handle, nothing to wait for or redirect afterwards, so delegate a slice you can afford to wait for. A child cannot delegate further.";
function delegationNote(caps) {
  return caps.has("orchestrate.live") ? LIVE_DELEGATION_NOTE : BLOCKING_DELEGATION_NOTE;
}
function withDelegationNote(def) {
  return { ...def, describeFor: (caps) => def.schema.function.description.replace(LIVE_DELEGATION_NOTE, delegationNote(caps)) };
}
var VERIFY_DELEGATION_STEP = 'Hand the checking to ONE verify sub-agent (spawn_agent, role "verify"): brief it with the files changed and how to know the change is done; it runs the narrowest type-check, build and tests on a cheaper model and reports each failure verbatim. Fix what it reports \u2014 yourself or with a code sub-agent \u2014 and verify again until it passes. When the checks are only a few known commands, do not delegate them: run them yourself with run_command background:true. Never run a command a live child was briefed to run \u2014 call wait_agents for its result.';
var VERIFY_STEP = `${VERIFY_DELEGATION_STEP} Where you cannot spawn, run the narrowest type-check, build and tests that cover what you touched yourself, and fix whatever fails.`;
var RESOLVE_OPEN_ISSUES = "resolve every open issue the reports name: fix it yourself, send it back with message_agent, or hand it to a code sub-agent";
var LIVE_FANOUT_NEXT = `Keep working on anything not delegated. When their reports are in (they arrive on their own, or call wait_agents), ${RESOLVE_OPEN_ISSUES}; fix anything the slices broke between them, then check the combined result. ${VERIFY_DELEGATION_STEP} Report per workstream and ticket.`;
var OPEN_ISSUES_HEAD = `Open issues \u2014 yours before you finish (${RESOLVE_OPEN_ISSUES}; then verify again):`;
var SUBAGENT_CONTROL_TOOL_NAMES = { wait: "wait_agents", message: "message_agent", stop: "stop_agent" };
var MAX_WAIT_SECONDS = 600;
var DEFAULT_WAIT_SECONDS = 300;
var handlesOf = (v) => Array.isArray(v) ? v.filter((h) => typeof h === "string" && h.trim() !== "").map((h) => h.trim()) : [];
var live = (ctx) => ctx.caps.orchestration?.live ?? null;
var unavailable = () => ({ data: { ok: false, error: "this surface runs no background sub-agents" } });
var waitAgentsTool = defineTool({
  name: SUBAGENT_CONTROL_TOOL_NAMES.wait,
  description: "Wait for your running sub-agents and collect their reports. Use it only when your next step depends on their results (e.g. verifying and committing a fan-out). Pass `agents` to wait for specific handles; omit it to wait for all of yours. Returns the reports that came in and which are still running at the timeout.",
  parameters: {
    type: "object",
    properties: {
      agents: { type: "array", items: { type: "string" }, description: "Handles to wait for, e.g. ['a1','a3']. Omit for all of yours." },
      timeout_seconds: { type: "number", description: `How long to wait (default ${DEFAULT_WAIT_SECONDS}, max ${MAX_WAIT_SECONDS}).` }
    }
  },
  requires: ["orchestrate.live"],
  async execute(args, ctx) {
    const controls = live(ctx);
    if (!controls) return unavailable();
    const seconds = Math.min(MAX_WAIT_SECONDS, Math.max(1, Number(args.timeout_seconds) || DEFAULT_WAIT_SECONDS));
    const { reports, running, note } = await controls.wait(handlesOf(args.agents), seconds * 1e3, ctx.signal);
    const changedFiles = [...new Set(reports.flatMap((r) => r.changedFiles ?? []))];
    return {
      data: {
        ok: true,
        reports,
        running,
        // Read by the ticket backstop (`codeChangesOf`) like any delegation result.
        ...changedFiles.length ? { changedFiles } : {},
        ...note ? { note } : running.length ? { note: `${running.join(", ")} still running \u2014 their reports will reach you when they finish.` } : {}
      }
    };
  }
});
var messageAgentTool = defineTool({
  name: SUBAGENT_CONTROL_TOOL_NAMES.message,
  description: "Redirect one of your running sub-agents mid-task: narrow its scope, correct a wrong assumption, hand it a fact it lacks. It reads the message before its next step. The message is shown in the chat.",
  parameters: {
    type: "object",
    properties: {
      agent: { type: "string", description: "The child's handle, e.g. 'a2'." },
      message: { type: "string", description: "The direction, standalone \u2014 it has none of your conversation." }
    },
    required: ["agent", "message"]
  },
  requires: ["orchestrate.live"],
  async execute(args, ctx) {
    const controls = live(ctx);
    if (!controls) return unavailable();
    const handle = typeof args.agent === "string" ? args.agent.trim() : "";
    const text = typeof args.message === "string" ? args.message.trim() : "";
    if (!handle || !text) return { data: { ok: false, error: "agent and message are required" } };
    const out = await controls.message(handle, text);
    return { data: out };
  }
});
var stopAgentTool = defineTool({
  name: SUBAGENT_CONTROL_TOOL_NAMES.stop,
  description: "Stop running sub-agents of yours \u2014 one or more by handle, or all of them. A stopped child reports what it had done.",
  parameters: {
    type: "object",
    properties: {
      agents: { type: "array", items: { type: "string" }, description: "Handles to stop. Omit to stop ALL of your running children." }
    }
  },
  requires: ["orchestrate.live"],
  async execute(args, ctx) {
    const controls = live(ctx);
    if (!controls) return unavailable();
    const named = handlesOf(args.agents);
    const stopped = await controls.stop(named.length ? named : "all");
    return { data: { ok: true, stopped } };
  }
});
var SUBAGENT_CONTROL_TOOLS = [waitAgentsTool, messageAgentTool, stopAgentTool];

// ../packages/agent-tools/src/subagent-tools.ts
var ROLE_ENUM_DESCRIPTION = MODEL_ROLES.map((role) => `${role} \u2014 ${MODEL_ROLE_DESCRIPTIONS[role]}`).join(" \xB7 ");
var spawnAgentTool = withDelegationNote(defineTool({
  name: "spawn_agent",
  description: "Delegate a self-contained sub-task to a child agent that works in its OWN context and reports back when it is done. Use it when finding something out would take many turns you do not want to carry \u2014 locating where a behaviour lives across an unfamiliar tree, checking whether a pattern is used anywhere else, summarising a large file you only need one fact from. The child sees NOTHING of this conversation, so `task` must state everything it needs to know, and it answers in prose \u2014 it cannot hand you files or tool output. Do NOT delegate work you can do in a turn or two. The child is a clone of you: it holds every tool you hold and carries its slice out end to end \u2014 investigating, editing, running commands, recording the work. You remain accountable for what ships, so check what it reports. " + LIVE_DELEGATION_NOTE,
  parameters: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "A few words naming the delegation, e.g. 'locate the auth middleware'. Shown on the run timeline."
      },
      task: {
        type: "string",
        description: "The child's complete brief: what to find out or do, where to look, and exactly what to report back. Assume it knows nothing about the ticket beyond what you write here."
      },
      role: {
        type: "string",
        enum: [...MODEL_ROLES],
        description: `What kind of call the child's turns are \u2014 lets the surface pick a model suited to the work rather than reusing yours. Defaults to 'code'. ${ROLE_ENUM_DESCRIPTION}`
      },
      as_agent: {
        type: "string",
        description: "Run the child AS one of the workspace's agents \u2014 its id or name (e.g. 'Ada'). The child adopts that agent's role, bio, skills and personality so the delegated slice is done in that agent's voice and expertise. Prefer an agent already in this chat (builtin_chats_list_agents) or from builtin_cloud_agents_list_mine. Optional: when no teammate's role fits the slice, omit it and the child runs as a plain sub-agent."
      }
    },
    required: ["label", "task"]
  },
  requires: ["orchestrate"],
  async execute(args, ctx) {
    const str3 = (v) => typeof v === "string" ? v.trim() : "";
    const label = str3(args.label);
    const task = str3(args.task);
    if (!task) return { data: { ok: false, error: "task is required \u2014 the child sees none of your conversation" } };
    const role = delegationRole(args.role);
    const asAgent = str3(args.as_agent);
    const r = await ctx.caps.orchestration.spawn({
      label: label || task.slice(0, 60),
      task,
      role,
      ...asAgent ? { asAgent } : {}
    });
    return { data: r, ...r.ok ? {} : { isError: true } };
  }
}));
var MAX_WORKSTREAMS = 4;
var FANOUT_OUTPUT_CHARS = 4800;
var SPAWN_AGENTS_TOOL = "spawn_agents";
function parseWorkstreams(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return "workstreams is required \u2014 one entry per independent slice";
  if (raw.length > MAX_WORKSTREAMS) {
    return `at most ${MAX_WORKSTREAMS} workstreams per call \u2014 run the rest in a second call once these are back`;
  }
  const str3 = (v) => typeof v === "string" ? v.trim() : "";
  const out = [];
  for (const [i, item] of raw.entries()) {
    const w = item ?? {};
    const task = str3(w.task);
    if (!task) return `workstream ${i + 1} has no task \u2014 each child sees none of your conversation`;
    const ticket = str3(w.ticket);
    const role = str3(w.role);
    out.push({
      label: str3(w.label) || task.slice(0, 60),
      task,
      ...ticket ? { ticket } : {},
      ...role ? { role } : {},
      asAgent: str3(w.as_agent)
    });
  }
  return out;
}
var spawnAgentsTool = withDelegationNote(defineTool({
  name: SPAWN_AGENTS_TOOL,
  description: `Run SEVERAL independent workstreams side by side \u2014 up to ${MAX_WORKSTREAMS} child agents at once, each in its own context, each reporting back to the chat. Use it when the request splits into slices that do not depend on each other: a PRD's workstreams, one change per package or feature. Each child is a clone of you with every tool you hold, and carries its slice out end to end. Give slices that do not touch the same files, so they do not overwrite each other; once their reports are in, check the combined result and report per workstream. File one ticket per workstream first and pass its id as \`ticket\`. Each child sees nothing of this conversation, so every \`task\` must stand alone: what to change, where, and how to know it is done. ` + LIVE_DELEGATION_NOTE,
  parameters: {
    type: "object",
    properties: {
      workstreams: {
        type: "array",
        minItems: 1,
        maxItems: MAX_WORKSTREAMS,
        description: "One entry per independent slice of the work.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "A few words naming the workstream, e.g. 'W8: company \u2192 project'." },
            task: { type: "string", description: "The child's complete, standalone brief." },
            ticket: { type: "string", description: "The ticket this workstream delivers, echoed in the result." },
            role: { type: "string", enum: [...MODEL_ROLES], description: "Model role for the child. Defaults to code." },
            as_agent: { type: "string", description: "Run this workstream AS one of the workspace's agents (its name or id). Optional: omit it when no teammate's role fits, and the child runs as a plain sub-agent." }
          },
          required: ["label", "task"]
        }
      }
    },
    required: ["workstreams"]
  },
  requires: ["orchestrate.fanout"],
  // The CLOUD form: each child is one `orchestrate` spawn — its own durable run. The
  // editor starts its children as runs in its own process (`subagentFanOutTool.ts`) on
  // the same schema and parser.
  async execute(args, ctx) {
    const parsed = parseWorkstreams(args.workstreams);
    if (typeof parsed === "string") return { data: { ok: false, error: parsed } };
    const outputChars = Math.floor(FANOUT_OUTPUT_CHARS / parsed.length);
    const results = await Promise.all(parsed.map((w) => ctx.caps.orchestration.spawn({
      label: w.label,
      task: w.task,
      role: delegationRole(w.role),
      outputChars,
      ...w.ticket ? { ticket: w.ticket } : {},
      ...w.asAgent ? { asAgent: w.asAgent } : {}
    }).then((r) => ({ label: w.label, ...r }))));
    return {
      data: {
        ok: results.every((r) => r.ok),
        workstreams: results,
        next: LIVE_FANOUT_NEXT
      }
    };
  }
}));
var SUBAGENT_TOOLS = [spawnAgentTool, spawnAgentsTool, ...SUBAGENT_CONTROL_TOOLS];

// ../packages/agent-tools/src/symbolRelations.ts
var import_knowledge6 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/symbolImports.ts
var IMPORT_NAMED = new RegExp(`^\\s*(?:type\\s+)?(${ID})(?:\\s+as\\s+(${ID}))?\\s*$`);
var IMPORT_NAMESPACE = new RegExp(`\\*\\s*as\\s+(${ID})`);
var IMPORT_DEFAULT = new RegExp(`^\\s*(${ID})\\s*(?:,|$)`);

// ../packages/agent-tools/src/symbolRelations.ts
var import_knowledge7 = require("@seanhogg/builderforce-memory/knowledge");
var LEADING_TYPE = new RegExp(`^\\s*(${ID}(?:\\s*\\.\\s*${ID})?)`);
var FIELD = new RegExp(`^\\s*(?:(?:public|private|protected|readonly|static|declare|override|abstract|accessor)\\s+)*#?(${ID})\\s*[?!]?\\s*:\\s*([^=;]+)`);
var FIELD_INIT = new RegExp(`^\\s*(?:(?:public|private|protected|readonly|static|override)\\s+)*#?(${ID})\\s*=`);
var NEW = new RegExp(`(?:^|[^\\w$])new\\s+(${ID}(?:\\.${ID})?)`);
var PARAM_PROP = new RegExp(`\\b(?:public|private|protected|readonly)\\s+(?:readonly\\s+)?(${ID})\\s*\\??\\s*:\\s*(${ID}(?:\\.${ID})?)`, "g");
var LOCAL_DECL = new RegExp(`\\b(?:const|let|var|function\\s*\\*?|class|catch\\s*\\()\\s*(${ID})`, "g");
var LAST_ID = new RegExp(`(${ID})\\s*(?:=[^,]*)?\\s*$`);
var CALLBACK_PARAMS = new RegExp(`(?:\\(([^()]*)\\)(?:\\s*:\\s*[^=()]+)?\\s*=>|(${ID})\\s*=>|\\bfunction\\b[^(]*\\(([^()]*)\\))\\s*\\{\\s*$`);
var PARAM_NAME = new RegExp(`^\\s*(?:\\.\\.\\.)?(?:(?:public|private|protected|readonly)\\s+)*(${ID})`);

// ../packages/agent-tools/src/knowledge/codePack.ts
var import_knowledge22 = require("@seanhogg/builderforce-memory/knowledge");
var import_ingest4 = require("@seanhogg/builderforce-memory/ingest");

// ../packages/agent-tools/src/knowledge/codeComplexity.ts
var TERNARY = String.raw`\?(?![.:,)=]|\(\s*\)\s*:)`;
var JS_DECISIONS = new RegExp(String.raw`\b(?:if|for|while|case|catch)\b|&&|\|\||\?\?|${TERNARY}`, "g");
var OO_DECISIONS = new RegExp(String.raw`\b(?:if|for|foreach|while|case|catch)\b|&&|\|\||\?\?|${TERNARY}`, "g");

// ../packages/agent-tools/src/knowledge/codeConcurrency.ts
var import_knowledge8 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/codeNodes.ts
var import_knowledge9 = require("@seanhogg/builderforce-memory/knowledge");
var import_working4 = require("@seanhogg/builderforce-memory/working");
var import_ingest2 = require("@seanhogg/builderforce-memory/ingest");
var CODE_PACK_ID = "code";
var CODE_BADGES = {
  /** The symbol extractor's language family (`js`, `python`, …). */
  language: "language",
  /** Definitions in the file. */
  symbols: "symbols",
  /** Exported definitions in the file. */
  exports: "exports",
  /** knip: `'file'` when the whole file is unused. */
  unused: "unused",
  /** knip: unused exports in the file. */
  unusedExports: "unusedExports",
  /** knip: unused dependencies declared by the file (a package manifest). */
  unusedDependencies: "unusedDependencies",
  /** knip: the names of the file's unused exports, sorted and comma-joined: one `unused-export` finding each (PRD 41 §C3). */
  unusedExportNames: "unusedExportNames",
  /** knip: the names of the manifest's unused dependencies, sorted and comma-joined: one `unused-dependency` finding each. */
  unusedDependencyNames: "unusedDependencyNames",
  /** Lines in the file (deterministic): the god-module finding's size measure. */
  lines: "lines",
  /** Sum of cyclomatic complexity over the file's functions (deterministic). */
  complexity: "complexity",
  /** The worst function's cyclomatic complexity (deterministic). */
  maxComplexity: "maxComplexity",
  /** 0..1 line coverage from `coverage-final.json` / `lcov.info` under the root (runtime). */
  coverage: "coverage",
  /** Commits touching the file in the last 90 days, from the host's `HistoryPort` (deterministic). */
  churn: "churn",
  /** The file's co-change partners over the last year of history (memory's `encodeCoChange`, PRD 38 P4); absent with none. */
  coChange: import_knowledge9.COCHANGE_BADGE,
  /** First CODEOWNERS owner of the file (deterministic). */
  owner: "owner",
  /** Comma-separated design-pattern ids (heuristic). */
  patterns: "patterns",
  /** `METHOD path` route registrations joined by `;`, capped at 50 (deterministic). */
  routes: "routes",
  /** The rule that placed the file's layer: `folder`, `name` or `imports`. */
  layerRule: "layerRule",
  /** `1` on a package entry point a manifest names (`main` / `bin` / `exports`): layer resolution reads it, never the filesystem. */
  entry: "entry",
  /** Comma-joined ids of the known external services the file imports (`postgres,llm`), from `externalServices.ts` (deterministic). */
  externals: "externals",
  /** Comma-joined concurrency the file starts (`durable-object:ChatRoom,poller`), from `codeConcurrency.ts` (deterministic). */
  concurrency: "concurrency"
};

// ../packages/agent-tools/src/knowledge/codePatterns.ts
var import_knowledge10 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/codeRoutes.ts
var METHODS = "get|post|put|patch|delete|options|head|all";
var ROUTER_FILE = new RegExp(
  String.raw`\bfrom\s*['"](?:hono(?:/[^'"]*)?|@hono/[^'"]*|express|fastify|koa-router|@koa/router|[^'"]*/router(?:\.js)?)['"]` + String.raw`|\brequire\s*\(\s*['"](?:express|hono)['"]\s*\)|\bnew\s+Hono\b|\bexpress\.Router\s*\(|\bRouter\s*\(\s*\)`
);
var REGISTRATION = new RegExp(String.raw`([A-Za-z_$][\w$]*)\s*\.\s*(${METHODS}|route)\s*\(\s*(['"` + "`" + String.raw`])(/[^'"` + "`" + String.raw`]*)\3\s*(,)?`, "g");
var NEXT_WITH_PATH = new RegExp(String.raw`\s*\.\s*(${METHODS})\s*\(\s*(['"` + "`" + String.raw`])(/[^'"` + "`" + String.raw`]*)\2\s*,`, "y");
var NEXT_ANY = new RegExp(String.raw`\s*\.\s*(${METHODS})\s*\(`, "y");

// ../packages/agent-tools/src/knowledge/codeFindings.ts
var import_knowledge15 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/rules/unusedDependency.ts
var import_knowledge12 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/rules/unusedItems.ts
var import_knowledge11 = require("@seanhogg/builderforce-memory/knowledge");
var codeFiles = (g) => g.nodes.filter((n) => n.pack === CODE_PACK_ID && n.kind === "file").sort((a, b) => (0, import_knowledge11.compareStr)(a.ref, b.ref));
var namesOf = (n, badge) => [...new Set(String(n.badges?.[badge] ?? "").split(",").filter(Boolean))].sort(import_knowledge11.compareStr);
function itemFindings(n, item) {
  const ref = n.ref;
  const names = namesOf(n, item.names);
  if (names.length === 0) {
    const count = Number(n.badges?.[item.count] ?? 0) || 0;
    return count > 0 ? [(0, import_knowledge11.finding)(item.kind, CODE_PACK_ID, [ref], "info", { count, files: 1 }, void 0, (0, import_knowledge11.refAnchor)(ref))] : [];
  }
  return names.map((name) => {
    const anchor = `${ref}#${name}`;
    return (0, import_knowledge11.finding)(item.kind, CODE_PACK_ID, [ref], "info", { count: 1, files: 1, name }, [anchor], { anchor, anchorKind: item.anchorKind });
  });
}

// ../packages/agent-tools/src/knowledge/rules/unusedDependency.ts
var ITEM = { kind: "unused-dependency", names: CODE_BADGES.unusedDependencyNames, count: CODE_BADGES.unusedDependencies, anchorKind: "package" };
var unusedDependencyRule = (0, import_knowledge12.defineRule)({
  id: "code.unused-dependency",
  version: 1,
  reads: [],
  // the knowledge graph only
  scope: "global",
  extraInputs: ["knowledge"],
  derive: ({ extra: { knowledge: k } }) => codeFiles(k.graph).flatMap((n) => itemFindings(n, ITEM))
});

// ../packages/agent-tools/src/knowledge/rules/unusedExport.ts
var import_knowledge13 = require("@seanhogg/builderforce-memory/knowledge");
var ITEM2 = { kind: "unused-export", names: CODE_BADGES.unusedExportNames, count: CODE_BADGES.unusedExports, anchorKind: "symbol" };
var unusedExportRule = (0, import_knowledge13.defineRule)({
  id: "code.unused-export",
  version: 1,
  reads: [],
  // the knowledge graph only
  scope: "global",
  extraInputs: ["knowledge"],
  derive: ({ extra: { knowledge: k } }) => codeFiles(k.graph).flatMap((n) => itemFindings(n, ITEM2))
});

// ../packages/agent-tools/src/knowledge/rules/unusedFile.ts
var import_knowledge14 = require("@seanhogg/builderforce-memory/knowledge");
var unusedFileRule = (0, import_knowledge14.defineRule)({
  id: "code.unused-file",
  version: 1,
  reads: [],
  // the knowledge graph only
  scope: "global",
  extraInputs: ["knowledge"],
  derive: ({ extra: { knowledge: k } }) => codeFiles(k.graph).filter((n) => n.badges?.[CODE_BADGES.unused] === "file").map((n) => (0, import_knowledge14.finding)("unused-file", CODE_PACK_ID, [n.ref], "info", { count: 1, files: 1 }, void 0, (0, import_knowledge14.refAnchor)(n.ref)))
});

// ../packages/agent-tools/src/knowledge/codeFindings.ts
var CODE_FACT_RULES = Object.freeze([unusedFileRule, unusedExportRule, unusedDependencyRule]);

// ../packages/agent-tools/src/knowledge/codeRollup.ts
var import_knowledge18 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/moduleAliases.ts
var import_knowledge16 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/rootId.ts
var import_knowledge17 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/deploy/deployParser.ts
var import_knowledge20 = require("@seanhogg/builderforce-memory/knowledge");
var import_ingest3 = require("@seanhogg/builderforce-memory/ingest");

// ../packages/agent-tools/src/knowledge/deploy/deployNodes.ts
var import_knowledge19 = require("@seanhogg/builderforce-memory/knowledge");
var DEPLOY_BADGES = {
  type: "type",
  unitKind: "unitKind",
  runtime: "runtime",
  /** Comma-joined port numbers. */
  ports: "ports",
  /** Comma-joined env var NAMES (capped at 40). */
  env: "env",
  /** `;`-joined schedules. */
  cron: "cron",
  /** Comma-joined root-relative folders / files it builds from ('.' = the root). */
  source: "source",
  /** Comma-joined `kind:name` of its bindings. */
  bindings: "bindings",
  /** Comma-joined queue names it sends to / consumes. */
  produces: "produces",
  consumes: "consumes",
  externals: CODE_BADGES.externals,
  /** Binding nodes: what kind of resource it is. */
  bindingKind: "bindingKind",
  /** The descriptor's file node: its family (`wrangler`, `compose`, …) and how many units it declares. */
  deploy: "deploy",
  units: "units",
  /** A package.json's `workspaces` globs, comma-joined. */
  workspaces: "workspaces"
};
var UNIT_PREFIX = `ent:${CODE_PACK_ID}:unit:`;
var BINDING_PREFIX = `ent:${CODE_PACK_ID}:binding:`;

// ../packages/agent-tools/src/knowledge/deploy/parseDescriptor.ts
var MAX_DESCRIPTOR_CHARS = 256 * 1024;

// ../packages/agent-tools/src/knowledge/codeLayers.ts
var import_knowledge21 = require("@seanhogg/builderforce-memory/knowledge");
var FOLDER_LAYERS = {
  presentation: ["routes", "components", "app", "pages", "webview", "views", "hooks", "handlers", "controllers", "ui"],
  application: ["application", "use-cases", "usecases", "services", "lib", "clients", "commands", "queries"],
  domain: ["domain", "models", "entities", "types"],
  infrastructure: ["infrastructure", "db", "adapters", "repositories", "providers", "storage", "persistence", "migrations"]
};
var NOT_AT_TOP_LEVEL = /* @__PURE__ */ new Set(["clients"]);
var NAME_RULES = [
  { layer: "presentation", globs: ["*.tsx", "*.jsx", "*.vue", "*.svelte"], beatsFolder: true },
  { layer: "infrastructure", globs: ["*Repository.*", "*Adapter.*", "*Provider.*", "*Storage.*", "*Gateway.*", "*Dao.*"] },
  { layer: "domain", globs: ["*.types.*", "*.model.*", "*.entity.*", "*Model.*", "*Entity.*", "*Types.*", "types.*", "models.*", "entities.*"] },
  { layer: "application", globs: ["*Service.*", "*UseCase.*", "*Client.*", "*Command.*", "*Query.*", "*Manager.*"] },
  { layer: "presentation", globs: ["use*.*"], guard: /^use[A-Z]/ },
  { layer: "presentation", globs: ["*Route.*", "*Routes.*", "*Handler.*", "*Controller.*", "*Page.*", "*View.*", "*.route.*"] }
];
var ALLOW = {
  presentation: ["application", "domain"],
  application: ["domain"],
  domain: [],
  infrastructure: ["domain", "application"]
};
var TABLE_LAYERS = Object.keys(FOLDER_LAYERS);
function defaultLayerRegistry() {
  return {
    layerSet: "default",
    partitions: TABLE_LAYERS.map((id, order) => ({
      id,
      order,
      match: [
        ...FOLDER_LAYERS[id].map((seg) => NOT_AT_TOP_LEVEL.has(seg) ? `**/*/${seg}/**` : `**/${seg}/**`),
        ...NAME_RULES.filter((r) => r.layer === id && !r.guard).flatMap((r) => r.globs.map((g) => `**/${g}`))
      ]
    })),
    allow: { ...ALLOW }
  };
}
var CODE_LAYERS = defaultLayerRegistry();

// ../packages/agent-tools/src/knowledge/knowledgePacks.ts
var import_knowledge24 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/documents/documentsPack.ts
var import_knowledge23 = require("@seanhogg/builderforce-memory/knowledge");
var import_ingest5 = require("@seanhogg/builderforce-memory/ingest");
var DOCUMENTS_PACK_ID = "documents";
var documentsParser = {
  ...import_ingest5.plainTextParser,
  id: "documents",
  accepts: (source) => source.content.kind === "text" && isExtractableDocumentType(source.content.mediaType ?? "")
};
var DOCUMENTS_PACK = {
  id: DOCUMENTS_PACK_ID,
  parsers: [documentsParser],
  ...import_knowledge23.DOCS_PACK.judgement ? { judgement: import_knowledge23.DOCS_PACK.judgement } : {}
};

// ../packages/agent-tools/src/knowledge/codeExtracted.ts
var import_knowledge25 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/facts/fileFactsOf.ts
var import_knowledge27 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/facts/factsAst.ts
var import_knowledge26 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/reviewRunner.ts
var import_knowledge38 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/codeGraph.ts
var import_knowledge29 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/deploy/deployGraph.ts
var import_knowledge28 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/codeRootSignals.ts
var import_knowledge32 = require("@seanhogg/builderforce-memory/knowledge");
var import_ingest6 = require("@seanhogg/builderforce-memory/ingest");

// ../packages/agent-tools/src/knowledge/codeCoverage.ts
var MAX_FILE_BYTES = 40 * 1024 * 1024;

// ../packages/agent-tools/src/knowledge/codeOwners.ts
var import_knowledge30 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/historyPort.ts
var import_knowledge31 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/fileEdits.ts
var import_knowledge33 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/workspaceAnalysis.ts
var import_ingest7 = require("@seanhogg/builderforce-memory/ingest");

// ../packages/agent-tools/src/knowledge/graphIgnore.ts
var import_knowledge34 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/workspaceAnalysis.ts
var MAX_GRAPH_FILE_BYTES = 256 * 1024;
var FAILED_RETAIN_MS = 2 * 6e4;
var cache = createShaCache({
  keep: (held) => held.retainMs === 0 ? false : held.retainMs ?? true
});

// ../packages/agent-tools/src/knowledge/reviewJudgePass.ts
var import_knowledge35 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/judgement.ts
var import_knowledge36 = require("@seanhogg/builderforce-memory/knowledge");
var KNOWLEDGE_EXTRACT_SYSTEM = [
  "You read one section of a document and list what it asserts.",
  'Reply with JSON only: {"extract":[{"ref":<the ref given>,"claims":[{"subject","predicate","object","quote"}],"entities":[{"name","type"}]}]}.',
  'A claim is one factual assertion the text makes. "quote" is the supporting text, at most 3 lines, copied verbatim.',
  "Entities are the named things the section is about (people, organisations, systems, documents, terms).",
  "Return empty arrays when the section asserts nothing."
].join("\n");
var KNOWLEDGE_COMPARE_SYSTEM = [
  "You compare two claims.",
  'Reply with JSON only: {"compare":[{"a":<ref a>,"b":<ref b>,"relation":"contradicts"|"agrees"|"unrelated","confidence":<0..1>}]}.'
].join("\n");

// ../packages/agent-tools/src/knowledge/measuredWith.ts
var import_knowledge37 = require("@seanhogg/builderforce-memory/knowledge");
var TYPESCRIPT_VERSION = TYPESCRIPT_PIN.slice(TYPESCRIPT_PIN.lastIndexOf("@") + 1);

// ../packages/agent-tools/src/knowledge/humanFact.ts
var import_knowledge39 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/documents/documentDoc.ts
var import_knowledge40 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/index/persistence.ts
var import_knowledge41 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/replicaQueue.ts
var import_knowledge42 = require("@seanhogg/builderforce-memory/knowledge");
var import_pack = require("@seanhogg/builderforce-memory/knowledge/pack");

// ../packages/agent-tools/src/knowledge/replicatedStore.ts
var import_pack2 = require("@seanhogg/builderforce-memory/knowledge/pack");

// ../packages/agent-tools/src/knowledge/replicaPump.ts
var import_pack5 = require("@seanhogg/builderforce-memory/knowledge/pack");

// ../packages/agent-tools/src/knowledge/replicaPack.ts
var import_knowledge43 = require("@seanhogg/builderforce-memory/knowledge");
var import_pack3 = require("@seanhogg/builderforce-memory/knowledge/pack");
var DEFAULT_MAX_DECODED = 16 * 1024 * 1024;
var EMPTY_PACK = { rootId: "", baseGeneration: 0, targetDigest: import_pack3.ZERO_DIGEST };
var EMPTY_EXTRACTED_BYTES = (0, import_pack3.jsonBytesOf)({ ...EMPTY_PACK, extracted: [] });

// ../packages/agent-tools/src/knowledge/replicaGenerationCheck.ts
var GENERATION_CHECK_INTERVAL_MS = 10 * 6e4;

// ../packages/agent-tools/src/knowledge/replicaReconcile.ts
var import_pack4 = require("@seanhogg/builderforce-memory/knowledge/pack");
var EMPTY_ROOT = (0, import_pack4.manifestTree)([]).root;

// ../packages/agent-tools/src/knowledge/replicaPump.ts
var MAX_ANALYSIS_BYTES = 2 * 1024 * 1024;
var MAX_SYNC_PACK_BYTES = 24 * 1024 * 1024;

// ../packages/agent-tools/src/knowledge/replicaFirstSync.ts
var import_knowledge44 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/claimSimilarity.ts
var import_knowledge45 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/portablePack.ts
var import_knowledge46 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/knowledge/packGraph.ts
var import_knowledge47 = require("@seanhogg/builderforce-memory/knowledge");
var import_ingest8 = require("@seanhogg/builderforce-memory/ingest");

// ../packages/agent-tools/src/knowledge/pinpointMatch.ts
var import_knowledge48 = require("@seanhogg/builderforce-memory/knowledge");
var MAX_PINPOINT_IMAGE_BYTES = 8 * 1024 * 1024;
var MAX_DATA_URL_CHARS = Math.ceil(MAX_PINPOINT_IMAGE_BYTES * 4 / 3) + 64;
var PINPOINT_VISION_SYSTEM = [
  "You read a screenshot of a software product.",
  'Reply with JSON only: {"description": one line saying what the screen shows and, if it looks stuck or broken, how,',
  '"texts": the exact visible strings (labels, headings, buttons, status text, error messages), at most 12, verbatim}.'
].join(" ");

// ../packages/agent-tools/src/knowledge/replicaLock.ts
var LOCK_REFRESH_MS = 3e4;
var LOCK_STALE_MS = 12e4;
var LOCK_FRESH_MS = LOCK_STALE_MS - LOCK_REFRESH_MS;

// ../packages/agent-tools/src/delta/adapters/dependencyCruiser.ts
var import_ingest9 = require("@seanhogg/builderforce-memory/ingest");
var import_knowledge49 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/delta/adapters/gitleaks.ts
var import_knowledge50 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/delta/adapters/jscpd.ts
var import_knowledge51 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/delta/adapters/knip.ts
var import_knowledge52 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/delta/adapters/osv.ts
var import_knowledge53 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/agent-tools/src/delta/adapters/sarifTools.ts
var import_knowledge54 = require("@seanhogg/builderforce-memory/knowledge");

// ../packages/sarif/src/emit.ts
var SARIF_BASELINE_STATES = ["new", "unchanged", "updated", "absent"];

// ../packages/sarif/src/parse.ts
var BASELINE = new Set(SARIF_BASELINE_STATES);

// ../packages/agent-tools/src/delta/adapters/sarifTools.ts
var SEMGREP_TOOL = "semgrep";
var CODEQL_TOOL = "codeql";
var SARIF_KINDS = { [SEMGREP_TOOL]: "semgrep-finding", [CODEQL_TOOL]: "codeql-finding" };

// ../packages/agent-tools/src/delta/adapters/l3Cache.ts
var import_retrieval = require("@seanhogg/builderforce-memory/retrieval");

// ../packages/agent-tools/src/delta/adapters/typescript.ts
var import_knowledge55 = require("@seanhogg/builderforce-memory/knowledge");
var TYPESCRIPT_VERSION2 = TYPESCRIPT_PIN.slice(TYPESCRIPT_PIN.lastIndexOf("@") + 1);

// ../packages/agent-tools/src/delta/dynamic/host.ts
var DYNAMIC_STEP_CAP_MS = 30 * 6e4;

// src/runFindings/detectors/bracketBreak.ts
function bracketBreak(view) {
  const out = [];
  for (const c of view.calls) {
    if (!c.write) continue;
    for (const r of editedFilesOf(c.name, c.args)) {
      if (r.before === void 0 || r.after === void 0) continue;
      const delta = bracketDelta(r.before, r.after, r.path);
      if (!changesBalance(delta)) continue;
      out.push(finding(
        "bracket_break",
        "error",
        { path: r.path, delta: describeBracketDelta(delta) },
        [callEvidence(c, r.path, r.after)]
      ));
    }
  }
  return out;
}

// src/runFindings/detectors/editChurn.ts
function editChurn(view) {
  return fileLedger(view).filter((f) => f.writes >= RUN_FINDING_POLICY.editChurnWrites).map((f) => finding(
    "edit_churn",
    "warn",
    { path: f.path, writes: f.writes },
    view.calls.filter((c) => c.paths.includes(f.path)).map((c) => callEvidence(c, f.path))
  ));
}

// ../packages/agent-stall/src/requestIntent.ts
var CHANGE_VERBS = "add|change|fix|update|reduce|increase|remove|delete|rename|refactor|implement|create|build|make|move|set|wire|migrate|replace|adjust|enable|disable|improve|write|edit|apply|correct|resolve|shrink|expand|hide|show|bump|revert|restore|install|upgrade|downgrade|rewrite|extract|split|merge";
var CHANGE_VERB = new RegExp(`\\b(${CHANGE_VERBS})\\b`, "i");
var FINISH_OBJECT = "(complete|finish|finali[sz]e)\\s+(the|this|that|these|those|it|my|our|your|all|implementation|work|task|change)\\b";
var FINISH_ORDER = new RegExp(`^\\s*(please\\s+)?(now\\s+)?${FINISH_OBJECT}`, "i");
var CHAINED_FINISH = new RegExp(`(\\band|\\bthen|[,.;])\\s+((also|then|please|now)\\s+)*${FINISH_OBJECT}`, "i");
var REPORT_OBJECTS = "summary|report|findings|notes|overview|write-?up|answer|explanation|list|table|recommendations?";
var CHAINED_CHANGE = new RegExp(
  `(\\band|\\bthen|[,.;])\\s+((also|then|please|now)\\s+)*(${CHANGE_VERBS})\\b(?!\\s+(me|us)\\b|\\s+(up\\s+)?((a|an|the|your|me|us|my)\\s+)?(short\\s+|brief\\s+)?(${REPORT_OBJECTS})\\b)`,
  "i"
);

// ../packages/agent-stall/src/handoff.ts
var RUNNER = "(?:npm|pnpm|yarn|npx|bun|deno|node|git|make|cargo|go|dotnet|mvn|gradle|python3?|pip3?|poetry|uv|ruby|rake|bundle|composer|php|docker(?:\\s+compose)?|kubectl|helm|terraform|wrangler|vercel|netlify|vite|webpack|tsc|tsgo|eslint|prettier|pytest|jest|vitest|playwright|cypress|bash|sh|zsh|pwsh|powershell|curl|wget|sed|awk|rsync|vsce)\\b";
var SCRIPT_NOUN = "(?:build|tests?|test suite|type-?check(?:ing)?|typecheck|lint(?:er|ing)?|guards?|checks?|install|dev server|migrations?|deploy(?:ment)?|codegen|bundle|vsix|package|commit|push|pull request|pr\\b|branch|lockfile|extension host)";
var CMD_MARK = "\u2983cmd\u2984";
var HANDOFF_VERB = "(?:re-?run|run|execute|apply|install|re-?install|rebuild|build|compile|commit|push|deploy|publish|restart|relaunch|launch|start|test|verify|lint|type-?check|typecheck|migrate|regenerate|package|bump|trigger|kick off)";
var HANDS_OFF = new RegExp(
  [
    // "you can run", "you'll need to run", "you should now commit", "you must rebuild"
    `\\byou(?:'ll|'d|'ve| will| would| should| must| may| might| can| could| still| then| now)?(?:\\s+(?:then|now|also|just|still|next|first|finally|want to|need to|have to|be able to))*\\s+${HANDOFF_VERB}\\b`,
    // "please run the guards"
    `\\bplease\\s+(?:now\\s+|then\\s+)?${HANDOFF_VERB}\\b`,
    // "once you've run the build", "after you push"
    `\\b(?:once|after|when|before)\\s+you(?:'ve| have| had)?\\s+${HANDOFF_VERB}\\b`,
    // "run the following", "apply these changes", "execute this command"
    `\\b${HANDOFF_VERB}\\s+(?:the\\s+following|these|this)\\b`,
    // "to verify, run …" / "to apply the fix you need to run …"
    `\\bto\\s+(?:apply|verify|confirm|finish|complete|deploy|ship|land|pick up|see)\\b[^.\\n]{0,60}?,?\\s*(?:you\\s+(?:can|should|must|will|need to|have to)\\s+)?${HANDOFF_VERB}\\b`,
    // A steps list: "1. Run the type-check", "- Commit the change", "Then push to main"
    `(?:^|\\n)[ \\t]*(?:\\d+[.)]|[-*+]|#{1,6}|>)?[ \\t]*(?:then|now|next|finally|first)?[,:]?[ \\t]*${HANDOFF_VERB}\\b`,
    // The same imperative mid-paragraph: "I applied the fix. Now run the type-check."
    // The adverb is REQUIRED here, unlike the line-leading form above — without it a
    // plain sentence that happens to open with one of these words ("Build output is
    // clean now.") would read as an instruction.
    `[.!?]\\s+(?:then|now|next|finally|first)[,:]?\\s+${HANDOFF_VERB}\\b`
  ].join("|"),
  "gi"
);
var COMMAND_NEARBY = new RegExp(`${CMD_MARK}|${RUNNER}|\\b${SCRIPT_NOUN}`, "i");

// ../packages/agent-stall/src/permissionMenu.ts
var ACTION_VERB = "(?:run|execute|apply|implement|install|rebuild|build|compile|commit|push|merge|rebase|deploy|publish|release|ship|open|create|file|draft|write|add|update|patch|edit|change|modify|fix|resolve|refactor|rename|move|delete|remove|drop|close|cancel|archive|assign|dispatch|schedule|start|kick off|trigger|link|list|enumerate|show|generate|produce|proceed|continue|go ahead|do (?:it|that|this|them|so|first|next|now|any|all)|handle|take care of|work through|go through|tackle|clean up|tidy|sort out|migrate|convert|split|extract|bump|revert|restore|retry|re-?try|re-?run|verify|test|check|review|investigate|dig into|look into)";
var OFFER = new RegExp(
  [
    // "Would you like me to open the PRs?" · "Do you want me to merge these?"
    // · "Would you like me to proceed?"
    `\\b(?:would|do)\\s+you\\s+(?:like|want|prefer)\\s+(?:me|us)\\s+to\\b`,
    // "Shall I open PRs?" · "Should I cancel the stalled tickets?" · "Can I proceed?"
    // · "May I go ahead?"
    `\\b(?:shall|should|can|may)\\s+i\\b[^.?\\n]{0,80}\\?`,
    // "Want me to push these?" — the subjectless form.
    `\\bwant\\s+(?:me|us)\\s+to\\b`,
    // "Let me know if you'd like me to…" · "Let me know which of these to do"
    // · "Tell me which you'd prefer" · "Just say the word and I'll merge them"
    // "how" earns its place: "let me know how you'd like to proceed" is the single most
    // common way this pause is phrased, and it names no option at all.
    `\\blet me know\\b[^.\\n]{0,80}\\b(?:if|whether|which|what|how)\\b`,
    `\\b(?:tell|let)\\s+me\\s+know\\s+(?:which|what|whether|if)\\b`,
    `\\bsay the word\\b`,
    // "I can open the PRs if you'd like." · "I could cancel them if you want."
    // · "I'm happy to merge these if that's what you want."
    `\\bi\\s+(?:can|could|am happy to|'?m happy to|would be happy to)\\b[^.\\n]{0,120}?\\bif\\s+(?:you|that|you'?d|you would)\\b`,
    // "Confirm and I'll proceed." · "Approve and I'll merge them."
    `\\b(?:confirm|approve|give me the go-?ahead|give the go-?ahead)\\b[^.\\n]{0,40}\\band\\s+i(?:'ll| will)\\b`,
    // "Which would you like me to do first?" · "Which of these should I start with?"
    `\\bwhich\\s+(?:one|of these|of those)?\\s*(?:would|do|should|shall)\\s+(?:you|i)\\b`,
    // "Your call." · "Up to you." · "How would you like to proceed?" — and the
    // declarative order the same sentence takes inside a clause, "…how you would like
    // to proceed", which the interrogative-only form used to miss.
    `\\b(?:your call|up to you|it'?s your call)\\b`,
    `\\bhow\\s+(?:you\\s+(?:would|do)|(?:would|do)\\s+you)\\s+(?:want|like|prefer)\\b`
  ].join("|"),
  "gi"
);
var ACTION_NEARBY = new RegExp(`\\b${ACTION_VERB}\\b`, "i");

// ../packages/agent-stall/src/index.ts
var ANNOUNCE_SUBJECT = "\\b(?:i(?: will|'ll| am going to|'m going to| am about to| plan to|'d need to| would need to| will need to| need to)|let(?:'?s| me| us)|going to|about to|next,? i'?l?l?|now)";
var ANNOUNCE_FILLER = "(?:\\s+(?:now|then|first|next|quickly|briefly|just|also|actually|go ahead and|try to|attempt to))*";
var ANNOUNCE_VERB = "(?:call|use|invoke|run|execute|trigger|query|fetch|retrieve|request|look|search|scan|find|locate|examine|inspect|review|read|list|check|verify|confirm|get|grab|pull|load|open|gather|dig|explore|investigate|analy[sz]e|start|begin|take|do|act|see|walk|trace|map)";
var ANNOUNCE_GERUND = "(?:searching|fetching|retrieving|querying|loading|checking|looking|scanning|reading|listing|gathering|pulling|examining|inspecting|reviewing|analy[sz]ing)";
var TOOL_IDENT = "(?:builtin_[a-z0-9]+(?:_[a-z0-9]+)+|mcp__[a-z0-9_]+)";
var PSEUDO_CALL = [
  // "call builtin_x", "run tool builtin_x", "invoke the function mcp__srv__x"
  `(?:call|run|invoke|execute)\\s+(?:the\\s+)?(?:tool\\s+|function\\s+)?${TOOL_IDENT}`,
  // "builtin_x({…})" / "builtin_x(" — the call written as code
  `${TOOL_IDENT}\\s*[({]`,
  // "builtin_x with chatId is 85" — the call written as an argument clause
  `${TOOL_IDENT}\\s+(?:with|args|arguments)\\b`
];
var ANNOUNCED_ACTION = new RegExp(
  [
    "calling (the|this|that|a|it|them|these) [\\w\\s-]*?(tool|function|api|now)",
    `${ANNOUNCE_SUBJECT}${ANNOUNCE_FILLER}\\s+${ANNOUNCE_VERB}\\b`,
    "(one|just a) (moment|second|sec)\\b",
    `${ANNOUNCE_GERUND} (it|that|this|these|those|the [\\w-]+|now|for)\\b`,
    // A sentence that OPENS on a gerund and signs off with "now": "Pulling linked tickets
    // and the roster code now." The object-led form above wants the/this/now straight
    // after the verb, so a bare noun phrase slipped through. Measured on VS Code chat #105
    // (`xai-oauth/grok-4.6`): turns 1-2 were caught and re-prompted, turn 3 said exactly
    // this, scored as a complete answer, and the run ended with a recovery still unspent.
    `(?:^|[.!?\\n]\\s*)${ANNOUNCE_GERUND}\\b[^.!?\\n]{0,80}\\bnow\\b`,
    "stand ?by\\b",
    ...PSEUDO_CALL
  ].join("|"),
  "i"
);
var FILE_EXTENSION = "(?:ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml|sql|toml|lock|txt|env|html|css|py|go|rs|sh|png|svg|csv|xml)\\b";
var DOTTED_TOOL_IDENT = `\\b[a-z][a-z0-9_]{2,}\\.(?!${FILE_EXTENSION})[a-z][a-z0-9_]{2,}\\b`;
var UNCALLED_TOOL_CLAIM = new RegExp(
  [
    // "The tools required are X, Y and Z." / "The required tools are …"
    "\\b(?:required tools?\\b|tools? required\\b|tools? (?:i |we )?(?:need|require)\\b)",
    // "…tools have not returned results" / "…the tool has not returned anything yet"
    "\\btools?\\b[^.!?]{0,80}?\\b(?:have|has|had|were|was)(?:n'?t| not)\\s+(?:yet\\s+)?(?:return|returned|provided|available|run|called)",
    // "no tool results", "no results from the tools", "no tool outputs for project 11"
    "\\bno\\s+(?:new\\s+)?tools?\\s+(?:results?|outputs?|data|returns?)\\b",
    // "No other tools provide the needed data." — the same claim aimed at the CATALOG
    // rather than at the results: an inventory of what it would need, from a turn that
    // called none of it. Observed as the closing sentence of the measured replies.
    "\\bno\\s+other\\s+tools?\\b[^.!?]{0,40}?\\b(?:provide|provides|give|gives|return|returns|have|has|offer|offers)\\b",
    "\\bno\\s+results?\\s+(?:from|for)\\s+(?:the\\s+)?tools?\\b",
    // "tool outputs never provided" / "the tool results were never returned"
    "\\btools?\\s+(?:results?|outputs?)\\b[^.!?]{0,40}?\\b(?:never|not)\\s+(?:been\\s+)?(?:provided|returned|available)",
    // "requires the tool outputs" / "awaiting the tool results"
    "\\b(?:requires?|awaiting|waiting on|pending)\\s+(?:those\\s+|the\\s+)?tools?\\s+(?:results?|outputs?)",
    // The same claim with the TOOL NAMED instead of the word "tool" — "no results from
    // manager.digest", "missing builtin_manager_policy results". The name IS the
    // discriminator here: prose does not carry tool identifiers by accident.
    `\\bno\\s+(?:new\\s+)?(?:results?|data|outputs?|returns?)\\s+(?:from|for|on)\\s+(?:the\\s+)?(?:${TOOL_IDENT}|${DOTTED_TOOL_IDENT})`,
    `\\b(?:missing|awaiting|pending|without)\\s+(?:the\\s+|those\\s+)?(?:results?\\s+(?:from|of|for)\\s+)?(?:${TOOL_IDENT}|${DOTTED_TOOL_IDENT})`
  ].join("|"),
  "i"
);

// src/modelReply.ts
var import_working5 = require("@seanhogg/builderforce-memory/working");

// src/stoppedTurn.ts
var STOPPED_TURN_STEP = "agent.stopped";

// ../packages/local-first/src/policy.ts
var LOCAL_FIRST_POLICY = Object.freeze({
  synchronize: false,
  gatewayInference: false,
  connectedFeatures: false,
  authenticate: false,
  modelDownloads: false,
  directProviders: false,
  externalMcp: false,
  gitRemotes: false
});

// ../packages/local-first/src/inferenceMode.ts
var INFERENCE_MODES = Object.freeze(["hybrid", "local-only", "specific"]);

// ../packages/local-first/src/platformRoutes.ts
var PLATFORM_ROUTE_RULES = Object.freeze([
  { path: "/api/auth", match: "contains", capability: "authenticate", note: "token exchange and session" },
  { path: "/api/vscode/tenants/*/token", capability: "authenticate", note: "the editor's tenant token exchange" },
  { path: "/chat/completions", match: "contains", capability: "gateway-inference", content: true, note: "a gateway completion \u2014 the prompt" },
  { path: "/api/brain/stream", capability: "gateway-inference", content: true, note: "the Brain's streamed turn \u2014 the prompt" },
  { path: "/llm/v1/models", capability: "connected-feature", note: "the model catalog" },
  { path: "/api/llm/models", capability: "connected-feature", note: "the model catalog" },
  { path: "/api/limbic/block", capability: "connected-feature", content: true, note: "personality block \u2014 once per session; the per-turn affect is appraised on the device" },
  { path: "/api/limbic", match: "prefix", capability: "connected-feature", content: true, note: "the personality / affect store" },
  { path: "/api/projects/*/evermind/recall", capability: "connected-feature", content: true, note: "memory recall \u2014 a read that sends the prompt" },
  { path: "/api/projects/*/evermind", match: "contains", capability: "connected-feature", content: true, note: "a project's Evermind memory" },
  { path: "/api/evermind", match: "contains", capability: "connected-feature", content: true, note: "Evermind memory" },
  { path: "/api/sync", match: "prefix", capability: "synchronize", content: true, note: "the local-first sync transport \u2014 the records themselves" },
  // PRD 36: a signed-in editor BINDS its local chat to a server chat so the chat's
  // tickets, usage and memory land on it. The bind sends a title and a project — never
  // the transcript (that is `/messages`, below, and the sync transport above).
  { path: "/api/brain/chats", capability: "connected-feature", note: "binding a chat to the account \u2014 its title and project only" },
  { path: "/api/brain/chats/*/messages", content: true, note: "a Brain chat's transcript" },
  { path: "/api/chats/*/messages", content: true, note: "a chat's transcript" },
  { path: "/api/brain/upload", content: true, note: "an uploaded file" },
  { path: "/api/brain/fetch-url", content: true, note: "a page fetched for the Brain \u2014 the URL the person gave" },
  { path: "/product-report", match: "suffix", content: true, note: "an error report \u2014 what was on screen" },
  // Sockets that carry the person's content (an upgrade is a GET, so these keep the
  // read default): live canvas sync, rooms and meetings, an execution's stream, an
  // agent host's chat. A socket that only says "something changed" is not tagged.
  { path: "/api/creation-sessions/*/ws", content: true, note: "a canvas session's live sync" },
  { path: "/api/guest/rooms/*/ws", content: true, note: "a guest room's shared transcript and meeting" },
  { path: "/api/agile/ceremonies/rooms/*/ws", content: true, note: "a ceremony room's live conversation" },
  { path: "/api/meetings/rooms/*/ws", content: true, note: "a meeting room's signalling" },
  { path: "/api/runtime/executions/*/stream", content: true, note: "an execution's live stream \u2014 messages, tool results, file changes" },
  { path: "/api/agent-hosts/*/ws", content: true, note: "an agent host's chat" },
  { path: "/api/guest/research", match: "prefix", content: true, note: "a guest canvas's research call \u2014 the query" },
  { path: "/api/guest/career", match: "prefix", content: true, note: "a guest canvas's career tool \u2014 the r\xE9sum\xE9 / job text" },
  { path: "/search", match: "suffix", capability: "connected-feature", note: "a search \u2014 a read" },
  { path: "/api/dashboards/query", capability: "connected-feature", note: "a dashboard query \u2014 a read" },
  { path: "/api/data-sources/*/query", capability: "connected-feature", note: "a data-source query \u2014 a read" },
  { path: "/api/vscode/connect", capability: "connected-feature", note: "the editor presence beat" }
]);

// ../packages/local-first/src/payloadHash.ts
function fnv1a32(text, seed = 2166136261) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function hashPayload(payload) {
  const text = JSON.stringify(payload) ?? "null";
  return `fnv1a:${fnv1a32(text).toString(16).padStart(8, "0")}`;
}

// ../packages/local-first/src/recordPayloadMarker.ts
var NULL_PAYLOAD_HASH = hashPayload(null);

// ../packages/local-first/src/domainToolClass.ts
var LOCAL_DOMAIN_TOOL_NAMES = Object.freeze([
  "project-create",
  "project-update",
  "project-move",
  "project-archive",
  "ticket-create",
  "ticket-update",
  "ticket-move",
  "ticket-archive",
  "ticket-delete",
  "memory-recall",
  "local-memory-recall",
  "audit-finding",
  "local-audit-finding"
]);
var CONNECTED_ONLY_DOMAIN_TOOL_NAMES = Object.freeze([
  "cloud-execution",
  "meeting-join",
  "remote-session-read"
]);
var LOCAL = new Set(LOCAL_DOMAIN_TOOL_NAMES);
var CONNECTED = new Set(CONNECTED_ONLY_DOMAIN_TOOL_NAMES);
var LOCAL_CLASS = Object.freeze({ mode: "local" });
var CONNECTED_CLASS = Object.freeze({ mode: "connected-only" });
var UNKNOWN_CLASS = Object.freeze({ mode: "unknown" });

// ../packages/local-first/src/journalCodec.ts
var MAGIC_BYTES = 5;
var JOURNAL_HEADER_BYTES = MAGIC_BYTES + 8;
var RESET_PREFIX = new TextEncoder().encode('{"reset":true');
var TABLES = (() => {
  const tables = new Int32Array(8 * 256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? c >>> 1 ^ 3988292384 : c >>> 1;
    tables[n] = c;
  }
  for (let n = 0; n < 256; n += 1) {
    let c = tables[n];
    for (let k = 1; k < 8; k += 1) {
      c = tables[c & 255] ^ c >>> 8;
      tables[k * 256 + n] = c;
    }
  }
  return tables;
})();

// ../packages/local-first/src/journalCompaction.ts
var DEFAULT_JOURNAL_COMPACTION = Object.freeze({
  maxFrames: 8192,
  maxBytes: 64 * 1024 * 1024
});
var DEFAULT_COMPACTION_FRAME = Object.freeze({
  maxBytes: 256 * 1024,
  maxRows: 500
});
var encoder = new TextEncoder();

// ../packages/local-first/src/creationDestination.ts
var LOCAL_CREATE_PATHS = Object.freeze([
  Object.freeze({
    id: "localWork.createProject",
    module: "localWork.ts",
    entry: "createLocalWork(store).createProject",
    writes: Object.freeze(["project"])
  }),
  Object.freeze({
    id: "localWork.createTicket",
    module: "localWork.ts",
    entry: "createLocalWork(store).createTicket",
    writes: Object.freeze(["ticket"])
  }),
  Object.freeze({
    id: "transactionalRecord.commit",
    module: "transactionalRecord.ts",
    entry: "createTransactionalRecordStore(options).commit",
    writes: Object.freeze(["project", "ticket", "chat", "audit-run", "execution"])
  }),
  Object.freeze({
    id: "hostChatRecord.ensureChat",
    module: "hostChatRecord.ts",
    entry: "createHostChatLog(store).appendTurn/appendRun/appendStep/appendApproval",
    writes: Object.freeze(["chat"])
  }),
  Object.freeze({
    id: "hostChatRecord.appendRun",
    module: "hostChatRecord.ts",
    entry: "createHostChatLog(store).appendRun",
    writes: Object.freeze(["execution"])
  }),
  Object.freeze({
    id: "localAudit.createLocalAuditFinding",
    module: "localAudit.ts",
    entry: "createLocalAuditFinding(store, input)",
    writes: Object.freeze(["audit-finding"])
  }),
  Object.freeze({
    id: "factProvenance.remember",
    module: "factProvenance.ts",
    entry: "createFactStore(store).remember",
    writes: Object.freeze(["memory-fact"])
  })
]);

// ../packages/local-first/src/holdLimits.ts
var SYNC_EVENT_RETENTION_DAYS = 90;
var DAY_MS = 24 * 60 * 60 * 1e3;
var HOLD_MAX_AGE_MS = 7 * DAY_MS;
var DEPENDENCY_PENDING_MAX_AGE_MS = SYNC_EVENT_RETENTION_DAYS * DAY_MS;
var HOLD_BACKOFF_CAP_MS = 60 * 60 * 1e3;

// ../packages/local-first/src/syncLease.ts
var DEFAULT_COORDINATOR_WORK_TIMEOUT_MS = 5 * 6e4;

// ../packages/local-first/src/redaction.ts
var INDEXEDDB_REDACTED_KEYS = [
  "token",
  "password",
  "authorization",
  "cookie",
  "apikey",
  "clientsecret"
];
var INDEXEDDB_REDACTION_RULE = `Only exportForUploadOrLog() output may be uploaded or logged. It strips every secret-shaped key at every depth \u2014 a key whose lowercase name is one of ${INDEXEDDB_REDACTED_KEYS.join(", ")} or contains token, secret, password, authorization, cookie, or apikey \u2014 so accessToken, client_secret and sessionCookie are stripped too. The strip is recursive through arrays and nested objects, the input is not mutated, and a dropped key is absent rather than blanked. export() is the unfiltered local record and must not leave the device.`;

// ../packages/local-first/src/httpSyncTransport.ts
var MAX_RETRY_AFTER_MS = 60 * 60 * 1e3;

// ../packages/local-first/src/tombstone.ts
var RESNAPSHOT = Object.freeze({ action: "resnapshot" });

// ../packages/local-first/src/applyServerCursor.ts
var RESNAPSHOT2 = Object.freeze({ resnapshotRequired: true });

// src/types.ts
var STEP_MESSAGE_ROLE = "tool";
function isStepMessage(m) {
  return m.role === STEP_MESSAGE_ROLE;
}

// src/persistedSteps.ts
function stepSig(category, label, tsIso) {
  return `${category}|${label}|${tsIso ?? ""}`;
}
function parseStepMessage(metadata) {
  if (!metadata) return null;
  try {
    const m = JSON.parse(metadata);
    if (m.kind !== "step" || typeof m.category !== "string") return null;
    return {
      step: {
        category: m.category,
        label: typeof m.label === "string" ? m.label : m.category,
        args: m.args,
        result: m.result,
        isError: m.isError,
        durationMs: m.durationMs,
        resultBytes: m.resultBytes,
        truncated: m.truncated,
        usage: m.usage,
        finishReason: m.finishReason,
        textChars: m.textChars,
        ttftMs: m.ttftMs
      },
      tsIso: typeof m.ts === "string" ? m.ts : void 0
    };
  } catch {
    return null;
  }
}
function traceWithPersistedSteps(messages, trace) {
  const seen = /* @__PURE__ */ new Set();
  for (const ev of trace) seen.add(stepSig(ev.category, ev.label, ev.ts));
  const fromMessages = [];
  for (const message of messages) {
    if (!isStepMessage(message)) continue;
    const parsed = parseStepMessage(message.metadata);
    if (!parsed) continue;
    const sig = stepSig(parsed.step.category, parsed.step.label, parsed.tsIso);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const s = parsed.step;
    fromMessages.push({
      ts: parsed.tsIso ?? message.createdAt ?? "",
      recovered: true,
      category: s.category,
      label: s.label,
      args: s.args,
      result: s.result,
      ...s.isError ? { isError: true } : {},
      ...s.durationMs != null ? { durationMs: s.durationMs } : {},
      ...s.ttftMs != null ? { ttftMs: s.ttftMs } : {},
      ...s.resultBytes != null ? { resultBytes: s.resultBytes } : {},
      ...s.truncated ? { truncated: true } : {},
      ...s.usage ? { usage: s.usage } : {},
      ...s.finishReason !== void 0 ? { finishReason: s.finishReason } : {},
      ...s.textChars != null ? { textChars: s.textChars } : {}
    });
  }
  if (fromMessages.length === 0) return trace;
  return [...trace, ...fromMessages].sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
}

// src/localWorkspaceTools.ts
var CODE_CHANGE_TOOLS = /* @__PURE__ */ new Set([
  "write_file",
  "edit_file",
  "delete_file",
  "canvas_write_build_file",
  "canvas_edit_build_file",
  "canvas_restore_build_file"
]);
function isCodeChangeTool(name) {
  return CODE_CHANGE_TOOLS.has(name);
}

// ../packages/run-guards/src/readinessClaim.ts
var READY_PATTERNS = [
  // "Now I have everything I need", "I've got all the context", "we now have enough"
  /\b(?:i|we)(?:'ve| have)?\s+(?:now\s+)?(?:have|got)\s+(?:got\s+)?(?:everything|all\s+(?:the\s+)?(?:context|information|info|details|i\s+need|we\s+need)|enough)\b/,
  // "I've got all the component contracts", "we have all of the pieces" (run #70776)
  /\b(?:i|we)(?:'ve| have)?\s+(?:now\s+)?(?:have|got)\s+all\s+(?:of\s+)?(?:the\s+)?(?:[\w/-]+\s+){0,3}(?:contracts|pieces|interfaces|signatures)\b/,
  // "Now I have the full picture", "I have a complete understanding", "I have a thorough map" (run #70776)
  /\b(?:now\s+)?(?:i|we)(?:'ve|\s+have)?\s+(?:now\s+)?(?:have\s+|got\s+)?(?:a|the)\s+(?:clear|complete|full|good|solid|whole|thorough)\s+(?:picture|understanding|view|overview|grasp|map)\b/,
  // "Analysis is over; time to build." (run #70776)
  /\b(?:analysis|investigation|exploration|research)\s+(?:is|'s)\s+(?:over|done|complete|finished)\b/,
  // "Now I understand the camera registry pattern" (run #70776) — never "I don't understand"
  /\b(?:now\s+(?:i|we)|(?:i|we)\s+now)\s+(?:fully\s+|clearly\s+)?understand\b/,
  // "Implementing now", "now implementing" (run #70776)
  /^\s*(?:(?:implementing|building|coding)(?:\s+(?:it|this|that))?\s+now|now\s+(?:implementing|building|coding))\b/,
  // "one final check, then I write", "one more file before I implement"
  /\bone\s+(?:last|final|more)\s+(?:check|look|read|thing|file)\b[^.!?\n]*\b(?:then|before)\b[^.!?\n]*\b(?:write|implement|edit|make|apply|update|change|fix|code)\b/,
  // "now I'll write", "let me now implement", "time to make the change" — never "make sure"
  /\b(?:now\s+(?:i'll|i\s+will|let\s+me|let's)|(?:i'll|i\s+will|let\s+me|let's)\s+now|time\s+to)\s+(?:write|implement|build|code|make(?!\s+(?:sure|certain))|apply|edit|update(?!\s+(?:my|our)\s+(?:understanding|notes|picture))|create|fix|start\s+(?:writing|implementing|coding|the\s+(?:edit|change|implementation)))\b/,
  /\blet\s+me\s+(?:write|make|apply)\s+the\s+(?:update|change|changes|edit|edits|fix|implementation)\s+now\b/
];
var NEGATION = /\b(?:don't|do\s+not|doesn't|haven't|have\s+not|isn't|is\s+not|not\s+yet|not\s+(?:time|ready)|still\s+need|need\s+(?:more|to\s+(?:read|check|look|see|find|understand))|before\s+(?:i|we)\s+have|until\s+(?:i|we)\s+have|once|unless|when\s+(?:i|we)\s+have|if\s+(?:i|we)\s+(?:have|had)|(?:if|when|after|until|before)\s+(?:the|my|our)\s+(?:\w+\s+){1,2}(?:is|are|'s))\b/;
function ownWords(text) {
  return text.replace(/```[\s\S]*?(?:```|$)/g, " ").replace(/`[^`\n]*`/g, " ").replace(/^\s*>.*$/gm, " ").replace(/"[^"\n]*"|“[^”\n]*”/g, " ").replace(/[’‘]/g, "'");
}
function sentenceClaims(sentence) {
  if (sentence.trimEnd().endsWith("?")) return false;
  return READY_PATTERNS.some((p) => {
    const m = p.exec(sentence);
    return !!m && !NEGATION.test(sentence.slice(0, m.index + m[0].length));
  });
}
function claimsReady(text) {
  if (!text) return false;
  return ownWords(text).toLowerCase().split(/(?<=[.!?])\s+|\n+/).some(sentenceClaims);
}

// ../packages/run-guards/src/evidence/gitCommandPattern.ts
function gitCommandPattern(verbs) {
  return new RegExp(`\\bgit\\s+(?:-[Cc]\\s+\\S+\\s+|-\\S+\\s+|--\\S+(?:=\\S+)?\\s+)*(?:${verbs})\\b`, "i");
}

// src/runProgress.ts
function isCacheAnswered(ev) {
  const r = ev.result;
  if (!r || typeof r !== "object") return false;
  const o = r;
  return o.covered === true || o.replayed === true || o.derived === true || o.skipped === true && typeof o.note === "string" || typeof o.note === "string" && /^Duplicate \S+ call/.test(o.note);
}

// src/modelScorecard.ts
function modelOf(ev) {
  const m = ev.args?.model;
  return typeof m === "string" && m && m !== "default" ? m : null;
}
function modelTurnLog(events) {
  const turns = [];
  for (const ev of events) {
    if (ev.label !== "llm.complete") continue;
    const model = modelOf(ev);
    if (!model) continue;
    const args = ev.args;
    const requested = typeof args?.requestedModel === "string" && args.requestedModel && args.requestedModel !== "default" && args.requestedModel !== model ? args.requestedModel : void 0;
    if (ev.category === "error") {
      turns.push({
        index: turns.length + 1,
        model,
        ...requested ? { requestedModel: requested } : {},
        toolCalls: 0,
        textOnly: false,
        failed: true,
        ...typeof ev.durationMs === "number" ? { durationMs: ev.durationMs } : {}
      });
      continue;
    }
    if (ev.category !== "llm") continue;
    const calls = typeof args?.toolCalls === "number" ? args.toolCalls : 0;
    const turn = {
      index: turns.length + 1,
      model,
      ...requested ? { requestedModel: requested } : {},
      toolCalls: calls,
      textOnly: calls === 0 && (ev.textChars ?? 0) > 0,
      // What the turn SPENT its time producing. Absent on traces that predate the
      // accounting, so an old chat's log renders exactly as it used to.
      ...typeof args?.argBytes === "number" && args.argBytes > 0 ? { argBytes: args.argBytes } : {},
      ...typeof ev.usage?.completion === "number" && ev.usage.completion > 0 ? { completionTokens: ev.usage.completion } : {},
      ...typeof ev.durationMs === "number" ? { durationMs: ev.durationMs } : {},
      ...args?.unliftedCallMarkup === true ? { unliftedCallMarkup: true } : {},
      ...typeof args?.role === "string" ? { role: args.role } : {},
      ...typeof args?.failovers === "string" && args.failovers ? { failovers: args.failovers } : {}
    };
    if (typeof args?.upstreamFunctionCalls === "number") {
      turn.upstreamFunctionCalls = args.upstreamFunctionCalls;
      if (typeof args.upstreamRecovered === "number") turn.upstreamRecovered = args.upstreamRecovered;
    }
    turns.push(turn);
  }
  return turns;
}

// src/runStore/gatewayRoutingTrace.ts
var FAILOVER_SEPARATOR = ", ";

// src/handOffParallelism.ts
var import_node_fs = require("fs");
var import_node_path = __toESM(require("path"), 1);
var import_node_url = require("url");
var HAND_OFF_MODE_LABEL = "hand_off.mode";
var HAND_OFF_CLASH_LABEL = "hand_off.scope_clash";

// src/routingByRole.ts
function decisionOf(e) {
  const a = e.args;
  if (!a || a.mode !== "parallel" && a.mode !== "inline" && a.mode !== "mixed") return null;
  return {
    mode: a.mode,
    parallelTasks: Array.isArray(a.parallelTasks) ? a.parallelTasks : [],
    inlineTasks: Array.isArray(a.inlineTasks) ? a.inlineTasks : [],
    clash: a.clash ?? null
  };
}
var ranked = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1]);
function routingByRole(turns, events) {
  const byRole = /* @__PURE__ */ new Map();
  for (const t of turns) {
    if (t.failed || !t.role) continue;
    const entry = byRole.get(t.role) ?? { turns: 0, models: /* @__PURE__ */ new Map(), failovers: /* @__PURE__ */ new Map() };
    entry.turns += 1;
    entry.models.set(t.model, (entry.models.get(t.model) ?? 0) + 1);
    for (const f of t.failovers?.split(FAILOVER_SEPARATOR) ?? []) if (f) entry.failovers.set(f, (entry.failovers.get(f) ?? 0) + 1);
    byRole.set(t.role, entry);
  }
  const count = (label) => events.filter((e) => e.label === label).length;
  const roleHandoffs = events.filter((e) => e.label === "llm.role_handoff");
  const hasArg = (e, key) => !!e.args && typeof e.args === "object" && key in e.args;
  return {
    roles: [...byRole.entries()].map(([role, e]) => ({
      role,
      turns: e.turns,
      models: ranked(e.models).map(([model, n]) => ({ model, turns: n })),
      failovers: ranked(e.failovers).map(([failover, n]) => ({ failover, turns: n }))
    })),
    coderReasks: roleHandoffs.filter((e) => hasArg(e, "from")).length,
    handOffs: roleHandoffs.filter((e) => hasArg(e, "via")).length,
    handOffsForced: count("loop.hand_off_due"),
    planBudgetsSpent: count("loop.plan_budget_spent"),
    handOffModes: events.filter((e) => e.label === HAND_OFF_MODE_LABEL).map(decisionOf).filter((d) => d !== null),
    handOffClashesRefused: count(HAND_OFF_CLASH_LABEL)
  };
}

// src/ticketToolVocabulary.ts
var SERVER_TICKET_CREATE_TOOL = "builtin_tasks_create";
var LOCAL_TICKET_CREATE_LABEL = /ticket[-_.]create/i;
var SERVER = Object.freeze({
  createTool: SERVER_TICKET_CREATE_TOOL,
  local: false,
  kanbanScoping: true,
  createName: SERVER_TICKET_CREATE_TOOL
});
function isLocalTicketCreateLabel(label) {
  return LOCAL_TICKET_CREATE_LABEL.test(label);
}

// src/toolResultRecord.ts
function toolResultRecord(result) {
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return result && typeof result === "object" ? result : null;
}

// src/staffingSummary.ts
var DISPATCH_TOOL = /chats[._](dispatch_agent|execute_as_agent)|kanban[._](coordinate|materialize_work_items|assess_resource|assign_participant)|executions[._]submit|run[._-]?now/i;
function isDispatchTool(label) {
  return DISPATCH_TOOL.test(label);
}
var MAX_REFUSAL_CHARS = 180;
function didDispatch(ev) {
  if (ev.isError || isFailedToolResult(ev.result)) return false;
  const r = toolResultRecord(ev.result);
  if (!r) return true;
  const autoRun = r.autoRun && typeof r.autoRun === "object" ? r.autoRun : null;
  if (autoRun && typeof autoRun.dispatched === "boolean") return autoRun.dispatched;
  if (typeof r.dispatched === "boolean") return r.dispatched;
  return true;
}
function refusalMessage(ev) {
  const r = toolResultRecord(ev.result);
  const raw = r && typeof r.error === "string" && r.error || r && typeof r.detail === "string" && r.detail || (r && r.autoRun && typeof r.autoRun === "object" && typeof r.autoRun.detail === "string" ? String(r.autoRun.detail) : "") || (typeof ev.result === "string" ? ev.result : "") || (r ? JSON.stringify(r) : "") || "no reason given";
  const flat = String(raw).replace(/\s+/g, " ").trim();
  return flat.length > MAX_REFUSAL_CHARS ? `${flat.slice(0, MAX_REFUSAL_CHARS)}\u2026` : flat || "no reason given";
}
function asAgentOf(args) {
  const a = args && typeof args === "object" ? args : null;
  const v = a?.as_agent;
  return typeof v === "string" ? v.trim() : "";
}
function staffingSummaryInTrace(events) {
  let ticketsCreated = 0;
  let filedLocally = 0;
  let dispatchAttempts = 0;
  let dispatched = 0;
  const dispatchRefusals = [];
  const personaSubagents = [];
  for (const ev of events) {
    if (ev.category !== "tool") continue;
    if (isTicketWriteTool(ev.label) && !ev.isError && !isFailedToolResult(ev.result)) {
      ticketsCreated += 1;
      if (isLocalTicketCreateLabel(ev.label)) filedLocally += 1;
    }
    if (isDispatchTool(ev.label)) {
      dispatchAttempts += 1;
      if (didDispatch(ev)) dispatched += 1;
      else dispatchRefusals.push({ label: ev.label, message: refusalMessage(ev) });
    }
    if (ev.label === "spawn_agent") {
      const agent = asAgentOf(ev.args);
      if (!agent) continue;
      const args = ev.args;
      const result = toolResultRecord(ev.result);
      const label = typeof args?.label === "string" && args.label.trim() || typeof result?.label === "string" && result.label.trim() || (typeof args?.task === "string" ? args.task.trim().slice(0, 60) : "") || "delegated work";
      personaSubagents.push({
        agent,
        label,
        ok: !ev.isError && !isFailedToolResult(ev.result) && result?.ok !== false
      });
    }
  }
  const verdict = dispatched > 0 || personaSubagents.some((p) => p.ok) ? "staffed" : dispatchRefusals.length > 0 ? "staffing-refused" : ticketsCreated > 0 && filedLocally === ticketsCreated ? "filed-locally" : ticketsCreated > 0 ? "filed-not-staffed" : "no-work-filed";
  return { ticketsCreated, filedLocally, dispatchAttempts, dispatched, dispatchRefusals, personaSubagents, verdict };
}

// ../packages/cost-levers/src/index.ts
var COST_LEVERS = [
  { id: "a2_run_budget", requirement: "A2", rollout: 100, summary: "Token + USD run budget, shown to the loop" },
  { id: "a3_progress_detector", requirement: "A3", rollout: 100, summary: "Repeat-read / edit-revert / no-progress steer" },
  { id: "b1_stable_prefix", requirement: "B1", rollout: 100, summary: "Volatile blocks after the cache breakpoint" },
  { id: "b2_semantic_cache", requirement: "B2", rollout: 10, summary: "Scoped semantic cache on tool-free chat" },
  { id: "b3_single_flight", requirement: "B3", rollout: 100, summary: "Coalesce identical in-flight requests" },
  { id: "b4_agent_answer_replay", requirement: "B4", rollout: 10, summary: "Memory answer replay for agent sub-questions" },
  { id: "c2_observation_masking", requirement: "C2", rollout: 10, summary: "Mask tool outputs older than N turns" },
  { id: "c3_task_state", requirement: "C3", rollout: 10, summary: "Structured task state kept through compaction" },
  { id: "c4_adaptive_context", requirement: "C4", rollout: 10, summary: "Start retrieval small, widen on low confidence" },
  { id: "c5_cloud_repo_map", requirement: "C5", rollout: 10, summary: "Graph-ranked repo map on cloud runs" },
  { id: "c6_rerank", requirement: "C6", rollout: 10, summary: "Cross-encoder rerank after hybrid retrieval" },
  { id: "c7_tool_output_policy", requirement: "C7", rollout: 100, summary: "One shared tool-output budget + failure summaries" },
  // 10 like every lever that changes what the model sees; it runs only where the local
  // engine's health probe reports a loaded compressor, so it never triggers a download.
  { id: "c8_token_compression", requirement: "C8", rollout: 10, summary: "LLMLingua-2 token compression of large context" },
  { id: "c10_outline_first_reads", requirement: "B2", rollout: 100, summary: "Large-file first read returns outline + first 40 lines" },
  { id: "c9_price_tier_budget", requirement: "C9", rollout: 100, summary: "Compaction budget under long-context price tiers" },
  { id: "d1_verifier_cascade", requirement: "D1", rollout: 10, summary: "Weak model first, verifier, escalate one tier" },
  { id: "d2_difficulty_router", requirement: "D2", rollout: 10, summary: "Predict weak-model failure, skip the wasted attempt" },
  { id: "d3_routing_exploration", requirement: "D3", rollout: 100, summary: "Thompson exploration + decay in learned routing" },
  { id: "d4_role_reasoning", requirement: "D4", rollout: 10, summary: "Reasoning effort by role" },
  { id: "d5_output_caps", requirement: "D5", rollout: 100, summary: "Diff edits + per-role max_tokens" },
  { id: "d6_batch_api", requirement: "D6", rollout: 100, summary: "Provider batch APIs for deferred background work" },
  { id: "d7_deterministic_handlers", requirement: "D7", rollout: 100, summary: "Deterministic handlers + post-edit checks" },
  { id: "d8_parallel_tool_calls", requirement: "D8", rollout: 100, summary: "Batch independent tool calls in one turn" },
  { id: "e1_skill_ranking", requirement: "E1", rollout: 100, summary: "Inject only the most relevant approved skills" },
  { id: "e2_specialists", requirement: "E2", rollout: 10, summary: "Admitted small specialist models for narrow jobs" },
  // Always on (operator, 2026-10-23): recall dual-reads the paid 1536 column for rows the
  // 1024 backfill has not reached yet, so it never had to wait for the backfill.
  { id: "e3_free_embeddings", requirement: "E3", rollout: 100, summary: "Free Workers AI embeddings for memory" },
  { id: "e5_verified_local_label", requirement: "E5", rollout: 100, summary: "Hybrid local label = passed the verifier" }
];
var BY_ID = new Map(COST_LEVERS.map((l) => [l.id, l]));

// ../packages/tool-output-policy/src/caps.ts
var TOOL_OUTPUT_CAPS = {
  read_file: 16e3,
  run_command: 2e4,
  exec: 2e4,
  bash: 2e4,
  git_status: 2e4,
  git_diff: 2e4,
  git_history: 2e4,
  git_sync_latest: 2e4,
  git_undo: 2e4,
  git_redo: 2e4,
  // Up to four children's reports in one result, each capped by agent-tools'
  // `SUBAGENT_REPORT_CHARS`. A research child's report IS its deliverable: under the 6K
  // default a wait on four left the owner ~1.5K of each, and it re-spawned researchers
  // to recover what was cut (VS Code chat #6). Four full reports plus each one's header
  // and cut marker; `subagentReportBudget.test.ts` (brain-embedded) holds the two together.
  wait_agents: 34e3,
  // The Creation Canvas's reads. A board snapshot is the whole board as JSON and a real
  // board runs to tens of KB; under the 6K default the model was handed a sliver of it and
  // asked the user to re-select objects that were already there. A build file is paged
  // like `read_file` (see {@link PAGED_READ_TOOLS}).
  canvas_read_snapshot: 64e3,
  canvas_read_object: 32e3,
  canvas_read_build_file: 16e3
};
var READ_FILE_TOOL = "read_file";
var PAGED_READ_TOOLS = {
  // `read_file`'s `offset` applies to each path of a `paths[]` read (agent-tools core-tools).
  [READ_FILE_TOOL]: { search: "search_code", perPathOffset: true },
  // The canvas's `offset` is honoured for a SINGLE path only.
  canvas_read_build_file: { search: "canvas_search_build_files", perPathOffset: false }
};

// ../packages/tool-output-policy/src/readFileWindow.ts
var READ_FILE_RESULT_CHARS = TOOL_OUTPUT_CAPS.read_file ?? 16e3;

// src/brainTriage.ts
var import_working6 = require("@seanhogg/builderforce-memory/working");
var CONTEXT_PROMPT_PEAK = Math.round(import_working6.HISTORY_TOKEN_BUDGET * 1.5);
function isFailedToolResult(result) {
  if (result == null) return false;
  if (typeof result === "object") {
    const r = result;
    if (r.ok === false) return true;
    if (typeof r.error === "string" && r.error) return true;
    return false;
  }
  if (typeof result === "string") {
    return /"ok"\s*:\s*false/.test(result) || /"error"\s*:\s*"[^"]/.test(result);
  }
  return false;
}
var TICKET_WRITE_TOOL = new RegExp(
  `(tasks|objectives|key_results|initiatives|portfolios|specs|roadmap)[._]create|chats[._]link_ticket|tickets[._]from_delta|${LOCAL_TICKET_CREATE_LABEL.source}`,
  "i"
);
function isTicketWriteTool(label) {
  return TICKET_WRITE_TOOL.test(label);
}

// src/runFindings/detectors/filedThenInline.ts
function filedThenInline(view) {
  const { staffing } = view;
  if (staffing.ticketsCreated === 0 || staffing.dispatched > 0 || staffing.personaSubagents.some((p) => p.ok)) return [];
  const filed = view.calls.filter((c) => c.ok && isTicketWriteTool(c.name));
  const last = filed[filed.length - 1];
  if (!last) return [];
  const inline = view.calls.find((c) => c.write && c.step > last.step);
  if (!inline) return [];
  return [finding("filed_then_inline", "info", { tickets: staffing.ticketsCreated }, [
    ...filed.map((c) => callEvidence(c, void 0, typeof c.args.title === "string" ? c.args.title : void 0)),
    callEvidence(inline, inline.paths[0])
  ])];
}

// src/composingActivity.ts
function utf8ByteLength2(text) {
  if (!text) return 0;
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
  }
  return bytes;
}

// src/runFindings/detectors/oversizedArgs.ts
function blocksOf(v, out = /* @__PURE__ */ new Set()) {
  if (typeof v === "string") {
    for (const p of v.split(/\n\s*\n/)) {
      const block = p.trim();
      if (utf8ByteLength2(block) >= RUN_FINDING_POLICY.sharedArgBytes) out.add(block);
    }
  } else if (Array.isArray(v)) {
    for (const x of v) blocksOf(x, out);
  } else if (v && typeof v === "object") {
    for (const x of Object.values(v)) blocksOf(x, out);
  }
  return out;
}
function sharingCalls(calls) {
  const holders = /* @__PURE__ */ new Map();
  for (const c of calls) for (const b of blocksOf(c.args)) holders.set(b, [...holders.get(b) ?? [], c]);
  const out = /* @__PURE__ */ new Set();
  for (const list of holders.values()) if (list.length >= 2) for (const c of list) out.add(c);
  return out;
}
function oversizedArgs(view) {
  const byTool = /* @__PURE__ */ new Map();
  for (const c of view.calls) {
    if (isCodeChangeTool(c.name)) continue;
    byTool.set(c.name, [...byTool.get(c.name) ?? [], c]);
  }
  const out = [];
  for (const [tool, calls] of byTool) {
    const shared = sharingCalls(calls);
    const flagged = calls.filter((c) => c.argBytes >= RUN_FINDING_POLICY.oversizedArgBytes || shared.has(c));
    if (flagged.length === 0) continue;
    const evidence = flagged.map((c) => ({
      ...callEvidence(c),
      note: shared.has(c) ? "argBytesShared" : "argBytes",
      params: { bytes: c.argBytes }
    }));
    out.push(finding("oversized_args", "warn", { tool, bytes: Math.max(...flagged.map((c) => c.argBytes)), calls: flagged.length }, evidence));
  }
  for (const t of view.turns) {
    if (!t.handOffVia || t.argBytes < RUN_FINDING_POLICY.oversizedArgBytes || byTool.has(t.handOffVia)) continue;
    out.push(finding(
      "oversized_args",
      "warn",
      { tool: t.handOffVia, bytes: t.argBytes, calls: 1 },
      [{ ...turnEvidence(t, t.handOffVia), note: "argBytes", params: { bytes: t.argBytes } }]
    ));
  }
  return out;
}

// src/runFindings/detectors/promptBloat.ts
function promptBloat(view) {
  const promptTokens = view.turns.reduce((sum, t) => sum + t.promptTokens, 0);
  const completion = view.turns.reduce((sum, t) => sum + t.completionTokens, 0);
  if (promptTokens < RUN_FINDING_POLICY.promptBloatMinTokens) return [];
  const ratio = completion > 0 ? promptTokens / completion : Number.POSITIVE_INFINITY;
  if (ratio < RUN_FINDING_POLICY.promptBloatRatio) return [];
  const writes = writeCalls(view).length;
  const peak = view.turns.reduce((max, t) => t.promptTokens > max.promptTokens ? t : max, view.turns[0]);
  return [finding("prompt_bloat", "warn", {
    ratio: Number.isFinite(ratio) ? Math.round(ratio) : 0,
    promptTokens,
    perWrite: writes > 0 ? Math.round(promptTokens / writes) : 0
  }, [turnEvidence(peak)])];
}

// src/runFindings/detectors/repeatedNarration.ts
var import_working7 = require("@seanhogg/builderforce-memory/working");
function asNarration(t) {
  return { role: "assistant", content: t.text, tool_calls: t.calls.map(() => ({})) };
}
var isCandidate = (t) => t.calls.length > 0 && t.text.trim().length > 0;
function repeatedNarration(view) {
  const msgs = view.turns.map(asNarration);
  const folded = (0, import_working7.foldRepeatedNarration)(msgs, RUN_FINDING_POLICY.narrationOverlap);
  const repeats = /* @__PURE__ */ new Set();
  let lastKept = null;
  for (let i = 0; i < view.turns.length; i++) {
    const t = view.turns[i];
    if (!isCandidate(t)) continue;
    if (folded[i] === msgs[i]) {
      lastKept = t;
      continue;
    }
    if (lastKept) repeats.add(lastKept);
    repeats.add(t);
  }
  if (repeats.size === 0) return [];
  const turns = [...repeats].sort((a, b) => a.index - b.index);
  return [finding(
    "repeated_narration",
    "info",
    { turns: turns.length },
    turns.map((t) => turnEvidence(t, "agent.message", t.text))
  )];
}

// src/runFindings/detectors/sameModelRoles.ts
function soleModel(view, role) {
  const models = view.routing.roles.find((r) => r.role === role)?.models ?? [];
  return models.length === 1 ? models[0].model : null;
}
function sameModelRoles(view) {
  const r = view.routing;
  if (r.handOffs + r.handOffsForced + r.coderReasks === 0) return [];
  const plan = soleModel(view, "plan");
  if (!plan || plan !== soleModel(view, "code")) return [];
  const firstPlan = view.turns.find((t) => t.role === "plan");
  const firstCode = view.turns.find((t) => t.role === "code");
  return [finding("same_model_roles", "info", { model: plan }, [
    ...firstPlan ? [turnEvidence(firstPlan)] : [],
    ...firstCode ? [turnEvidence(firstCode)] : []
  ])];
}

// src/runFindings/detectors/serialSingleWrites.ts
function serialSingleWrites(view) {
  const single = view.turns.filter((t) => t.calls.filter((c) => c.write).length === 1);
  if (single.length < RUN_FINDING_POLICY.serialSingleWriteTurns) return [];
  const promptTokens = single.reduce((sum, t) => sum + t.promptTokens, 0);
  return [finding(
    "serial_single_writes",
    "warn",
    { turns: single.length, promptTokens },
    single.map((t) => {
      const write = t.calls.find((c) => c.write);
      return { ...turnEvidence(t, write.name), ...write.paths[0] ? { path: write.paths[0] } : {} };
    })
  )];
}

// src/runFindings/detectors/slowTurns.ts
function slowTurns(view) {
  const slow = view.turns.filter((t) => t.durationMs >= RUN_FINDING_POLICY.slowTurnMs);
  if (slow.length === 0) return [];
  const slowestMs = Math.max(...slow.map((t) => t.durationMs));
  return [finding("slow_turns", "warn", { turns: slow.length, slowestMs }, slow.map((t) => ({ ...turnEvidence(t), note: "slowTurn", params: { ms: t.durationMs, completionTokens: t.completionTokens, argBytes: t.argBytes } })))];
}

// src/runFindings/detectors/stoppedUnverified.ts
function stoppedUnverified(view) {
  if (!view.stopped) return [];
  const files = unverifiedFiles(view);
  if (files.length === 0) return [];
  return [finding("stopped_unverified", "error", { files: files.length }, [
    { step: view.stopped.step, label: STOPPED_TURN_STEP },
    ...files.map((f) => callEvidence(f.lastWrite, f.path))
  ])];
}

// src/runFindings/detectors/unkeptReadiness.ts
function readTurnsAfter(turns, from) {
  let n = 0;
  for (const t of turns) {
    if (t.index <= from) continue;
    if (t.kind !== "read") break;
    n += 1;
  }
  return n;
}
function unkeptReadiness(view) {
  const claims = view.turns.filter((t) => t.kind === "read" && claimsReady(t.text));
  const first = claims[0];
  if (!first) return [];
  const after = readTurnsAfter(view.turns, first.index);
  if (after < RUN_FINDING_POLICY.unkeptReadTurns) return [];
  return [finding(
    "unkept_readiness",
    "warn",
    { claims: claims.length, readTurnsAfter: after },
    claims.map((t) => turnEvidence(t, "agent.message", t.text))
  )];
}

// src/runFindings/detectors/unverifiedWrites.ts
function unverifiedWrites(view) {
  const files = unverifiedFiles(view);
  if (files.length === 0) return [];
  const writes = writeCalls(view).filter((c) => c.paths.some((p) => files.some((f) => f.path === p))).length;
  return [finding(
    "unverified_writes",
    "error",
    { files: files.length, writes },
    files.map((f) => callEvidence(f.lastWrite, f.path))
  )];
}

// src/runFindings/registry.ts
var RUN_FINDING_REGISTRY = [
  { kind: "analysis_overrun", detect: analysisOverrun },
  { kind: "unkept_readiness", detect: unkeptReadiness },
  { kind: "serial_single_writes", detect: serialSingleWrites },
  { kind: "prompt_bloat", detect: promptBloat },
  { kind: "unverified_writes", detect: unverifiedWrites },
  { kind: "bracket_break", detect: bracketBreak },
  { kind: "edit_churn", detect: editChurn },
  { kind: "filed_then_inline", detect: filedThenInline },
  { kind: "same_model_roles", detect: sameModelRoles },
  { kind: "oversized_args", detect: oversizedArgs },
  { kind: "slow_turns", detect: slowTurns },
  { kind: "repeated_narration", detect: repeatedNarration },
  { kind: "stopped_unverified", detect: stoppedUnverified }
];

// src/shipVerification.ts
var GIT_PUSH = gitCommandPattern("push");
var GIT_STATUS_CMD = gitCommandPattern("status");
function commandOf(ev) {
  const a = ev.args;
  if (typeof a?.command === "string") return a.command;
  if (typeof a?.cmd === "string") return a.cmd;
  return "";
}
var DEFAULT_BRANCH_CMD = gitCommandPattern("remote|symbolic-ref|branch");

// src/runFindings/runView.ts
var HAND_OFF_DUE = "loop.hand_off_due";
var ROLE_HANDOFF = "llm.role_handoff";
var record2 = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
function jsonBytes2(v) {
  try {
    return utf8ByteLength2(JSON.stringify(v ?? null));
  } catch {
    return 0;
  }
}
function isCheck(ev) {
  if (CHECK_TOOL.test(ev.label)) return true;
  return SHELL_TOOLS.has(ev.label) && CHECK_COMMAND.test(commandOf(ev));
}
function callOf(ev, step, turn) {
  const ok = !ev.isError && !isFailedToolResult(ev.result);
  const args = record2(ev.args);
  const write = ok && isCodeChangeTool(ev.label) && !isCacheAnswered(ev);
  return {
    step,
    turn,
    name: ev.label,
    args,
    ok,
    argBytes: jsonBytes2(ev.args),
    write,
    check: ok && isCheck(ev),
    paths: write ? editedPathsOf(ev.label, args) : []
  };
}
function kindOf(t, failed2) {
  if (failed2) return "failed";
  if (t.forced) return "forced";
  if (t.calls.some((c) => c.write)) return "write";
  return t.toolCalls > 0 || t.calls.length > 0 ? "read" : "text";
}
function buildRunView(events, messages = []) {
  const list = [...events];
  const turns = [];
  const calls = [];
  let forcedNext = false;
  let stopped = null;
  for (const [i, ev] of list.entries()) {
    const step = i + 1;
    const current = turns[turns.length - 1];
    if (ev.label === HAND_OFF_DUE) {
      forcedNext = true;
      continue;
    }
    if (ev.label === STOPPED_TURN_STEP) {
      const model = record2(ev.args).model;
      stopped = { step, ...typeof model === "string" ? { model } : {} };
      continue;
    }
    if (ev.label === "llm.complete") {
      const logged = modelTurnLog([ev])[0];
      if (!logged) continue;
      const failed2 = logged.failed === true;
      turns.push({
        index: turns.length + 1,
        step,
        role: logged.role ?? "",
        model: logged.model,
        kind: failed2 ? "failed" : "text",
        toolCalls: logged.toolCalls,
        promptTokens: ev.usage?.prompt ?? 0,
        completionTokens: logged.completionTokens ?? 0,
        durationMs: logged.durationMs ?? 0,
        argBytes: logged.argBytes ?? 0,
        forced: forcedNext && !failed2,
        text: "",
        calls: []
      });
      if (!failed2) forcedNext = false;
      stopped = null;
      continue;
    }
    if (!current) {
      if (ev.category === "tool") calls.push(callOf(ev, step, 0));
      continue;
    }
    if (ev.label === "agent.message" && typeof ev.result === "string" && !current.text) current.text = ev.result;
    else if (ev.label === ROLE_HANDOFF && typeof record2(ev.args).via === "string") current.handOffVia = record2(ev.args).via;
    else if (ev.category === "tool") {
      const call = callOf(ev, step, current.index);
      current.calls.push(call);
      calls.push(call);
    }
  }
  for (const t of turns) t.kind = kindOf(t, t.kind === "failed");
  return {
    events: list,
    messages: [...messages],
    turns,
    calls,
    stopped,
    routing: routingByRole(modelTurnLog(list), list),
    staffing: staffingSummaryInTrace(list)
  };
}

// src/runFindings/detectRunFindings.ts
var SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
var firstStep = (f) => f.evidence.reduce((min, e) => Math.min(min, e.step), Number.POSITIVE_INFINITY);
function compareFindings(a, b) {
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || firstStep(a) - firstStep(b) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function summaryOf(view, findings, identity) {
  const ask = view.messages.find((m) => m.role === "user")?.content.replace(/\s+/g, " ").trim() ?? "";
  const max = RUN_FINDING_POLICY.excerptChars;
  const counts = { info: 0, warn: 0, error: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return {
    id: identity.id ?? "",
    title: identity.title ?? (ask.length > max ? `${ask.slice(0, max - 1).trimEnd()}\u2026` : ask),
    startedAt: view.events[0]?.ts ?? "",
    endedAt: view.events[view.events.length - 1]?.ts ?? "",
    models: [...new Set(view.turns.map((t) => t.model))],
    turns: view.turns.length,
    counts
  };
}
function detectRunFindings(events, messages = [], identity = {}) {
  const view = buildRunView(events, messages);
  const findings = withUniqueIds(RUN_FINDING_REGISTRY.flatMap((d) => d.detect(view)).sort(compareFindings));
  return {
    summary: summaryOf(view, findings, identity),
    turns: view.turns.map((t) => ({
      index: t.index,
      role: t.role,
      model: t.model,
      kind: t.kind,
      toolCalls: t.toolCalls,
      promptTokens: t.promptTokens,
      completionTokens: t.completionTokens,
      durationMs: t.durationMs
    })),
    findings,
    files: fileLedger(view).map((f) => ({ path: f.path, writes: f.writes, checked: f.checked }))
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RUN_FINDING_POLICY,
  RUN_FINDING_REGISTRY,
  buildRunView,
  compareFindings,
  detectRunFindings,
  traceWithPersistedSteps
});
//# sourceMappingURL=runFindings.cjs.map