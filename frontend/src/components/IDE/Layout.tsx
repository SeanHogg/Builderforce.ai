'use client';

import { ReactNode } from 'react';

interface LayoutProps {
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  rightPanel?: ReactNode;
}

export function IDELayout({ leftPanel, centerPanel, rightPanel }: LayoutProps) {
  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
      background: 'var(--bg-deep)',
      fontFamily: 'var(--font-display)',
    }}>
      {/* Left Panel - AI Assistant */}
      <div style={{
        width: 320,
        minWidth: 320,
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-base)',
      }}>
        {leftPanel}
      </div>

      {/* Center Panel - Editor/Preview */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {centerPanel}
      </div>

      {/* Right Panel - Files/Train/Publish (optional) */}
      {rightPanel && (
        <div style={{
          width: 300,
          minWidth: 300,
          borderLeft: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-base)',
          overflow: 'hidden',
        }}>
          {rightPanel}
        </div>
      )}
    </div>
  );
}
