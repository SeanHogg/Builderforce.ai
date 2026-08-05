import Link from 'next/link';

export function CompliancePage({ title, updated = 'August 4, 2026', children }: { title: string; updated?: string; children: React.ReactNode }) {
  return (
    <article style={{ maxWidth: 900, margin: '0 auto', padding: '64px 24px', lineHeight: 1.65 }}>
      <p><Link href="/legal/compliance">← Compliance center</Link></p>
      <h1>{title}</h1><p>Last updated: {updated}</p>{children}
      <hr /><p>Fix Faster LLC dba BuilderForce.ai · 6513 Basswood Dr., Troy, MI 48098 · <a href="mailto:privacy@builderforce.ai">privacy@builderforce.ai</a></p>
    </article>
  );
}
