'use client';

import { useState } from 'react';
import { ObservabilityContent } from '@/components/ObservabilityContent';
import { LlmUsageContent } from '@/components/LlmUsageContent';
import { QaContent } from '@/components/QaContent';
import { ActiveRunsPanel } from '@/components/ActiveRunsPanel';

type Tab = 'logs' | 'llm' | 'qa';

const TABS: { id: Tab; label: string }[] = [
  // "Logs" holds both diagnostics views — toggle between Log view and Timeline
  // view inside it. No separate Timeline tab (it was a redundant entry point).
  { id: 'logs', label: 'Logs' },
  { id: 'llm', label: 'LLM Usage' },
  { id: 'qa', label: 'Agentic QA' },
];

export default function ObservabilityPage() {
  const [tab, setTab] = useState<Tab>('logs');

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1000 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 4, color: 'var(--text-primary)' }}>
        Observability
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
        Agent logs, execution timelines, and LLM usage metrics across your workspace.
      </p>

      {/* Live fleet view — what's running right now (self-hides when idle). */}
      <div style={{ marginBottom: 24 }}>
        <ActiveRunsPanel />
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 2,
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: 24,
        }}
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            style={{
              padding: '10px 16px',
              fontSize: 13,
              fontWeight: 600,
              color: tab === id ? 'var(--coral-bright)' : 'var(--text-secondary)',
              background: 'none',
              border: 'none',
              borderBottom: tab === id ? '2px solid var(--coral-bright)' : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'logs' && <ObservabilityContent initialView="logs" />}
      {tab === 'llm' && <LlmUsageContent />}
      {tab === 'qa' && <QaContent />}
    </div>
  );
}
