'use client';

import { useState, ReactNode } from 'react';

interface RightPanelProps {
  fileExplorer: ReactNode;
  training: ReactNode;
  publish: ReactNode;
}

type Tab = 'files' | 'train' | 'publish';

export function RightPanel({ fileExplorer, training, publish }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('files');

  const tabStyle = (isActive: boolean) => ({
    flex: 1,
    padding: '10px 8px',
    background: isActive ? 'var(--bg-elevated)' : 'transparent',
    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.7rem',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    fontFamily: 'var(--font-display)',
    borderBottom: isActive ? '2px solid var(--coral-bright)' : '2px solid transparent',
    whiteSpace: 'nowrap' as const,
  });

  return (
    <>
      {/* Tab Bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-base)',
      }}>
        <button onClick={() => setActiveTab('files')} style={tabStyle(activeTab === 'files')}>
          📁 Files
        </button>
        <button onClick={() => setActiveTab('train')} style={tabStyle(activeTab === 'train')}>
          🧠 Train
        </button>
        <button onClick={() => setActiveTab('publish')} style={tabStyle(activeTab === 'publish')}>
          🚀 Publish
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
          <div style={{ 
            position: 'absolute', 
            inset: 0, 
            visibility: activeTab === 'files' ? 'visible' : 'hidden', 
            pointerEvents: activeTab === 'files' ? 'auto' : 'none',
            overflow: 'hidden',
          }}>
            {fileExplorer}
          </div>
          <div style={{ 
            position: 'absolute', 
            inset: 0, 
            visibility: activeTab === 'train' ? 'visible' : 'hidden', 
            pointerEvents: activeTab === 'train' ? 'auto' : 'none',
            overflow: 'hidden',
          }}>
            {training}
          </div>
          <div style={{ 
            position: 'absolute', 
            inset: 0, 
            visibility: activeTab === 'publish' ? 'visible' : 'hidden', 
            pointerEvents: activeTab === 'publish' ? 'auto' : 'none',
            overflow: 'hidden',
          }}>
            {publish}
          </div>
        </div>
      </div>
    </>
  );
}
