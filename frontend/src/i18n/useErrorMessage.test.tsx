import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import de from '@/i18n/messages/de.json';
import { ApiRequestError } from '@/lib/apiClient';
import { ApiTransportError } from '@/lib/errors/transportFailure';
import { useErrorMessage, useErrorText } from './useErrorMessage';

// The REAL German catalog, so the assertions are about the copy a reader sees —
// the global mock would hand back the key and prove nothing about translation.
vi.mock('next-intl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-intl')>()),
  useTranslations: (await import('@/test/realCatalogTranslations')).realCatalogTranslator(
    (await import('@/i18n/messages/de.json')).default as Record<string, unknown>,
  ),
}));

describe('useErrorMessage', () => {
  it('quotes an error that carries its own message', () => {
    const { result } = renderHook(() => useErrorMessage());
    expect(result.current(new Error('Quota exceeded'))).toBe('Quota exceeded');
  });

  it('falls back to the translated common.actionFailed when the error says nothing', () => {
    const { result } = renderHook(() => useErrorMessage());
    expect(result.current('boom-string')).toBe(de.common.actionFailed);
    expect(result.current(new Error(''))).toBe(de.common.actionFailed);
  });

  it('says nothing for no error and for a signed-out read', () => {
    const { result } = renderHook(() => useErrorMessage());
    expect(result.current(null)).toBeNull();
    expect(result.current(new ApiRequestError('Unauthorized', 401, undefined, undefined, true))).toBeNull();
  });

  it('translates a transport failure instead of quoting its English diagnostic', () => {
    const { result } = renderHook(() => useErrorMessage());
    const failure = new ApiTransportError('offline', '/api/x', 'GET');
    expect(result.current(failure)).toBe(de.globalError.transport.offline);
    expect(result.current(failure)).not.toBe(failure.message);
  });
});

describe('useErrorText', () => {
  it('uses the empty string where useErrorMessage says null', () => {
    const { result } = renderHook(() => useErrorText());
    expect(result.current(null)).toBe('');
    expect(result.current(new Error('Nope'))).toBe('Nope');
  });
});
