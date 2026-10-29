import { describe, expect, it } from 'vitest';
import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { camelKind, fillTemplate } from './template';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, resolveLabels } from './labels';
import { findingDetail, findingRequest } from './findingText';
import { edgeKindLabel, packLabel } from './names';

const node = (ref: string, label: string): KNode => ({ ref, kind: 'section', label, pack: 'docs', importance: 0.5, origin: 'extracted' }) as KNode;
const INDEX = new Map([
  ['src:r::a.md', node('src:r::a.md', 'a.md')],
  ['src:r::b.md', node('src:r::b.md', 'b.md')],
]);

const contradiction = (params: Finding['params'], nodes = ['src:r::a.md', 'src:r::b.md']): Finding => ({
  id: 'c', kind: 'contradiction', pack: 'docs', nodes: nodes as Finding['nodes'], severity: 'warn', params,
  requestKey: 'knowledgeGraph.fix.contradiction',
});

describe('fillTemplate', () => {
  it('fills placeholders, renders unknown ones empty and collapses the gap', () => {
    expect(fillTemplate('{a} and {b}', { a: 'x' })).toBe('x and');
    expect(fillTemplate('n={n}', { n: 0 })).toBe('n=0');
  });

  it('keeps an optional [[part]] only when every placeholder in it has a value', () => {
    const t = 'Fix[[ in group {group}]]: {items}';
    expect(fillTemplate(t, { group: 'g1', items: 'x' })).toBe('Fix in group g1: x');
    expect(fillTemplate(t, { group: '', items: 'x' })).toBe('Fix: x');
    expect(fillTemplate(t, { items: 'x' })).toBe('Fix: x');
    expect(fillTemplate(t, { group: '  ', items: 'x' })).toBe('Fix: x');
  });

  it('camel-cases kinds and request keys', () => {
    expect(camelKind('near-duplicate')).toBe('nearDuplicate');
    expect(camelKind('knowledgeGraph.fix.cloneGroup')).toBe('cloneGroup');
  });
});

describe('contradiction request', () => {
  it('names both sections', () => {
    const f = contradiction({ fileA: 'lease.md', sectionA: '2', fileB: 'policy.md', sectionB: '4', confidence: 80 });
    expect(findingRequest(f, L, INDEX)).toBe('Reconcile §2 of lease.md with §4 of policy.md.');
    expect(findingDetail(f, L, INDEX)).toBe('Reconcile §2 of lease.md with §4 of policy.md.');
  });

  it('omits the § part of a side whose section is empty', () => {
    const f = contradiction({ fileA: 'lease.md', sectionA: '', fileB: 'policy.md', sectionB: '4', confidence: 80 });
    expect(findingRequest(f, L, INDEX)).toBe('Reconcile lease.md with §4 of policy.md.');
    const none = contradiction({ fileA: 'lease.md', sectionA: '', fileB: 'policy.md', sectionB: '', confidence: 50 });
    expect(findingRequest(none, L, INDEX)).toBe('Reconcile lease.md with policy.md.');
  });

  it('falls back to the first two nodes when memory named no files, and offers no row detail', () => {
    const f = contradiction({});
    expect(findingRequest(f, L, INDEX)).toBe('Reconcile a.md with b.md.');
    expect(findingDetail(f, L, INDEX)).toBeUndefined();
  });

  it('has no row detail for other kinds', () => {
    expect(findingDetail({ ...contradiction({ fileA: 'a', fileB: 'b' }), kind: 'cycle' }, L, INDEX)).toBeUndefined();
  });
});

describe('clone group request', () => {
  const clone = (params: Finding['params']): Finding => ({
    id: 'g', kind: 'clone-group', pack: 'code', nodes: ['src:r::a.md', 'src:r::b.md'] as Finding['nodes'], severity: 'warn', params,
    requestKey: 'knowledgeGraph.fix.cloneGroup',
  });

  it('names the group when it has one', () => {
    expect(findingRequest(clone({ group: 'g1' }), L, INDEX)).toContain('in clone group g1: a.md, b.md.');
  });

  it('never renders "clone group :" for an empty group', () => {
    const text = findingRequest(clone({ group: '' }), L, INDEX);
    expect(text).not.toContain('clone group');
    expect(text).toContain('Consolidate the duplicated code: a.md, b.md.');
    expect(findingRequest(clone({}), L, INDEX)).not.toMatch(/ :|clone group/);
  });
});

describe('names and labels', () => {
  it('words known edge kinds and packs, and shows an unknown id raw', () => {
    expect(edgeKindLabel(L, 'near-duplicate')).toBe('nearly duplicates');
    expect(edgeKindLabel(L, 'links')).toBe('links to');
    expect(edgeKindLabel(L, 'wormhole')).toBe('wormhole');
    expect(packLabel(L, 'docs')).toBe('Documents');
    expect(packLabel(L, 'sheets')).toBe('sheets');
  });

  it('merges a host subset over the defaults key by key, including the new maps', () => {
    const merged = resolveLabels({ edgeKinds: { references: 'verweist auf' }, packs: { code: 'Quelltext' }, title: 'Wissen' });
    expect(merged.title).toBe('Wissen');
    expect(merged.edgeKinds.references).toBe('verweist auf');
    expect(merged.edgeKinds.links).toBe(L.edgeKinds.links);
    expect(merged.packs).toEqual({ code: 'Quelltext', docs: L.packs.docs });
    expect(merged.reviewPlanCostPending).toBe(L.reviewPlanCostPending);
    expect(resolveLabels()).toBe(L);
  });
});
