import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { CompliancePage } from '@/components/legal/CompliancePage';
import styles from './page.module.css';

/**
 * Route, glyph, and the catalog key its label comes from.
 *
 * The label reuses `legal.nav.*` — the same seven names the shared chrome's
 * sidebar renders — rather than a second copy of the words. Two lists of the
 * same page names is how "Cookie choices" and "Cookie policy" end up naming one
 * page in two places.
 */
const resources = [
  { href: '/legal/privacy-rights', icon: '↗', key: 'privacyRights' },
  { href: '/legal/cookies', icon: '◌', key: 'cookies' },
  { href: '/legal/subprocessors', icon: '◇', key: 'subprocessors' },
  { href: '/legal/dpa', icon: '✓', key: 'dpa' },
  { href: '/legal/ai-transparency', icon: '✦', key: 'aiTransparency' },
  { href: '/legal/accessibility', icon: '◎', key: 'accessibility' },
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
          <Link className={styles.card} href={resource.href} key={resource.href}>
            <span className={styles.icon} aria-hidden="true">{resource.icon}</span>
            <span className={styles.cardCopy}>
              <strong>{t(`nav.${resource.key}`)}</strong>
              <span>{t(`center.details.${resource.key}`)}</span>
            </span>
            <span className={styles.arrow} aria-hidden="true">→</span>
          </Link>
        ))}
      </nav>

      <div className={styles.assurance}>
        <span className={styles.pulse} aria-hidden="true" />
        <p><strong>{t('center.assuranceLead')}</strong> {t('center.assuranceBody')}</p>
      </div>
    </CompliancePage>
  );
}
