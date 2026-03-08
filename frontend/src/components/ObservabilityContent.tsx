'use client';

import { useState } from 'react';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

export type ObservabilityView = 'logs' | 'timeline';

export interface ObservabilityContentProps {
  /** Optional initial view. Defaults to 'logs'. */
  initialView?: ObservabilityView;
  /** Optional className for the root wrapper. */
  className?: string;
  /** Optional inline style for the root wrapper. */
  style?: React.CSSProperties;
}

export function ObservabilityContent({
  initialView = 'logs',
  className,
  style,
}: ObservabilityContentProps) {
  const [view, setView] = useState<ObservabilityView>(initialView);

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: 16, ...style }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>View:</span>
        <button
          type="button"
          onClick={() => setView('logs')}
          style={{
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 600,
            background: view === 'logs' ? 'var(--surface-coral-soft)' : 'var(--bg-deep)',
            color: view === 'logs' ? 'var(--coral-bright)' : 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Logs
        </button>
        <button
          type="button"
          onClick={() => setView('timeline')}
          style={{
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 600,
            background: view === 'timeline' ? 'var(--surface-coral-soft)' : 'var(--bg-deep)',
            color: view === 'timeline' ? 'var(--coral-bright)' : 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Timeline
        </button>
      </div>

      {view === 'logs' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Active Claw</span>
            <select
              style={{
                padding: '6px 10px',
                fontSize: 13,
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                background: 'var(--bg-deep)',
                color: 'var(--text-primary)',
                minWidth: 200,
              }}
            >
              <option value="">No agent selected</option>
            </select>
          </div>
          <div
            style={{
              background: 'var(--bg-deep)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: 12,
              minHeight: 280,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--text-muted)',
              overflow: 'auto',
            }}
          >
            Streaming logs will appear here when an agent is selected and running.
          </div>
        </div>
      )}

      {view === 'timeline' && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Timeline</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            Visualize execution and task flow over time. Timeline view will show task states and agent activity.
          </p>
          <div
            style={{
              background: 'var(--bg-deep)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: 24,
              minHeight: 240,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            Timeline visualization will appear here when execution data is available.
          </div>
        </div>
      )}
    </div>
  );
}
