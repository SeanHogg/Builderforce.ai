/**
 * One side's FileFacts for the run delta (PRD 41 §B3, `SideFacts.fileFacts`): every changed file with text on this side,
 * extracted through THE extraction pool (`extractFactsJob`, the side's TEXT — a before side is not on disk), then resolved
 * against THIS side's listing (the before listing for the before side) and the root's aliases, keyed by repo path.
 *
 * Extraction is RAW (specifiers) and resolution is per side, so the same bytes resolve to each side's files; a file whose
 * facts cannot be extracted is left out (the rules keep their text path), its error reported to `onError`.
 */

import { importResolver, isRouterFacts, NO_MODULE_ALIASES, resolveFileFacts, type ModuleAliases, type RouterFiles } from "@builderforce/agent-tools/knowledge";
import { hasFileFacts } from "@builderforce/agent-tools/node-file-facts";
import type { FileFacts } from "@seanhogg/builderforce-memory/knowledge";
import { extractFactsJob } from "../knowledge/review/extractPoolHost";
import { symbolGrammarOptions } from "../workspaceSymbols";

/** One changed file of a side, by repo path. */
export interface FactsSideFile { path: string; hash?: string; text?: string }

export interface SideFileFactsArgs {
  rootId: string;
  files: readonly FactsSideFile[];
  /** Every path that exists on this side (repo-relative): what imports resolve against. */
  listing: ReadonlySet<string>;
  aliases?: ModuleAliases;
  /**
   * Whether a file the side did NOT change is a router module (decides an Express `use` of it: mount or middleware). The
   * side's own changed files answer from their facts on this side; any other file from this (the host's fact index).
   */
  isRouterFile?: RouterFiles;
  onError?: (error: unknown) => void;
}

/** The side's resolved FileFacts of its changed files with text, by repo path. */
export async function sideFileFacts(args: SideFileFactsArgs): Promise<Map<string, FileFacts>> {
  const resolve = importResolver((p) => args.listing.has(p), args.aliases ?? NO_MODULE_ALIASES);
  const raw = new Map<string, FileFacts>();
  await Promise.all(args.files.map(async (f) => {
    if (f.hash === undefined || f.text === undefined || !hasFileFacts(f.path)) return;
    try {
      const facts = await extractFactsJob({ rootId: args.rootId, path: f.path, hash: f.hash, text: f.text, ...symbolGrammarOptions() });
      if (facts) raw.set(f.path, facts);
    } catch (error) {
      args.onError?.(error);
    }
  }));
  const isRouterFile: RouterFiles = (file) => {
    const side = raw.get(file);
    return side ? isRouterFacts(side) : args.isRouterFile?.(file) ?? false;
  };
  const out = [...raw].map(([path, facts]) => [path, resolveFileFacts(path, facts, resolve, isRouterFile)] as const);
  return new Map(out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}
