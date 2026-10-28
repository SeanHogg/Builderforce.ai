/**
 * What is the WEB's own in the shared browser host (`@builderforce/knowledge-browser`):
 * its root-id prefix and where a degraded knowledge path is reported (the product
 * Quality feed). Everything else — the source, the worker review, the manifest, the
 * upload — is the package's.
 */

import { hostRootId, type KnowledgeDegradedReporter } from '@builderforce/knowledge-browser';
import { reportBackgroundFailure } from '@/lib/reportError';

/** The web host's root-id prefix (`web:<kind>:…`). */
export const WEB_HOST = 'web';

/** `web:<kind>:<…parts>` — the host prefix of a web-reviewed root (`knowledge_scopes.root_id`). */
export function webRootId(kind: 'vfs' | 'upload' | 'drive', ...parts: Array<string | number>): string {
  return hostRootId(WEB_HOST, kind, ...parts);
}

/**
 * A knowledge path that degrades instead of failing (no drive listing, no IndexedDB, a
 * live refresh that missed) still says so — once, to the product Quality feed — and the
 * caller carries on with its stated fallback.
 */
export const reportKnowledgeDegraded: KnowledgeDegradedReporter = (what, error, context = {}) => {
  void reportBackgroundFailure({
    message: `knowledge: ${what}: ${error instanceof Error ? error.message : String(error)}`,
    level: 'warning',
    context: { area: 'knowledge-graph', ...context },
  });
};
