'use client';

import { useTranslations } from 'next-intl';
import { ToolResultView } from '@/components/tools/ToolResultView';
import type { ProjectScore } from '@/lib/tools';

const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 10000 };
const drawerStyle: React.CSSProperties = {
  position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(560px, 100%)',
  background: 'var(--bg-elevated)', borderLeft: '1px solid var(--border-subtle)',
  boxShadow: '-8px 0 24px rgba(0,0,0,0.25)', zIndex: 10001, display: 'flex', flexDirection: 'column',
};

/**
 * Slide-out diagnostics results. With no `filterToolId` it shows the combined
 * analysis — the project's overall rating plus every diagnostic's latest result.
 * With a `filterToolId` it shows just that one diagnostic. Both modes render the
 * same panel (DRY); the trigger decides the filter.
 */
export function DiagnosticsResultsPanel({
  open,
  onClose,
  score,
  filterToolId,
}: {
  open: boolean;
  onClose: () => void;
  score: ProjectScore | null;
  filterToolId?: string | null;
}) {
  const t = useTranslations('projectDiagnostics');
  if (!open || !score) return null;

  const filtered = filterToolId ? score.diagnostics.filter((d) => d.toolId === filterToolId) : score.diagnostics;
  const single = filterToolId ? filtered[0] : null;
  const title = single ? single.name : t('combinedResults');

  return (
    <>
      <div role="presentation" style={overlayStyle} onClick={onClose} aria-hidden />
      <div role="dialog" aria-label={title} style={drawerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('closeResults')}
            style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {filtered.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('noResults')}</div>
          ) : single ? (
            <ToolResultView result={single.result} />
          ) : (
            <>
              {/* Combined: overall rating across all diagnostics, then each one. */}
              <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--muted)' }}>{t('overall')}</div>
                <ToolResultView result={score.result} />
              </section>
              {filtered.map((d) => (
                <section key={d.toolId} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--muted)' }}>{d.name}</div>
                  <ToolResultView result={d.result} />
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
