import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { CompliancePage } from '@/components/legal/CompliancePage';
import { legalDocHref } from '@/lib/legalDocs';
import styles from './page.module.css';
import { Icon } from '@/components/ui/Icon';
import { surfaceClassName } from '@/components/ui/Surface';

/**
 * Route, glyph, and the catalog key its label comes from.
 *
 * The label reuses the SAME catalog key the shared chrome's sidebar renders —
 * `legal.nav.*` for the notices, `legal.termsTitle`/`legal.privacyTitle` for the
 * two published instruments — rather than a second copy of the words. Two lists
 * of the same page names is how "Cookie choices" and "Cookie policy" end up
 * naming one page in two places.
 */
const resources = [
  { href: legalDocHref('terms'), icon: '§', key: 'termsTitle', detail: 'terms' },
  { href: legalDocHref('privacy'), icon: '⚖', key: 'privacyTitle', detail: 'privacy' },
  { href: '/legal/privacy-rights', icon: '↗', key: 'nav.privacyRights', detail: 'privacyRights' },
  { href: '/legal/cookies', icon: '◌', key: 'nav.cookies', detail: 'cookies' },
  { href: '/legal/subprocessors', icon: '◇', key: 'nav.subprocessors', detail: 'subprocessors' },
  { href: '/legal/dpa', icon: '✓', key: 'nav.dpa', detail: 'dpa' },
  { href: '/legal/ai-transparency', icon: '✦', key: 'nav.aiTransparency', detail: 'aiTransparency' },
  { href: '/legal/accessibility', icon: '◎', key: 'nav.accessibility', detail: 'accessibility' },
] as const;

export default async function ComplianceCenter() {
  const t = await getTranslations('legal');
  return (
    <CompliancePage
      title={t('titles.compliance')}
      updated={null}
      eyebrow={t('center.eyebrow')}
      backHref="/"
      backLabel="BuilderForce.ai"
      currentHref="/legal/compliance"
    >
      <p className={styles.lead}>{t('center.lead')}</p>

      <nav className={styles.grid} aria-label={t('resourcesHeading')}>
        {resources.map((resource) => (
          <Link
            className={surfaceClassName({ tone: 'raised', padding: 'md', interactive: true }, styles.card)}
            href={resource.href}
            key={resource.href}
          >
            <span className={styles.icon} aria-hidden="true"><Icon source={resource.icon} size={22} /></span>
            <span className={styles.cardCopy}>
              <strong>{t(resource.key)}</strong>
              <span>{t(`center.details.${resource.detail}`)}</span>
            </span>
            <span className={styles.arrow} aria-hidden="true">→</span>
          </Link>
        ))}
      </nav>

      <div className={surfaceClassName({ tone: 'accent', padding: 'md' }, styles.assurance)}>
        <span className={styles.pulse} aria-hidden="true" />
        <p><strong>{t('center.assuranceLead')}</strong> {t('center.assuranceBody')}</p>
      </div>
    </CompliancePage>
  );
}
