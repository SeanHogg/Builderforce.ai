'use client';

import { ReactNode } from 'react';
import { ViewToggle } from './ViewToggle';

interface CenterPanelProps {
  viewMode: 'preview' | 'code';
  onViewChange: (view: 'preview' | 'code') => void;
  previewContent: ReactNode;
  codeContent: ReactNode;
  terminalContent: ReactNode;
}

export function CenterPanel({ 
  viewMode, 
  onViewChange, 
  previewContent, 
  codeContent,
  terminalContent 
}: CenterPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top: Preview/Code toggle */}
      <ViewToggle activeView={viewMode} onViewChange={onViewChange} />
      
      {/* Middle: Preview or Code editor */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {viewMode === 'preview' ? previewContent : codeContent}
      </div>

      {/* Bottom: Terminal */}
      <div style={{ 
        height: 200, 
        borderTop: '1px solid var(--border-subtle)', 
        display: 'flex', 
        flexDirection: 'column',
        flexShrink: 0,
        background: 'var(--bg-deep)',
      }}>
        <div style={{ 
          padding: '6px 12px', 
          background: 'var(--bg-surface)', 
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          💻 Terminal
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {terminalContent}
        </div>
      </div>
    </div>
  );
}
