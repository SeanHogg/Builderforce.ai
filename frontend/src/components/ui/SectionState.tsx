/**
 * The three answers a data section gives before it has rows: loading, failed,
 * empty.
 *
 * It exists because those three were written twice, verbatim, in the two halves
 * of Reliability — `Loader`/`ErrorCard`/`EmptyCard` in `IncidentsPageClient` and
 * again in `MonitoringSections` — and the copies had already drifted: one painted
 * its failure with `--danger`, the other with `--error`/`--error-text`. Two
 * tokens for one state on two tabs of one page is exactly the drift a primitive
 * removes, and there is nothing about any of the three that belongs to incidents
 * rather than to any other section that fetches rows.
 *
 * `SectionError` decides its OWN visibility, which is the part that matters:
 * a rejection that only means "nobody is signed in" is not a failure and must
 * not paint a red box. A guest reading the sample workspace met
 * `Missing or malformed Authorization header` in exactly that box. The rule
 * lives in `faultMessage` so no call site can forget it — see apiClient.
 */

import type { CSSProperties } from 'react';
import { faultMessage } from '@/lib/apiClient';

/**
 * What a card inside a data section looks like.
 *
 * ONE object, because these four declarations were the `const card` at the top
 * of both Reliability modules and are spread into every row, form and state
 * they render. It lives beside the three states rather than in a stylesheet
 * because its consumers COMPOSE it — `{ ...SECTION_CARD, borderColor: … }` at
 * two dozen call sites — and a class cannot be spread.
 */
export const SECTION_CARD: CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

export function SectionLoading({ label }: { label: string }) {
  return <div style={{ ...SECTION_CARD, color: 'var(--text-muted)' }}>{label}</div>;
}

/**
 * The failure, if there is one worth showing. Renders nothing for `null` and
 * nothing for a signed-out rejection, so a caller can mount it unconditionally.
 */
export function SectionError({ error }: { error: unknown }) {
  const message = faultMessage(error);
  if (!message) return null;
  return (
    <div style={{ ...SECTION_CARD, borderColor: 'var(--error)', color: 'var(--error-text)' }} role="alert">
      {message}
    </div>
  );
}

export function SectionEmpty({ message }: { message: string }) {
  return (
    <div style={{ ...SECTION_CARD, color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>
      {message}
    </div>
  );
}
