/**
 * Derive a `{ language: bytes }` weighting from a file tree by mapping each
 * file's extension to a language and summing its size — a proxy for providers
 * that expose no languages API (Bitbucket; see [1553]). Pure + unit-tested.
 *
 * Files with no size contribute 1 (a presence weight) so an extension still
 * registers; unknown extensions are ignored (they'd otherwise dominate as
 * "Other" noise). The shape matches GitHub's `/languages` response so the
 * evidence bundle treats all providers uniformly.
 */

/** Extension (lower-case, no dot) → language name. Bounded, common set. */
const LANGUAGE_BY_EXT: Readonly<Record<string, string>> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin',
  swift: 'Swift', c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++',
  cs: 'C#', php: 'PHP', scala: 'Scala', clj: 'Clojure', ex: 'Elixir', exs: 'Elixir',
  erl: 'Erlang', hs: 'Haskell', dart: 'Dart', lua: 'Lua', r: 'R', m: 'Objective-C',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell',
  html: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less',
  vue: 'Vue', svelte: 'Svelte', sql: 'SQL', json: 'JSON', yaml: 'YAML', yml: 'YAML',
  md: 'Markdown', toml: 'TOML', xml: 'XML', proto: 'Protocol Buffers',
};

/** Lower-case extension (without the dot) of a path, or '' if none. */
export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function deriveLanguagesFromTree(
  entries: ReadonlyArray<{ path: string; bytes?: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    const lang = LANGUAGE_BY_EXT[extensionOf(e.path)];
    if (!lang) continue;
    out[lang] = (out[lang] ?? 0) + (typeof e.bytes === 'number' && e.bytes > 0 ? e.bytes : 1);
  }
  return out;
}
