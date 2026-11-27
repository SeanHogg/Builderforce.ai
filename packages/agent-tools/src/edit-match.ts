/**
 * WHERE an `edit_file` `oldString` lands in a file — the matcher behind {@link applyStringEdit}
 * (`edit.ts`), plus the line-ending helpers it and the whole-file write share.
 *
 * Tiers, tried in order; the first that finds anything decides (a later tier never runs
 * after an earlier one found a match, even an ambiguous one):
 *   1. `exact` / `crlf` — the literal text, CRLF and LF comparing equal on both sides.
 *   2. `unescaped`     — the model over-escaped (`\"` for `"`, `\n` for a newline): the
 *                        escape kinds `oldString` used whose escaped form does not occur in
 *                        the file are unescaped, in `oldString` and `newString` alike; any
 *                        other escape is left as written.
 *   3. `whitespace`    — line by line, ignoring trailing whitespace and leading indentation
 *                        (tabs vs spaces, a different width); the first/last line of a
 *                        multi-line `oldString` may be a partial line matched by trimmed
 *                        content at a token boundary, and at least one whole non-blank
 *                        line must match. The old→file indentation must be structurally
 *                        consistent (one mapping per indent, same nesting order) or there
 *                        is no match. `newString` is re-indented to the file's indentation.
 * Every tier answers in ORIGINAL offsets, so the rest of the file is byte-for-byte intact.
 */

/** Which tier matched — see the module doc. */
export type MatchTier = "exact" | "crlf" | "unescaped" | "whitespace";

/** One replacement in ORIGINAL offsets: `content[start, end)` becomes `text`. */
export interface Splice {
  start: number;
  end: number;
  text: string;
}

/** A match: its tier and splices (one, or every occurrence under `replaceAll`); `ambiguous`
 *  when a tier found more than one without `replaceAll`; `null` when no tier matched. */
export type EditMatch = { tier: MatchTier; splices: Splice[] } | { ambiguous: true; matchCount: number } | null;

export const toLF = (s: string): string => s.replace(/\r\n/g, "\n");
export const countNewlines = (s: string): number => s.split("\n").length - 1;

/** A file's line-ending style: the one most of its lines use, or `null` for a file with none. */
export type Eol = "\r\n" | "\n";

/** The dominant EOL of `content` — CRLF wins a tie; `null` when it has no newline at all. */
export function dominantEol(content: string): Eol | null {
  const all = countNewlines(content);
  if (all === 0) return null;
  const crlf = content.split("\r\n").length - 1;
  return crlf >= all - crlf ? "\r\n" : "\n";
}

/** `text` with every line ending (CRLF or LF) rewritten to `eol`; untouched when `eol` is null. */
export function withEol(text: string, eol: Eol | null): string {
  if (!eol) return text;
  const lf = toLF(text);
  return eol === "\n" ? lf : lf.replace(/\n/g, "\r\n");
}

/**
 * `content` with its CRLFs folded to LF, plus `at[i]` = the offset in `content` of the
 * character that produced `lf[i]` (a folded CRLF maps to its `\r`). `at[lf.length]` is
 * `content.length`, so an LF span `[s, e)` is `[at[s], at[e])` in the original.
 */
function foldToLF(content: string): { lf: string; at: Int32Array } {
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

/** The non-overlapping `[start, end)` spans of `needle` in `hay`, in order — all of them, or at most two (enough to tell "not unique"). */
function spansOf(hay: string, needle: string, all: boolean): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
    spans.push([at, at + needle.length]);
    if (!all && spans.length === 2) break;
  }
  return spans;
}

/** Tier 1: the EOL-normalised match, then (only for a needle whose lone `\r` the fold cannot see) the literal one. */
function exactSpans(content: string, needle: string, all: boolean): { tier: "exact" | "crlf"; spans: Array<[number, number]> } {
  const { lf, at } = foldToLF(content);
  const folded = spansOf(lf, toLF(needle), all).map(([s, e]): [number, number] => [at[s]!, at[e]!]);
  if (folded.length > 0) return { tier: content.slice(folded[0]![0], folded[0]![1]) === needle ? "exact" : "crlf", spans: folded };
  return { tier: "exact", spans: spansOf(content, needle, all) };
}

const ESCAPE = /\\(["'nt\\])/g;
const UNESCAPED: Record<string, string> = { '"': '"', "'": "'", n: "\n", t: "\t", "\\": "\\" };
/** `s` with only the escape KINDS in `kinds` (the char after the backslash) unescaped; every other escape is kept as written. */
const unescape = (s: string, kinds: ReadonlySet<string>): string => s.replace(ESCAPE, (seq, c: string) => (kinds.has(c) ? UNESCAPED[c]! : seq));

/**
 * Tier 2's escape kinds: those `oldString` uses whose escaped form does NOT occur in the file
 * (a kind the file itself writes escaped is real text, not over-escaping). `null` when none.
 * newString is unescaped for exactly these kinds — never for an escape oldString did not over-use.
 */
function overEscapedKinds(content: string, oldString: string): ReadonlySet<string> | null {
  const kinds = new Set<string>();
  for (const m of oldString.matchAll(ESCAPE)) {
    if (!content.includes(m[0])) kinds.add(m[1]!);
  }
  return kinds.size ? kinds : null;
}

interface FileLine {
  /** Offset of the line's first character. */
  start: number;
  /** Offset just past its text (before the EOL). */
  end: number;
  /** Offset just past its EOL (== `end` on a last line without one). */
  next: number;
  text: string;
}

function fileLines(content: string): FileLine[] {
  const out: FileLine[] = [];
  let start = 0;
  while (start <= content.length) {
    const nl = content.indexOf("\n", start);
    const lineEnd = nl === -1 ? content.length : nl;
    const end = lineEnd > start && content.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
    out.push({ start, end, next: nl === -1 ? content.length : nl + 1, text: content.slice(start, end) });
    if (nl === -1) break;
    start = nl + 1;
  }
  return out;
}

const indentOf = (line: string): string => /^[ \t]*/.exec(line)![0];

/** How each old line compared: `full` (whole-line, trimmed), `suffix`/`prefix` (a partial first/last line), or no match. */
type LineFit = "full" | "suffix" | "prefix" | null;

const isWord = (ch: string | undefined): boolean => ch !== undefined && /\w/.test(ch);
/** A token boundary between `a` and `b` (the line edge counts): never splits an identifier. */
const boundary = (a: string | undefined, b: string | undefined): boolean => !isWord(a) || !isWord(b);

function fitLine(file: string, old: string, k: number, n: number, lastMustBeFull: boolean): LineFit {
  const f = file.trim();
  const o = old.trim();
  if (f === o) return "full";
  if (n === 1 || o === "") return null;
  if (k === 0 && f.endsWith(o) && boundary(f[f.length - o.length - 1], o[0])) return "suffix";
  if (k === n - 1 && !lastMustBeFull && f.startsWith(o) && boundary(o[o.length - 1], f[o.length])) return "prefix";
  return null;
}

/** Visual width of an indent (tab = 4) — only ever compared within ONE side (old or file). */
const widthOf = (indent: string): number => [...indent].reduce((w, ch) => w + (ch === "\t" ? 4 : 1), 0);

/**
 * The old-indent → file-indent map from the fully matched, non-blank lines at `i`, or `null`
 * when the indentation STRUCTURE disagrees: one old indent mapping to two file indents, or the
 * old indents ordered differently from the file's. Trimmed lines can match text whose nesting
 * differs — fatal for Python/YAML — so such a match is no match.
 */
function indentMap(lines: readonly FileLine[], i: number, old: readonly string[], fits: readonly LineFit[]): Array<[string, string]> | null {
  const map: Array<[string, string]> = [];
  for (let k = 0; k < old.length; k += 1) {
    if (fits[k] !== "full" || old[k]!.trim() === "") continue;
    const from = indentOf(old[k]!);
    const to = indentOf(lines[i + k]!.text);
    const seen = map.find(([o]) => o === from);
    if (seen && seen[1] !== to) return null;
    if (!seen) map.push([from, to]);
  }
  for (const [oa, fa] of map) {
    for (const [ob, fb] of map) {
      const dOld = widthOf(oa) - widthOf(ob);
      const dFile = widthOf(fa) - widthOf(fb);
      if (Math.sign(dOld) !== Math.sign(dFile)) return null;
    }
  }
  return map;
}

/** `line` moved from `oldString`'s indentation to the file's: the longest mapped old indent that prefixes it is swapped for its file indent. */
function reindent(line: string, map: ReadonlyArray<[string, string]>): string {
  if (line.trim() === "") return "";
  const ind = indentOf(line);
  let best: [string, string] | undefined;
  for (const pair of map) {
    if (ind.startsWith(pair[0]) && (!best || pair[0].length > best[0].length)) best = pair;
  }
  return best ? best[1] + line.slice(best[0].length) : line;
}

/** Tier 3 — see the module doc. `eol` is the line ending the replacement is written in. */
function whitespaceSplices(content: string, oldString: string, newString: string, all: boolean, eol: Eol): Splice[] {
  const oldLF = toLF(oldString);
  const endsWithNewline = oldLF.endsWith("\n");
  const old = (endsWithNewline ? oldLF.slice(0, -1) : oldLF).split("\n");
  if (old.every((l) => l.trim() === "")) return [];
  const lines = fileLines(content);
  const n = old.length;
  const splices: Splice[] = [];
  for (let i = 0; i + n <= lines.length; ) {
    const fits: LineFit[] = [];
    for (let k = 0; k < n; k += 1) {
      const fit = fitLine(lines[i + k]!.text, old[k]!, k, n, endsWithNewline);
      if (!fit) break;
      fits.push(fit);
    }
    // At least one whole non-blank line must anchor the match (two partial edges alone are not one).
    const anchored = fits.length === n && fits.some((fit, k) => fit === "full" && old[k]!.trim() !== "");
    const map = anchored ? indentMap(lines, i, old, fits) : null;
    if (!map) {
      i += 1;
      continue;
    }
    splices.push(whitespaceSplice(content, lines, i, old, fits, map, newString, endsWithNewline, eol));
    if (!all && splices.length === 2) break;
    i += n;
  }
  return splices;
}

function whitespaceSplice(
  content: string,
  lines: readonly FileLine[],
  i: number,
  old: readonly string[],
  fits: readonly LineFit[],
  map: ReadonlyArray<[string, string]>,
  newString: string,
  endsWithNewline: boolean,
  eol: Eol,
): Splice {
  const n = old.length;
  const first = lines[i]!;
  const last = lines[i + n - 1]!;
  const start = fits[0] === "suffix" ? first.start + first.text.trimEnd().length - old[0]!.trim().length : first.start;
  let end: number;
  let newLF = toLF(newString);
  if (fits[n - 1] === "prefix") end = last.start + indentOf(last.text).length + old[n - 1]!.trim().length;
  else if (!endsWithNewline) end = last.end;
  else if (last.next > last.end) end = last.next;
  else {
    // The file's last line has no EOL: the oldString's trailing newline matched end-of-file; keep it that way.
    end = content.length;
    if (newLF.endsWith("\n")) newLF = newLF.slice(0, -1);
  }
  // A partial first line starts mid-line, so its replacement takes no indentation; a trailing
  // newline in newString leaves a final empty segment, which `reindent` keeps empty.
  const out = newLF.split("\n").map((l, k) => (k === 0 && fits[0] === "suffix" ? l.trimStart() : reindent(l, map)));
  return { start, end, text: out.join(eol) };
}

/** The tiers in order — see the module doc. `eol` is the file's dominant EOL (`null` when it has none). */
export function matchEdit(content: string, oldString: string, newString: string, replaceAll: boolean, eol: Eol | null): EditMatch {
  const decide = (tier: MatchTier, splices: Splice[]): EditMatch => {
    if (splices.length === 0) return null;
    if (splices.length > 1 && !replaceAll) return { ambiguous: true, matchCount: splices.length };
    return { tier, splices };
  };
  const spliced = (spans: Array<[number, number]>, text: string): Splice[] => spans.map(([start, end]) => ({ start, end, text }));

  const exact = exactSpans(content, oldString, replaceAll);
  const t1 = decide(exact.tier, spliced(exact.spans, withEol(newString, eol)));
  if (t1) return t1;

  const kinds = overEscapedKinds(content, oldString);
  const repaired = kinds ? unescape(oldString, kinds) : null;
  const newRepaired = kinds ? unescape(newString, kinds) : newString;
  if (repaired !== null) {
    const t2 = decide("unescaped", spliced(exactSpans(content, repaired, replaceAll).spans, withEol(newRepaired, eol)));
    if (t2) return t2;
  }

  const writeEol = eol ?? "\n";
  const t3 = decide("whitespace", whitespaceSplices(content, oldString, newString, replaceAll, writeEol));
  if (t3 || repaired === null) return t3;
  return decide("whitespace", whitespaceSplices(content, repaired, newRepaired, replaceAll, writeEol));
}
