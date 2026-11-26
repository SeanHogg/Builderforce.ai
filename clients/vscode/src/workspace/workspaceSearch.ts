/**
 * `search_code` for the editor surface — the searcher behind the local capability
 * provider's `repoRead.searchCode`.
 *
 * The searcher itself (ripgrep first, in-process walk as the fallback, smart case, the
 * 100-match cap, POSIX repo-relative paths) is host-neutral and lives in
 * `@builderforce/agent-tools/node-text-search`, shared with the on-prem agent runtime so
 * the exact/regex contract has ONE implementation. This module is the editor's seam to
 * it: the editor-side imports (`SKIP_DIRS`, `searchWorkspace`, …) keep their path, and
 * the ripgrep binary VS Code ships is located by `../tools/ripgrep.ts`.
 */

export {
  SKIP_DIRS,
  SEARCH_MAX_MATCHES,
  RG_MAX_CONCURRENT,
  RgSemaphore,
  rgGateFor,
  isValidRegex,
  compileSearchPattern,
  smartCaseSensitive,
  parseRipgrepLine,
  parseRipgrepJsonLine,
  ripgrepSearch,
  walkSearch,
  searchWorkspace,
} from "@builderforce/agent-tools/node-text-search";
export type { SearchMatch, SearchRunOptions, WorkspaceSearchOptions } from "@builderforce/agent-tools/node-text-search";
