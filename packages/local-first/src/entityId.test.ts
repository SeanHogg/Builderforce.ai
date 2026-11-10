import { describe, expect, it, vi } from 'vitest';
import {
  CLIENT_ID_NOT_UUID,
  isIntegerIdText,
  isLocalId,
  mintLocalId,
  parseEntityRef,
  parseSyncId,
  syncIdText,
  type SyncId,
} from './entityId.js';
import { isJournalEventId } from './storeContract.js';

const UPPER = '3F2504E0-4F89-11D3-9A0C-0305E82C3301';

describe('parseSyncId', () => {
  it('accepts a positive safe integer and its decimal text', () => {
    expect(parseSyncId(42)).toBe(42);
    expect(parseSyncId('42')).toBe(42);
    expect(parseSyncId(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('refuses zero, negatives, fractions, padded / signed / spaced text, unsafe integers and non-ids', () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, '0', '007', '-3', '+3', ' 4', '4 ', '1e3', '9007199254740993',
      Number.MAX_SAFE_INTEGER + 2, '', 'spec:5', UPPER, null, undefined, {}, [], true]) {
      expect(parseSyncId(bad), String(bad)).toBeNull();
    }
  });

  it('syncIdText is the decimal text parseSyncId reads back', () => {
    const id = parseSyncId(501) as SyncId;
    expect(syncIdText(id)).toBe('501');
    expect(parseSyncId(syncIdText(id))).toBe(501);
  });
});

describe('isLocalId', () => {
  it('is the case-insensitive UUID check, of any version', () => {
    expect(isLocalId('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true);
    expect(isLocalId(UPPER)).toBe(true);
    expect(isLocalId('00000000-0000-8000-8000-000000000000')).toBe(true);
    for (const bad of ['42', 42, '', 'spec:5', `${UPPER}x`, null, undefined]) expect(isLocalId(bad)).toBe(false);
  });

  it('isJournalEventId is an alias: it accepts exactly what isLocalId accepts', () => {
    for (const v of [UPPER, UPPER.toLowerCase(), '42', 'ticket:1:v1', undefined]) {
      expect(isJournalEventId(v)).toBe(isLocalId(v));
    }
  });
});

describe('isIntegerIdText', () => {
  it('matches integer text of any sign and nothing else', () => {
    for (const v of ['42', '-3', '0']) expect(isIntegerIdText(v)).toBe(true);
    for (const v of [' 42', '4.2', 'x', 42, UPPER]) expect(isIntegerIdText(v)).toBe(false);
  });
});

describe('parseEntityRef', () => {
  it('reads a UUID as local, an integer as sync and kind:ref as tier', () => {
    expect(parseEntityRef(UPPER)).toEqual({ local: UPPER });
    expect(parseEntityRef('77')).toEqual({ sync: 77 });
    expect(parseEntityRef(77)).toEqual({ sync: 77 });
    expect(parseEntityRef('spec:5')).toEqual({ tier: { kind: 'spec', ref: '5' } });
    expect(parseEntityRef('objective:Q3-growth')).toEqual({ tier: { kind: 'objective', ref: 'Q3-growth' } });
  });

  it('re-validates an EntityRef object (brands do not survive a round-trip)', () => {
    expect(parseEntityRef(JSON.parse(JSON.stringify({ sync: 9 })))).toEqual({ sync: 9 });
    expect(parseEntityRef({ local: UPPER })).toEqual({ local: UPPER });
    expect(parseEntityRef({ tier: { kind: 'spec', ref: '5' } })).toEqual({ tier: { kind: 'spec', ref: '5' } });
    expect(parseEntityRef({ sync: '0' })).toBeNull();
    expect(parseEntityRef({ local: '42' })).toBeNull();
  });

  it('never guesses: anything else is null', () => {
    for (const bad of ['', '0', '-1', 'dev_abc', ':5', 'spec:', 'spec: 5', null, undefined, 1.5]) {
      expect(parseEntityRef(bad), String(bad)).toBeNull();
    }
  });
});

describe('mintLocalId', () => {
  it('mints a lower-case UUID locally and never a positive integer', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network_denied'));
    try {
      const seen = new Set<string>();
      for (let i = 0; i < 30; i += 1) {
        const id = mintLocalId();
        expect(isLocalId(id)).toBe(true);
        expect(id).toBe(id.toLowerCase());
        expect(parseSyncId(id)).toBeNull();
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('lower-cases an upper-case source', () => {
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(UPPER as `${string}-${string}-${string}-${string}-${string}`);
    try {
      expect(mintLocalId()).toBe(UPPER.toLowerCase());
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses a local id source that yields a positive integer instead of a UUID', () => {
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      42 as unknown as `${string}-${string}-${string}-${string}-${string}`,
    );
    try {
      expect(() => mintLocalId()).toThrow(CLIENT_ID_NOT_UUID);
    } finally {
      spy.mockRestore();
    }
  });
});
