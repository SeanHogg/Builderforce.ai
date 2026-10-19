/**
 * G26 — what the Rovr store guarantees when the device misbehaves (ticket #5860).
 *
 * Three claims, and this file exists because each one fails SILENTLY if it is wrong:
 *
 *  1. A held write lease is WAITED OUT and then refused. Age must never take a foreign
 *     lease, so `withWriteLease` has no branch on the lease's age at all — the test
 *     hands it a lease held since long before any plausible steal window and proves it
 *     still refuses rather than writing.
 *  2. A corrupt read is RAISED, never returned empty. `[]` is this store's truthful
 *     "nothing here"; returning it for an unreadable store would show a user with lost
 *     work an empty history and no error.
 *  3. The redaction rule is STATED and drops secret-shaped keys at every depth, so the
 *     shape that may be uploaded or logged is one the store can name rather than infer.
 *
 * The rules come from `packages/local-first` (the same contract the VSIX file host
 * uses) — these tests assert Rovr reuses them, not that they are reimplemented here.
 * Nothing in this file opens a socket or a database.
 */
import { describe, expect, it } from 'vitest';
import {
  readStoredChats,
  readStoredMessages,
  rovrLeaseBusy,
  rovrLockStolen,
  rovrRecoverSnapshot,
  rovrRedactForUploadOrLog,
  RovrCorruptRecordError,
  RovrLeaseBusyError,
  ROVR_BUSY_TIMEOUT,
  ROVR_BUSY_POLL_MS,
  ROVR_REDACTED_KEYS,
  ROVR_REDACTION_RULE,
  ROVR_REQUIRES_RECOVERY_COPY,
  withWriteLease,
  type LocalChat,
  type RovrWriteLease,
} from './records';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const STALE = Date.parse('2026-10-18T11:00:00.000Z');

function chat(id: number): LocalChat {
  return {
    id,
    title: `chat ${id}`,
    createdAt: '2026-10-18T11:00:00.000Z',
    updatedAt: '2026-10-18T11:30:00.000Z',
    syncKey: `sync-${id}`,
  };
}

/** A lease held since `STALE` — an hour old, far past any steal window. */
function staleLease(): RovrWriteLease {
  return { holder: 'side-panel', heldSince: STALE };
}

/**
 * A clock that only moves when `wait` is called, so a poll loop makes progress in
 * a test instead of spinning. `wait` returns immediately — the fake clock is what
 * makes the deadline reachable, not real elapsed time.
 */
function fakeClock(start = NOW) {
  let t = start;
  return { now: () => t, wait: async (ms: number) => void (t += ms) };
}

describe('G26 write lease: busy, never stolen', () => {
  it('waits for a held lease and then refuses, rather than writing on top of it', async () => {
    let polls = 0;
    let writes = 0;
    const clock = fakeClock();

    // The holder never releases, so the loop must end by refusing once the busy
    // timeout passes. A steal would have returned the write instead.
    await expect(
      withWriteLease(
        () => staleLease(),
        async () => {
          writes += 1;
        },
        clock.now,
        async () => {
          polls += 1;
          await clock.wait(ROVR_BUSY_POLL_MS);
        },
      ),
    ).rejects.toBeInstanceOf(RovrLeaseBusyError);
    expect(writes).toBe(0);
    expect(polls).toBeGreaterThan(0);
  });

  it('names the holder in the refusal, so the failure is diagnosable', async () => {
    const clock = fakeClock();
    await expect(
      withWriteLease(
        () => staleLease(),
        async () => undefined,
        clock.now,
        async (ms) => void (await clock.wait(ms)),
      ),
    ).rejects.toThrow(/lease held by side-panel/);
  });

  it('writes as soon as the holder releases, without a restart', async () => {
    let released = false;
    const clock = fakeClock();
    const result = await withWriteLease(
      () => (released ? undefined : staleLease()),
      async () => 'written',
      clock.now,
      async (ms) => {
        released = true;
        await clock.wait(ms);
      },
    );
    expect(result).toBe('written');
  });

  it('writes immediately when no lease exists — an absent lease is not a wait', async () => {
    let writes = 0;
    await withWriteLease(
      () => undefined,
      async () => {
        writes += 1;
      },
      () => NOW,
      async () => {
        throw new Error('must not poll');
      },
    );
    expect(writes).toBe(1);
  });

  it('treats an empty holder as no lease at all — there is nothing to wait on', async () => {
    await expect(
      withWriteLease(
        () => ({ holder: '', heldSince: STALE }),
        async () => 'written',
        () => NOW,
        async () => {
          throw new Error('must not poll');
        },
      ),
    ).resolves.toBe('written');
  });

  it('age never opens the path: a lease old enough to have timed out is still busy', () => {
    for (const ageMs of [0, 30_000, 60_000, 24 * 60 * 60 * 1000]) {
      expect(rovrLeaseBusy('side-panel', STALE + ageMs, STALE)).toBe(true);
    }
  });

  it('there is no steal at any age, so no caller can invent one', () => {
    for (const ageMs of [0, 30_000, 60_000, 24 * 60 * 60 * 1000]) {
      expect(rovrLockStolen('side-panel', STALE + ageMs, STALE, ageMs)).toBe(false);
    }
    expect(rovrLockStolen(null, NOW, STALE, 1)).toBe(false);
    expect(rovrLockStolen(undefined, NOW, STALE, 1)).toBe(false);
  });

  it('the timeout is a wait, not a millisecond window that admits a second entrant', () => {
    expect(ROVR_BUSY_TIMEOUT).toBe('until_release');
    // A numeric steal window would be read as "fine after this long". This is not one.
    expect(typeof ROVR_BUSY_TIMEOUT).not.toBe('number');
  });

  it('does not grant on a missing holder either — lockStolen says no to both cases', () => {
    expect(rovrLockStolen('', NOW, STALE, 30_000)).toBe(false);
  });
});

describe('G26 corrupt read: raised, never returned empty', () => {
  it('returns the rows when they are well formed', () => {
    const rows = [chat(-1), chat(-2)];
    expect(readStoredChats(rows)).toEqual(rows);
  });

  it('still returns [] for a store that genuinely holds nothing', () => {
    expect(readStoredChats([])).toEqual([]);
  });

  it('raises on a row that parses but is not a chat, instead of dropping it', () => {
    const rows = [chat(-1), { ...chat(-2), syncKey: undefined }];
    expect(() => readStoredChats(rows)).toThrow(RovrCorruptRecordError);
    // The important half: it is NOT [].
    let returned: LocalChat[] | undefined;
    try {
      returned = readStoredChats(rows);
    } catch {
      returned = undefined;
    }
    expect(returned).not.toEqual([]);
  });

  it('names the offending chat, so a broken row is findable in the store', () => {
    expect(() => readStoredChats([{ ...chat(-42), title: 7 as unknown as string }])).toThrow(/chat -42/);
  });

  it('raises on a non-object row rather than tolerating it', () => {
    expect(() => readStoredChats([null as unknown as LocalChat])).toThrow(RovrCorruptRecordError);
    expect(() => readStoredChats(['not-a-chat' as unknown as LocalChat])).toThrow(RovrCorruptRecordError);
  });

  it('a transcript row with no content raises — the transcript is the only copy', () => {
    const rows = [{ id: 1, seq: 1, chatId: -1, role: 'user', content: undefined, createdAt: 'x' }];
    expect(() => readStoredMessages(rows as unknown as Parameters<typeof readStoredMessages>[0], -1)).toThrow(
      RovrCorruptRecordError,
    );
  });

  it('returns [] for a chat with genuinely no messages', () => {
    expect(readStoredMessages([], -1)).toEqual([]);
  });

  it('classifies a corrupt snapshot as corrupt rather than as an empty value', () => {
    const truncated = rovrRecoverSnapshot('{"chats":[{"id":-1');
    expect(truncated).toEqual({ ok: false, reason: 'corrupt_snapshot' });
    expect(rovrRecoverSnapshot(JSON.stringify([chat(-1)]))).toEqual({ ok: true, value: [chat(-1)] });
  });

  it('needs no recovery copy: this adapter has no second file to keep', () => {
    expect(ROVR_REQUIRES_RECOVERY_COPY).toBe(false);
  });
});

describe('G26 redaction: the rule is stated and drops secret fields', () => {
  it('states the rule in words, so it can be reviewed rather than inferred', () => {
    expect(ROVR_REDACTION_RULE).toMatch(/strip/i);
    expect(ROVR_REDACTION_RULE).toMatch(/uploaded or logged/i);
  });

  it('names the secret-shaped keys it drops', () => {
    expect(ROVR_REDACTED_KEYS).toContain('token');
    expect(ROVR_REDACTED_KEYS).toContain('password');
    expect(ROVR_REDACTED_KEYS).toContain('apikey');
  });

  it('drops a secret field from a record, absent rather than blanked', () => {
    const record = { ...chat(-1), accessToken: 'super-secret' };
    const out = rovrRedactForUploadOrLog(record);
    expect('accessToken' in out).toBe(false);
    expect(out.id).toBe(-1);
    expect(out.syncKey).toBe('sync--1');
  });

  it('drops secrets at every depth, including inside arrays', () => {
    const snapshot = {
      chats: [chat(-1), { ...chat(-2), clientSecret: 'nope' }],
      credential: { nested: { password: 'nope', keep: 'yes' } },
    };
    const out = rovrRedactForUploadOrLog(snapshot);
    expect(JSON.stringify(out)).not.toMatch(/nope/);
    expect(out.credential.nested.keep).toBe('yes');
    expect(out.chats).toHaveLength(2);
  });

  it('does not mutate the input — the device copy keeps its own value', () => {
    const record = { ...chat(-1), accessToken: 'super-secret' };
    rovrRedactForUploadOrLog(record);
    expect(record.accessToken).toBe('super-secret');
  });

  it('keeps the non-secret fields, so the redacted shape is still uploadable', () => {
    const out = rovrRedactForUploadOrLog({ ...chat(-1), isArchived: true, originalRequest: 'add a banner' });
    expect(out.isArchived).toBe(true);
    expect(out.originalRequest).toBe('add a banner');
  });
});