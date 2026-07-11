'use client';

import { useTranslations } from 'next-intl';
import type { ProjectDiagnosticSummary } from '@/lib/tools';
import { diagnosticScoreColor, orderDiagnostics } from '@/lib/diagnosticScore';

/**
 * ProjectDiagnosticsStrip — the SINGLE surface for showing the diagnostics a
 * project has run (SOC 2 readiness, Quality, PM Vision, …) with their latest
 * score and outstanding-gap count. Shared so the project card, the project
 * table, and the analytics panel can't drift.
 *
 * Two variants:
 *  - `chips`  — a dense row of score pills for the project card / list row.
 *  - `gauges` — radial gauge cards (score + label + remediation status) for the
 *               analytics panel, echoing the SOC 2 readiness gauge.
 *
 * Decides its own visibility: renders nothing when there are no diagnostics, so
 * callers never gate on an entitlement/`hasData` boolean.
 */
export interface ProjectDiagnosticsStripProps {
  diagnostics: ProjectDiagnosticSummary[];
  variant?: 'chips' | 'gauges';
  /** Open a diagnostic's results (chips/gauges become buttons when provided). */
  onOpen?: (toolId: string) => void;
  /** Chips variant: cap the rendered chips, overflow into a "+N" pill. */
  maxChips?: number;
}

/** Small radial gauge (0–5 → fraction of a 270° arc), score + label in the hub. */
function MiniGauge({ score, label, size = 92 }: { score: number | null; label: string | null; size?: number }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const arc = 0.75; // 270° sweep
  const pct = score == null ? 0 : Math.max(0, Math.min(1, score / 5));
  const color = score == null ? 'var(--border-subtle)' : diagnosticScoreColor(score);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 130 130" style={{ transform: 'rotate(135deg)' }} aria-hidden>
        <circle cx="65" cy="65" r={R} fill="none" stroke="var(--border-subtle)" strokeWidth="10" strokeDasharray={`${C * arc} ${C}`} strokeLinecap="round" />
        <circle cx="65" cy="65" r={R} fill="none" stroke={color} strokeWidth="10" strokeDasharray={`${C * arc * pct} ${C}`} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
          {score == null ? '—' : score.toFixed(1)}
        </span>
        {label && <span style={{ fontSize: 10, fontWeight: 700, color, marginTop: 2 }}>{label}</span>}
      </div>
    </div>
  );
}

export function ProjectDiagnosticsStrip({ diagnostics, variant = 'chips', onOpen, maxChips = 4 }: ProjectDiagnosticsStripProps) {
  const t = useTranslations('diagnosticsStrip');
  if (!diagnostics || diagnostics.length === 0) return null;
  const ordered = orderDiagnostics(diagnostics);

  const scoreText = (d: ProjectDiagnosticSummary) => (d.score == null ? t('notScored') : `${d.score.toFixed(1)} / 5`);
  const gapText = (d: ProjectDiagnosticSummary) => (d.gapCount > 0 ? t('gaps', { count: d.gapCount }) : t('noGaps'));
  const ariaFor = (d: ProjectDiagnosticSummary) =>
    t('itemAria', { name: d.name, score: scoreText(d), label: d.scoreLabel ?? t('notScored'), gaps: gapText(d) });

  // The honest remediation signal for the gauge badge. A diagnostic with a filed
  // remediation ticket shows its real PR/merge state (matching the marketing SOC 2
  // gauge); one with no ticket falls back to the gap count.
  type BadgeTone = 'good' | 'progress' | 'warn';
  const remediationBadge = (d: ProjectDiagnosticSummary): { label: string; tone: BadgeTone } => {
    const state = d.remediation?.state ?? 'none';
    if (state === 'resolved') return { label: `✓ ${t('remediationResolved')}`, tone: 'good' };
    if (state === 'pr_open') return { label: `✓ ${t('remediationPrOpen')}`, tone: 'good' };
    if (state === 'filed') return { label: t('remediationFiled', { count: d.remediation.open }), tone: 'progress' };
    return d.gapCount > 0 ? { label: gapText(d), tone: 'warn' } : { label: `✓ ${t('noGaps')}`, tone: 'good' };
  };
  const BADGE_TONE: Record<BadgeTone, { fg: string; bg: string; border: string }> = {
    good: { fg: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.4)' },
    progress: { fg: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.4)' },
    warn: { fg: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)' },
  };

  // ── chips: dense score pills for the project card / list row ────────────────
  if (variant === 'chips') {
    const shown = ordered.slice(0, maxChips);
    const overflow = ordered.length - shown.length;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }} aria-label={t('title')}>
        {shown.map((d) => {
          const color = d.score == null ? 'var(--text-muted)' : diagnosticScoreColor(d.score);
          // Status dot: a remediation PR in flight / merged reads as "handled"
          // (green), outstanding gaps read as "attention" (coral); otherwise none.
          const remState = d.remediation?.state ?? 'none';
          const dot = (remState === 'pr_open' || remState === 'resolved')
            ? { color: '#22c55e', title: remediationBadge(d).label }
            : d.gapCount > 0 ? { color: 'var(--coral-bright)', title: gapText(d) } : null;
          const chip = (
            <>
              <span aria-hidden style={{ fontSize: 13 }}>{d.icon}</span>
              <span style={{ fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
                {d.score == null ? '—' : d.score.toFixed(1)}
              </span>
              {dot && (
                <span
                  aria-hidden
                  title={dot.title}
                  style={{ width: 6, height: 6, borderRadius: 999, background: dot.color, flexShrink: 0 }}
                />
              )}
            </>
          );
          const style: React.CSSProperties = {
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 11, lineHeight: 1,
            background: 'var(--bg-base)', border: `1px solid ${d.score == null ? 'var(--border-subtle)' : color + '66'}`,
            borderRadius: 999, padding: '4px 9px', color: 'var(--text-secondary)',
          };
          return onOpen ? (
            <button key={d.toolId} type="button" title={ariaFor(d)} aria-label={ariaFor(d)}
              onClick={(e) => { e.stopPropagation(); onOpen(d.toolId); }}
              style={{ ...style, cursor: 'pointer' }}
            >
              {chip}
            </button>
          ) : (
            <span key={d.toolId} title={ariaFor(d)} style={style}>{chip}</span>
          );
        })}
        {overflow > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{t('more', { count: overflow })}</span>
        )}
      </div>
    );
  }

  // ── gauges: radial cards for the analytics panel ────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t('title')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        {ordered.map((d) => {
          const inner = (
            <>
              <MiniGauge score={d.score} label={d.scoreLabel} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0, width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' }}>
                  <span aria-hidden style={{ fontSize: 14 }}>{d.icon}</span>
                  <span style={{
                    fontSize: 12, fontWeight: 700, color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{d.name}</span>
                </div>
                {(() => {
                  const badge = remediationBadge(d);
                  const tone = BADGE_TONE[badge.tone];
                  return (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
                      color: tone.fg, background: tone.bg, border: `1px solid ${tone.border}`,
                      borderRadius: 999, padding: '3px 9px', maxWidth: '100%',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {badge.label}
                    </span>
                  );
                })()}
              </div>
            </>
          );
          const cardStyle: React.CSSProperties = {
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            padding: 14, textAlign: 'center', width: '100%',
            background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12,
          };
          return onOpen ? (
            <button key={d.toolId} type="button" aria-label={ariaFor(d)}
              onClick={() => onOpen(d.toolId)}
              style={{ ...cardStyle, cursor: 'pointer' }}
            >
              {inner}
            </button>
          ) : (
            <div key={d.toolId} style={cardStyle}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
