/**
 * JavaScript errors as `error` marks (PRD 33 §8 S2).
 *
 * `window` `error` and `unhandledrejection`. The mark's `label` is the
 * message (≤120 chars); its `key` is a fingerprint of the first stack frame
 * plus the message with digits removed, so "Cannot read 'x' of undefined at
 * row 17" and "… at row 18" from the same line are one issue.
 */

import { REPLAY_STRING_LIMITS, fnv1a64, type ReplayMark } from '@builderforce/interaction-contract';

/** The first frame of a V8 (`at …`) or Firefox/Safari (`fn@url:line:col`) stack, query strings removed. */
export function firstFrame(stack: string | undefined | null): string {
  if (!stack) return '';
  for (const line of stack.split('\n')) {
    const trimmed = line.trim();
    if (!/:\d+/.test(trimmed)) continue;
    if (!(trimmed.startsWith('at ') || trimmed.includes('@'))) continue;
    return trimmed.replace(/\?[^\s:)]*/g, '').slice(0, 300);
  }
  return '';
}

export function errorFingerprint(message: string, stack?: string | null): string {
  return fnv1a64(`${firstFrame(stack)}|${message.replace(/\d+/g, '')}`);
}

export function errorMark(message: string, stack: string | null | undefined, atMs: number): ReplayMark {
  const text = (message || 'Error').trim();
  return {
    kind: 'error',
    key: errorFingerprint(text, stack),
    label: text.slice(0, REPLAY_STRING_LIMITS.markLabel),
    atMs,
  };
}

function reasonText(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: reason.message || reason.name, stack: reason.stack };
  if (typeof reason === 'string') return { message: reason };
  try {
    return { message: JSON.stringify(reason) ?? String(reason) };
  } catch {
    return { message: String(reason) };
  }
}

/** Listen for page errors; returns the unsubscribe. */
export function watchErrors(onError: (message: string, stack?: string) => void): () => void {
  const onWindowError = (ev: ErrorEvent) => {
    const err = ev.error instanceof Error ? ev.error : null;
    onError(ev.message || (err ? err.message : 'Error'), err?.stack);
  };
  const onRejection = (ev: PromiseRejectionEvent) => {
    const { message, stack } = reasonText(ev.reason);
    onError(message, stack);
  };
  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
