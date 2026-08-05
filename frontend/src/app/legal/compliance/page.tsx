import Link from 'next/link';
import { CompliancePage } from '@/components/legal/CompliancePage';
import styles from './page.module.css';

const resources = [
  { href: '/legal/privacy-rights', icon: '↗', title: 'Privacy rights', detail: 'Requests, deletion, appeals, and human review' },
  { href: '/legal/cookies', icon: '◌', title: 'Cookie choices', detail: 'Consent, optional analytics, and Global Privacy Control' },
  { href: '/legal/subprocessors', icon: '◇', title: 'Subprocessors', detail: 'Service providers, data use, and transfer safeguards' },
  { href: '/legal/dpa', icon: '✓', title: 'Data processing addendum', detail: 'Customer instructions, security, and audit terms' },
  { href: '/legal/ai-transparency', icon: '✦', title: 'AI transparency', detail: 'Agent behavior, user control, and consequential decisions' },
  { href: '/legal/accessibility', icon: '◎', title: 'Accessibility', detail: 'Our WCAG commitment, feedback, and accommodations' },
];

export default function ComplianceCenter() {
  return (
    <CompliancePage
      title="Trust & compliance center"
      updated={null}
      eyebrow="BuilderForce trust center"
      backHref="/"
      backLabel="BuilderForce.ai"
      currentHref="/legal/compliance"
    >
      <p className={styles.lead}>
        BuilderForce.ai is operated by Fix Faster LLC, a Michigan limited liability company. These public controls supplement our Terms and Privacy Policy.
      </p>

      <nav className={styles.grid} aria-label="Compliance resources">
        {resources.map((resource) => (
          <Link className={styles.card} href={resource.href} key={resource.href}>
            <span className={styles.icon} aria-hidden="true">{resource.icon}</span>
            <span className={styles.cardCopy}>
              <strong>{resource.title}</strong>
              <span>{resource.detail}</span>
            </span>
            <span className={styles.arrow} aria-hidden="true">→</span>
          </Link>
        ))}
      </nav>

      <div className={styles.assurance}>
        <span className={styles.pulse} aria-hidden="true" />
        <p><strong>Controls are continuously reviewed.</strong> Security, privacy, AI, minor-safety, breach-response, impact-assessment, retention, and accessibility controls are tested by our Compliance Audit Agent against the source repository.</p>
      </div>
    </CompliancePage>
  );
}
