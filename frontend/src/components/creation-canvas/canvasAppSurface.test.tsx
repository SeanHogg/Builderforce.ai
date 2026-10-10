import { describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// The copy IS part of the assertion, exactly as it is for the surface switcher.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

// The workspace (editor, runtime client, panels) is lazy-loaded and covered by its own
// tests; here it is a marker that says which app the surface handed it.
vi.mock('next/dynamic', () => ({
  default: () => function WorkspaceMarker(props: { app: { nodeId: string }; initialFiles: Array<{ path: string }> }) {
    return <div data-testid="workspace" data-app={props.app.nodeId} data-files={props.initialFiles.map((file) => file.path).join(',')} />;
  },
}));

import { canvasAppEntry, canvasAppFiles } from '@/lib/canvasApp';
import { sessionApps } from '@/lib/canvasSessionApp';
import { seedLocalWorkspace } from '@/lib/workspace/localFileStore';
import type { CreationNodeData } from './types';
import { CanvasAppSurface } from './CanvasAppSurface';
import type { CanvasSessionAppActions } from './hooks/useCanvasSessionApp';
import { CanvasSessionProvider, type CanvasSessionFacts } from './chrome/canvasSessionContext';
import type { CanvasLens } from '@/lib/canvasLens';

/** The surface reads the session's lens to decide whether it can be left at all. */
const facts = (lens: CanvasLens): CanvasSessionFacts => ({
  sessionId: 'app-surface-test',
  persistence: 'server',
  role: 'owner' as CanvasSessionFacts['role'],
  lens,
  boardPath: '/create/app-surface-test',
  canEdit: true,
  notify: vi.fn(),
  requireAccount: vi.fn() as unknown as CanvasSessionFacts['requireAccount'],
});

function renderSurface(ui: ReactElement, lens: CanvasLens = 'canvas') {
  const value = facts(lens);
  return render(ui, { wrapper: ({ children }: { children: ReactNode }) => <CanvasSessionProvider value={value}>{children}</CanvasSessionProvider> });
}

const card = (id: string, path: string, code: string, language = ''): { id: string; data: CreationNodeData } =>
  ({ id, data: { kind: 'code', title: path, path, code, language } as CreationNodeData });

const SESSION = [
  card('n1', 'backend/server.js', "const express = require('express');\napp.listen(3000);"),
  card('n2', 'frontend/index.html', '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Send an SMS</h1><script src="app.js"></script></body></html>'),
  card('n3', 'frontend/styles.css', 'body { font-family: system-ui; }'),
  card('n4', 'frontend/app.js', "document.querySelector('h1').dataset.ready = '1';"),
];

describe('the board read as an app\'s files', () => {
  it('composes loose code cards into one file list, keeping the card each came from', () => {
    const files = canvasAppFiles(SESSION);
    expect(files.map((file) => file.path)).toEqual([
      'backend/server.js', 'frontend/index.html', 'frontend/styles.css', 'frontend/app.js',
    ]);
    expect(files.find((file) => file.path === 'frontend/app.js')?.nodeId).toBe('n4');
  });

  /**
   * Brain authors a code card's source into `content` — the field `canvas_add_object`
   * actually receives — not the rarer `code` field this projection once read exclusively
   * (the GreenEdge Yard Care session, 2026-08-16, had six cards written this way).
   */
  it('reads a code card\'s source from `content`, the field Brain actually authors', () => {
    const authoredByBrain = { id: 'n8', data: {
      kind: 'code', title: 'backend/server.js', content: "require('express');\napp.listen(3000);",
    } as unknown as CreationNodeData };
    const files = canvasAppFiles([authoredByBrain]);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'backend/server.js', role: 'server', nodeId: 'n8' });
  });

  it('projects a website object\'s pages into the file list, so it composes with a code backend', () => {
    const website = { id: 'n5', data: {
      kind: 'website', title: 'GreenEdge Yard Care',
      pages: [{
        id: 'quote', name: 'Quote', path: '/quote', sections: [
          { id: 'hero', kind: 'hero', heading: 'GreenEdge Yard Care', body: 'Proof of concept', cta: 'Get a quote' },
          { id: 'form', kind: 'content', heading: 'Request a quote', body: '<form action="/api/quote"><input name="email"></form>' },
        ],
      }],
    } as unknown as CreationNodeData };
    const backend = card('n6', 'twilio-handler.js', "const twilio = require('twilio');\napp.listen(3000);");
    const files = canvasAppFiles([website, backend]);

    const site = files.find((file) => file.nodeId === 'n5');
    expect(site?.role).toBe('page');
    expect(site?.source).toContain('sandbox="allow-scripts allow-forms"');
    expect(canvasAppEntry(files)?.nodeId).toBe('n5');
    expect(files.filter((file) => file.role === 'server').map((file) => file.nodeId)).toEqual(['n6']);
  });

  it('does not project a plain document — it has no runnable shape', () => {
    const doc = { id: 'n7', data: { kind: 'document', title: 'Notes', content: 'Some prose.' } as unknown as CreationNodeData };
    expect(canvasAppFiles([doc])).toEqual([]);
  });

  it('tells a server apart from a script the page loads, by what the source needs', () => {
    const files = canvasAppFiles(SESSION);
    expect(files.find((file) => file.path === 'backend/server.js')?.role).toBe('server');
    expect(files.find((file) => file.path === 'frontend/app.js')?.role).toBe('script');
    expect(files.find((file) => file.path === 'frontend/styles.css')?.role).toBe('style');
    expect(files.find((file) => file.path === 'frontend/index.html')?.role).toBe('page');
  });

  it('opens on index.html when there is one, and on the only page when there is not', () => {
    expect(canvasAppEntry(canvasAppFiles(SESSION))?.path).toBe('frontend/index.html');
    const single = canvasAppFiles([card('n1', 'pages/about.html', '<h1>About</h1>')]);
    expect(canvasAppEntry(single)?.path).toBe('pages/about.html');
    expect(canvasAppEntry(canvasAppFiles([card('n1', 'server.js', "require('http')")]))).toBeNull();
  });
});

describe('a game on the board', () => {
  const html = '<!doctype html><html><head><title>Runner</title></head><body><canvas></canvas></body></html>';
  const place = `<roblox version="4"><Item class="ServerScriptService" referent="RBX0">
<Properties><string name="Name">ServerScriptService</string></Properties>
<Item class="Script" referent="RBX1"><Properties>
<string name="Name">GameServer</string>
<ProtectedString name="Source"><![CDATA[print("rules")]]></ProtectedString>
</Properties></Item></Item></roblox>`;

  const gameNode = (id: string, title: string, mime: string, body: string) => ({
    id,
    data: { kind: 'game', title, outputUrl: `data:${mime};charset=utf-8,${encodeURIComponent(body)}` } as CreationNodeData,
  });

  it('is a page the app opens on, because a web game IS an HTML document', () => {
    const files = canvasAppFiles([gameNode('g1', 'Star Run', 'text/html', html)]);
    expect(canvasAppEntry(files)?.path).toBe('star-run.html');
    expect(files[0]!.source).toContain('<canvas>');
  });

  it('offers a Roblox place as SOURCE, and never as the page to open', () => {
    const files = canvasAppFiles([gameNode('g2', 'Skybound Citadels', 'application/xml', place)]);
    expect(files.map((file) => file.path)).toEqual(['skybound-citadels/GameServer.luau']);
    expect(files[0]!.source).toBe('print("rules")');
    expect(canvasAppEntry(files)).toBeNull();
  });
});

function session(nodes: ReadonlyArray<{ id: string; data: CreationNodeData }>, overrides: Partial<CanvasSessionAppActions> = {}): CanvasSessionAppActions {
  const apps = sessionApps(nodes as unknown as Parameters<typeof sessionApps>[0]);
  return {
    apps,
    app: apps[0] ?? null,
    buildsRef: { current: [] },
    createApp: vi.fn().mockResolvedValue({ objectId: 'new', title: 'x', modality: 'designer', store: {} }),
    provisionApp: vi.fn().mockResolvedValue(undefined),
    selectApp: vi.fn(),
    appWritten: vi.fn(),
    importCards: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const localBuild = (id: string, key: string) => ({ id, data: { kind: 'build', title: 'He-Man site', modality: 'designer', localAppKey: key } as unknown as CreationNodeData });

describe('the app surface', () => {
  it('offers what to make on a board with no app and no code', async () => {
    const actions = session([]);
    renderSurface(<CanvasAppSurface nodes={[]} session={actions} persistence="server" sessionTitle="Launch" onExit={vi.fn()} />);
    expect(screen.getByText('Start this session’s app')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Website/ }));
    await waitFor(() => expect(actions.createApp).toHaveBeenCalledWith({ title: 'Launch', modality: 'designer' }));
  });

  it('offers a board with no account only the kinds that run in the browser', () => {
    renderSurface(<CanvasAppSurface nodes={[]} session={session([])} persistence="local" sessionTitle="" onExit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Website/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Evermind/ })).toBeNull();
  });

  /** The operator's decision: code cards on the board become the app without asking. */
  it('makes the app a board of code cards already is, once, without asking', async () => {
    const actions = session(SESSION);
    const { rerender } = renderSurface(<CanvasAppSurface nodes={SESSION} session={actions} persistence="local" sessionTitle="" onExit={vi.fn()} />);
    expect(screen.queryByText('Start this session’s app')).toBeNull();
    await waitFor(() => expect(actions.createApp).toHaveBeenCalledWith({ title: 'My app', modality: 'designer' }));
    rerender(<CanvasAppSurface nodes={SESSION} session={actions} persistence="local" sessionTitle="" onExit={vi.fn()} />);
    expect(actions.createApp).toHaveBeenCalledTimes(1);
  });

  it('opens the session\'s app on its files, and brings the board\'s cards into it', async () => {
    await seedLocalWorkspace('surface-test', { 'index.html': '<h1>Hi</h1>', 'src/main.jsx': '' });
    const nodes = [localBuild('b1', 'surface-test'), card('n4', 'frontend/app.js', '1')];
    const actions = session(nodes);
    renderSurface(<CanvasAppSurface nodes={nodes} session={actions} persistence="local" sessionTitle="" onExit={vi.fn()} />);
    const workspace = await screen.findByTestId('workspace');
    expect(workspace).toHaveAttribute('data-app', 'b1');
    expect(workspace).toHaveAttribute('data-files', 'index.html,src/main.jsx');
    expect(actions.importCards).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'b1' }));
  });

  /** The Studio lens creates the board's app itself (`useCanvasEntryApp`); the chooser would be moot. */
  it('says the app is being prepared, not what to make, while a lens is creating it', () => {
    const actions = session([]);
    renderSurface(<CanvasAppSurface nodes={[]} session={actions} persistence="local" sessionTitle="" entryAppPending onExit={vi.fn()} />);
    expect(screen.queryByText('Start this session’s app')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Bringing your code into the app');
    expect(actions.createApp).not.toHaveBeenCalled();
  });

  it('hands the board back on Escape, the way every other surface does', () => {
    const onExit = vi.fn();
    renderSurface(<CanvasAppSurface nodes={[]} session={session([])} persistence="server" sessionTitle="" onExit={onExit} />);
    fireEvent.keyDown(screen.getByTestId('canvas-app-surface'), { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('wears a visible way back to the board, as every object surface does', () => {
    const onExit = vi.fn();
    renderSurface(<CanvasAppSurface nodes={[]} session={session([])} persistence="server" sessionTitle="" onExit={onExit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the board' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('draws no way back where the lens keeps the App as its home (Studio)', () => {
    renderSurface(<CanvasAppSurface nodes={[]} session={session([])} persistence="server" sessionTitle="" onExit={vi.fn()} />, 'studio');
    expect(screen.queryByRole('button', { name: 'Back to the board' })).toBeNull();
  });
});
