import { describe, expect, it } from 'vitest';
import {
  appModalityFor,
  applySearchReplace,
  hasCodeWorkspace,
  resolveCanvasBuild,
  searchFileLines,
  summarizeWorkspace,
  workspacePathArg,
  CANVAS_BUILD_TOOL_NAMES,
  CANVAS_BUILD_WORKSPACE_WRITE_TOOLS,
  canvasBuildActions,
  type BoundCanvasBuild,
} from './canvasBuildTools';
import { ACCOUNT_REQUIRED_CANVAS_TOOLS, GUEST_SAFE_CANVAS_TOOLS } from '@builderforce/creation-canvas-contract';
import { localFileStore, seedLocalWorkspace } from './workspace/localFileStore';
import { serverFileStore } from './workspace/workspaceFileStore';

const build = (objectId: string, title: string): BoundCanvasBuild => ({
  objectId,
  title,
  modality: 'designer',
  store: serverFileStore(900),
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

// `exportedSymbols` itself is the shared extractor's (packages/agent-tools symbols.test.ts);
// this only checks that the canvas map is built from it.
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
  // tool cannot be added here and quietly left out of either set.
  const HISTORY = ['canvas_list_build_file_history', 'canvas_restore_build_file'];

  it('gives a guest every build tool except file history', () => {
    for (const name of CANVAS_BUILD_TOOL_NAMES) {
      if (HISTORY.includes(name)) expect(ACCOUNT_REQUIRED_CANVAS_TOOLS).toContain(name);
      else expect(GUEST_SAFE_CANVAS_TOOLS).toContain(name);
    }
  });
});

describe('a workspace held in this browser', () => {
  const run = async (actions: ReturnType<typeof canvasBuildActions>, name: string, args: unknown) => {
    const action = actions.find((candidate) => candidate.name === name);
    if (!action) throw new Error(`missing ${name}`);
    return action.run(args as never) as Promise<Record<string, unknown>>;
  };

  it('writes, reads, edits and searches through the local store', async () => {
    await seedLocalWorkspace('tools-local', { 'index.html': '<h1>Hi</h1>' });
    const store = localFileStore('tools-local');
    const changed: Array<[unknown, string[]]> = [];
    const written: string[] = [];
    const actions = canvasBuildActions({
      builds: () => [{ objectId: 'b1', title: 'Local', modality: 'designer', store }],
      createBuild: async () => { throw new Error('unused'); },
      onFilesChanged: (id, paths) => changed.push([id, paths]),
      onBuildWritten: (objectId) => written.push(objectId),
    });

    expect(await run(actions, 'canvas_write_build_file', { path: '/src/App.jsx', content: 'export const a = 1;' })).toMatchObject({ ok: true, path: 'src/App.jsx' });
    expect(await run(actions, 'canvas_read_build_file', { path: 'src/App.jsx' })).toMatchObject({ content: 'export const a = 1;' });
    expect(await run(actions, 'canvas_edit_build_file', { path: 'src/App.jsx', find: '1', replace: '2' })).toMatchObject({ ok: true });
    expect(await store.read('src/App.jsx')).toBe('export const a = 2;');
    expect(await run(actions, 'canvas_search_build_files', { query: 'const a' })).toMatchObject({ matchCount: 1 });
    expect(changed).toEqual([['local:tools-local', ['src/App.jsx']], ['local:tools-local', ['src/App.jsx']]]);
    // Each committed change names the build it went into, so the surface can show it.
    expect(written).toEqual(['b1', 'b1']);
  });

  it('tells the model when a write imports a package package.json does not declare', async () => {
    await seedLocalWorkspace('tools-deps', { 'package.json': JSON.stringify({ dependencies: { react: '^18.2.0' } }) });
    const actions = canvasBuildActions({
      builds: () => [{ objectId: 'b1', title: 'Local', modality: 'designer', store: localFileStore('tools-deps') }],
      createBuild: async () => { throw new Error('unused'); },
    });
    const result = await run(actions, 'canvas_write_build_file', { path: 'src/App.jsx', content: "import React from 'react';\nimport { BrowserRouter } from 'react-router-dom';" });
    expect(result).toMatchObject({ ok: true, undeclaredDependencies: ['react-router-dom'] });
    expect(String(result.next)).toContain('package.json');
    const clean = await run(actions, 'canvas_write_build_file', { path: 'src/Ok.jsx', content: "import React from 'react';" });
    expect(clean).not.toHaveProperty('undeclaredDependencies');
  });

  it('answers the history tools with a reason instead of failing', async () => {
    const actions = canvasBuildActions({
      builds: () => [{ objectId: 'b1', title: 'Local', modality: 'designer', store: localFileStore('tools-history') }],
      createBuild: async () => { throw new Error('unused'); },
    });
    expect(await run(actions, 'canvas_list_build_file_history', {})).toHaveProperty('error');
    expect(await run(actions, 'canvas_restore_build_file', { path: 'a.js', at: 1 })).toHaveProperty('error');
  });
});

describe('workspacePathArg', () => {
  it('keeps a workspace-relative path as it came', () => {
    expect(workspacePathArg('src/App.jsx')).toBe('src/App.jsx');
  });

  it('accepts the leading-slash form a model retries with', () => {
    // The exact second attempt after a failed write: same file, not a new one.
    expect(workspacePathArg('/src/App.jsx')).toBe('src/App.jsx');
    expect(workspacePathArg('./src/App.jsx')).toBe('src/App.jsx');
    expect(workspacePathArg('  src/App.jsx  ')).toBe('src/App.jsx');
  });

  it('normalises a Windows-style path and a doubled separator', () => {
    expect(workspacePathArg('src\\components\\Header.jsx')).toBe('src/components/Header.jsx');
    expect(workspacePathArg('src//App.jsx')).toBe('src/App.jsx');
  });

  it('leaves traversal for the server validator to refuse', () => {
    expect(workspacePathArg('../secret.env')).toBe('../secret.env');
  });

  it('treats a missing or non-string path as absent', () => {
    expect(workspacePathArg(undefined)).toBe('');
    expect(workspacePathArg(42)).toBe('');
    expect(workspacePathArg('   ')).toBe('');
  });
});

describe('the workspace write set', () => {
  // The turn runner widens its output ceiling and step budget the moment one of THESE
  // commits, and counts them as canvas work. A build tool that writes but is missing
  // here would leave a turn reporting "nothing happened" over a working app again.
  it('names only build tools, and only the ones that commit to the workspace', () => {
    for (const name of CANVAS_BUILD_WORKSPACE_WRITE_TOOLS) {
      expect(CANVAS_BUILD_TOOL_NAMES).toContain(name);
    }
    expect([...CANVAS_BUILD_WORKSPACE_WRITE_TOOLS].sort()).toEqual([
      'canvas_create_build', 'canvas_edit_build_file', 'canvas_restore_build_file', 'canvas_write_build_file',
    ]);
  });
});

describe('which app types a board can hold', () => {
  it('knows the types that have a code workspace', () => {
    expect(hasCodeWorkspace('designer')).toBe(true);
    expect(hasCodeWorkspace('webmobile')).toBe(true);
    expect(hasCodeWorkspace('evermind')).toBe(false);
    expect(hasCodeWorkspace(undefined)).toBe(false);
  });

  it('gives a browser-held app a website when its type cannot run there, and a project any known type', () => {
    expect(appModalityFor('mobile', false)).toBe('mobile');
    expect(appModalityFor('evermind', false)).toBe('designer');
    expect(appModalityFor('evermind', true)).toBe('evermind');
    expect(appModalityFor('nonsense', true)).toBe('designer');
  });
});
