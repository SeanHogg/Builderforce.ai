/**
 * `/api/payouts/connections` validates through the shared `connectWithdrawalMethod`
 * rule; these pin that the historical error wording survived the move.
 */
import { describe, expect, it } from 'vitest';
import { connectRefusalMessage } from './payoutRoutes';

describe('connectRefusalMessage', () => {
  it('names an unknown provider', () => {
    expect(connectRefusalMessage('nope', 'unknown_provider')).toBe('Unknown payout provider.');
  });

  it('sends OAuth providers back to consent', () => {
    expect(connectRefusalMessage('stripe', 'wrong_connect_flow')).toBe('Stripe is connected through consent, not a form.');
  });

  it('names the missing field by its label, not its key', () => {
    expect(connectRefusalMessage('bank', 'missing_field', 'accountNumber')).toBe('Account number / IBAN is required.');
  });
});
