/**
 * What one source file contributes to the graph: the symbols it DEFINES (from the one
 * shared extractor, `@builderforce/agent-tools/symbols`), the identifiers it USES (a
 * light tokenizer over the code with comments and string literals blanked) and the
 * terms of its IMPORT statements (per-language patterns).
 *
 * bf-index reads the same three facts off a tree-sitter parse; here they come from
 * regexes because this runs in a Worker with no parser. A missed or spurious fact
 * shifts a rank a little, never a wrong edit — the same trade the symbol index made.
 */

import { extractSymbols, symbolLanguageOf, type SymbolLanguage } from '@builderforce/agent-tools/symbols';
import { identifiers } from './terms.js';

/** One definition as the map renders it. `nested` = a member (indented under its type). */
export interface SymbolRow {
  name: string;
  line: number;
  signature: string;
  nested: boolean;
}

export interface FileFacts {
  symbols: SymbolRow[];
  /** Identifiers (≥ 3 chars) the file's code mentions — bf-index's `file_idents`. */
  identifiers: Set<string>;
  /** Lowercased identifier terms of the file's import statements — `file_imports`. */
  imports: Set<string>;
}

/** Language families whose definitions belong on a code map (prose and DDL do not). */
type CodeLanguage = Exclude<SymbolLanguage, 'markdown' | 'sql'>;

interface LanguageSyntax {
  lineComments: readonly string[];
  blockComments: ReadonlyArray<readonly [open: string, close: string]>;
  quotes: readonly string[];
  imports: readonly RegExp[];
}

const C_LIKE = { lineComments: ['//'], blockComments: [['/*', '*/']] as const, quotes: ['"', "'"] };

/** Per-family syntax — data, one row per family the shared extractor knows. */
const SYNTAX: Readonly<Record<CodeLanguage, LanguageSyntax>> = {
  js: {
    ...C_LIKE,
    quotes: ['"', "'", '`'],
    imports: [
      /^\s*import\s[^;]*?['"][^'"\n]+['"]/gm,
      /^\s*export\s[^;]*?\sfrom\s*['"][^'"\n]+['"]/gm,
      /\b(?:require|import)\(\s*['"][^'"\n]+['"]\s*\)/g,
    ],
  },
  python: {
    lineComments: ['#'],
    blockComments: [],
    quotes: ['"""', "'''", '"', "'"],
    imports: [/^\s*(?:from\s+[\w.]+\s+)?import\s+[^\n]+/gm],
  },
  go: { ...C_LIKE, quotes: ['"', '`'], imports: [/^\s*import\s*\([^)]*\)/gm, /^\s*import\s+[^\n(]+/gm] },
  rust: { ...C_LIKE, quotes: ['"'], imports: [/^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+[^;]+;/gm] },
  oo: {
    lineComments: ['//', '#'],
    blockComments: [['/*', '*/']],
    quotes: ['"', "'"],
    imports: [/^\s*(?:import|using|use)\s+[^\n;]+/gm, /^\s*(?:require|include)(?:_once)?\s*\(?\s*['"][^'"\n]+['"]/gm],
  },
  ruby: {
    lineComments: ['#'],
    blockComments: [['=begin', '=end']],
    quotes: ['"', "'"],
    imports: [/^\s*(?:require|require_relative|load)\s*\(?\s*['"][^'"\n]+['"]/gm],
  },
};

/** Longest import statement read for terms; anything longer is a generated blob (bf-index). */
const MAX_IMPORT_CHARS = 400;
/** Signature lines longer than this are cut — a map line, not the declaration. */
const MAX_SIGNATURE_CHARS = 160;

function codeLanguageOf(path: string): CodeLanguage | undefined {
  const lang = symbolLanguageOf(path);
  return lang && lang in SYNTAX ? (lang as CodeLanguage) : undefined;
}

/** True when the repo map reads this file (a code language the extractor understands). */
export function isMapSource(path: string): boolean {
  return codeLanguageOf(path) !== undefined;
}

/** The code with comments and string literals replaced by spaces (newlines kept). */
function blankCommentsAndStrings(text: string, syntax: LanguageSyntax): string {
  const parts: string[] = [];
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ');
  /** End (exclusive) of the comment or literal opening at `i`, or -1 when none does. */
  const spanEnd = (i: number): number => {
    for (const lc of syntax.lineComments) {
      if (text.startsWith(lc, i)) {
        const end = text.indexOf('\n', i);
        return end < 0 ? text.length : end;
      }
    }
    for (const [open, close] of syntax.blockComments) {
      if (text.startsWith(open, i)) {
        const end = text.indexOf(close, i + open.length);
        return end < 0 ? text.length : end + close.length;
      }
    }
    for (const q of syntax.quotes) {
      if (!text.startsWith(q, i)) continue;
      let j = i + q.length;
      while (j < text.length && !text.startsWith(q, j)) {
        if (text[j] === '\\') j += 1;
        // A one-character quote never spans a line (except a JS template literal).
        else if (q.length === 1 && q !== '`' && text[j] === '\n') return j;
        j += 1;
      }
      return Math.min(text.length, j + q.length);
    }
    return -1;
  };
  let plainStart = 0;
  let i = 0;
  while (i < text.length) {
    const end = spanEnd(i);
    if (end < 0) {
      i += 1;
      continue;
    }
    parts.push(text.slice(plainStart, i), blank(text.slice(i, end)));
    i = Math.max(end, i + 1);
    plainStart = i;
  }
  parts.push(text.slice(plainStart));
  return parts.join('');
}

function importTerms(text: string, syntax: LanguageSyntax): Set<string> {
  const terms = new Set<string>();
  for (const re of syntax.imports) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      for (const w of identifiers(m[0].slice(0, MAX_IMPORT_CHARS), 2)) terms.add(w.toLowerCase());
    }
  }
  return terms;
}

/** The three facts of one file; `null` when the map does not read its language. */
export function extractFileFacts(path: string, content: string): FileFacts | null {
  const lang = codeLanguageOf(path);
  if (!lang) return null;
  const syntax = SYNTAX[lang];
  const lines = content.split(/\r?\n/);
  const symbols = extractSymbols(path, content).map((s) => ({
    name: s.name,
    line: s.line,
    signature: (lines[s.line - 1] ?? s.name).trim().slice(0, MAX_SIGNATURE_CHARS),
    nested: s.kind === 'method',
  }));
  return {
    symbols,
    identifiers: new Set(identifiers(blankCommentsAndStrings(content, syntax), 3)),
    imports: importTerms(content, syntax),
  };
}
