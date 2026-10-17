/** @vitest-environment jsdom */
// `whenDocumentVisible` parks on the document's visibility, so this suite needs a document.
import { afterEach, describe, expect, it } from 'vitest';
import { backoffDelay, MAX_BACKOFF_FACTOR, whenDocumentVisible } from './pollPolicy';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('pollPolicy', () => {
  afterEach(() => setVisibility('visible'));

  it('doubles a failed wait up to the ceiling', () => {
    expect(backoffDelay(1_000, 1_000)).toBe(2_000);
    expect(backoffDelay(6_000, 1_000)).toBe(MAX_BACKOFF_FACTOR * 1_000);
  });

  it('resolves at once while visible', async () => {
    await expect(whenDocumentVisible()).resolves.toBeUndefined();
  });

  it('parks while hidden and resolves on return', async () => {
    setVisibility('hidden');
    let resolved = false;
    const waiting = whenDocumentVisible().then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    setVisibility('visible');
    await waiting;
    expect(resolved).toBe(true);
  });

  it('rejects when aborted while parked', async () => {
    setVisibility('hidden');
    const controller = new AbortController();
    const waiting = whenDocumentVisible(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });
});
