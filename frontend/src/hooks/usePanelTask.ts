'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The one shape a canvas panel's ACTION has: busy while it runs, a notice when it
 * worked, a message when it did not.
 *
 * Every panel was writing the same eleven lines around every call — `setBusy(true)`,
 * `setError(null)`, `try`, `setNotice(...)`, `catch` with the same
 * `failure instanceof Error ? failure.message : t('...')` ternary, `finally`
 * `setBusy(false)`. Six copies in one file, and they had already drifted: some cleared
 * the previous notice and some left a stale "campaign launched" sitting above a fresh
 * error, which reads as though the failed thing had succeeded.
 *
 * So the mechanics live here and the panel supplies only the WORDS. Two rules the
 * copies disagreed about are settled by being in one place:
 *
 *   1. Starting an action clears BOTH the previous error and the previous notice. A
 *      message on screen always describes the most recent action, never the one before.
 *   2. A rejection resolves to `undefined` rather than propagating, so a caller reads
 *      the result to decide what to do next instead of wrapping the call in its own
 *      try/catch — which is what the duplication was made of.
 *
 * Deliberately UI-agnostic: no styles, no strings, no knowledge of ads or drives. It is
 * the async half of a panel, and any surface with a button that can fail can use it.
 */
export interface PanelTask {
  /** True while an action is in flight. Drives `disabled` on every control. */
  busy: boolean;
  /** The most recent failure, already reduced to a sentence. */
  error: string | null;
  /** The most recent success. */
  notice: string | null;
  /**
   * Run one action. Resolves to its value, or to `undefined` when it threw — in which
   * case `error` carries the reason: the thrown `Error.message` when there is one (an
   * API refusal names what was wrong, and replacing it with a generic sentence throws
   * away the only actionable part), otherwise `messages.failure`.
   */
  run: <T>(action: () => Promise<T>, messages?: { success?: string; failure?: string }) => Promise<T | undefined>;
  /**
   * State a refusal the panel decided ITSELF, without running anything.
   *
   * A form that can reject its own input before a request (a budget of zero, a required
   * pick nobody made) still owes the person a sentence, and it must land in the same
   * place — and clear at the same moment — as one that came back from the API. Without
   * this a panel keeps a second error state beside this one, and the two take turns
   * showing stale messages.
   */
  fail: (message: string) => void;
  /** Drop both messages — e.g. when a form the message was about is dismissed. */
  clear: () => void;
}

export function usePanelTask(): PanelTask {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A panel row that closes while its call is in flight must not set state afterwards,
  // which is the React warning every hand-rolled copy produced. Set in the effect BODY
  // as well as its cleanup so a remount (StrictMode runs cleanup then effect) is live.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const clear = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const fail = useCallback((message: string) => {
    setNotice(null);
    setError(message);
  }, []);

  const run = useCallback(async <T,>(
    action: () => Promise<T>,
    messages: { success?: string; failure?: string } = {},
  ): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const value = await action();
      if (live.current && messages.success) setNotice(messages.success);
      return value;
    } catch (failure) {
      if (live.current) {
        setError(failure instanceof Error && failure.message
          ? failure.message
          : messages.failure ?? null);
      }
      return undefined;
    } finally {
      if (live.current) setBusy(false);
    }
  }, []);

  // Memoized so a consumer can hold the whole task in a `useCallback` dependency list
  // without re-creating every callback on every render — `run` and `clear` are stable,
  // so only a real state change moves it.
  return useMemo(
    () => ({ busy, error, notice, run, fail, clear }),
    [busy, error, notice, run, fail, clear],
  );
}
