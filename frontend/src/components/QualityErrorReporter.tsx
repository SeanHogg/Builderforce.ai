'use client';

/**
 * Dogfood: report the web app's OWN browser errors to the Builderforce Product
 * Quality pillar via the published @seanhogg/builderforce-quality SDK — the exact
 * keyed ingest path a customer uses. `init()` hooks window.onerror +
 * unhandledrejection and batches events to /api/quality-ingest/events.
 *
 * The ingest key (a public bfq_ source key — safe to expose to the browser) is
 * read server-side from NEXT_BUILDERFORCE_ERROR_API_KEY in the root layout and
 * passed down; this island only calls init once on mount. Renders nothing.
 */

import { useEffect } from 'react';
import { init, type QualityClient } from '@seanhogg/builderforce-quality';
import { API_ERROR_EVENT, type ApiErrorEvent } from '@/lib/errors/apiErrorEvent';
import { reportProductApiError } from '@/lib/reportError';

interface Props {
  apiKey: string;
  endpoint: string;
  environment: string;
  release?: string;
}

export function QualityErrorReporter({ apiKey, endpoint, environment, release }: Props) {
  useEffect(() => {
    let client: QualityClient | null = null;
    if (apiKey) client = init({ key: apiKey, endpoint, environment, release });
    const persist = (input: Parameters<typeof reportProductApiError>[0]) => {
      void reportProductApiError(input, endpoint).catch(() => { /* reporting failures must never disrupt the app */ });
    };
    const captureApiError = (event: Event) => {
      const error = (event as CustomEvent<ApiErrorEvent>).detail;
      persist({
        title: `${error.status}${error.code ? ` ${error.code}` : ''}`,
        message: error.message,
        url: error.url,
        level: 'error',
        context: {
          method: error.method,
          status: error.status,
          requestId: error.requestId,
          details: error.details,
          page: window.location.href,
        },
      });
    };
    // The SDK handles browser exceptions when its optional source key exists.
    // The product endpoint is the keyless fallback used in local development.
    const captureBrowserError = (event: ErrorEvent) => persist({
      title: event.error instanceof Error ? event.error.name : 'BrowserError',
      message: event.message || 'Unknown browser error',
      url: event.filename || window.location.href,
      level: 'error',
      context: { stack: event.error instanceof Error ? event.error.stack : undefined },
    });
    const captureRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason ?? 'Unhandled promise rejection'));
      persist({
        title: reason.name,
        message: reason.message,
        url: window.location.href,
        level: 'error',
        context: { stack: reason.stack },
      });
    };
    window.addEventListener(API_ERROR_EVENT, captureApiError);
    if (!client) {
      window.addEventListener('error', captureBrowserError);
      window.addEventListener('unhandledrejection', captureRejection);
    }
    return () => {
      window.removeEventListener(API_ERROR_EVENT, captureApiError);
      window.removeEventListener('error', captureBrowserError);
      window.removeEventListener('unhandledrejection', captureRejection);
      client?.close();
    };
  }, [apiKey, endpoint, environment, release]);

  return null;
}
