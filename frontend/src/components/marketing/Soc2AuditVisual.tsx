/**
 * Soc2AuditVisual — a decorative mock of the SOC 2 readiness report exactly as it
 * renders in-app: an overall readiness gauge, the Common Criteria (CC1–CC9)
 * checklist with pass / partial / gap chips, a findings strip, and a
 * "remediation PR opened" badge. Presentational only (no hooks/interactivity), so
 * it renders inside the server marketing page. Every colour is a theme token, so
 * it reads in light AND dark; the layout is fluid and wraps on narrow screens.
 *
 * All text comes in via `labels` so the page (a server component with
 * getTranslations) owns localization — this component ships no hardcoded copy.
 */
export interface Soc2AuditVisualLabels {
  title: string;
  scoreLabel: string;      // e.g. "Defined"
  scoreValue: string;      // e.g. "3.4 / 5"
  criteriaHeading: string;
  criteria: Array<{ ref: string; label: string; state: 'pass' | 'partial' | 'gap' }>;
  stateLabels: { pass: string; partial: string; gap: string };
  findingsHeading: string;
  findings: string[];
  prBadge: string;
}

const STATE_COLORS: Record<'pass' | 'partial' | 'gap', { fg: string; bg: string; border: string }> = {
  pass: { fg: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.4)' },
  partial: { fg: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)' },
  gap: { fg: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)' },
};

export function Soc2AuditVisual({ labels }: { labels: Soc2AuditVisualLabels }) {
  // Gauge: 3.4 / 5 → ~68% of a 270° arc.
  const pct = 0.68;
  const R = 52;
  const C = 2 * Math.PI * R;
  const arc = 0.75; // 270° sweep
  const dash = `${C * arc * pct} ${C}`;

  return (
    <div
      role="img"
      aria-label={labels.title}
      style={{
        background: 'var(--surface-card, var(--bg-elevated))',
        border: '1px solid var(--border-subtle)',
        borderRadius: 18,
        padding: 'clamp(16px, 3vw, 28px)',
        boxShadow: '0 18px 50px rgba(0,0,0,0.22)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 'clamp(16px, 3vw, 28px)',
        width: '100%',
        maxWidth: 760,
        margin: '0 auto',
      }}
    >
      {/* Left: gauge + title + PR badge */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{labels.title}</div>
        <div style={{ position: 'relative', width: 150, height: 150 }}>
          <svg width="150" height="150" viewBox="0 0 130 130" style={{ transform: 'rotate(135deg)' }} aria-hidden>
            <circle cx="65" cy="65" r={R} fill="none" stroke="var(--border-subtle)" strokeWidth="10" strokeDasharray={`${C * arc} ${C}`} strokeLinecap="round" />
            <circle cx="65" cy="65" r={R} fill="none" stroke="url(#soc2grad)" strokeWidth="10" strokeDasharray={dash} strokeDashoffset={`-${0}`} strokeLinecap="round" />
            <defs>
              <linearGradient id="soc2grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--coral-bright)" />
                <stop offset="100%" stopColor="var(--cyan-bright, #22d3ee)" />
              </linearGradient>
            </defs>
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{labels.scoreValue}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--coral-bright)', marginTop: 4 }}>{labels.scoreLabel}</span>
          </div>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
          color: '#22c55e', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.4)',
          borderRadius: 999, padding: '5px 12px',
        }}>✓ {labels.prBadge}</span>
      </div>

      {/* Right: CC checklist + findings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{labels.criteriaHeading}</div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {labels.criteria.map((c) => {
            const col = STATE_COLORS[c.state];
            return (
              <li key={c.ref} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ fontWeight: 700, color: 'var(--text-secondary)', minWidth: 34 }}>{c.ref}</span>
                <span style={{ flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: col.fg, background: col.bg, border: `1px solid ${col.border}`, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                  {labels.stateLabels[c.state]}
                </span>
              </li>
            );
          })}
        </ul>

        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, marginTop: 2 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>{labels.findingsHeading}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {labels.findings.map((f, i) => (
              <span key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '4px 10px' }}>{f}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
