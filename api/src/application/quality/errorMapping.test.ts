import { describe, it, expect } from 'vitest';
import { resolveEventProjectId, type CollectorRef, type MappingRule } from './errorMapping';
import type { NormalizedErrorEvent } from './errorSpec';

function ev(p: Partial<NormalizedErrorEvent>): NormalizedErrorEvent {
  return { type: 'Error', message: 'm', level: 'error', timestamp: '2026-01-01T00:00:00Z', source: 'native', ...p };
}
const projectCollector: CollectorRef = { id: 'c1', tenantId: 1, projectId: 42, defaultProjectId: null };
const tenantCollector: CollectorRef = { id: 'c2', tenantId: 1, projectId: null, defaultProjectId: 9 };

describe('resolveEventProjectId — project collector', () => {
  it('always routes to its own project, ignoring rules', () => {
    expect(resolveEventProjectId(ev({}), projectCollector, [])).toBe(42);
    expect(resolveEventProjectId(ev({ environment: 'prod' }), projectCollector, [{ matchField: 'environment', matchOp: 'equals', matchValue: 'prod', projectId: 7, priority: 1 }])).toBe(42);
  });
});

describe('resolveEventProjectId — tenant collector', () => {
  const rules: MappingRule[] = [
    { matchField: 'service', matchOp: 'equals', matchValue: 'checkout', projectId: 100, priority: 1 },
    { matchField: 'url', matchOp: 'prefix', matchValue: 'https://admin.', projectId: 200, priority: 2 },
    { matchField: 'release', matchOp: 'contains', matchValue: 'beta', projectId: 300, priority: 3 },
  ];

  it('matches on a service tag (equals)', () => {
    expect(resolveEventProjectId(ev({ tags: { service: 'checkout' } }), tenantCollector, rules)).toBe(100);
  });
  it('matches on a url prefix', () => {
    expect(resolveEventProjectId(ev({ url: 'https://admin.example.com/x' }), tenantCollector, rules)).toBe(200);
  });
  it('matches on a release substring (contains)', () => {
    expect(resolveEventProjectId(ev({ release: '2.0.0-beta.1' }), tenantCollector, rules)).toBe(300);
  });
  it('first rule by priority wins', () => {
    const e = ev({ tags: { service: 'checkout' }, url: 'https://admin.x' });
    expect(resolveEventProjectId(e, tenantCollector, rules)).toBe(100);
  });
  it('falls back to defaultProjectId when nothing matches', () => {
    expect(resolveEventProjectId(ev({ environment: 'prod' }), tenantCollector, rules)).toBe(9);
  });
  it('returns null when no match and no default (event is dropped)', () => {
    const noDefault: CollectorRef = { ...tenantCollector, defaultProjectId: null };
    expect(resolveEventProjectId(ev({}), noDefault, rules)).toBeNull();
  });
  it('supports a custom tag:<key> field', () => {
    const tagRule: MappingRule[] = [{ matchField: 'tag:repo', matchOp: 'equals', matchValue: 'web', projectId: 55, priority: 1 }];
    expect(resolveEventProjectId(ev({ tags: { repo: 'web' } }), tenantCollector, tagRule)).toBe(55);
  });
});
