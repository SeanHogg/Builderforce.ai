import Link from 'next/link';
import { useTranslations } from 'next-intl';

/**
 * The "you are talking to AI agents" disclosure every Brain conversation carries.
 *
 * Two presentations of the same notice:
 *   - `banner` — the full paragraph across the top of the conversation (the
 *     full-page Brain, where there is room for it).
 *   - `footnote` — one muted line UNDER the composer, the way chat products state it.
 *     In a ~340px docked column the banner wrapped to four lines and sat between the
 *     header and the thread on every visit; the footnote keeps the notice (and the
 *     link to the full explanation) without spending the reading height on it. The
 *     full wording rides along as the tooltip.
 */
export function AiDisclosure({ variant }: { variant: 'banner' | 'footnote' }) {
  const t = useTranslations('brain');
  const link = <Link href="/legal/ai-transparency" style={{ color: 'inherit', textDecoration: 'underline' }}>{t('aiDisclosureLink')}</Link>;

  if (variant === 'footnote') {
    return (
      <p
        aria-label={t('aiDisclosureAria')}
        title={t('aiDisclosureBody')}
        style={{ margin: '4px 2px 0', fontSize: 'var(--font-size-eyebrow)', lineHeight: 1.4, color: 'var(--text-muted)', textAlign: 'center', overflowWrap: 'anywhere' }}
      >
        {t('aiDisclosureShort')} {link}
      </p>
    );
  }

  return (
    <aside aria-label={t('aiDisclosureAria')} style={{ flexShrink: 0, padding: '7px 12px', fontSize: 'var(--font-size-eyebrow)', lineHeight: 1.45, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
      {t('aiDisclosureBody')}{' '}{link}.
    </aside>
  );
}
