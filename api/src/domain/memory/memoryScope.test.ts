import { describe, expect, it } from 'vitest';
import {
  MAX_TTL_DAYS,
  MIN_TTL_DAYS,
  dedupeBySpecificity,
  expiryFromTtlDays,
  isExpired,
  isMemoryOrigin,
  isMemoryScope,
  resolveWriteScope,
  visibleScopeChain,
} from './memoryScope';

const NOW = new Date('2026-07-26T12:00:00Z');

describe('visibleScopeChain', () => {
  it('reads narrowest-first from a ticket run', () => {
    expect(visibleScopeChain({ tenantId: 1, projectId: 3, ticketId: 9 })).toEqual([
      { kind: 'ticket', id: 9 },
      { kind: 'project', id: 3 },
      { kind: 'tenant', id: 0 },
    ]);
  });

  it('skips the levels a run does not occupy', () => {
    expect(visibleScopeChain({ tenantId: 1, projectId: 3 })).toEqual([
      { kind: 'project', id: 3 },
      { kind: 'tenant', id: 0 },
    ]);
    expect(visibleScopeChain({ tenantId: 1 })).toEqual([{ kind: 'tenant', id: 0 }]);
  });

  it('never emits a sibling — project B is unreachable from a project A run', () => {
    const chain = visibleScopeChain({ tenantId: 1, projectId: 3, ticketId: 9 });
    expect(chain.filter((s) => s.kind === 'project')).toEqual([{ kind: 'project', id: 3 }]);
  });

  it('treats 0/null ids as absent rather than as a real scope', () => {
    expect(visibleScopeChain({ tenantId: 1, projectId: 0, ticketId: null })).toEqual([{ kind: 'tenant', id: 0 }]);
  });
});

describe('resolveWriteScope', () => {
  const ticketRun = { tenantId: 1, projectId: 3, ticketId: 9 };

  it('defaults to the NARROWEST scope the run occupies', () => {
    expect(resolveWriteScope(ticketRun)).toEqual({ kind: 'ticket', id: 9 });
    expect(resolveWriteScope({ tenantId: 1, projectId: 3 })).toEqual({ kind: 'project', id: 3 });
    expect(resolveWriteScope({ tenantId: 1 })).toEqual({ kind: 'tenant', id: 0 });
  });

  it('honours an explicit widening', () => {
    expect(resolveWriteScope(ticketRun, 'project')).toEqual({ kind: 'project', id: 3 });
    expect(resolveWriteScope(ticketRun, 'tenant')).toEqual({ kind: 'tenant', id: 0 });
  });

  it('takes the owner from the RUN, so a scope string cannot aim at another project', () => {
    expect(resolveWriteScope({ tenantId: 1, projectId: 3 }, 'project').id).toBe(3);
    expect(resolveWriteScope({ tenantId: 1, projectId: 55 }, 'project').id).toBe(55);
  });

  it('degrades outward when the run lacks the requested scope', () => {
    expect(resolveWriteScope({ tenantId: 1, projectId: 3 }, 'ticket')).toEqual({ kind: 'project', id: 3 });
    expect(resolveWriteScope({ tenantId: 1 }, 'ticket')).toEqual({ kind: 'tenant', id: 0 });
  });
});

describe('isExpired', () => {
  it('treats a null expiry as durable', () => {
    expect(isExpired(null, NOW)).toBe(false);
    expect(isExpired(undefined, NOW)).toBe(false);
  });

  it('lapses at or after the expiry', () => {
    expect(isExpired(new Date(NOW.getTime() - 1), NOW)).toBe(true);
    expect(isExpired(NOW, NOW)).toBe(true);
    expect(isExpired(new Date(NOW.getTime() + 1), NOW)).toBe(false);
  });

  it('accepts an ISO string (rows arrive as strings from some drivers)', () => {
    expect(isExpired('2026-07-25T00:00:00Z', NOW)).toBe(true);
    expect(isExpired('2026-07-27T00:00:00Z', NOW)).toBe(false);
  });
});

describe('expiryFromTtlDays', () => {
  it('returns null for a durable fact', () => {
    for (const ttl of [null, undefined, 0, -5, Number.NaN]) expect(expiryFromTtlDays(ttl, NOW)).toBeNull();
  });

  it('converts days to an absolute instant', () => {
    expect(expiryFromTtlDays(7, NOW)?.toISOString()).toBe('2026-08-02T12:00:00.000Z');
  });

  it('clamps so a model cannot defeat the TTL in either direction', () => {
    expect(expiryFromTtlDays(1e9, NOW)?.getTime()).toBe(NOW.getTime() + MAX_TTL_DAYS * 86_400_000);
    expect(expiryFromTtlDays(0.0001, NOW)?.getTime()).toBe(NOW.getTime() + MIN_TTL_DAYS * 86_400_000);
  });
});

describe('dedupeBySpecificity', () => {
  it('keeps the narrowest scope when a key exists at several', () => {
    const out = dedupeBySpecificity([
      { key: 'deploy', scope: 'ticket' as const },
      { key: 'deploy', scope: 'project' as const },
      { key: 'deploy', scope: 'tenant' as const },
    ]);
    expect(out).toEqual([{ key: 'deploy', scope: 'ticket' }]);
  });

  it('preserves order within a scope so importance ranking survives', () => {
    const out = dedupeBySpecificity([
      { key: 'a', scope: 'project' as const },
      { key: 'b', scope: 'project' as const },
      { key: 'c', scope: 'tenant' as const },
    ]);
    expect(out.map((e) => e.key)).toEqual(['a', 'b', 'c']);
  });
});

describe('guards', () => {
  it('validates scope kinds', () => {
    expect(isMemoryScope('ticket')).toBe(true);
    expect(isMemoryScope('global')).toBe(false);
    expect(isMemoryScope(3)).toBe(false);
  });

  it('validates origins', () => {
    expect(isMemoryOrigin('cloud-run')).toBe(true);
    expect(isMemoryOrigin('vibes')).toBe(false);
  });
});
