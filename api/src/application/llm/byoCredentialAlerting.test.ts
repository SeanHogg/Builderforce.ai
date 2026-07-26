import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import {
  _resetMemoryProviderAuthAlerts,
  clearProviderAuthAlert,
  loadProviderAuthAlert,
  type ProviderAuthAlert,
} from './providerAuthAlerts';

// ---------------------------------------------------------------------------
// Alert NOTIFICATION — the transition rule.
//
// Recording that an account is broken and TELLING its owner are different things, and
// the gap between them is what let a workspace run for weeks on a lapsed subscription.
// So every surface that observes breakage (a live cascade, the Test button, the daily
// sweep) raises through one function, and that function decides when a human hears about
// it. The rule under test:
//
//   first break  → record + email        (the owner learns about it immediately)
//   still broken → record, NO email      (a run hitting a dead key every turn mails once)
//   fixed → breaks again → email         (clearing re-arms the transition)
//
// The mail layer is mocked: what matters here is WHEN a notification is attempted, not
// its HTML. `getManagerEmails` is mocked too so no database is needed.
// ---------------------------------------------------------------------------

const sendTransactionalEmail = vi.fn(async () => undefined);
const getManagerEmails = vi.fn(async () => ['owner@example.com', 'manager@example.com']);

vi.mock('../email/sendEmail', () => ({ sendTransactionalEmail: (...a: unknown[]) => sendTransactionalEmail(...(a as [])) }));
vi.mock('../approval/approvalNotifier', () => ({ getManagerEmails: (...a: unknown[]) => getManagerEmails(...(a as [])) }));
vi.mock('../../infrastructure/database/connection', () => ({ buildDatabase: () => ({}) }));
vi.mock('../../infrastructure/email/EmailService', () => ({ sendByoCredentialAlertEmail: async () => undefined }));

const { raiseProviderAuthAlert, raiseProviderAuthAlertsFromFailovers } = await import('./byoCredentialAlerting');

// No AUTH_CACHE_KV → the alert store uses its per-isolate map, which is reset per test.
const env = {} as Env;

const alert = (over: Partial<ProviderAuthAlert> = {}): ProviderAuthAlert => ({
  provider: 'openai', reason: 'rejected', status: 401, vendor: 'openai-codex', at: Date.now(), ...over,
});

beforeEach(() => {
  _resetMemoryProviderAuthAlerts();
  sendTransactionalEmail.mockClear();
  getManagerEmails.mockClear();
});

describe('raiseProviderAuthAlert — notify on transition, not on state', () => {
  it('records AND notifies the workspace admins the first time a provider breaks', async () => {
    const outcome = await raiseProviderAuthAlert(env, 42, alert(), 'OAuth token expired');

    expect(outcome.transitioned).toBe(true);
    expect(outcome.notified).toEqual(['owner@example.com', 'manager@example.com']);
    // One mail per admin, not one per workspace.
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2);
    expect(await loadProviderAuthAlert(env, 42, 'openai')).toMatchObject({ reason: 'rejected' });
  });

  it('does NOT re-notify while the provider stays broken', async () => {
    await raiseProviderAuthAlert(env, 42, alert());
    sendTransactionalEmail.mockClear();

    // Every subsequent run hits the same dead credential; none of them may mail.
    const second = await raiseProviderAuthAlert(env, 42, alert());
    const third = await raiseProviderAuthAlert(env, 42, alert());

    expect(second.transitioned).toBe(false);
    expect(third.transitioned).toBe(false);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('re-notifies after a recovery — clearing the alert re-arms the transition', async () => {
    await raiseProviderAuthAlert(env, 42, alert());
    await clearProviderAuthAlert(env, 42, 'openai'); // reconnect / successful probe
    sendTransactionalEmail.mockClear();

    const again = await raiseProviderAuthAlert(env, 42, alert());
    expect(again.transitioned).toBe(true);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2);
  });

  it('scopes the transition per tenant — one workspace breaking does not mute another', async () => {
    await raiseProviderAuthAlert(env, 42, alert());
    sendTransactionalEmail.mockClear();

    const other = await raiseProviderAuthAlert(env, 43, alert());
    expect(other.transitioned).toBe(true);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2);
  });

  it('never lets a mail failure propagate into the caller', async () => {
    getManagerEmails.mockRejectedValueOnce(new Error('db down'));
    // The alert must still be RECORDED even when nobody could be told about it.
    await expect(raiseProviderAuthAlert(env, 42, alert())).resolves.toMatchObject({ notified: [] });
    expect(await loadProviderAuthAlert(env, 42, 'openai')).toMatchObject({ reason: 'rejected' });
  });
});

describe('raiseProviderAuthAlertsFromFailovers — the live-run entry point', () => {
  it('notifies from a cascade that failed over and still SUCCEEDED elsewhere', async () => {
    // The motivating case: the run works, so nothing looks wrong, and the tenant's own
    // account silently stops being used. The failover list is the only evidence.
    await raiseProviderAuthAlertsFromFailovers(env, 42, [
      { vendor: 'openai-codex', code: 401, detail: 'token expired' },
      { vendor: 'openrouter', code: 200 },
    ]);

    expect(await loadProviderAuthAlert(env, 42, 'openai')).toMatchObject({ reason: 'rejected' });
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2);
  });

  it('stays completely silent for a cascade with no owner-actionable failure', async () => {
    await raiseProviderAuthAlertsFromFailovers(env, 42, [
      { vendor: 'openai-codex', code: 429 },
      { vendor: 'meta', code: 502 },
    ]);

    expect(await loadProviderAuthAlert(env, 42, 'openai')).toBeNull();
    expect(getManagerEmails).not.toHaveBeenCalled();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
