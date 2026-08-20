import { describe, expect, it } from 'vitest';
import {
  CEREMONY_SESSION_STATUSES,
  isCeremonySessionDone,
  isCeremonySessionStatus,
} from './ceremonySession';

/**
 * A SESSION THAT CAN NEVER FINISH IS NOT A WORK ITEM.
 *
 * Both tables shipped with `status` defaulting to `'active'` and no writer anywhere,
 * so every poker session and every retro in every workspace was permanently open.
 * These tests lock the two halves that fix it: a strict write vocabulary, and one
 * read-side definition of terminal that is deliberately WIDER than it — because rows
 * written before this vocabulary existed must not read as in-flight forever.
 */
describe('ceremony session lifecycle', () => {
  it('accepts exactly the statuses a client may set', () => {
    for (const s of CEREMONY_SESSION_STATUSES) expect(isCeremonySessionStatus(s)).toBe(true);
    expect(isCeremonySessionStatus('ACTIVE')).toBe(true);
  });

  it('rejects anything else, so a typo is a 400 and not an uninterpretable row', () => {
    for (const s of ['done', 'finished', '', 'active ', null, undefined, 7, {}]) {
      expect(isCeremonySessionStatus(s)).toBe(false);
    }
  });

  it('treats every terminal status as done — including legacy ones it will not let you set', () => {
    for (const s of ['completed', 'cancelled', 'closed', 'archived', 'COMPLETED']) {
      expect(isCeremonySessionDone(s)).toBe(true);
    }
    // `closed`/`archived` are readable-but-not-settable: the write path is strict.
    expect(isCeremonySessionStatus('closed')).toBe(false);
    expect(isCeremonySessionStatus('archived')).toBe(false);
  });

  it('treats an open — or never-set — session as not done', () => {
    for (const s of ['active', 'ACTIVE', '', null, undefined]) {
      expect(isCeremonySessionDone(s)).toBe(false);
    }
  });

  /**
   * A cancelled ceremony is NOT outstanding work. Counting it as unfinished would park
   * a progress ring at 0% forever with no action that could ever move it.
   */
  it('counts a cancelled session as finished, not as work still owed', () => {
    expect(isCeremonySessionDone('cancelled')).toBe(true);
  });
});
