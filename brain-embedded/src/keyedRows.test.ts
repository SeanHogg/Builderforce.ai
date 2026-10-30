import { describe, expect, it } from 'vitest';
import { slotKeyedRows } from './keyedRows';

describe('slotKeyedRows - the one decision every message store makes for a keyed row', () => {
  const stored = new Map([['steer:a', { id: 1 }]]);

  it('a key already stored is KNOWN (return the saved row, write nothing)', () => {
    expect(slotKeyedRows([{ eventKey: 'steer:a' }], (k) => stored.get(k))).toEqual([{ kind: 'known', prior: { id: 1 } }]);
  });

  it('an unseen key is NEW; a row with no key is always new', () => {
    expect(slotKeyedRows([{ eventKey: 'steer:b' }, {}], (k) => stored.get(k))).toEqual([
      { kind: 'new', row: { eventKey: 'steer:b' }, key: 'steer:b' },
      { kind: 'new', row: {}, key: undefined },
    ]);
  });

  it('a key repeated within the batch REPEATS the earlier row', () => {
    const slots = slotKeyedRows([{ eventKey: 'steer:c' }, { eventKey: 'steer:c' }], () => undefined);
    expect(slots[0]).toMatchObject({ kind: 'new' });
    expect(slots[1]).toEqual({ kind: 'repeat', of: 0 });
  });
});
