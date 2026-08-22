'use client';

/**
 * "You are looking at sample data" — said once, in the shell, for every surface.
 *
 * ── WHY IT IS NOT A PROP ON EACH PAGE ────────────────────────────────────────
 * Seventy-eight surfaces render for a signed-out visitor now, and the sample
 * workspace is what fills them. If each page had to remember to say so, the
 * question would be answered seventy-eight times and some of those answers would
 * be wrong — and a surface that shows invented numbers WITHOUT saying they are
 * invented is not a demo, it is a false statement about somebody's business. So
 * the notice decides its own visibility from {@link useSampleWorkspace} and is
 * mounted once by `AppShell`: there is no way to add a surface that forgets, and
 * no way for it to appear over real rows.
 *
 * ── WHY IT IS NOT DISMISSIBLE ────────────────────────────────────────────────
 * A dismissible label is a label that is absent exactly when somebody has been
 * looking long enough to believe it. It stays for the whole visit, and it says
 * what replaces it — "your workspace" — because the useful half of the sentence
 * is the offer, not the disclaimer.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { useSampleWorkspace } from '@/domains/guest/presentation/useSampleWorkspace';

const bar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  padding: '8px clamp(12px, 3vw, 20px)',
  background: 'var(--bg-elevated)',
  borderBottom: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-small)',
  lineHeight: 1.45,
};

const markStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 8px',
  borderRadius: 'var(--radius-full)',
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const linkStyle: React.CSSProperties = {
  color: 'var(--accent)',
  fontWeight: 600,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
};

export function SampleDataNotice() {
  const { isSample } = useSampleWorkspace();
  const t = useTranslations('guest');
  if (!isSample) return null;

  return (
    <div style={bar} role="status">
      <span style={markStyle}>
        <Icon source="sparkles" size={13} />
        {t('sample.badge')}
      </span>
      <span style={{ flex: '1 1 220px', minWidth: 0 }}>{t('sample.body')}</span>
      <Link href="/register" style={linkStyle}>
        {t('sample.cta')} →
      </Link>
    </div>
  );
}
