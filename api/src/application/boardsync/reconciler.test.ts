import { describe, expect, it } from 'vitest';
import {
  reconcile,
  compareVersion,
  hashFields,
  type ExistingLink,
  type IncomingTicket,
} from './reconciler';

function incoming(overrides: Partial<IncomingTicket> = {}): IncomingTicket {
  return {
    externalId: 'GH-1',
    externalVersion: '2024-01-01T00:00:10Z',
    contentHash: 'aaaa',
    fields: { title: 'T', body: 'B', state: 'open' },
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingLink> = {}): ExistingLink {
  return {
    externalId: 'GH-1',
    externalVersion: '2024-01-01T00:00:05Z',
    contentHash: 'bbbb',
    syncState: 'synced',
    fields: { title: 'Old', body: 'Old', state: 'open' },
    ...overrides,
  };
}

describe('compareVersion', () => {
  it('handles nulls', () => {
    expect(compareVersion(null, null)).toBe(0);
    expect(compareVersion(null, '1')).toBeLessThan(0);
    expect(compareVersion('1', null)).toBeGreaterThan(0);
  });

  it('compares numeric version tokens numerically (not lexically)', () => {
    // lexical would say "10" < "9"; numeric says 10 > 9.
    expect(compareVersion('10', '9')).toBeGreaterThan(0);
    expect(compareVersion('9', '10')).toBeLessThan(0);
    expect(compareVersion('5', '5')).toBe(0);
  });

  it('compares ISO timestamps lexicographically (monotonic)', () => {
    expect(compareVersion('2024-01-01T00:00:10Z', '2024-01-01T00:00:05Z')).toBeGreaterThan(0);
    expect(compareVersion('2024-01-01T00:00:05Z', '2024-01-01T00:00:10Z')).toBeLessThan(0);
  });
});

describe('hashFields', () => {
  it('is order-independent and deterministic', () => {
    const a = hashFields({ title: 'X', body: 'Y', state: 'open' });
    const b = hashFields({ state: 'open', body: 'Y', title: 'X' });
    expect(a).toBe(b);
  });

  it('changes when content changes', () => {
    const a = hashFields({ title: 'X' });
    const b = hashFields({ title: 'Z' });
    expect(a).not.toBe(b);
  });
});

describe('reconcile — first sight', () => {
  it('applies a brand-new ticket', () => {
    const r = reconcile(null, incoming());
    expect(r.decision).toBe('applied');
    expect(r.reason).toBe('first_sight');
    expect(r.merged.syncState).toBe('synced');
    expect(r.merged.fields).toEqual(incoming().fields);
  });
});

describe('reconcile — idempotent re-sync', () => {
  it('skips when version equal and content unchanged', () => {
    const ex = existing({ externalVersion: 'v5', contentHash: 'same' });
    const r = reconcile(ex, incoming({ externalVersion: 'v5', contentHash: 'same' }));
    expect(r.decision).toBe('skipped_idempotent');
    expect(r.reason).toBe('duplicate_version');
  });

  it('skips a full replay of the exact same ticket', () => {
    const fields = { title: 'T', body: 'B', state: 'open' };
    const hash = hashFields(fields);
    const ex = existing({ externalVersion: 'v9', contentHash: hash, fields });
    const r = reconcile(ex, incoming({ externalVersion: 'v9', contentHash: hash, fields }));
    expect(r.decision).toBe('skipped_idempotent');
  });
});

describe('reconcile — version regression', () => {
  it('skips an older version with identical content', () => {
    const ex = existing({ externalVersion: '10', contentHash: 'h' });
    const r = reconcile(ex, incoming({ externalVersion: '7', contentHash: 'h' }));
    expect(r.decision).toBe('skipped_idempotent');
    expect(r.reason).toBe('version_regression');
  });

  it('skips an older version even when content differs (stale delivery)', () => {
    const ex = existing({ externalVersion: '10', contentHash: 'newhash' });
    const r = reconcile(ex, incoming({ externalVersion: '7', contentHash: 'oldhash' }));
    expect(r.decision).toBe('skipped_idempotent');
    expect(r.reason).toBe('version_regression');
    // never regresses stored state
    expect(r.merged.externalVersion).toBe('10');
    expect(r.merged.contentHash).toBe('newhash');
  });
});

describe('reconcile — clock-skew dedupe by version token, not timestamp', () => {
  it('dedupes on equal version token regardless of any wall-clock difference', () => {
    // Both observations carry the same provider version token "etag-abc",
    // even though a naive timestamp-based dedupe (e.g. provider clock skew)
    // might treat them as distinct. We must skip.
    const ex = existing({ externalVersion: 'etag-abc', contentHash: 'c1' });
    const r = reconcile(ex, incoming({ externalVersion: 'etag-abc', contentHash: 'c1' }));
    expect(r.decision).toBe('skipped_idempotent');
  });

  it('applies when version token advances even if it sorts oddly numerically', () => {
    const ex = existing({ externalVersion: '9', contentHash: 'c1' });
    // numeric advance 9 -> 10 with changed content
    const r = reconcile(ex, incoming({ externalVersion: '10', contentHash: 'c2' }));
    expect(r.decision).toBe('applied');
    expect(r.reason).toBe('remote_advanced');
  });
});

describe('reconcile — conflict detection', () => {
  it('flags conflict when local is dirty and remote content changed', () => {
    const ex = existing({ syncState: 'dirty_local', externalVersion: '5', contentHash: 'local' });
    const r = reconcile(ex, incoming({ externalVersion: '6', contentHash: 'remote' }));
    expect(r.decision).toBe('conflict');
    expect(r.reason).toBe('concurrent_local_and_remote_edit');
    expect(r.merged.syncState).toBe('conflict');
  });

  it('does NOT conflict when local dirty but remote content is unchanged', () => {
    const ex = existing({ syncState: 'dirty_local', externalVersion: '5', contentHash: 'same' });
    const r = reconcile(ex, incoming({ externalVersion: '6', contentHash: 'same' }));
    // newer version, unchanged content, dirty_local but no remote change → not conflict
    expect(r.decision).not.toBe('conflict');
  });
});

describe('reconcile — echo suppression', () => {
  it('suppresses an inbound echo while awaiting remote ack (dirty_remote + unchanged)', () => {
    const ex = existing({ syncState: 'dirty_remote', externalVersion: '5', contentHash: 'sent' });
    const r = reconcile(ex, incoming({ externalVersion: '6', contentHash: 'sent' }));
    expect(r.decision).toBe('skipped_idempotent');
    expect(r.reason).toBe('echo_suppressed');
    expect(r.merged.syncState).toBe('synced'); // dirty cleared
  });

  it('suppresses an explicitly locally-originated echo even with newer version', () => {
    const ex = existing({ syncState: 'dirty_remote', externalVersion: '5', contentHash: 'x' });
    const r = reconcile(
      ex,
      incoming({ externalVersion: '6', contentHash: 'y', originatedLocally: true }),
    );
    expect(r.decision).toBe('skipped_idempotent');
    expect(r.reason).toBe('echo_suppressed');
  });

  it('does NOT suppress a genuine remote edit after our push (content actually differs)', () => {
    const ex = existing({ syncState: 'dirty_remote', externalVersion: '5', contentHash: 'sent' });
    const r = reconcile(ex, incoming({ externalVersion: '6', contentHash: 'someone-else-edited' }));
    expect(r.decision).toBe('applied');
  });
});

describe('reconcile — remote advanced', () => {
  it('applies a newer version with changed content on a clean link', () => {
    const ex = existing({ syncState: 'synced', externalVersion: '5', contentHash: 'old' });
    const r = reconcile(ex, incoming({ externalVersion: '6', contentHash: 'new' }));
    expect(r.decision).toBe('applied');
    expect(r.merged.externalVersion).toBe('6');
    expect(r.merged.contentHash).toBe('new');
    expect(r.merged.syncState).toBe('synced');
  });
});
