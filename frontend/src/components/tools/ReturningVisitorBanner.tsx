'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMarketingVisitor } from '@/lib/useMarketingVisitor';
import { ToolResultView } from '@/components/tools/ToolResultView';

/**
 * "Welcome back — here are your results" banner for the free Diagnostics & Tools
 * suite. Self-gating (returns null when the visitor is authed, still loading, or
 * has no prior anonymous runs), so consumers just drop it in — the returning-
 * visitor logic and its sign-up nudge live in exactly one place.
 *
 * - `toolId` set (tool runner): if the visitor already has a stored result for
 *   THIS tool, replay it with a targeted sign-up CTA.
 * - `toolId` omitted (tools hub): summarise how many diagnostics they've run and
 *   link back to each, with a sign-up CTA to save + track them.
 */
export function ReturningVisitorBanner({ toolId }: { toolId?: string }) {
  const t = useTranslations('tools');
  const { session, loading, isAuthed } = useMarketingVisitor();

  if (isAuthed || loading || !session?.session || session.runs.length === 0) return null;

  const bannerWrap: React.CSSProperties = {
    border: '1px solid var(--accent)', borderRadius: 12, padding: 18, marginBottom: 20,
    background: 'var(--bg-elevated)',
  };
  const cta: React.CSSProperties = {
    padding: '10px 20px', fontSize: 14, fontWeight: 700, borderRadius: 10, border: 'none',
    background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff',
    textDecoration: 'none', whiteSpace: 'nowrap', display: 'inline-block',
  };
  const eyebrow: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--coral-bright)', margin: 0,
  };

  // Per-tool replay (runner).
  if (toolId) {
    const prior = session.runs.find((r) => r.toolId === toolId);
    if (!prior) return null;
    return (
      <section style={bannerWrap}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <p style={eyebrow}>{t('welcomeBack')}</p>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '4px 0 0' }}>{t('welcomeBackTool')}</p>
          </div>
          <Link href={`/register?next=/tools/${toolId}`} style={cta}>{t('saveMyResult')} →</Link>
        </div>
        <ToolResultView result={prior.result} />
      </section>
    );
  }

  // Cross-tool summary (hub).
  return (
    <section style={bannerWrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p style={eyebrow}>{t('welcomeBack')}</p>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)', margin: '4px 0 2px' }}>
            {t('welcomeBackHub', { count: session.runs.length })}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {session.runs.map((r) => (
              <Link
                key={r.toolId}
                href={`/tools/${r.toolId}`}
                style={{
                  fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 999, textDecoration: 'none',
                  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', color: 'var(--accent)',
                }}
              >
                {r.name}{r.result.score != null ? ` · ${r.result.score.toFixed(1)}/5` : ''}
              </Link>
            ))}
          </div>
        </div>
        <Link href="/register?next=/tools" style={cta}>{t('saveMyResults')} →</Link>
      </div>
    </section>
  );
}
