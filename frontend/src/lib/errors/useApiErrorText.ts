'use client';

/**
 * How an API-error event reads to a PERSON.
 *
 * `ApiErrorEvent` is a diagnostic record — a status, a machine code, and whatever
 * the server said, none of it translated and none of it meant for a human. Every
 * surface that shows one has to decide the same two things: what to call it, and
 * what sentence to put under it. This is that decision, once.
 *
 * The case it exists for is a request that never reached a server
 * ({@link TRANSPORT_FAILURE_STATUS}). "0" is not a status anybody recognises, and
 * the browser's own console blames CORS for a failure that is almost never about
 * CORS — so a transport failure gets a real name and a translated explanation of
 * what the person can actually do about it, instead of leaking the reason slug.
 */
import { useTranslations } from 'next-intl';
import type { ApiErrorEvent } from './apiErrorEvent';
import { TRANSPORT_FAILURE_STATUS, type TransportFailureReason } from './transportFailure';

const TRANSPORT_REASONS: readonly TransportFailureReason[] = ['offline', 'aborted', 'unreachable'];

function isTransportFailure(event: Pick<ApiErrorEvent, 'status'>): boolean {
  return event.status === TRANSPORT_FAILURE_STATUS;
}

/** An unrecognised code still gets a sentence — never a raw slug on screen. */
function reasonOf(event: Pick<ApiErrorEvent, 'code'>): TransportFailureReason {
  const code = event.code as TransportFailureReason | undefined;
  return code && TRANSPORT_REASONS.includes(code) ? code : 'unreachable';
}

export interface ApiErrorText {
  /** Short label for the header row and the support-ticket status line. */
  title: (event: Pick<ApiErrorEvent, 'status' | 'code'>) => string;
  /** The sentence shown to the person. */
  message: (event: Pick<ApiErrorEvent, 'status' | 'code' | 'message'>) => string;
}

export function useApiErrorText(): ApiErrorText {
  const t = useTranslations('globalError');
  return {
    title: (event) =>
      isTransportFailure(event)
        ? t('transport.title')
        : `${event.status}${event.code ? ` ${event.code}` : ''}`,
    message: (event) =>
      isTransportFailure(event) ? t(`transport.${reasonOf(event)}`) : event.message,
  };
}
