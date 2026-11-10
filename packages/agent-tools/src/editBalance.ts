/**
 * Bracket balance of an edit (PRD 46 §3.2): how much a replacement changes the `{}` / `()` / `[]`
 * balance of the text it replaces. `edit_file` applies `old_string → new_string` atomically, so a
 * `new_string` that closes an object early (chat #70776: `};` after the spreads of `labels.ts`)
 * leaves the file unparseable while the call reports success. A non-zero delta is that signal,
 * computed with no compiler and no file read — the run's own post-edit note and the run-findings
 * `bracket_break` detector both read it.
 *
 * The lexer skips what is not code: '…' and "…" strings, template text (the `${ … }` braces of an
 * interpolation balance themselves and are never counted), and `//` / `/* *\/` comments. Regex
 * literals are not recognised — a bracket inside one counts, which on an edit fragment is as likely
 * balanced as not. Pure.
 */

export interface BracketDelta {
  curly: number;
  paren: number;
  square: number;
}

/** The extensions whose bracket syntax this lexer knows. Anything else reports zeros. */
const LEXED_EXTENSIONS: ReadonlySet<string> = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'json', 'jsonc',
]);

const ZERO: BracketDelta = Object.freeze({ curly: 0, paren: 0, square: 0 });

/** `'.ts'`, `'ts'` and `'src/labels.ts'` all name the TypeScript lexer. */
function extensionOf(ext: string): string {
  const dot = ext.lastIndexOf('.');
  return (dot >= 0 ? ext.slice(dot + 1) : ext).toLowerCase();
}

/** Opens minus closes of each bracket kind in `text`, code only. */
export function bracketBalance(text: string): BracketDelta {
  const out = { curly: 0, paren: 0, square: 0 };
  // One entry per open `{` in code: `true` when it is a template's `${`, so its `}` resumes the template.
  const braces: boolean[] = [];
  let i = 0;
  const n = text.length;
  /** Skip template text from `i` (just past a backtick or an interpolation's `}`). */
  const template = (): void => {
    while (i < n) {
      const ch = text[i]!;
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { i += 1; return; }
      if (ch === '$' && text[i + 1] === '{') { braces.push(true); i += 2; return; }
      i += 1;
    }
  };
  while (i < n) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? n : end + 1;
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else if (ch === '"' || ch === "'") {
      // A quote ends at its twin or at the line's end — an edit fragment may hold half a string.
      i += 1;
      while (i < n && text[i] !== ch && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
      i += 1;
    } else if (ch === '`') {
      i += 1;
      template();
    } else {
      if (ch === '{') { out.curly += 1; braces.push(false); }
      else if (ch === '}') {
        if (braces.pop() === true) { i += 1; template(); continue; }
        out.curly -= 1;
      }
      else if (ch === '(') out.paren += 1;
      else if (ch === ')') out.paren -= 1;
      else if (ch === '[') out.square += 1;
      else if (ch === ']') out.square -= 1;
      i += 1;
    }
  }
  return out;
}

/**
 * How replacing `before` with `after` changes bracket balance — `after` minus `before`, per kind.
 * Zeros for an extension this lexer does not know (`ext` may be `'ts'`, `'.ts'` or a path).
 */
export function bracketDelta(before: string, after: string, ext: string): BracketDelta {
  if (!LEXED_EXTENSIONS.has(extensionOf(ext))) return { ...ZERO };
  const b = bracketBalance(before);
  const a = bracketBalance(after);
  return { curly: a.curly - b.curly, paren: a.paren - b.paren, square: a.square - b.square };
}

/** True when any kind's balance moved. */
export function changesBalance(delta: BracketDelta): boolean {
  return delta.curly !== 0 || delta.paren !== 0 || delta.square !== 0;
}
