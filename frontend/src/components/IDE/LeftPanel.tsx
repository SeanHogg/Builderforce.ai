'use client';

import { ReactNode } from 'react';

interface LeftPanelProps {
  aiChat: ReactNode;
}

export function LeftPanel({ aiChat }: LeftPanelProps) {
  return (
    <>
      {/* Header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-base)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: '1.5rem' }}>🤖</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
            AI Assistant
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {aiChat}
      </div>
    </>
  );
}
