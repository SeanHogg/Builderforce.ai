// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimInlinePrompt,
  noteSignedOutRead,
  readGuestWall,
  resetGuestWall,
  subscribeGuestWall,
} from './guestWall';

beforeEach(() => {
  resetGuestWall();
  window.history.replaceState(null, '', '/');
});

describe('guestWall', () => {
  it('records the route a signed-out read was refused on, without its query', () => {
    window.history.replaceState(null, '', '/investor?tab=pack');
    noteSignedOutRead();
    expect(readGuestWall().pathname).toBe('/investor');
  });

  it('tells subscribers once per route, not once per refused read', () => {
    const seen = vi.fn();
    const stop = subscribeGuestWall(seen);
    window.history.replaceState(null, '', '/investor');
    noteSignedOutRead();
    noteSignedOutRead();
    noteSignedOutRead();
    expect(seen).toHaveBeenCalledTimes(1);

    window.history.replaceState(null, '', '/hiring');
    noteSignedOutRead();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(readGuestWall().pathname).toBe('/hiring');

    stop();
    window.history.replaceState(null, '', '/incidents');
    noteSignedOutRead();
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('counts the prompts mounted inside a page so the shell copy can stand down', () => {
    const releaseFirst = claimInlinePrompt();
    const releaseSecond = claimInlinePrompt();
    expect(readGuestWall().inline).toBe(2);
    releaseFirst();
    expect(readGuestWall().inline).toBe(1);
    releaseSecond();
    releaseSecond();
    expect(readGuestWall().inline).toBe(0);
  });

  it('returns the same idle snapshot until something changes, as useSyncExternalStore requires', () => {
    const first = readGuestWall();
    expect(readGuestWall()).toBe(first);
    expect(resetGuestWall()).toBe(first);
    noteSignedOutRead();
    expect(readGuestWall()).not.toBe(first);
    expect(resetGuestWall()).toBe(first);
  });
});
