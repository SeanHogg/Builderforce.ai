'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toolsApi } from '@/lib/builderforceApi';
import { ToolResultView } from '@/components/tools/ToolResultView';
import { getStoredTenantToken } from '@/lib/auth';
import type { ToolSummary, ToolCategory, TenantDiagnosticsRollup } from '@/lib/tools';

const wrap: React.CSSProperties = { maxWidth: 980, margin: '0 auto', padding: '32px 20px' };
const cardLink: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: 18, textDecoration: 'none',
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12,
  color: 'inherit', transition: 'border-color .15s',
};

const CATEGORY_ORDER: ToolCategory[] = ['delivery', 'finops', 'governance', 'quality'];

export default function ToolsHubClient() {
  const t = useTranslations('tools');
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [rollup, setRollup] = useState<TenantDiagnosticsRollup | null>(null);

  useEffect(() => {
    toolsApi.list()
      .then(setTools)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
    // Workspace rating (project diagnostics rolled up) — best-effort, manager+ only.
    if (getStoredTenantToken()) {
      toolsApi.rollup().then(setRollup).catch(() => setRollup(null));
    }
  }, []);

  const categoryLabel = (c: ToolCategory) => t(`category.${c}`);
  // agentic-maturity is featured above, so keep it out of the category grid.
  const gridTools = tools.filter((tool) => tool.id !== 'agentic-maturity');

  return (
    <div style={wrap}>
      <header style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--coral-bright)', margin: 0 }}>
          {t('hubEyebrow')}
        </p>
        <h1 style={{ fontSize: 30, fontWeight: 800, color: 'var(--text-strong)', margin: '8px 0' }}>{t('hubTitle')}</h1>
        <p style={{ fontSize: 15, color: 'var(--text-secondary)', maxWidth: 680 }}>{t('hubIntro')}</p>
      </header>

      {/* Workspace rating — project diagnostics rolled up to the tenant. */}
      {rollup && rollup.projects.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--muted)', margin: '0 0 4px' }}>
            {t('rollupTitle')}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>{t('rollupDesc')}</p>
          <ToolResultView result={rollup.result} />
        </section>
      )}

      {/* Featured: the full maturity diagnostic */}
      <Link href="/tools/agentic-maturity" style={{ ...cardLink, marginBottom: 24, background: 'var(--bg-elevated)', borderColor: 'var(--accent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>📈</span>
          <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-strong)' }}>{t('featuredTitle')}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{t('open')} →</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{t('featuredDesc')}</p>
      </Link>

      {error && <div style={{ color: 'var(--error-text)', marginBottom: 16 }}>{error}</div>}
      {!loaded ? (
        <div style={{ color: 'var(--muted)' }}>{t('loading')}</div>
      ) : (
        CATEGORY_ORDER.filter((c) => gridTools.some((tool) => tool.category === c)).map((cat) => (
          <section key={cat} style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--muted)', margin: '0 0 12px' }}>
              {categoryLabel(cat)}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
              {gridTools.filter((tool) => tool.category === cat).map((tool) => (
                <Link key={tool.id} href={`/tools/${tool.id}`} style={cardLink}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>{tool.icon}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>{tool.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: 'var(--bg-elevated)', color: 'var(--muted)' }}>
                      {t(`kind.${tool.kind}`)}
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, flex: 1 }}>{tool.tagline}</p>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{t('runFree')} →</span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}

      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{t('hubFootnote')}</p>
    </div>
  );
}
