import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  watchDrainNeedsWrite, MAILBOX_AUTOMATION_REAP_INTERVAL_MS, MAILBOX_AUTOMATION_STALE_PROCESSING_MS,
} from './mailboxSweepWrites';

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url).href), 'utf8');

describe('watchDrainNeedsWrite', () => {
  const healthy = { cursor: 'c1', status: 'active', lastError: null };

  it('writes nothing for an empty drain on a healthy watch', () => {
    expect(watchDrainNeedsWrite(healthy, 'c1')).toBe(false);
  });

  it('writes when the cursor moved — losing it would replay the window', () => {
    expect(watchDrainNeedsWrite(healthy, 'c2')).toBe(true);
    expect(watchDrainNeedsWrite({ ...healthy, cursor: null }, 'c1')).toBe(true);
  });

  it('writes to clear an error or a non-active status even with no new mail', () => {
    expect(watchDrainNeedsWrite({ ...healthy, lastError: 'token expired' }, 'c1')).toBe(true);
    expect(watchDrainNeedsWrite({ ...healthy, status: 'error' }, 'c1')).toBe(true);
  });

  it('is what drainMailboxWatch gates its row update on', () => {
    expect(read('./mailboxWatch.ts')).toMatch(/if \(watchDrainNeedsWrite\(row, delta\.cursor\)\) \{/);
  });
});

describe('mailbox-automation stale-claim reap', () => {
  const source = read('./mailboxAutomationService.ts');

  it('reaps on a slower cadence than the tick, and only when an enabled rule exists', () => {
    expect(MAILBOX_AUTOMATION_REAP_INTERVAL_MS).toBeGreaterThan(5 * 60_000);
    expect(MAILBOX_AUTOMATION_REAP_INTERVAL_MS).toBeLessThanOrEqual(MAILBOX_AUTOMATION_STALE_PROCESSING_MS);
    expect(source).toMatch(/if \(rules\.length > 0\) await reapStaleProcessingClaims\(env, db, onlyTenantId\);/);
  });

  it('throttles the scheduled reap with a KV marker, never the manual per-tenant run', () => {
    expect(source).toMatch(/if \(scheduled && await peekCached<number>\(env, MAILBOX_AUTOMATION_REAP_MARKER_KEY\)\) return;/);
    // The unconditional DELETE at the top of the sweep must not come back.
    expect(source).not.toMatch(/dispatchBudget: TickDispatchBudget = createTickDispatchBudget\(\),\n\): Promise<MailboxAutomationSweepResult> \{\n  await db\.delete/);
  });
});
