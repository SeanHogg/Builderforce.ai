import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import styles from './CompliancePage.module.css';

type CompliancePageProps = {
  title: string;
  updated?: string | null;
  eyebrow?: string;
  backHref?: string;
  backLabel?: string;
  currentHref?: string;
  children: React.ReactNode;
};

/** Route → catalog key. The LABEL is translated; the path never is. */
const legalNavigation = [
  { href: '/legal/compliance', key: 'overview' },
  { href: '/legal/privacy-rights', key: 'privacyRights' },
  { href: '/legal/cookies', key: 'cookies' },
  { href: '/legal/subprocessors', key: 'subprocessors' },
  { href: '/legal/dpa', key: 'dpa' },
  { href: '/legal/ai-transparency', key: 'aiTransparency' },
  { href: '/legal/accessibility', key: 'accessibility' },
] as const;

/**
 * Shared chrome for the seven /legal pages.
 *
 * The chrome is fully translated. The DOCUMENT BODY each page passes as
 * `children` is deliberately not: these are binding instruments — a DPA, a
 * privacy-rights notice, a subprocessor list — and a machine translation of a
 * contractual term is a liability, not a feature. The standard practice is one
 * authoritative language plus a notice saying so, and `authoritativeNotice`
 * below is that notice, itself translated so a reader in every locale can
 * understand which version governs.
 */
export async function CompliancePage({
  title,
  updated = 'August 4, 2026',
  eyebrow,
  backHref = '/legal/compliance',
  backLabel,
  currentHref,
  children,
}: CompliancePageProps) {
  const t = await getTranslations('legal');

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.backLink} href={backHref}>
            <span aria-hidden="true">←</span> {backLabel ?? t('backToCenter')}
          </Link>
          <p className={styles.eyebrow}>{eyebrow ?? t('eyebrow')}</p>
          <h1>{title}</h1>
          {updated && (
            <p className={styles.updated}>
              <span className={styles.statusDot} aria-hidden="true" />
              {t('lastUpdated')} <time>{updated}</time>
            </p>
          )}
        </header>

        <nav className={styles.localNav} aria-label={t('navLabel')}>
          <p>{t('resourcesHeading')}</p>
          <div>
            {legalNavigation.map((item) => (
              <Link
                href={item.href}
                key={item.href}
                className={currentHref === item.href ? styles.activeNavLink : undefined}
                aria-current={currentHref === item.href ? 'page' : undefined}
              >
                {t(`nav.${item.key}`)}
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </nav>

        <article className={styles.document}>
          <p className={styles.authoritative}>{t('authoritativeNotice')}</p>

          <div className={styles.content}>{children}</div>

          <footer className={styles.contact}>
            <div>
              <strong>{t('contactHeading')}</strong>
              <span>{t('contactBody')}</span>
            </div>
            <a href="mailto:privacy@builderforce.ai">privacy@builderforce.ai</a>
            <p>Fix Faster LLC dba BuilderForce.ai · 6513 Basswood Dr., Troy, MI 48098</p>
          </footer>
        </article>
      </div>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function LegalCallout({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <aside className={styles.callout}>
      <span aria-hidden="true">✓</span>
      <div><strong>{label}</strong><p>{children}</p></div>
    </aside>
  );
}

export function LegalChecklist({ items }: { items: string[] }) {
  return (
    <ul className={styles.checklist}>
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}
