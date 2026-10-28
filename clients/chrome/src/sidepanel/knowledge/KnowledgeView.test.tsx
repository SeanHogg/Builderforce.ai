// @vitest-environment jsdom
/**
 * Rovr's Knowledge destination (PRD 38 WS6). Pins what the destination promises:
 *   - it renders the view's fixture graphs (code, docs, mixed) IDENTICALLY to the web —
 *     the same ONE `KnowledgeGraphView`, with labels from the same web catalogs through
 *     the same mapper;
 *   - signed out, or with no project, it says why and points at Settings;
 *   - its source reads the knowledge API through Rovr's authenticated fetch, and offers
 *     the File System Access picker where the browser has one, the upload always.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS, KnowledgeGraphView } from '@builderforce/knowledge-graph-view';
import { codeFixture, docsFixture, fixtureSource, mixedFixture } from '@builderforce/knowledge-graph-view/testing';
import { catalogReader, knowledgeGraphLabels } from '@builderforce/knowledge-browser';
import catalogs from 'virtual:rovr-knowledge-catalogs';
import { KnowledgeView } from './KnowledgeView';
import { rovrKnowledgeLabels } from './knowledgeLabels';
import { createRovrKnowledgeSource, rovrDirectoryProviders } from './rovrKnowledgeSource';

/** `chrome.*` as the panel reads it: no catalog (every `t()` is its key), English UI. */
beforeEach(() => {
  vi.stubGlobal('chrome', { i18n: { getMessage: () => '', getUILanguage: () => 'en' }, runtime: { getURL: (p: string) => `chrome-extension://rovr/${p}` } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The list the view paints first, with React's per-render `useId` values neutralised. */
async function paintedList(ui: ReactElement): Promise<string> {
  const { container, unmount } = render(ui);
  await screen.findByTestId('kg-list');
  const html = container.querySelector('[data-testid="kg-list"]')!.outerHTML.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:/g, 'ID');
  unmount();
  return html;
}

describe('Rovr Knowledge destination', () => {
  it.each([
    ['code', codeFixture()],
    ['docs', docsFixture()],
    ['mixed', mixedFixture()],
  ])('renders the %s fixture identically to the web', async (_name, graph) => {
    const rovr = await paintedList(
      <KnowledgeView source={fixtureSource([graph])} gap={null} labels={rovrKnowledgeLabels('en')} onOpenSettings={() => undefined} />,
    );
    // The web host: the same view, labels from the same catalog through the same mapper.
    const web = await paintedList(<KnowledgeGraphView source={fixtureSource([graph])} labels={knowledgeGraphLabels(catalogReader(catalogs.en))} />);
    expect(rovr).toBe(web);
  });

  it('labels come from the web catalogs: English is the package defaults, every locale is translated', () => {
    expect(rovrKnowledgeLabels('en')).toEqual(DEFAULT_KNOWLEDGE_GRAPH_LABELS);
    for (const locale of ['de', 'es', 'fr', 'zh'] as const) {
      expect(rovrKnowledgeLabels(locale).title, locale).toBe(catalogs[locale].title);
      expect(rovrKnowledgeLabels(locale).title, locale).not.toBe(DEFAULT_KNOWLEDGE_GRAPH_LABELS.title);
    }
  });

  it.each([
    ['signedOut', 'knowledgeSignedOutTitle', 'knowledgeSignedOutBody'],
    ['noProject', 'knowledgeNoProjectTitle', 'knowledgeNoProjectBody'],
  ] as const)('explains a %s gap and opens Settings', (gap, title, body) => {
    const onOpenSettings = vi.fn();
    render(<KnowledgeView source={null} gap={gap} labels={rovrKnowledgeLabels('en')} onOpenSettings={onOpenSettings} />);
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByText(body)).toBeTruthy();
    expect(screen.queryByTestId('kg-list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'knowledgeOpenSettings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('offers the folder picker where the browser has one, and the upload always', () => {
    expect(rovrDirectoryProviders().map((p) => p.kind)).toEqual(['upload']);
    const host = window as unknown as { showDirectoryPicker?: unknown };
    host.showDirectoryPicker = vi.fn();
    try {
      expect(rovrDirectoryProviders().map((p) => p.kind)).toEqual(['folder', 'upload']);
    } finally {
      delete host.showDirectoryPicker;
    }
  });

  it('reads the knowledge API through Rovr\'s authenticated fetch, scoped to the project', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ scopes: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const source = createRovrKnowledgeSource({ projectId: 7, fetch, reportError: vi.fn() });
    expect(await source.scopes()).toEqual([]);
    expect(fetch.mock.calls.map((call) => (call as unknown[])[0])).toContain('/api/projects/7/knowledge/scopes');
  });
});
