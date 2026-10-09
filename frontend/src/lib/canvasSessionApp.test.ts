import { describe, expect, it } from 'vitest';
import {
  APP_IMPORT_HASH_FIELD,
  appCardSignature,
  boundCanvasBuilds,
  canvasAppLocalKey,
  claimableStarter,
  entryRedirectPage,
  newAppTakesPrimary,
  pendingCardImport,
  primarySessionApp,
  sessionApps,
  sessionHasApp,
  withImportStamps,
  withPrimaryApp,
  writtenAppTakesPrimary,
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

  it('goes to a new app only on an empty board, or over a lens starter of another platform', () => {
    expect(newAppTakesPrimary([], 'designer')).toBe(true);
    // An app someone asked for keeps its place.
    expect(newAppTakesPrimary(sessionApps([serverBuild('a')]), 'mobile')).toBe(false);
    // Studio's web starter gives way to the mobile app the request was for…
    expect(newAppTakesPrimary(sessionApps([localBuild('bb', { appStarter: true })]), 'mobile')).toBe(true);
    // …but not to a second web app (that request claims the starter — `claimableStarter`).
    expect(newAppTakesPrimary(sessionApps([localBuild('bb', { appStarter: true })]), 'designer')).toBe(false);
  });
});

describe('claimableStarter', () => {
  it('hands a requested app the lens starter of its own platform, and nothing else', () => {
    const starter = localBuild('bb', { appStarter: true });
    // Same platform: the request IS the starter, so it is claimed rather than duplicated.
    expect(claimableStarter(sessionApps([starter]), 'designer')?.nodeId).toBe('bb');
    // Another platform takes primary from it instead (`newAppTakesPrimary`); not claimed.
    expect(claimableStarter(sessionApps([starter]), 'mobile')).toBeNull();
    // An app someone asked for is never taken over.
    expect(claimableStarter(sessionApps([serverBuild('a')]), 'designer')).toBeNull();
    expect(claimableStarter([], 'designer')).toBeNull();
  });
});

describe('writtenAppTakesPrimary', () => {
  it('moves the surface to the app being written only when it is showing a starter', () => {
    // Session local-148925cf: thirteen files went into "cc" while the surface ran the starter.
    const starterBoard = withPrimaryApp([localBuild('bb', { appStarter: true }), localBuild('cc')], 'bb');
    expect(writtenAppTakesPrimary(sessionApps(starterBoard), 'cc')).toBe(true);
    // Writing into the app already shown changes nothing.
    expect(writtenAppTakesPrimary(sessionApps(starterBoard), 'bb')).toBe(false);
    // An app someone chose keeps the surface while the Brain works on the other one.
    const chosen = withPrimaryApp([localBuild('bb'), localBuild('cc', { modality: 'mobile' })], 'bb');
    expect(writtenAppTakesPrimary(sessionApps(chosen), 'cc')).toBe(false);
    // An id that is not an app on the board never takes it.
    expect(writtenAppTakesPrimary(sessionApps(starterBoard), 'nope')).toBe(false);
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
