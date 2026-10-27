/**
 * Deterministic pre-search — what the symbol index and a text search already know about
 * the identifiers a request names, gathered with NO model call.
 *
 * A coding run's first turns are usually spent orienting: "where is `resolveMembership`?"
 * costs a `find_symbol`, a `search_code` and a read before any work starts — paid turns
 * that only fetch facts a local index answers in milliseconds. So before turn 1 the host
 * runs this over the request and hands the run a bounded hits block; `local_research`
 * runs the same thing to choose which files its local model reads.
 *
 * Pure: the index and the searcher are injected ports, so every surface with a symbol
 * index (the editor, on-prem) shares the rule, and a test pins both.
 */

import type { RepoSearchResult, SymbolFindResult } from "./capabilities.js";

export interface PreSearchPorts {
  /** The definition index (`repo.symbols`). */
  findSymbol?: (name: string) => Promise<SymbolFindResult>;
  /** A text search over the tree (ripgrep on the editor). `query` is a REGEX with the
   *  identifier's metacharacters escaped (`\$scope`). `signal` is the pre-search's own
   *  stop (its caller's deadline or Stop): a searcher that spawns a process kills it. */
  searchText?: (query: string, signal?: AbortSignal) => Promise<RepoSearchResult>;
}

export interface PreSearchDefinition {
  identifier: string;
  path: string;
  line: number;
  kind: string;
  exported: boolean;
}

export interface PreSearchReference {
  identifier: string;
  path: string;
  line: number;
  text: string;
}

export interface PreSearchResult {
  identifiers: string[];
  definitions: PreSearchDefinition[];
  references: PreSearchReference[];
  /** The rendered hits block, '' when nothing was found. */
  block: string;
}

export interface PreSearchOptions {
  maxIdentifiers?: number;
  definitionsPerIdentifier?: number;
  referencesPerIdentifier?: number;
  /** Hard cap on the rendered block. */
  maxChars?: number;
  /** Stops the pre-search: handed to every text search, and an aborted pre-search
   *  starts no further look-ups. */
  signal?: AbortSignal;
}

const DEFAULTS: Required<Omit<PreSearchOptions, "signal">> = {
  maxIdentifiers: 6,
  definitionsPerIdentifier: 3,
  referencesPerIdentifier: 4,
  maxChars: 3000,
};

const TOKEN = /[A-Za-z_$][\w$]*/g;
const REFERENCE_TEXT_MAX = 140;

/** True when a bare word reads as code rather than English. */
function looksLikeIdentifier(word: string): boolean {
  if (word.length < 3) return false;
  if (/^_+$/.test(word)) return false;
  if (word.includes("_") || word.includes("$")) return true;
  if (/[a-z][A-Z]/.test(word)) return true; // camelCase / PascalCase with two humps
  if (/[0-9][A-Z]/.test(word) && /[a-z]/.test(word)) return true; // base64Encode, Win32Api — not B2B
  if (/^[A-Z][A-Z0-9]*\d$/.test(word)) return true; // SHA256, MD5, ES2015 — not B2B (a trailing digit, not a sandwiched one)
  return false;
}

/**
 * The identifiers a request names, in order of first mention: anything in backticks,
 * anything called (`foo(`), and words shaped like code (camelCase, snake_case,
 * `$scope`). Plain English — including a lone capitalised word — is not an identifier.
 */
export function extractIdentifiers(request: string, max = DEFAULTS.maxIdentifiers): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (word: string) => {
    if (!word || seen.has(word) || out.length >= max) return;
    seen.add(word);
    out.push(word);
  };
  const text = request ?? "";
  // Backticked spans first: the request's author marked them as code.
  for (const span of text.matchAll(/`([^`\n]{1,120})`/g)) {
    const words = span[1]!.match(TOKEN) ?? [];
    // `a.b.c` names c — the last segment is the definition the index holds.
    const last = words[words.length - 1];
    if (last && last.length >= 2) add(last);
  }
  for (const m of text.matchAll(/([A-Za-z_$][\w$]*)(\s*\()?/g)) {
    const word = m[1]!;
    // A path or file name is the focus-file reader's job, not the index's.
    const after = text.charAt((m.index ?? 0) + word.length);
    if (after === "." && /[A-Za-z]/.test(text.charAt((m.index ?? 0) + word.length + 1)) && !looksLikeIdentifier(word)) continue;
    if (m[2] && word.length >= 3 && /[a-z]/.test(word)) add(word);
    else if (looksLikeIdentifier(word)) add(word);
  }
  return out;
}

/** `identifier` as a literal in a regex search — `$scope` must not read as end-of-line. */
export function escapeRegex(identifier: string): string {
  return identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Render the hits as the run's pre-search block, bounded by `maxChars`. */
export function renderPreSearchBlock(r: Omit<PreSearchResult, "block">, maxChars = DEFAULTS.maxChars): string {
  if (r.definitions.length === 0 && r.references.length === 0) return "";
  const lines: string[] = [
    "## Pre-search (symbol index + text search, gathered before this run with no model call)",
    `Identifiers in the request: ${r.identifiers.map((i) => `\`${i}\``).join(", ")}`,
  ];
  for (const id of r.identifiers) {
    for (const d of r.definitions.filter((x) => x.identifier === id)) {
      lines.push(`- \`${id}\` defined at ${d.path}:${d.line} (${d.kind}${d.exported ? ", exported" : ""})`);
    }
    for (const ref of r.references.filter((x) => x.identifier === id)) {
      lines.push(`- \`${id}\` at ${ref.path}:${ref.line} — ${clip(ref.text, REFERENCE_TEXT_MAX)}`);
    }
  }
  lines.push("Start from these locations (read_file with a line range) instead of searching for them again.");
  let out = lines.join("\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars).replace(/\n[^\n]*$/, "")}\n- …`;
  return out;
}

/**
 * Pre-search the request: identifiers → definition index (exact names first) → text
 * search for where they are used. Every port failure is a missing part, never a throw.
 */
export async function preSearch(request: string, ports: PreSearchPorts, options: PreSearchOptions = {}): Promise<PreSearchResult> {
  const o = { ...DEFAULTS, ...options };
  const { signal } = options;
  const identifiers = extractIdentifiers(request, o.maxIdentifiers);
  const empty: PreSearchResult = { identifiers, definitions: [], references: [], block: "" };
  if (identifiers.length === 0 || signal?.aborted) return empty;
  const perId = await Promise.all(identifiers.map(async (identifier) => {
    const [defs, refs] = await Promise.all([
      ports.findSymbol ? ports.findSymbol(identifier).catch((): SymbolFindResult => ({ ok: false })) : Promise.resolve<SymbolFindResult>({ ok: false }),
      ports.searchText
        ? ports.searchText(escapeRegex(identifier), signal).catch((): RepoSearchResult => ({ ok: false }))
        : Promise.resolve<RepoSearchResult>({ ok: false }),
    ]);
    const exact = (defs.ok ? defs.matches ?? [] : []).filter((m) => m.name === identifier && m.kind !== "heading");
    const definitions: PreSearchDefinition[] = exact.slice(0, o.definitionsPerIdentifier).map((m) => ({
      identifier, path: m.path, line: m.line, kind: m.kind, exported: m.exported,
    }));
    const defined = new Set(definitions.map((d) => `${d.path}:${d.line}`));
    const references: PreSearchReference[] = [];
    for (const m of refs.ok ? refs.matches ?? [] : []) {
      if (references.length >= o.referencesPerIdentifier) break;
      const line = typeof m.line === "number" ? m.line : Number(m.line);
      if (!Number.isFinite(line) || defined.has(`${m.path}:${line}`)) continue;
      references.push({ identifier, path: m.path, line, text: typeof m.text === "string" ? m.text : "" });
    }
    return { definitions, references };
  }));
  const definitions = perId.flatMap((p) => p.definitions);
  const references = perId.flatMap((p) => p.references);
  const result = { identifiers, definitions, references };
  return { ...result, block: renderPreSearchBlock(result, o.maxChars) };
}

/** The distinct files the hits point at, definitions first — what a reader should open. */
export function preSearchFiles(r: Pick<PreSearchResult, "definitions" | "references">, max = 6): string[] {
  const out: string[] = [];
  for (const p of [...r.definitions.map((d) => d.path), ...r.references.map((x) => x.path)]) {
    if (!out.includes(p)) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}
