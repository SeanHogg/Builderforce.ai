/**
 * Bracket balance of an edit (PRD 46 §3.2): how much a replacement changes the `{}` / `()` / `[]`
 * balance of the text it replaces. `edit_file` applies `old_string → new_string` atomically, so a
 * `new_string` that closes an object early (chat #70776: `};` after the spreads of `labels.ts`)
 * leaves the file unparseable while the call reports success. A non-zero delta is that signal,
 * computed with no compiler and no file read — the run's own post-edit note and the run-findings
 * `bracket_break` detector both read it.
 *
 * The lexer skips what is not code:
 *   - '…' and "…" strings (a quote ends at its twin or at the line's end — a fragment may hold half a string);
 *   - template text (the `${ … }` braces of an interpolation balance themselves and are never counted);
 *   - `//` and `/* *\/` comments;
 *   - regex literals, recognised heuristically: a `/` in expression position — at the start of the text or of a
 *     line, after an operator or one of `( , = : [ ! & | ? { } ;`, or after a keyword such as `return` / `typeof`
 *     — that closes on the same line;
 *   - in .jsx / .tsx, JSX text: an element opened in expression position (`<p>`, `<>`) has its children's text
 *     skipped up to its closing tag, so an apostrophe or a bracket in prose counts for nothing. `{ … }` containers
 *     inside an element are code and are counted; `<T,>` and `<T extends …>` stay type parameters.
 *
 * The TypeScript scanner is not used: agent-tools carries TypeScript 7 (the native compiler) only as a dev
 * dependency, and it has no JS scanner API. Pure.
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

/** The extensions whose expressions may hold JSX. */
const JSX_EXTENSIONS: ReadonlySet<string> = new Set(['jsx', 'tsx']);

/** Keywords after which a `/` starts a regex and a `<` may start a JSX element. */
const EXPRESSION_KEYWORDS: ReadonlySet<string> = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);

const ZERO: BracketDelta = Object.freeze({ curly: 0, paren: 0, square: 0 });

const WORD_START = /[A-Za-z_$]/;
const WORD_CHAR = /[\w$]/;
const JSX_NAME = /^[A-Za-z_$][\w$.:-]*/;

/** `'.ts'`, `'ts'` and `'src/labels.ts'` all name the TypeScript lexer. */
function extensionOf(ext: string): string {
  const dot = ext.lastIndexOf('.');
  return (dot >= 0 ? ext.slice(dot + 1) : ext).toLowerCase();
}

export interface BracketBalanceOptions {
  /** Lex JSX elements (a .jsx / .tsx file). */
  jsx?: boolean;
}

/** Opens minus closes of each bracket kind in `text`, code only. */
export function bracketBalance(text: string, options: BracketBalanceOptions = {}): BracketDelta {
  const jsx = options.jsx === true;
  const out = { curly: 0, paren: 0, square: 0 };
  const n = text.length;
  let i = 0;
  /** The next `/` starts a regex and the next `<` may start a JSX element. */
  let expr = true;

  const skipQuoted = (quote: string, multiline: boolean): void => {
    i += 1;
    while (i < n && text[i] !== quote && (multiline || text[i] !== '\n')) i += !multiline && text[i] === '\\' ? 2 : 1;
    i += 1;
  };

  /** A regex literal from `i` (a `/`) to its closing `/` and flags on the same line; false when it does not close. */
  const tryRegex = (): boolean => {
    let j = i + 1;
    let inClass = false;
    while (j < n) {
      const c = text[j]!;
      if (c === '\n') return false;
      if (c === '\\') { j += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        j += 1;
        while (j < n && /[a-z]/i.test(text[j]!)) j += 1;
        i = j;
        return true;
      }
      j += 1;
    }
    return false;
  };

  /** A `{ … }` container: the braces count, the code between them is lexed. */
  const container = (): void => {
    out.curly += 1;
    i += 1;
    code(true);
    if (text[i] === '}') { out.curly -= 1; i += 1; }
  };

  const skipSpace = (): void => {
    while (i < n && /\s/.test(text[i]!)) i += 1;
  };

  /** The children of an element whose opening tag just ended, through its closing tag. */
  const jsxChildren = (): void => {
    while (i < n) {
      const c = text[i]!;
      if (c === '{') { container(); continue; }
      if (c === '<') {
        if (text[i + 1] === '/') {
          const end = text.indexOf('>', i);
          i = end < 0 ? n : end + 1;
          return;
        }
        if (tryJsxElement()) continue;
      }
      i += 1;
    }
  };

  /** A JSX element from `i` (a `<` in expression position); false (and `i` unmoved) when it is not one. */
  const tryJsxElement = (): boolean => {
    const start = i;
    i += 1;
    if (text[i] === '>') { i += 1; jsxChildren(); return true; }
    const name = JSX_NAME.exec(text.slice(i, i + 200));
    if (!name) { i = start; return false; }
    i += name[0].length;
    let first = true;
    while (i < n) {
      skipSpace();
      if (i >= n) return true;
      const c = text[i]!;
      if (c === '/' && text[i + 1] === '>') { i += 2; return true; }
      if (c === '>') { i += 1; jsxChildren(); return true; }
      if (c === '{') { container(); first = false; continue; }
      const attr = JSX_NAME.exec(text.slice(i, i + 200));
      // `<T,>` / `<T extends U>`: a type parameter list, not an element.
      if (!attr || (first && attr[0] === 'extends')) { i = start; return false; }
      first = false;
      i += attr[0].length;
      skipSpace();
      if (text[i] !== '=') continue;
      i += 1;
      skipSpace();
      if (text[i] === '"' || text[i] === "'") skipQuoted(text[i]!, true);
      else if (text[i] === '{') container();
    }
    return true;
  };

  /** Code from `i`; with `nested`, stops (unconsumed) at the `}` that closes the enclosing container. */
  function code(nested: boolean): void {
    let depth = 0;
    while (i < n) {
      const ch = text[i]!;
      const next = text[i + 1];
      if (ch === '\n') { expr = true; i += 1; continue; }
      if (/\s/.test(ch)) { i += 1; continue; }
      if (ch === '/' && next === '/') {
        const end = text.indexOf('\n', i);
        i = end < 0 ? n : end;
        continue;
      }
      if (ch === '/' && next === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end < 0 ? n : end + 2;
        continue;
      }
      if (ch === '/' && expr && tryRegex()) { expr = false; continue; }
      if (ch === '"' || ch === "'") { skipQuoted(ch, false); expr = false; continue; }
      if (ch === '`') { i += 1; template(); expr = false; continue; }
      if (ch === '<' && jsx && expr && tryJsxElement()) { expr = false; continue; }
      if (WORD_START.test(ch) || /\d/.test(ch)) {
        const start = i;
        while (i < n && WORD_CHAR.test(text[i]!)) i += 1;
        expr = EXPRESSION_KEYWORDS.has(text.slice(start, i));
        continue;
      }
      if (ch === '{') { out.curly += 1; depth += 1; expr = true; }
      else if (ch === '}') {
        if (nested && depth === 0) return;
        out.curly -= 1;
        if (depth > 0) depth -= 1;
        expr = true;
      }
      else if (ch === '(' || ch === '[') { out[ch === '(' ? 'paren' : 'square'] += 1; expr = true; }
      else if (ch === ')' || ch === ']') { out[ch === ')' ? 'paren' : 'square'] -= 1; expr = false; }
      else expr = ch !== '.';
      i += 1;
    }
  }

  /** Template text from `i` (just past a backtick) through its closing backtick; interpolations are code. */
  function template(): void {
    while (i < n) {
      const ch = text[i]!;
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { i += 1; return; }
      if (ch === '$' && text[i + 1] === '{') {
        i += 2;
        expr = true;
        code(true);
        if (text[i] === '}') i += 1;
        continue;
      }
      i += 1;
    }
  }

  code(false);
  return out;
}

/**
 * How replacing `before` with `after` changes bracket balance — `after` minus `before`, per kind.
 * Zeros for an extension this lexer does not know (`ext` may be `'ts'`, `'.ts'` or a path).
 */
export function bracketDelta(before: string, after: string, ext: string): BracketDelta {
  const e = extensionOf(ext);
  if (!LEXED_EXTENSIONS.has(e)) return { ...ZERO };
  const options = { jsx: JSX_EXTENSIONS.has(e) };
  const b = bracketBalance(before, options);
  const a = bracketBalance(after, options);
  return { curly: a.curly - b.curly, paren: a.paren - b.paren, square: a.square - b.square };
}

/** True when any kind's balance moved. */
export function changesBalance(delta: BracketDelta): boolean {
  return delta.curly !== 0 || delta.paren !== 0 || delta.square !== 0;
}

/**
 * The kinds whose balance moved, signed — the one rendering of a delta.
 * `'name'`: `curly -1 · paren +1` (a finding's language-neutral param).
 * `'glyph'`: "`{}` -1, `()` +1" (the post-edit note the model reads).
 */
export function describeBracketDelta(d: BracketDelta, style: 'name' | 'glyph' = 'name'): string {
  const glyph = { curly: '`{}`', paren: '`()`', square: '`[]`' } as const;
  return (['curly', 'paren', 'square'] as const)
    .filter((k) => d[k] !== 0)
    .map((k) => `${style === 'glyph' ? glyph[k] : k} ${d[k] > 0 ? '+' : ''}${d[k]}`)
    .join(style === 'glyph' ? ', ' : ' · ');
}
