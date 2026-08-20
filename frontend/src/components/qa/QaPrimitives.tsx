/**
 * Shared presentation primitives for the Agentic QA surfaces.
 *
 * Extracted when `QaContent.tsx` crossed the repo's 800-line production-file
 * ceiling: the tab is a dashboard of independent sections, and the section
 * chrome (heading + action slot), the button/input styling, the status/severity
 * colour vocabulary and the little table shell were the parts every one of them
 * shared. They carry no domain logic and no data access — they are the visual
 * grammar the QA tab is written in, stated once so a new section cannot invent
 * a second one.
 *
 * Colours come from theme tokens only (`var(--…)`), so every surface built from
 * these reads correctly in BOTH themes without a per-component decision.
 *
 * No `'use client'` directive of its own: it is imported only from
 * `QaContent.tsx`, which declares the boundary, and a module inside an existing
 * client boundary inherits it. The directive marks WHERE server rendering stops,
 * not every file on the client side of it.
 */

import type React from 'react';


export const STATUS_COLOR: Record<string, string> = {
  passed: 'var(--success)', failed: 'var(--error)', error: 'var(--error)', skipped: 'var(--text-muted)',
  running: 'var(--amber-bright)', queued: 'var(--text-muted)',
};

export const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--error)', high: 'var(--error)', medium: 'var(--amber-bright)', low: 'var(--text-muted)',
};
export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export function btnStyle(disabled = false): React.CSSProperties {
  return {
    padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-subtle)', background: 'var(--surface-raised)',
    color: 'var(--text-secondary)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
  };
}

export const inputStyle: React.CSSProperties = {
  padding: '6px 8px', fontSize: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-deep)', color: 'var(--text-primary)', minWidth: 120,
};

export function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>{children}</p>;
}

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '8px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top', ...style }}>{children}</td>;
}

