import { describe, expect, it } from 'vitest';
import {
  APP_IMPORT_HASH_FIELD,
  appCardSignature,
  boundCanvasBuilds,
  canvasAppLocalKey,
  entryRedirectPage,
  pendingCardImport,
  primarySessionApp,
  sessionApps,
  sessionHasApp,
  withImportStamps,
  withPrimaryApp,
} from './canvasSessionApp';

type Node = { id: string; data: { [key: string]: unknown; kind: string } };

const serverBuild = (id: string, extra: Record<string, unknown> = {}): Node => ({
  id,
  data: { kind: 'build', title: `Build ${id}`, resourceId: `ideProject:${id.length}`, ideProjectId: id.length, storageProjectId: 900 + id.length, modality: 'designer', ...extra },
});
const localBuild = (id: string, extra: Record<string, unknown> = {}): Node => ({
  id,
  data: { kind: 'build', title: `Local ${id}`, localAppKey: `key-${id}`, modality: 'designer', ...extra },
});
const code = (id: string, path: string, content: string, extra: Record<string, unknown> = {}): Node => ({
  id,
  data: { kind: 'code', title: path, path, content, ...extra },
});

describe('sessionApps', () => {
  it('reads durable and browser-held builds, and skips a build with no workspace', () => {
    const apps = sessionApps([serverBuild('a'), localBuild('bb'), { id: 'c', data: { kind: 'build', title: 'Unbound' } }, code('d', 'x.js', '1')]);
    expect(apps.map((app) => [app.nodeId, app.store.kind])).toEqual([['a', 'server'], ['bb', 'local']]);
    expect(apps[0].store.id).toBe(901);
    expect(apps[1].store.id).toBe('local:key-bb');
  });

  it('keeps ONE store object per workspace, so the workspace does not restart on a board change', () => {
    expect(sessionApps([localBuild('bb')])[0].store).toBe(sessionApps([localBuild('bb', { title: 'Renamed' })])[0].store);
  });

  it('maps apps onto the build tools without leaking card internals', () => {
    expect(boundCanvasBuilds(sessionApps([localBuild('bb')]))).toEqual([
      expect.objectContaining({ objectId: 'bb', title: 'Local bb', modality: 'designer' }),
    ]);
  });
});

describe('the primary app', () => {
  it('is the flagged build, otherwise the first', () => {
    expect(primarySessionApp(sessionApps([serverBuild('a'), localBuild('bb')]))?.nodeId).toBe('a');
    expect(primarySessionApp(sessionApps([serverBuild('a'), localBuild('bb', { appPrimary: true })]))?.nodeId).toBe('bb');
    expect(primarySessionApp([])).toBeNull();
  });

  it('has one writer that leaves exactly one build flagged', () => {
    const board = [serverBuild('a', { appPrimary: true }), localBuild('bb'), code('c', 'x.js', '1')];
    const next = withPrimaryApp(board, 'bb');
    expect(next.filter((node) => node.data.appPrimary === true).map((node) => node.id)).toEqual(['bb']);
    // A code card is never touched.
    expect(next[2]).toBe(board[2]);
  });
});

describe('sessionHasApp', () => {
  it('is true for a build or a runnable code page, false for an empty board', () => {
    expect(sessionHasApp([localBuild('bb')])).toBe(true);
    expect(sessionHasApp([code('c', 'index.html', '<h1>Hi</h1>')])).toBe(true);
    expect(sessionHasApp([code('c', 'server.js', "require('http')")])).toBe(false);
    expect(sessionHasApp([])).toBe(false);
  });
});

describe('bringing code cards into the app', () => {
  it('brings in new cards, then nothing until a card changes', () => {
    const board = [code('c1', 'index.html', '<h1>Hi</h1>'), code('c2', 'styles.css', 'h1{}')];
    const first = pendingCardImport(board);
    expect(first.files).toEqual({ 'index.html': '<h1>Hi</h1>', 'styles.css': 'h1{}' });

    const stamped = withImportStamps(board, first.stamps);
    expect(pendingCardImport(stamped).files).toEqual({});

    const edited = stamped.map((node) => (node.id === 'c2' ? { ...node, data: { ...node.data, content: 'h1{color:red}' } } : node));
    expect(pendingCardImport(edited).files).toEqual({ 'styles.css': 'h1{color:red}' });
  });

  it('adds a root page that opens an entry living in a folder, only when that entry is brought in', () => {
    const board = [code('c1', 'frontend/index.html', '<h1>Hi</h1>'), code('c2', 'backend/server.js', "require('http')")];
    const first = pendingCardImport(board);
    expect(first.files['index.html']).toBe(entryRedirectPage('frontend/index.html'));
    expect(Object.keys(first.files)).toContain('backend/server.js');

    // The server changes; the entry did not — the root page the person may have replaced is left alone.
    const stamped = withImportStamps(board, first.stamps).map((node) => (node.id === 'c2' ? { ...node, data: { ...node.data, content: "require('http');//v2" } } : node));
    expect(pendingCardImport(stamped).files).toEqual({ 'backend/server.js': "require('http');//v2" });
  });

  it('stamps the cards it brought in', () => {
    const board = [code('c1', 'a.js', '1')];
    const { stamps } = pendingCardImport(board);
    expect(withImportStamps(board, stamps)[0].data[APP_IMPORT_HASH_FIELD]).toBe(stamps.c1);
  });

  it('a redirect page names the entry and nothing else', () => {
    const page = entryRedirectPage('/frontend/index.html');
    expect(page).toContain('url=./frontend/index.html');
    expect(page).toContain('location.replace("./frontend/index.html")');
  });
});

describe('appCardSignature', () => {
  it('ignores a move and notices an edit', () => {
    const card = code('c1', 'a.js', '1');
    const board = [card];
    const before = appCardSignature(board);
    // React Flow moves a card by replacing the node and keeping its data.
    expect(appCardSignature([{ ...card }])).toBe(before);
    expect(appCardSignature([{ ...card, data: { ...card.data, content: '2' } }])).not.toBe(before);
  });

  it('only fingerprints cards that can change the app', () => {
    expect(appCardSignature([{ id: 'n', data: { kind: 'note', title: 'x' } }])).toBe('');
  });
});

describe('canvasAppLocalKey', () => {
  it('reads the browser workspace key a card holds, and nothing else', () => {
    expect(canvasAppLocalKey({ kind: 'build', localAppKey: 'k1' })).toBe('k1');
    expect(canvasAppLocalKey({ kind: 'build', localAppKey: '' })).toBeNull();
    expect(canvasAppLocalKey({ kind: 'build' })).toBeNull();
  });
});
