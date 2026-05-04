import Link from 'next/link';
import type { ReactNode } from 'react';

export interface FeatureCardProps {
  href: string;
  title: string;
  description: ReactNode;
  icon: ReactNode;
  external?: boolean;
}

export default function FeatureCard({ href, title, description, icon, external }: FeatureCardProps) {
  const isExternal = external || href.startsWith('http');
  const inner = (
    <>
      <div className="cc-feature-icon">{icon}</div>
      <h3 className="cc-feature-title">{title}</h3>
      <p className="cc-feature-desc">{description}</p>
    </>
  );

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener" className="cc-feature-card">
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
