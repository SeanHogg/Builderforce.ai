/**
 * The tree-sitter symbol extractor — real parse trees (web-tree-sitter, WASM) for the
 * languages whose grammars load: TS/TSX/JS, Python, PHP, C#, Go, Rust, Java. Everything
 * else, and any language whose runtime, grammar or query fails to load, is read by the
 * line-regex extractor (`symbols.ts`) — so the index never loses a file to a missing wasm.
 *
 * Why: the regex extractor is line-anchored by design (it must run in the Worker with no
 * dependencies), so a method whose parameter list wraps, a decorated class, or an export
 * spread over lines is invisible to it. A parse tree has none of those blind spots.
 *
 * Node-only (it loads wasm from disk), so it rides the `./node-symbols` export condition.
 * The wasm files are found in `wasmDir` (the VS Code bundle copies them to `out/tree-sitter`)
 * or, without one, resolved from this package's `web-tree-sitter` / `tree-sitter-wasms`.
 */

import { createRequire } from "node:module";
import * as path from "node:path";
import { extractSymbols, MAX_SYMBOLS_PER_FILE, type CodeSymbol, type SymbolKind } from "./symbols.js";

export interface TreeSitterExtractorOptions {
  /** Directory holding `tree-sitter.wasm` and the `tree-sitter-<lang>.wasm` grammars. */
  wasmDir?: string;
  /** Larger files are read by the regex extractor — a parse is not worth a generated bundle. */
  maxParseBytes?: number;
}

/** The structural slice of web-tree-sitter this module uses (0.22 API). */
interface TsNode { startPosition: { row: number }; text: string }
interface TsQuery { captures(node: TsNode): Array<{ name: string; node: TsNode }> }
interface TsLanguage { query(source: string): TsQuery }
interface TsTree { rootNode: TsNode; delete(): void }
interface TsParser { setLanguage(lang: TsLanguage): void; parse(source: string): TsTree }
interface TsParserCtor {
  new (): TsParser;
  init(opts?: { locateFile?: (name: string, dir: string) => string }): Promise<void>;
  Language: { load(input: string): Promise<TsLanguage> };
}

type Family = "js" | "python" | "go" | "rust" | "oo";

interface Grammar { wasm: string; family: Family; query: string }

const JS_COMMON = `
(program (function_declaration name: (identifier) @function))
(program (export_statement (function_declaration name: (identifier) @function)))
(program (generator_function_declaration name: (identifier) @function))
(program (export_statement (generator_function_declaration name: (identifier) @function)))
(program (class_declaration name: (_) @class))
(program (export_statement (class_declaration name: (_) @class)))
(program (lexical_declaration (variable_declarator name: (identifier) @const)))
(program (export_statement (lexical_declaration (variable_declarator name: (identifier) @const))))
(program (variable_declaration (variable_declarator name: (identifier) @const)))
(class_body (method_definition name: (_) @method))
`;
const TS_EXTRA = `
(program (abstract_class_declaration name: (_) @class))
(program (export_statement (abstract_class_declaration name: (_) @class)))
(program (interface_declaration name: (_) @interface))
(program (export_statement (interface_declaration name: (_) @interface)))
(program (type_alias_declaration name: (_) @type))
(program (export_statement (type_alias_declaration name: (_) @type)))
(program (enum_declaration name: (_) @enum))
(program (export_statement (enum_declaration name: (_) @enum)))
`;
const PYTHON = `
(module (function_definition name: (identifier) @function))
(module (decorated_definition definition: (function_definition name: (identifier) @function)))
(module (class_definition name: (identifier) @class))
(module (decorated_definition definition: (class_definition name: (identifier) @class)))
(class_definition body: (block (function_definition name: (identifier) @method)))
(class_definition body: (block (decorated_definition definition: (function_definition name: (identifier) @method))))
`;
const GO = `
(function_declaration name: (identifier) @function)
(method_declaration name: (field_identifier) @method)
(type_spec name: (type_identifier) @struct type: (struct_type))
(type_spec name: (type_identifier) @interface type: (interface_type))
(type_spec name: (type_identifier) @type)
`;
const RUST = `
(function_item name: (identifier) @function)
(impl_item body: (declaration_list (function_item name: (identifier) @method)))
(trait_item body: (declaration_list (function_item name: (identifier) @method)))
(struct_item name: (type_identifier) @struct)
(enum_item name: (type_identifier) @enum)
(trait_item name: (type_identifier) @trait)
(mod_item name: (identifier) @module)
(type_item name: (type_identifier) @type)
`;
const JAVA = `
(class_declaration name: (identifier) @class)
(interface_declaration name: (identifier) @interface)
(enum_declaration name: (identifier) @enum)
(method_declaration name: (identifier) @method)
`;
const CSHARP = `
(class_declaration name: (identifier) @class)
(interface_declaration name: (identifier) @interface)
(enum_declaration name: (identifier) @enum)
(struct_declaration name: (identifier) @struct)
(method_declaration name: (identifier) @method)
`;
const PHP = `
(function_definition name: (name) @function)
(class_declaration name: (name) @class)
(interface_declaration name: (name) @interface)
(trait_declaration name: (name) @trait)
(method_declaration name: (name) @method)
`;

const TYPESCRIPT: Grammar = { wasm: "tree-sitter-typescript.wasm", family: "js", query: JS_COMMON + TS_EXTRA };
const GRAMMAR_BY_EXT: Record<string, Grammar> = {
  ts: TYPESCRIPT, mts: TYPESCRIPT, cts: TYPESCRIPT,
  tsx: { wasm: "tree-sitter-tsx.wasm", family: "js", query: JS_COMMON + TS_EXTRA },
  js: { wasm: "tree-sitter-javascript.wasm", family: "js", query: JS_COMMON },
  jsx: { wasm: "tree-sitter-javascript.wasm", family: "js", query: JS_COMMON },
  mjs: { wasm: "tree-sitter-javascript.wasm", family: "js", query: JS_COMMON },
  cjs: { wasm: "tree-sitter-javascript.wasm", family: "js", query: JS_COMMON },
  py: { wasm: "tree-sitter-python.wasm", family: "python", query: PYTHON },
  go: { wasm: "tree-sitter-go.wasm", family: "go", query: GO },
  rs: { wasm: "tree-sitter-rust.wasm", family: "rust", query: RUST },
  java: { wasm: "tree-sitter-java.wasm", family: "oo", query: JAVA },
  cs: { wasm: "tree-sitter-c_sharp.wasm", family: "oo", query: CSHARP },
  php: { wasm: "tree-sitter-php.wasm", family: "oo", query: PHP },
};

/** Every grammar wasm this extractor can use — the list a bundler copies. */
export const TREE_SITTER_GRAMMAR_WASMS: readonly string[] = [...new Set(Object.values(GRAMMAR_BY_EXT).map((g) => g.wasm))];
/** The web-tree-sitter runtime's own wasm. */
export const TREE_SITTER_RUNTIME_WASM = "tree-sitter.wasm";

const KINDS = new Set<SymbolKind>(["function", "method", "class", "interface", "type", "enum", "const", "struct", "trait", "module"]);
/** When one node is captured by two patterns, the more specific kind wins. */
const KIND_PRIORITY: Partial<Record<SymbolKind, number>> = { type: 0, function: 1 };

function extOf(rel: string): string {
  const base = rel.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Visibility from the definition's own line, by the family's convention. */
function isExported(family: Family, name: string, line: string): boolean {
  switch (family) {
    case "js": return /^\s*export\b/.test(line);
    case "python": return !name.startsWith("_");
    case "go": return /^[A-Z]/.test(name);
    case "rust": return /\bpub\b/.test(line);
    case "oo": return !/\bprivate\b/.test(line);
  }
}

/** The wasm locations: an explicit directory, else this package's installed deps. */
function wasmLocator(wasmDir?: string): { runtime: string; grammar: (file: string) => string } | null {
  if (wasmDir) return { runtime: path.join(wasmDir, TREE_SITTER_RUNTIME_WASM), grammar: (f) => path.join(wasmDir, f) };
  try {
    const req = createRequire(import.meta.url);
    const runtimeDir = path.dirname(req.resolve("web-tree-sitter"));
    const grammarsDir = path.join(path.dirname(req.resolve("tree-sitter-wasms/package.json")), "out");
    return { runtime: path.join(runtimeDir, TREE_SITTER_RUNTIME_WASM), grammar: (f) => path.join(grammarsDir, f) };
  } catch {
    return null;
  }
}

/**
 * A {@link SymbolExtractor}-shaped tree-sitter extractor. Lazy: nothing loads until the
 * first file of a supported language; each grammar loads once and a failure is
 * remembered, so a missing wasm costs one attempt, then the regex extractor.
 */
export function treeSitterSymbolExtractor(opts: TreeSitterExtractorOptions = {}): {
  readonly id: string;
  extract(relPath: string, content: string): Promise<CodeSymbol[]>;
} {
  const maxParseBytes = opts.maxParseBytes ?? 400_000;
  let parserCtor: Promise<TsParserCtor | null> | null = null;
  // One parser per grammar, reused: parsing is synchronous, so concurrent extracts never
  // share it mid-parse, and a parser per file would leak wasm memory.
  const languages = new Map<string, Promise<{ parser: TsParser; query: TsQuery } | null>>();
  const locator = wasmLocator(opts.wasmDir);

  const runtime = (): Promise<TsParserCtor | null> => {
    parserCtor ??= (async () => {
      if (!locator) return null;
      try {
        const mod = (await import("web-tree-sitter")) as unknown as { default?: TsParserCtor } & TsParserCtor;
        const Parser = (mod.default ?? mod) as TsParserCtor;
        await Parser.init({ locateFile: () => locator.runtime });
        return Parser;
      } catch {
        return null;
      }
    })();
    return parserCtor;
  };

  const language = (g: Grammar): Promise<{ parser: TsParser; query: TsQuery } | null> => {
    const key = `${g.wasm}\n${g.query}`;
    let loaded = languages.get(key);
    if (!loaded) {
      loaded = (async () => {
        const Parser = await runtime();
        if (!Parser || !locator) return null;
        try {
          const lang = await Parser.Language.load(locator.grammar(g.wasm));
          const parser = new Parser();
          parser.setLanguage(lang);
          return { parser, query: lang.query(g.query) };
        } catch {
          return null;
        }
      })();
      languages.set(key, loaded);
    }
    return loaded;
  };

  return {
    id: "tree-sitter-1",
    async extract(relPath: string, content: string): Promise<CodeSymbol[]> {
      const grammar = GRAMMAR_BY_EXT[extOf(relPath)];
      if (!grammar || content.length > maxParseBytes) return extractSymbols(relPath, content);
      const loaded = await language(grammar);
      if (!loaded) return extractSymbols(relPath, content);
      let tree: TsTree | null = null;
      try {
        tree = loaded.parser.parse(content);
        const lines = content.split(/\r?\n/);
        const byNode = new Map<string, CodeSymbol>();
        for (const { name: kind, node } of loaded.query.captures(tree.rootNode)) {
          if (!KINDS.has(kind as SymbolKind)) continue;
          const line = node.startPosition.row + 1;
          const name = node.text;
          const key = `${line}:${name}`;
          const prior = byNode.get(key);
          if (prior && (KIND_PRIORITY[kind as SymbolKind] ?? 2) <= (KIND_PRIORITY[prior.kind] ?? 2)) continue;
          const lineText = lines[line - 1] ?? "";
          byNode.set(key, { name, kind: kind as SymbolKind, line, exported: isExported(grammar.family, name, lineText) });
        }
        return [...byNode.values()].sort((a, b) => a.line - b.line).slice(0, MAX_SYMBOLS_PER_FILE);
      } catch {
        return extractSymbols(relPath, content);
      } finally {
        tree?.delete();
      }
    },
  };
}
