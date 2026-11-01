import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * The `automatic` response mode sends with nobody reviewing the reply, so the
 * do-not-contact check is its only gate. Everything around the sweep is replaced; the
 * key function (`suppressionKey`) stays real so the check and the test key a sender alike.
 */
vi.mock('../marketing/suppression', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../marketing/suppression')>()),
  suppressedEmails: vi.fn(async () => new Set<string>()),
}));
vi.mock('./mailboxService', () => ({
  getMailboxConnection: vi.fn(async () => ({ status: 'connected', allowSending: true })),
  readMailbox: vi.fn(),
  sendFromMailbox: vi.fn(async () => ({ ok: true, id: 'sent-1' })),
  setMailboxMessageRead: vi.fn(async () => undefined),
}));
vi.mock('../agent/agentPrompt', () => ({
  WORKFORCE_MODEL_REF_PREFIX: 'workforce:',
  resolveWorkforceModel: vi.fn(async () => ({ baseModel: 'm', directives: 'be brief', execParams: {} })),
}));
vi.mock('../llm/tenantProxy', () => ({ completeForTenant: vi.fn(async () => ({ response: { status: 200 } })) }));
vi.mock('../llm/LlmProxyService', () => ({ readProxyChoice: vi.fn(async () => ({ content: 'Thanks for writing.' })) }));
vi.mock('../approval/approvalNotifier', () => ({ notifyApprovalRequested: vi.fn(async () => undefined) }));
vi.mock('../runtime/cronWorkSignal', () => ({ signalPendingWork: vi.fn(async () => undefined) }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  peekCached: vi.fn(async () => undefined),
  setCached: vi.fn(async () => undefined),
}));

import { AUTOMATIC_REPLY_SUPPRESSED, runMailboxAutomationSweep } from './mailboxAutomationService';
import { suppressedEmails } from '../marketing/suppression';
import { readMailbox, sendFromMailbox } from './mailboxService';
import { completeForTenant } from '../llm/tenantProxy';
import { reportCaughtError } from '../observability/caughtErrorReporter';

const rule = (responseMode: string) => ({
  id: 1, tenantId: 7, connectionId: 3, enabled: true, name: 'r', fromContains: '', subjectContains: '',
  agentRef: 'a1', responseMode, instructions: '',
});
const inbound = { id: 'msg-1', from: 'Jane Doe <Erased@X.com>', subject: 'Hello', snippet: '', bodyText: 'hi' };
const execution = { id: 9, draftText: 'Thanks for writing.', status: 'processing', connectionId: 3, sender: inbound.from, subject: 'Hello', messageId: 'msg-1', providerSentId: null };

/** rules, reap, claim, then whatever the path under test reads. */
const dbFor = (mode: string, tail: unknown[][] = []) =>
  fakeDb([[rule(mode)], [], [{ id: 9 }], ...tail]);

beforeEach(() => {
  vi.mocked(suppressedEmails).mockReset().mockResolvedValue(new Set());
  vi.mocked(sendFromMailbox).mockClear();
  vi.mocked(completeForTenant).mockClear();
  vi.mocked(reportCaughtError).mockClear();
  vi.mocked(readMailbox).mockReset().mockResolvedValue({ ok: true, messages: [inbound] } as never);
});

describe('runMailboxAutomationSweep — automatic replies honour the do-not-contact list', () => {
  it('sends nothing to a suppressed sender, drafts nothing, and records why on the execution', async () => {
    vi.mocked(suppressedEmails).mockResolvedValue(new Set(['erased@x.com']));
    const db = dbFor('automatic');

    const summary = await runMailboxAutomationSweep({} as Env, db as unknown as Db);

    // Checked on the PARSED, lower-cased address — not the display-name form.
    expect(vi.mocked(suppressedEmails).mock.calls[0]![2]).toEqual(['erased@x.com']);
    expect(sendFromMailbox).not.toHaveBeenCalled();
    expect(completeForTenant).not.toHaveBeenCalled();
    const write = db.calls.filter((c) => c.kind === 'update').at(-1)!.payload as { status: string; error: string };
    expect(write).toMatchObject({ status: 'rejected', error: AUTOMATIC_REPLY_SUPPRESSED });
    expect(summary).toMatchObject({ matched: 1, sent: 0, failed: 0 });
  });

  it('sends to the bare address when the sender is not suppressed', async () => {
    const db = dbFor('automatic', [[], [execution], []]);
    const summary = await runMailboxAutomationSweep({} as Env, db as unknown as Db);
    expect(summary).toMatchObject({ sent: 1, failed: 0 });
    expect(vi.mocked(sendFromMailbox).mock.calls[0]![4]).toMatchObject({ to: 'Erased@X.com' });
  });

  it('fails closed: a failing check sends nothing and records the failure', async () => {
    vi.mocked(suppressedEmails).mockRejectedValue(new Error('db down'));
    const db = dbFor('automatic');
    const summary = await runMailboxAutomationSweep({} as Env, db as unknown as Db);
    expect(sendFromMailbox).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ sent: 0, failed: 1 });
    expect(reportCaughtError).toHaveBeenCalled();
  });

  it('fails closed on a mode it does not know: it sends, so it is gated like `automatic`', async () => {
    vi.mocked(suppressedEmails).mockResolvedValue(new Set(['erased@x.com']));
    const db = dbFor('autopilot');
    const summary = await runMailboxAutomationSweep({} as Env, db as unknown as Db);
    expect(suppressedEmails).toHaveBeenCalledTimes(1);
    expect(sendFromMailbox).not.toHaveBeenCalled();
    expect(completeForTenant).not.toHaveBeenCalled();
    const write = db.calls.filter((c) => c.kind === 'update').at(-1)!.payload as { status: string; error: string };
    expect(write).toMatchObject({ status: 'rejected', error: AUTOMATIC_REPLY_SUPPRESSED });
    expect(summary).toMatchObject({ matched: 1, sent: 0, failed: 0 });
  });

  it('does not ask for the human-reviewed modes: a draft is still drafted for a suppressed sender', async () => {
    vi.mocked(suppressedEmails).mockResolvedValue(new Set(['erased@x.com']));
    const db = dbFor('draft');
    const summary = await runMailboxAutomationSweep({} as Env, db as unknown as Db);
    expect(suppressedEmails).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ drafted: 1 });
    expect(sendFromMailbox).not.toHaveBeenCalled();
  });
});
