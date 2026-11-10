/**
 * callbackOwners.ts — the CALLBACK OWNERS of a JS/TS file (PRD 43 P0b): a statement that hands an inline callback to a
 * call and opens its body on the same line becomes a `function` definition flagged `callback: true`, whose body is the
 * callback's, so the calls in a route handler or a message listener have an owner (a sequence starts there):
 *
 *   routes.post("/me/youtube", validate(s), async (c) => {      →  routes.post "/me/youtube"
 *   chrome.runtime.onMessage.addListener((msg) => {             →  chrome.runtime.onMessage.addListener
 *   app.get("/a", h).post("/b", async (c) => {                  →  app.post "/b"   (the call that owns the callback)
 *
 * Where: a statement at column 0, or a first-level statement of a column-0 block that declares nothing
 * (`if (!window.__x) {`). Never in a test file ({@link isTestSourcePath}); never a test callee (`describe`, `it`, `test`,
 * hooks), a scheduler (`setTimeout`, `setInterval`, `setImmediate`, `queueMicrotask`, `requestAnimationFrame`) or a
 * keyword-led statement (`void (async () => {`, `await`, `return`, `new`). Lines over `MAX_SCANNED_LINE` are skipped.
 *
 * NAME, one stable format: `<receiver root>.<method>` of the owning call (the statement's callee when it is one call),
 * + ` "<literal>"` when the owning call's FIRST argument is a string literal (at most {@link MAX_OWNER_LITERAL} chars),
 * + ` #<n>` from the second owner of the same name in the file on. Pure.
 */

import { ID, MAX_SCANNED_LINE } from "./callScan.js";
import type { CodeSymbol } from "./symbols.js";
import { isTestSourcePath } from "./testPaths.js";

/** The longest first-argument literal a name carries. */
export const MAX_OWNER_LITERAL = 80;

const STATEMENT = new RegExp(`^([ \\t]*)(${ID}(?:\\??\\.${ID})*)\\s*\\(`);
/** The callback that opens its body at the end of the line: `(a) => {`, `a => {`, `async (a): T => {`, `function (a) {`. */
const CALLBACK_AT_END = new RegExp(`(?:\\([^()]*\\)(?:\\s*:\\s*[^=()]+)?\\s*=>|\\b${ID}\\s*=>|\\bfunction\\b[^(]*\\([^()]*\\))\\s*\\{\\s*$`);
/** A column-0 block that is no declaration — its first-level statements are still top level (`if (!window.__x) {`). */
const TOP_BLOCK = /^(?:if\s*\(.*\)|\}?\s*else(?:\s+if\s*\(.*\))?|try|\}?\s*finally|\{)\s*\{\s*$/;
const NOT_OWNERS = new Set([
  "describe", "it", "test", "suite", "bench", "beforeEach", "afterEach", "beforeAll", "afterAll",
  "setTimeout", "setInterval", "setImmediate", "queueMicrotask", "requestAnimationFrame",
  "void", "await", "return", "new", "if", "for", "while", "switch", "catch", "function", "with", "do", "else", "try", "typeof", "yield",
]);

/** The position of the `(` of the call that owns the argument starting at `at`: the innermost one still open there. */
function owningOpen(line: string, at: number): number {
  const open: number[] = [];
  for (let i = 0; i < at; i += 1) {
    const c = line[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i += 1; i < at && line[i] !== c; i += 1) if (line[i] === "\\") i += 1;
    } else if (c === "(") open.push(i);
    else if (c === ")") open.pop();
  }
  return open.length ? open[open.length - 1]! : -1;
}

/** The owner's name at a candidate line, or undefined when the line is no callback owner. */
export function callbackOwnerName(line: string): string | undefined {
  if (line.length > MAX_SCANNED_LINE) return undefined;
  const st = STATEMENT.exec(line);
  const cb = st ? CALLBACK_AT_END.exec(line) : null;
  if (!st || !cb) return undefined;
  const lead = st[2]!.replace(/\?/g, "");
  const root = lead.split(".")[0]!;
  if (NOT_OWNERS.has(root)) return undefined;
  let open = owningOpen(line, cb.index);
  if (open < 0) return undefined;
  // The owning call's callee: the statement's own (one call), or `<root>.<method>` of a chained call (`).post(`); a callback
  // wrapped in a helper (`routes.post("/x", wrap(async (c) => {`) is named by the statement's call.
  const before = line.slice(0, open).trimEnd();
  const member = /(?:^|[^\w$])([A-Za-z_$][\w$]*)$/.exec(before)?.[1];
  let callee: string;
  if (open === st[0]!.length - 1) callee = lead;
  else if (member && /\)\s*\.\s*$/.test(before.slice(0, before.length - member.length))) callee = `${root}.${member}`;
  else { callee = lead; open = st[0]!.length - 1; }
  if (member && NOT_OWNERS.has(member) && callee !== lead) return undefined;
  const first = /^\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/.exec(line.slice(open + 1));
  const literal = first && !first[2]!.includes("${") ? first[2]!.slice(0, MAX_OWNER_LITERAL) : undefined;
  return literal !== undefined ? `${callee} "${literal}"` : callee;
}

/** The scan state of one file's lines (see the file comment); `extractSymbols` hands it each line outside a class. */
export class CallbackOwnerScan {
  private readonly enabled: boolean;
  /** The indent of the first-level statements of a column-0 non-declaration block ("" before its first one is seen). */
  private topBlock: string | undefined;
  /** The indent of the owner whose body we are in, until a line at that indent closes it. */
  private inside: string | undefined;
  private readonly named = new Map<string, number>();

  constructor(path: string) {
    this.enabled = !isTestSourcePath(path);
  }

  /** True while the line is inside an owner's body (no definition is read there). Call for EVERY line, in order. */
  inBody(line: string): boolean {
    if (this.inside === undefined) return false;
    const rest = line.startsWith(this.inside) ? line.slice(this.inside.length) : undefined;
    if (rest !== undefined && /^[})]/.test(rest)) { this.inside = undefined; return true; }
    // A column-0 statement that closes nothing ends a body whose close was not seen (a definition is never lost to it).
    if (!/^\S/.test(line) || /^[})\]`]/.test(line)) return true;
    this.inside = undefined;
    return false;
  }

  /** Tracks the column-0 blocks; call for every line outside an owner's body, before the definitions are read. */
  track(line: string): void {
    if (/^\S/.test(line)) this.topBlock = TOP_BLOCK.test(line) ? "" : undefined;
    else if (this.topBlock === "" && line.trim()) this.topBlock = /^[ \t]*/.exec(line)![0];
  }

  /** The owner a line outside any class declares, if any. */
  ownerAt(line: string, lineNo: number): CodeSymbol | undefined {
    if (!this.enabled) return undefined;
    const indent = /^[ \t]*/.exec(line)![0];
    if (indent !== "" && indent !== this.topBlock) return undefined;
    const base = callbackOwnerName(line);
    if (!base) return undefined;
    const n = (this.named.get(base) ?? 0) + 1;
    this.named.set(base, n);
    this.inside = indent;
    return { name: n === 1 ? base : `${base} #${n}`, kind: "function", line: lineNo, exported: false, callback: true };
  }
}
