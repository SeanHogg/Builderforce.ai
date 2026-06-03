import Link from 'next/link';
import type { ReactNode } from 'react';

export interface FeatureCardProps {
  href: string;
  title: string;
  description: ReactNode;
  icon: ReactNode;
}

/**
 * Decides its own link rendering based on the href:
 *   - http(s):// — external (new tab, plain <a>)
 *   - /docs/*   — served by a separate Cloudflare deployment (Astro Starlight),
 *                 so Next.js cannot prefetch it. Use a plain same-tab <a>.
 *   - else      — Next.js internal route via <Link>.
 *
 * Consumers don't pass any `external` / `prefetch` flag — the component
 * derives the right rendering from the path itself.
 */
export default function FeatureCard({ href, title, description, icon }: FeatureCardProps) {
  const inner = (
    <>
      <div className="cc-feature-icon">{icon}</div>
      <h3 className="cc-feature-title">{title}</h3>
      <p className="cc-feature-desc">{description}</p>
    </>
  );

  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener" className="cc-feature-card">
        {inner}
      </a>
    );
  }
  if (href.startsWith('/docs')) {
    return (
      <a href={href} className="cc-feature-card">
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className="cc-feature-card">
      {inner}
    </Link>
  );
}
