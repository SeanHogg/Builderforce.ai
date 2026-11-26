import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS } from '@builderforce/knowledge-graph-view';
import { codeFixture, fixtureSource } from '@builderforce/knowledge-graph-view/testing';
import { KnowledgeView } from './KnowledgeView';

/**
 * The Visualization panel's Knowledge view mounts the ONE graph view with a source. This
 * bundle has no DOM renderer (vitest `environment: 'node'`), so the first paint is
 * rendered to markup: a source that holds its graph paints it on the first render, and
 * the first paint is always the list (the 3D scene is the lazy chunk).
 */
describe('the Visualization panel Knowledge view', () => {
  it('mounts the graph view on a fake source and paints its graph', () => {
    const graph = codeFixture('fixture-root');
    const source = { ...fixtureSource([graph]), snapshot: { graph, title: 'fixture-root' } };
    const html = renderToStaticMarkup(createElement(KnowledgeView, { source, labels: DEFAULT_KNOWLEDGE_GRAPH_LABELS, focus: ['src:fixture-root::app/page.tsx'] }));
    expect(html).toContain('data-testid="viz-knowledge"');
    expect(html).toContain(DEFAULT_KNOWLEDGE_GRAPH_LABELS.regionLabel);
    // The first paint is the header, the camera row and the scene box (stage, code pane and the findings drawer are lazy or closed
    // by default, so no file name is in the markup). The spine ("Where you are") names the root of the graph the source held.
    expect(html).toMatch(/data-testid="kg-spine"[^]*>fixture-root<\/button>/);
  });

  it('forwards onCompose to the graph view (the Agent runs drawer Fix action seeds a new chat through it)', () => {
    const graph = codeFixture('ws');
    const source = { ...fixtureSource([graph]), snapshot: { graph, title: 'ws' } };
    const html = renderToStaticMarkup(createElement(KnowledgeView, { source, labels: DEFAULT_KNOWLEDGE_GRAPH_LABELS, onCompose: () => undefined }));
    expect(html).toContain('data-testid="viz-knowledge"');
  });

  it('explains itself while the source has not answered (no graph yet)', () => {
    const html = renderToStaticMarkup(createElement(KnowledgeView, { source: fixtureSource([]), labels: DEFAULT_KNOWLEDGE_GRAPH_LABELS }));
    expect(html).toContain(DEFAULT_KNOWLEDGE_GRAPH_LABELS.loading);
  });
});
