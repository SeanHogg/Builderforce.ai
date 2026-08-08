'use client';

import React from 'react';

/**
 * PortfolioSnapshot — above-the-fold portfolio health summary per PRD task #549 FR-4.
 *
 * Delivers AC-6 (above the fold on portfolio dashboard) and AC-7 (exact counts
 * and top-3 actions). Values are hardcoded per the PRD; the component accepts
 * no props and performs no I/O — swap in live data later without changing the
 * layout contract.
 */

/* ── Constants (FR-4 / AC-7) ──────────────────────────────────────────────── */

const TOTAL_PROJECTS = 5;
const GREEN_COUNT = 0;
const AMBER_COUNT = 2;
const RED_COUNT = 3;
const OVERALL_HEALTH: 'Green' | 'Amber' | 'Red' = 'RED' as const;

const TOP_ACTIONS: Array<{ rank: 1 | 2 | 3; label: string }> = [
  { rank: 1, label: 'Fix Hired.Video build' },
  { rank: 2, label: 'Kickoff RumbleDating' },
  { rank: 3, label: 'Define or archive pattysnob.com' },
];

/* ── Design tokens (consistent with PmoRollup / PmoContent) ───────────────── */

const COLORS = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  muted: '#6b7280',
  subtle: '#9ca3af',
  text: 'var(--text-primary)',
  bg: 'var(--surface-card, #fff)',
  border: 'var(--border-subtle, #e5e7eb)',
} as const;

/* ── Styles ───────────────────────────────────────────────────────────────── */

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 16,
  alignItems: 'stretch',
  background: COLORS.bg,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 12,
  padding: 20,
};

const statGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  flex: 1,
  minWidth: 280,
};

const bigNumberStyle: React.CSSProperties = {
  fontSize: 36,
  fontWeight: 700,
  lineHeight: 1,
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: COLORS.subtle,
  marginTop: 2,
};

const countChipStyle = (color: string): React.CSSProperties => ({
  display: 'inline-flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 52,
  padding: '6px 10px',
  borderRadius: 8,
  background: `${color}15`,
  border: `1px solid ${color}40`,
});

const overallBannerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 120,
  padding: '8px 14px',
  borderRadius: 10,
  background: `${COLORS.red}15`,
  border: `2px solid ${COLORS.red}60`,
  flexShrink: 0,
};

const actionsListStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 2,
  fontSize: '0.84rem',
  color: COLORS.muted,
  lineHeight: 1.5,
  minWidth: 260,
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  color: COLORS.subtle,
  marginBottom: 4,
};

const dividerStyle: React.CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  background: COLORS.border,
  flexShrink: 0,
};

/* ── Component ────────────────────────────────────────────────────────────── */

export function PortfolioSnapshot() {
  return (
    <section
      style={containerStyle}
      role="region"
      aria-label="Portfolio health snapshot"
    >
      {/* Total projects */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 70 }}>
        <span style={{ ...bigNumberStyle, color: COLORS.text }}>{TOTAL_PROJECTS}</span>
        <span style={labelStyle}>Projects</span>
      </div>

      <span style={dividerStyle} aria-hidden />

      {/* RAG counts */}
      <div style={statGroupStyle}>
        <div style={countChipStyle(COLORS.green)}>
          <span style={{ fontSize: 22, fontWeight: 700, color: COLORS.green }}>{GREEN_COUNT}</span>
          <span style={{ fontSize: '0.68rem', color: COLORS.green, fontWeight: 600 }}>Green</span>
        </div>
        <div style={countChipStyle(COLORS.amber)}>
          <span style={{ fontSize: 22, fontWeight: 700, color: COLORS.amber }}>{AMBER_COUNT}</span>
          <span style={{ fontSize: '0.68rem', color: COLORS.amber, fontWeight: 600 }}>Amber</span>
        </div>
        <div style={countChipStyle(COLORS.red)}>
          <span style={{ fontSize: 22, fontWeight: 700, color: COLORS.red }}>{RED_COUNT}</span>
          <span style={{ fontSize: '0.68rem', color: COLORS.red, fontWeight: 600 }}>Red</span>
        </div>
      </div>

      <span style={dividerStyle} aria-hidden />

      {/* Overall health */}
      <div style={overallBannerStyle}>
        <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: COLORS.subtle }}>
          Overall
        </span>
        <span style={{ fontSize: 20, fontWeight: 800, color: COLORS.red, lineHeight: 1.2 }}>
          {OVERALL_HEALTH}
        </span>
      </div>

      <span style={dividerStyle} aria-hidden />

      {/* Top-3 priority actions */}
      <div>
        <div style={sectionHeadingStyle}>Priority Actions</div>
        <ol style={actionsListStyle}>
          {TOP_ACTIONS.map((a) => (
            <li key={a.rank} style={{ display: 'flex', gap: 6 }}>
              <span style={{ fontWeight: 700, color: COLORS.text }}>{a.rank}.</span>
              <span>{a.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
