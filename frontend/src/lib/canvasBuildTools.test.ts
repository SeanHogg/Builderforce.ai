import { describe, expect, it } from 'vitest';
import {
  applySearchReplace,
  exportedSymbols,
  resolveCanvasBuild,
  searchFileLines,
  summarizeWorkspace,
  CANVAS_BUILD_TOOL_NAMES,
  type BoundCanvasBuild,
} from './canvasBuildTools';
import { ACCOUNT_REQUIRED_CANVAS_TOOLS } from '@builderforce/creation-canvas-contract';

const build = (objectId: string, title: string): BoundCanvasBuild => ({
  objectId,
  title,
  binding: { ideProjectId: 1, storageProjectId: 900, storageProjectPublicId: '900', modality: 'designer' },
});

describe('resolveCanvasBuild', () => {
  it('points at canvas_create_build when the board has none', () => {
    const result = resolveCanvasBuild([], undefined);
    expect('error' in result && result.error).toContain('canvas_create_build');
  });

  it('needs no objectId when the board has exactly one build', () => {
    const only = build('a', 'Recipe Box');
    expect(resolveCanvasBuild([only], undefined)).toEqual({ build: only });
  });

  it('refuses to guess between several, and names them', () => {
    const result = resolveCanvasBuild([build('a', 'One'), build('b', 'Two')], undefined);
    expect('error' in result && result.error).toContain('a (One)');
    expect('error' in result && result.error).toContain('b (Two)');
  });

  it('honours an explicit objectId, and reports an unknown one', () => {
    const builds = [build('a', 'One'), build('b', 'Two')];
    expect(resolveCanvasBuild(builds, 'b')).toEqual({ build: builds[1] });
    expect('error' in resolveCanvasBuild(builds, 'zzz')).toBe(true);
  });
});

describe('applySearchReplace', () => {
  it('replaces a single occurrence', () => {
    const result = applySearchReplace('const a = 1;\nconst b = 2;', 'const b = 2;', 'const b = 3;', false);
    expect(result).toEqual({ ok: true, next: 'const a = 1;\nconst b = 3;', replacements: 1 });
  });

  it('tells the model to re-read when the anchor is absent', () => {
    const result = applySearchReplace('hello', 'goodbye', 'x', false);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('canvas_read_build_file');
  });

  // The whole point of a surgical edit is that an ambiguous anchor must NOT
  // silently pick the first match — that is how an agent edits the wrong line.
  it('refuses an ambiguous anchor unless replaceAll is explicit', () => {
    const source = 'x = 1;\nx = 1;';
    const refused = applySearchReplace(source, 'x = 1;', 'x = 2;', false);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.reason).toContain('matched 2 times');

    const all = applySearchReplace(source, 'x = 1;', 'x = 2;', true);
    expect(all).toEqual({ ok: true, next: 'x = 2;\nx = 2;', replacements: 2 });
  });

  it('deletes when replace is empty, and rejects an empty anchor', () => {
    expect(applySearchReplace('keep\ndrop\n', 'drop\n', '', false)).toEqual({ ok: true, next: 'keep\n', replacements: 1 });
    const empty = applySearchReplace('anything', '', 'x', false);
    expect(!empty.ok && empty.reason).toContain('canvas_write_build_file');
  });

  // `String.replace` treats `$&`, `$1`, `$'` in the REPLACEMENT as references.
  // A model replacing a price string or a regex literal would otherwise get
  // silently mangled text back.
  it('treats a replacement containing $ patterns literally', () => {
    const result = applySearchReplace('const label = "PRICE";', 'PRICE', '$&$1 total', false);
    expect(result.ok && result.next).toBe('const label = "$&$1 total";');
  });
});

describe('searchFileLines', () => {
  it('returns 1-indexed line numbers and trims long lines', () => {
    const content = 'first\nconst Header = () => null;\nthird';
    expect(searchFileLines('src/App.jsx', content, 'Header', false)).toEqual([
      { path: 'src/App.jsx', line: 2, text: 'const Header = () => null;' },
    ]);
  });

  it('is case-insensitive by default and case-sensitive on request', () => {
    expect(searchFileLines('a.js', 'const Foo = 1;', 'foo', false)).toHaveLength(1);
    expect(searchFileLines('a.js', 'const Foo = 1;', 'foo', true)).toHaveLength(0);
  });
});

describe('exportedSymbols', () => {
  it('finds named and default exports in source files', () => {
    const source = 'export function Header() {}\nexport const NAV = [];\nexport default App;';
    expect(exportedSymbols('src/App.jsx', source).sort()).toEqual(['Header', 'NAV', 'default']);
  });

  it('ignores non-source files', () => {
    expect(exportedSymbols('package.json', '{"name":"x"}')).toEqual([]);
  });

  // A shared /g regex carries `lastIndex` between calls; a second file would
  // start matching from wherever the first one stopped.
  it('does not leak regex state between files', () => {
    const source = 'export const A = 1;';
    expect(exportedSymbols('a.ts', source)).toEqual(['A']);
    expect(exportedSymbols('b.ts', source)).toEqual(['A']);
  });
});

describe('summarizeWorkspace', () => {
  it('lists every path and annotates source files with their exports', () => {
    const map = summarizeWorkspace([
      { path: 'package.json', content: '{}' },
      { path: 'src/App.jsx', content: 'export default function App() {}' },
    ]);
    expect(map).toBe('package.json\nsrc/App.jsx — exports: App, default');
  });
});

describe('the guest boundary', () => {
  // The contract guard checks that every DECLARED tool is classified; this checks
  // the other half — that the module's own manifest agrees with the contract, so a
  // tool cannot be added here and quietly left out of the account-required set.
  it('classifies every build tool as account-required', () => {
    for (const name of CANVAS_BUILD_TOOL_NAMES) {
      expect(ACCOUNT_REQUIRED_CANVAS_TOOLS).toContain(name);
    }
  });
});
