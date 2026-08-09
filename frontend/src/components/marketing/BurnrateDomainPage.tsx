'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import type { BurnrateDomain } from '@/lib/burnrateCatalog';
import { Icon } from '@/components/ui/Icon';

export interface BurnrateDomainCopy {
  title: string;
  tagline: string;
  description: string;
  hero: string;
  features: Array<{ title: string; description: string }>;
}

export interface BurnrateSharedCopy {
  builtFor: string;
  poweredBy: string;
  publicCta: string;
  publicSecondaryCta: string;
  authenticatedCta: string;
  authenticatedEyebrow: string;
  featureHeading: string;
  publicClosing: string;
  authenticatedClosing: string;
}

export default function BurnrateDomainPage({
  domain,
  copy,
  shared,
}: {
  domain: BurnrateDomain;
  copy: BurnrateDomainCopy;
  shared: BurnrateSharedCopy;
}) {
  const { isAuthenticated } = useAuth();
  const primaryHref = isAuthenticated ? domain.workspaceHref : '/register';

  return (
    <main className="br-domain-page">
      <section className="br-domain-hero">
        <div className="br-domain-hero__copy">
          <div className="br-domain-badges">
            <span>{shared.builtFor.replace('{persona}', domain.persona)}</span>
            <span>{shared.poweredBy}</span>
          </div>
          <p className="br-domain-kicker">{isAuthenticated ? shared.authenticatedEyebrow : copy.tagline}</p>
          <h1>{copy.title}</h1>
          <h2>{copy.hero}</h2>
          <p className="br-domain-lede">{copy.description}</p>
          <div className="br-domain-actions">
            <Link href={primaryHref} className="br-domain-primary">
              {isAuthenticated ? shared.authenticatedCta : shared.publicCta} <span aria-hidden="true">→</span>
            </Link>
            {!isAuthenticated && <Link href="/book-demo" className="br-domain-secondary">{shared.publicSecondaryCta}</Link>}
          </div>
        </div>
        <div className="br-domain-visual" aria-hidden="true">
          <span className="br-domain-visual__icon"><Icon source={domain.icon} size={44} /></span>
          <strong>{domain.persona}</strong>
          <span>{copy.tagline}</span>
          <div className="br-domain-signal-grid">
            {copy.features.slice(0, 4).map((feature, index) => <i key={feature.title} style={{ '--signal-index': index } as React.CSSProperties} />)}
          </div>
        </div>
      </section>

      <section className="br-domain-features">
        <p className="br-domain-kicker">{shared.featureHeading}</p>
        <div className="br-domain-grid">
          {copy.features.map((feature, index) => (
            <article key={feature.title} className="br-domain-card">
              <span className="br-domain-card__number">{String(index + 1).padStart(2, '0')}</span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="br-domain-closing">
        <p>{isAuthenticated ? shared.authenticatedClosing : shared.publicClosing}</p>
        <Link href={primaryHref} className="br-domain-primary">{isAuthenticated ? shared.authenticatedCta : shared.publicCta} →</Link>
      </section>
    </main>
  );
}
