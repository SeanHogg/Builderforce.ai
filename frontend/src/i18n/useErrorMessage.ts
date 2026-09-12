'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { faultMessage } from '@/lib/apiClient';
import { ApiTransportError } from '@/lib/errors/transportFailure';

/**
 * The message a surface SHOWS for a caught rejection, in the reader's language.
 *
 * `faultMessage(e, 'Create failed')` was written at 138 call sites, each with its own
 * English fallback — so a rejection that carried no message of its own (a thrown
 * string, an `Error('')`, a non-Error value) reached a German reader as "Create
 * failed". The fallback is only ever reached when the error says nothing, so it
 * never needed to be specific: it needed to be TRANSLATED. This is that one
 * fallback, `common.actionFailed`, and `check:error-fallbacks` keeps a literal from
 * coming back beside a `faultMessage`/`faultText` call or an `instanceof Error`
 * ternary.
 *
 * It also owns the one error whose own message is English BY DESIGN: an
 * {@link ApiTransportError} carries the diagnostic sentence the Quality feed files
 * (see `describeTransportFailure`), and a surface quoting `error.message` put that
 * engineer-facing text in front of a person. Here it reads as the localized
 * `globalError.transport.<reason>` the toast already uses.
 *
 * Same contract as {@link faultMessage}: `null` when there is nothing to report
 * (no error, or just "you are not signed in"), so `setError(errorMessage(e))`
 * leaves every `{error && …}` reading correctly.
 *
 * @example
 *   const errorMessage = useErrorMessage();
 *   try { await save(); } catch (e) { setError(errorMessage(e)); }
 */
export function useErrorMessage(): (error: unknown) => string | null {
  const t = useTranslations();
  return useCallback((error: unknown) => {
    if (error instanceof ApiTransportError) return t(`globalError.transport.${error.reason}`);
    return faultMessage(error, t('common.actionFailed'));
  }, [t]);
}

/**
 * {@link useErrorMessage} for a surface whose "nothing to report" is the empty string
 * (a `useState('')` notice, a status line) — the `faultText` twin, so those surfaces
 * keep their own sentinel instead of spelling `?? ''` beside every call.
 */
export function useErrorText(): (error: unknown) => string {
  const errorMessage = useErrorMessage();
  return useCallback((error: unknown) => errorMessage(error) ?? '', [errorMessage]);
}
