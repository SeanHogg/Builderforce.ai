'use client';

/**
 * useCopyToClipboard — the ONE clipboard write.
 *
 * `navigator.clipboard.writeText` + an idle→copied→idle feedback state + a reset timeout
 * was inlined at a dozen call sites, each with its own timeout length, its own state enum
 * and its own (usually absent) handling of a denied clipboard. This owns all of it.
 *
 * Presentation deliberately stays with the caller: these sites are a button, an icon
 * inside a field, a link, a toast trigger. Forcing one component on all of them would
 * change UX that is fine as it is — so the LOGIC is shared here, and
 * {@link CopyButton} is the standard button built on top for the common case.
 *
 * Clipboard access needs a secure context and can be refused by permission policy, so
 * `error` is a real state that callers can surface rather than a silent no-op.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type CopyState = 'idle' | 'copied' | 'error';

/**
 * The clipboard write itself — no React. Resolves `true` on success, `false` when the
 * clipboard is unavailable or refused; never throws, so a caller can branch on the
 * result instead of wrapping every call in its own try/catch.
 *
 * Exported because not every caller can use the hook: `ErrorBoundary` is a class
 * component, where hooks are illegal. Sharing at this level means all call sites —
 * hook-based or not — go through ONE implementation.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export interface UseCopyToClipboard {
  state: CopyState;
  /** Write `text` (or the value returned by a function/promise) to the clipboard. */
  copy: (text: string | (() => string | Promise<string>)) => Promise<boolean>;
  /** True while the confirmation is showing. */
  copied: boolean;
}

export function useCopyToClipboard(feedbackMs = 2000): UseCopyToClipboard {
  const [state, setState] = useState<CopyState>('idle');
  // Cleared on unmount: several call sites live in panels/drawers a user closes well
  // inside the feedback window, and a setState after unmount is a React warning at best.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback(async (text: string | (() => string | Promise<string>)): Promise<boolean> => {
    let ok = false;
    try {
      // Accepting a thunk lets an expensive payload (a diagnostics dump) be built only on
      // the click rather than on every render of the surrounding component.
      const value = typeof text === 'function' ? await text() : text;
      ok = await copyTextToClipboard(value);
      setState(ok ? 'copied' : 'error');
    } catch {
      // Only a throwing thunk reaches here — copyTextToClipboard never throws.
      setState('error');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), feedbackMs);
    return ok;
  }, [feedbackMs]);

  return { state, copy, copied: state === 'copied' };
}
