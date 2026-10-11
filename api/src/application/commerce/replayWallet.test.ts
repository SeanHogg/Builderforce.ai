import { describe, expect, it } from 'vitest';
import { remainingOfGrant, spendableCredits, type ReplayLedgerRow } from './replayWallet';

const at = (iso: string) => new Date(iso);

function grant(reference: string, amount: number, occurredAt: string, expiresAt: string): ReplayLedgerRow {
  return {
    amount,
    kind: 'grant',
    reference,
    occurredAt: at(occurredAt),
    accountRef: '1',
    metadata: { expiresAt },
  };
}

function spend(amount: number, occurredAt: string, reference = 'spend'): ReplayLedgerRow {
  return {
    amount: -amount,
    kind: 'spend',
    reference,
    occurredAt: at(occurredAt),
    accountRef: '1',
    metadata: null,
  };
}

describe('replayWallet FIFO', () => {
  it('counts unexpired leftover after older grants are spent first', () => {
    const rows = [
      grant('replay-pack:a', 10, '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'),
      grant('replay-pack:b', 5, '2026-02-01T00:00:00Z', '2027-02-01T00:00:00Z'),
      spend(8, '2026-03-01T00:00:00Z'),
    ];
    const now = at('2026-06-01T00:00:00Z');
    expect(spendableCredits(rows, now)).toBe(7);
    expect(remainingOfGrant(rows, 'replay-pack:a', now)).toBe(2);
    expect(remainingOfGrant(rows, 'replay-pack:b', now)).toBe(5);
  });

  it('drops a grant whose expiresAt has passed, even if unspent', () => {
    const rows = [
      grant('replay-pack:old', 100, '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      grant('replay-pack:new', 4, '2026-02-01T00:00:00Z', '2027-02-01T00:00:00Z'),
    ];
    const now = at('2026-06-01T00:00:00Z');
    expect(spendableCredits(rows, now)).toBe(4);
    expect(remainingOfGrant(rows, 'replay-pack:old', now)).toBe(0);
  });

  it('does not claw back more than a grant still holds after spends', () => {
    const rows = [
      grant('replay-pack:a', 10, '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'),
      spend(10, '2026-03-01T00:00:00Z'),
    ];
    expect(remainingOfGrant(rows, 'replay-pack:a', at('2026-06-01T00:00:00Z'))).toBe(0);
    expect(spendableCredits(rows, at('2026-06-01T00:00:00Z'))).toBe(0);
  });
});
