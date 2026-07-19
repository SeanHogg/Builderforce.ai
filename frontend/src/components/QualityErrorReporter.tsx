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
import { init } from '@seanhogg/builderforce-quality';

interface Props {
  apiKey: string;
  endpoint: string;
  environment: string;
  release?: string;
}

export function QualityErrorReporter({ apiKey, endpoint, environment, release }: Props) {
  useEffect(() => {
    if (!apiKey) return;
    init({ key: apiKey, endpoint, environment, release });
  }, [apiKey, endpoint, environment, release]);

  return null;
}
