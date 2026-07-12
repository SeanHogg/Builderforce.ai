'use client';
/**
 * CrossProjectHealthDashboard — the consumer view for the portfolio health data.
 *
 * Layout:
 *   1. Snapshot header (framed for above-the-fold visibility)
 *   2. Portfolio summary (RAG counts + top 3 actions)
 *   3. Project cards (grid; scannable per ~30 seconds per PRD)
 *
 * FR-6 scannability:
 *   - Summary before the fold.
 *   - RAG color prominent (badge).
 *   - Desktop-first with mobile-friendly font sizing.
 *
 * FR-5 refresh options:
 *   - This version is a point-in-time snapshot (generatedAt display in header).
 *   - Future: swap `portfolioHealthData` with fetch() + ReactQuery.
 */

import React from 'react';
import { projects, portfolioSummary, type ProjectHealth } from './portfolioHealthData';

/* ── Utility colors from CSS variable tokens (matches EvermindBrainMap/IDE theme) ───────────────── */

const colors = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  muted: '#9ca3af',
  emergency: '#fbbf24', // prompt header tone
  subtle: '#4b5563',
} as const;

/* ── Project Card Component (FR-1) ────────────────────────────────────────────────────────────── */

interface ProjectCardProps {
  p: ProjectHealth;
}

function ProjectCard({ p }: ProjectCardProps) {
  const rag = p.rag ?? 'Red'; // safe fallback
  const ragColor = colors[rag.toLowerCase()] as 'green' | 'amber' | 'red';
  const ragLabel = rag === 'Green' ? '🟢' : rag === 'Amber' ? '🟡' : '🔴';

  return (
    <div
      style={cardStyle}
      role="region"
      aria-label={`${p.name}: ${ragLabel} — ${p.completionPct ?? 'N/A'}% complete`}
    >
      {/* Status bar with RAG badge (FR-6 coloring) */}
      <div style={statusRowStyle}>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em', color: colors.subtle, fontSize: '0.68rem' }}>
          {p.status}
        </span>
        <div
          aria-hidden
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontWeight: 600,
            fontSize: '1.1rem',
            color: colors[ragColor],
          }}
        >
          {ragLabel}
          <span>{p.rag ?? 'Red'}</span>
        </div>
      </div>

      {/* Title + risk level */}
      <h2 style={headingStyle}>{p.name}</h2>
      <div style={{ fontSize: '0.8rem', color: colors.subtle, marginBottom: 8 }}>
        {p.riskLevel} — {p.riskRationale}
      </div>

      {/* Completion (progress bar style) */}
      {p.completionPct !== null ? (
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 2 }}>
            <span style={{ color: colors.green, fontWeight: 600 }}>{p.completionPct}%</span>
          </div>
          {/* Progress bar ready for dark background override on embedding */}
          <div
            style={{
              width: '100%',
              height: 10,
              borderRadius: 10,
              backgroundColor: `rgba(107, 114, 128, 0.2)`, // Blended progress bar tint
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: `${p.completionPct}%`,
                height: '100%',
                backgroundColor: colors.green,
                position: 'absolute',
              }}
            />
          </div>
        </div>
      ) : (
        <div style={naStyle}>N/A (no tasks defined)</div>
      )}

      {/* Task summary */}
      <div style={{ fontSize: '0.86rem', lineHeight: '1.45', color: colors.muted, marginBottom: 6 }}>
        {p.taskSummary}
      </div>

      {/* Key blocker */}
      <div style={sectionLabelStyle}>
        <strong style={{ color: colors.subtle }}>Key blocker:</strong>{' '}
        <span style={{ color: '#fff' }}>{p.keyBlocker}</span>
      </div>

      {/* Recommended next action */}
      <div style={sectionLabelStyle}>
        <strong style={{ color: colors.subtle }}>Next action:</strong>{' '}
        <span style={{ color: colors.emergency }}>{p.recommendedAction}</span>
      </div>
    </div>
  );
}

/* ── Portfolio Summary Component (FR-4) ─────────────────────────────────────────────────────── */

function PortfolioSummary({ summary }: { summary: typeof portfolioSummary }) {
  const { greenCount, amberCount, redCount, overall, topPriorityActions } = summary;

  return (
    <section aria-labelledby="summary-heading">
      <h2 id="summary-heading" style={summaryHeadingStyle}>
        Portfolio Snapshot
      </h2>
      <div style={summaryGridStyle}>
        <div style={statCardStyle(green)} aria-label='Green projects'>
          <div style={statCountStyle(greenCount)}>{greenCount}</div>
          <div style={statLabelStyle}>🟢 Green</div>
        </div>
        <div style={statCardStyle(amber)} aria-label='Amber projects'>
          <div style={statCountStyle(amberCount)}>{amberCount}</div>
          <div style={statLabelStyle}>🟡 Amber</div>
        </div>
        <div style={statCardStyle(red)} aria-label='Red projects'>
          <div style={statCountStyle(redCount)}>{redCount}</div>
          <div style={statLabelStyle}>🔴 Red</div>
        </div>
      </div>

      <div style={overallBannerStyle}>
        <strong>Overall portfolio health:</strong> <span style={{ color: colors[overall.toLowerCase() as 'green' | 'amber' | 'red' }] }}>{overall}</span>
      </div>

      <div style={{ marginTop: 12 }}>
        <h3 style={subHeadingStyle}>Top priority actions:</h3>
        <ul style={actionsListStyle}>
          {topPriorityActions.map((a) => (
            <li key={a.rank} style={actionItemStyle}>
              <span style={{ color: colors.emergency }}>{a.rank}.</span> {a.label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ── Main View (FR-1 FR-6) ─────────────────────────────────────────────────────────────── */

export function CrossProjectHealthDashboard() {
  return (
    <main style={mainStyle}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24, alignItems: 'flex-start' }}>
        <h1 style={pageheadingStyle}>Cross-Project Health Dashboard</h1>
        <div style={{ fontSize: '0.8rem', color: colors.subtle }}>
          {new Date(portfolioSummary.generatedAt).toLocaleString()}
        </div>
      </header>

      <PortfolioSummary summary={portfolioSummary} />

      <section aria-labelledby="projects-heading">
        <h2 id="projects-heading" style={{ ...headingStyle, paddingLeft: 40, marginTop: 32 }}>
          Project Health Cards ({portfolioSummary.totalProjects})
        </h2>
        <div style={cardGridStyle}>
          {projects.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      </section>
    </main>
  );
}

/* ── Design Tokens (inlined, matching EvermindBrainMap vibes) ─────────────────────────────── */

const mainStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  maxWidth: 1140,
  marginInline: 'auto',
  paddingInline: 32,
  paddingBottom: 48,
  color: 'var(--text)',
  backgroundColor: '#fafbfc',
};

const headingStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  color: 'var(--text)',
};

const subHeadingStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 500,
  color: 'var(--text)',
};

const pageheadingStyle: React.CSSProperties = {
  fontSize: 30,
  fontWeight: 600,
  color: colors.emergency,
  margin: 0,
};

const summaryHeadingStyle: React.CSSProperties = {
  ...headingStyle,
  textAlign: 'left',
  marginBottom: 20,
  marginLeft: -40,
};

const statusRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 4,
  marginLeft: 40,
};

const summaryGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(160px, 1fr))',
  gap: 12,
  marginLeft: -40,
  marginBottom: 20,
};

const statCardStyle = (count: number): React.CSSProperties => ({
  backgroundColor: '#fff',
  border: `1px solid ${count > 0 ? 'rgba(34, 197, 94, 0.3)' : 'rgba(150, 150, 150, 0.25)'}`,
  borderRadius: 8,
  padding: 12,
  textAlign: 'center',
  boxShadow: `0 1px 2px rgba(0, 0, 0, 0.05)`,
});

const statCountStyle = (c: number): React.CSSProperties => ({
  fontSize: 32,
  fontWeight: 700,
  color: c > 0 ? (c >= 3 ? colors.red : colors.green) : colors.muted,
});

const statLabelStyle: React.CSSProperties = {
  fontSize: 0.8,
  color: colors.subtle,
  marginTop: 4,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const overallBannerStyle: React.CSSProperties = {
  backgroundColor: '#fff',
  border: `1px solid ${colors[portfolioSummary.overall.toLowerCase() as 'green' | 'amber' | 'red']}`,
  borderRadius: 8,
  paddingInline: 16,
  marginBottom: 12,
  fontSize: 0.9rem,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const actionsListStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  color: colors.subtle,
  lineHeight: '1.6',
};

const actionItemStyle: React.CSSProperties = {
  marginBottom: 4,
  display: 'flex',
  gap: 6,
};

const cardGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
  gap: 16,
  marginLeft: -20,
};

const cardStyle: React.CSSProperties = {
  backgroundColor: '#fff',
  border: `1px solid ${colors.emergency}`,
  borderRadius: 10,
  padding: 20,
  boxShadow: `0 2px 6px rgba(0, 0, 0, 0.08)`,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 0.85rem,
  lineHeight: 1.4,
  color: colors.subtle,
  marginBottom: 4,
};

const naStyle: React.CSSProperties = {
  fontSize: 0.8rem,
  color: colors.muted,
  marginBottom: 8,
};