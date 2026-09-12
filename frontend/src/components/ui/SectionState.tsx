'use client';

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
 * `Missing or malformed Authorization header` in exactly that box. What it
 * shows instead is `GuestAccountPrompt` — the invitation, standing where the
 * rows would have been. The recognition lives in `isSignedOutFailure` so no
 * call site can forget it — see apiClient.
 */

import type { CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { isSignedOutFailure } from '@/lib/apiClient';
import { useErrorMessage } from '@/i18n/useErrorMessage';

/**
 * Off the first paint: this module sits in the root layout's static closure,
 * and the invitation is needed only by a guest whose read was refused. Same
 * cut `AppShell` makes for its own copy, for the same `check:root-closure` reason.
 */
const GuestAccountPrompt = dynamic(
  () => import('@/components/guest/GuestAccountPrompt').then((module) => module.GuestAccountPrompt),
  { ssr: false },
);

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
 * The failure, if there is one worth showing. Renders nothing for `null`, and
 * for a signed-out rejection renders the invitation to take an account where
 * the rows would have been, so a caller can mount it unconditionally.
 */
export function SectionError({ error }: { error: unknown }) {
  const errorMessage = useErrorMessage();
  if (isSignedOutFailure(error)) return <GuestAccountPrompt />;
  const message = errorMessage(error);
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
