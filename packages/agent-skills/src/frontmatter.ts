/**
 * SKILL.md frontmatter — splitting it from the body, and reading the YAML in it.
 *
 * ── WHY A PARSER OF ITS OWN ──────────────────────────────────────────────────
 * This package is imported by the Worker, the browser and the VS Code host as well as
 * Node, and has no dependencies so that stays true. A skill's frontmatter is a small,
 * flat document — a handful of scalars, a `metadata` map, now and then a block scalar
 * or a JSON-style flow value — so the subset below covers every SKILL.md the spec
 * describes. A host that already carries a full YAML implementation (the agent-runtime
 * does) passes it as `parseYaml` and gets that instead, through the SAME entry point:
 * one splitter, one result shape, whichever parser read the block.
 */

/** A YAML implementation a host may inject (e.g. the `yaml` package's `parse`). */
export type YamlParse = (block: string) => unknown;

export interface SplitSkillMarkdown {
  /** The raw YAML between the opening and closing `---`, or null when there is none. */
  frontmatter: string | null;
  /** Everything after the closing fence, with one leading blank line dropped. */
  body: string;
}

/** Split a SKILL.md into its frontmatter block and its Markdown body. */
export function splitSkillMarkdown(text: string): SplitSkillMarkdown {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n") && normalized !== "---") return { frontmatter: null, body: normalized };
  const close = normalized.indexOf("\n---", 3);
  if (close === -1) return { frontmatter: null, body: normalized };
  // The closing fence must be the whole line.
  const afterFence = normalized.slice(close + 4);
  const lineEnd = afterFence.indexOf("\n");
  const fenceRest = lineEnd === -1 ? afterFence : afterFence.slice(0, lineEnd);
  if (fenceRest.trim() !== "") return { frontmatter: null, body: normalized };
  const body = lineEnd === -1 ? "" : afterFence.slice(lineEnd + 1);
  return { frontmatter: normalized.slice(4, close), body: body.replace(/^\n/, "") };
}

/**
 * Parse a frontmatter block into a plain object. Never throws: a block that is not a
 * mapping yields `{}`, and the validator reports the missing required fields — which
 * is the error a skill author can act on, unlike a parser stack trace.
 */
export function parseFrontmatter(block: string, parseYaml?: YamlParse): Record<string, unknown> {
  if (parseYaml) {
    try {
      const parsed = parseYaml(block);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      // Fall through to the subset: a malformed block still gets its best reading.
    }
  }
  return parseMapping(toLines(block), 0, -1).value;
}

// ── The YAML subset ────────────────────────────────────────────────────────────

interface Line {
  indent: number;
  text: string;
}

function toLines(block: string): Line[] {
  return block.split("\n").map((raw) => {
    const indent = raw.length - raw.trimStart().length;
    return { indent, text: raw.trim() };
  });
}

const isBlankOrComment = (line: Line): boolean => line.text === "" || line.text.startsWith("#");

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse a mapping whose keys sit at an indent deeper than `parentIndent`. */
function parseMapping(lines: Line[], start: number, parentIndent: number): { value: Record<string, unknown>; next: number } {
  const value: Record<string, unknown> = {};
  let i = start;
  let keyIndent = -1;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlankOrComment(line)) { i++; continue; }
    if (line.indent <= parentIndent) break;
    if (keyIndent === -1) keyIndent = line.indent;
    if (line.indent !== keyIndent) { i++; continue; }
    const match = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:#][^:]*?)\s*:(?:\s+(.*))?$/.exec(line.text);
    if (!match) { i++; continue; }
    const key = unquoteKey(match[1]!);
    const inline = (match[2] ?? "").trim();
    const parsed = parseValue(lines, i, keyIndent, inline);
    value[key] = parsed.value;
    i = parsed.next;
  }
  return { value, next: i };
}

function unquoteKey(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('"')) return parseDoubleQuoted(t);
  if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/** The value of the key on line `at`, given what followed its colon. */
function parseValue(lines: Line[], at: number, keyIndent: number, inline: string): { value: unknown; next: number } {
  const next = at + 1;
  if (inline === "") {
    const child = firstContentLine(lines, next);
    if (child === -1 || lines[child]!.indent <= keyIndent) return { value: null, next };
    if (lines[child]!.text.startsWith("- ") || lines[child]!.text === "-") return parseSequence(lines, child, keyIndent);
    return parseMapping(lines, child, keyIndent);
  }
  const block = /^([|>])([+-]?)\s*(?:#.*)?$/.exec(inline);
  if (block) return parseBlockScalar(lines, next, keyIndent, block[1] as "|" | ">", block[2] as "" | "+" | "-");
  if (inline.startsWith("{") || inline.startsWith("[")) return parseFlow(lines, at, inline);
  if (inline.startsWith('"')) return { value: parseDoubleQuoted(inline), next };
  if (inline.startsWith("'")) return { value: inline.slice(1, inline.lastIndexOf("'")).replace(/''/g, "'"), next };
  // A plain scalar may fold onto deeper-indented continuation lines.
  let text = stripComment(inline);
  let i = next;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.text === "") { i++; continue; }
    if (line.indent <= keyIndent) break;
    text = `${text} ${stripComment(line.text)}`;
    i++;
  }
  return { value: plainScalar(text), next: i };
}

function firstContentLine(lines: Line[], from: number): number {
  for (let i = from; i < lines.length; i++) if (!isBlankOrComment(lines[i]!)) return i;
  return -1;
}

function parseSequence(lines: Line[], start: number, parentIndent: number): { value: unknown[]; next: number } {
  const items: unknown[] = [];
  const itemIndent = lines[start]!.indent;
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlankOrComment(line)) { i++; continue; }
    if (line.indent <= parentIndent || line.indent < itemIndent) break;
    if (line.indent === itemIndent && (line.text.startsWith("- ") || line.text === "-")) {
      const rest = line.text.slice(1).trim();
      items.push(rest.startsWith('"') ? parseDoubleQuoted(rest) : rest.startsWith("'") ? rest.slice(1, -1).replace(/''/g, "'") : plainScalar(stripComment(rest)));
    }
    i++;
  }
  return { value: items, next: i };
}

function parseBlockScalar(lines: Line[], start: number, keyIndent: number, style: "|" | ">", chomp: "" | "+" | "-"): { value: string; next: number } {
  const raw: string[] = [];
  let i = start;
  let contentIndent = -1;
  // Re-read the ORIGINAL indentation: block scalars keep relative indentation.
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.text !== "" && line.indent <= keyIndent) break;
    if (line.text !== "" && contentIndent === -1) contentIndent = line.indent;
    raw.push(line.text === "" ? "" : " ".repeat(Math.max(0, line.indent - Math.max(contentIndent, 0))) + line.text);
    i++;
  }
  let text = style === "|" ? raw.join("\n") : fold(raw);
  if (chomp === "-") text = text.replace(/\n+$/, "");
  else if (chomp === "") text = text.replace(/\n+$/, "") + "\n";
  return { value: chomp === "" && text === "\n" ? "" : text, next: i };
}

/** `>` folding: adjacent lines join with a space, a blank line becomes a newline. */
function fold(raw: readonly string[]): string {
  let out = "";
  for (const line of raw) {
    if (line === "") out += "\n";
    else if (out === "" || out.endsWith("\n")) out += line;
    else out += ` ${line}`;
  }
  return out;
}

/** A flow mapping/sequence, possibly spanning continuation lines (JSON5-ish). */
function parseFlow(lines: Line[], at: number, inline: string): { value: unknown; next: number } {
  let text = inline;
  let i = at + 1;
  // Indentation does not bound a flow collection — its brackets do. The closing `}` of
  // a multi-line JSON block conventionally sits back at the key's own column.
  while (!bracketsBalanced(text) && i < lines.length) {
    text = `${text}\n${lines[i]!.text}`;
    i++;
  }
  return { value: parseFlowText(text), next: i };
}

function bracketsBalanced(text: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k]!;
    if (quote) {
      if (ch === "\\") { k++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return depth <= 0;
}

/** JSON first; then a lenient pass (unquoted keys, single quotes, trailing commas). */
function parseFlowText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const lenient = text
      .replace(/'((?:[^'\\]|\\.)*)'/g, (_m, s: string) => JSON.stringify(s.replace(/\\'/g, "'")))
      .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(lenient);
    } catch {
      return text;
    }
  }
}

function parseDoubleQuoted(text: string): string {
  const end = findClosingQuote(text);
  const literal = text.slice(0, end + 1);
  try {
    return JSON.parse(literal) as string;
  } catch {
    return literal.slice(1, -1);
  }
}

function findClosingQuote(text: string): number {
  for (let k = 1; k < text.length; k++) {
    if (text[k] === "\\") { k++; continue; }
    if (text[k] === '"') return k;
  }
  return text.length - 1;
}

/** A trailing ` # comment` is not part of a plain scalar. */
function stripComment(text: string): string {
  const hash = text.search(/\s#/);
  return (hash === -1 ? text : text.slice(0, hash)).trim();
}

/** Plain scalars stay strings — `version: 1.0` must not become the number 1 — except
 *  the booleans and null, which spec-adjacent keys (`disable-model-invocation`) use. */
function plainScalar(text: string): unknown {
  if (text === "true" || text === "True" || text === "TRUE") return true;
  if (text === "false" || text === "False" || text === "FALSE") return false;
  if (text === "null" || text === "~" || text === "") return null;
  return text;
}
