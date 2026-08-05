import Link from 'next/link';
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

const legalNavigation = [
  { href: '/legal/compliance', label: 'Overview' },
  { href: '/legal/privacy-rights', label: 'Privacy rights' },
  { href: '/legal/cookies', label: 'Cookie choices' },
  { href: '/legal/subprocessors', label: 'Subprocessors' },
  { href: '/legal/dpa', label: 'Data processing' },
  { href: '/legal/ai-transparency', label: 'AI transparency' },
  { href: '/legal/accessibility', label: 'Accessibility' },
];

export function CompliancePage({
  title,
  updated = 'August 4, 2026',
  eyebrow = 'Legal & compliance',
  backHref = '/legal/compliance',
  backLabel = 'Compliance center',
  currentHref,
  children,
}: CompliancePageProps) {
  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.backLink} href={backHref}>
            <span aria-hidden="true">←</span> {backLabel}
          </Link>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1>{title}</h1>
          {updated && (
            <p className={styles.updated}>
              <span className={styles.statusDot} aria-hidden="true" />
              Last updated <time>{updated}</time>
            </p>
          )}
        </header>

        <nav className={styles.localNav} aria-label="Legal and compliance pages">
          <p>Compliance resources</p>
          <div>
            {legalNavigation.map((item) => (
              <Link
                href={item.href}
                key={item.href}
                className={currentHref === item.href ? styles.activeNavLink : undefined}
                aria-current={currentHref === item.href ? 'page' : undefined}
              >
                {item.label}
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </nav>

        <article className={styles.document}>
          <div className={styles.content}>{children}</div>

          <footer className={styles.contact}>
            <div>
              <strong>Questions about this document?</strong>
              <span>Our privacy team can help with requests, contracts, and compliance details.</span>
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
