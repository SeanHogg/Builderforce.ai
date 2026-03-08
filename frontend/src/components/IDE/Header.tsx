'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ThemeToggleButton } from '@/app/ThemeProvider';

interface HeaderProps {
  projectName: string;
  projectDescription?: string;
  isRunning: boolean;
  onRun: () => void;
  onShare: () => void;
  statusLabel?: string;
  collabConnected?: boolean;
  useNewLayout?: boolean;
  onToggleLayout?: () => void;
}

export function IDEHeader({ projectName, projectDescription, isRunning, onRun, onShare, statusLabel, collabConnected, useNewLayout, onToggleLayout }: HeaderProps) {
  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 14px',
      borderBottom: '1px solid var(--border-subtle)',
      background: 'var(--bg-surface)',
      minHeight: 46,
    }}>
      {/* Left: Back button + Logo & Project Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Link href="/dashboard" style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 6, 
          textDecoration: 'none', 
          color: 'var(--text-muted)', 
          fontSize: '0.78rem', 
          flexShrink: 0, 
          padding: '4px 8px', 
          borderRadius: 6, 
          background: 'var(--bg-elevated)', 
          border: '1px solid var(--border-subtle)' 
        }}>
          ← Dashboard
        </Link>
        <Image src="/claw.png" alt="" width={20} height={20} style={{ filter: 'drop-shadow(0 0 6px var(--logo-glow))', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
          {projectName}
        </span>
        {projectDescription && (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            — {projectDescription}
          </span>
        )}
      </div>

      {/* Right: Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onToggleLayout && (
          <button
            onClick={onToggleLayout}
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: '0.75rem',
              cursor: 'pointer',
              flexShrink: 0,
              fontFamily: 'var(--font-display)',
            }}
            title={useNewLayout ? 'Switch to old layout' : 'Switch to new layout'}
          >
            {useNewLayout ? '🔄 Old Layout' : '🔄 New Layout'}
          </button>
        )}
        {collabConnected && (
          <span style={{ fontSize: '0.72rem', color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, background: '#4ade80', borderRadius: '50%', display: 'inline-block' }} />
            Live
          </span>
        )}
        {statusLabel && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {statusLabel}
          </span>
        )}
        <ThemeToggleButton />
        <button
          onClick={onRun}
          disabled={isRunning}
          style={{
            background: isRunning ? 'var(--bg-elevated)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
            color: '#fff',
            border: 'none',
            padding: '5px 14px',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: '0.82rem',
            cursor: isRunning ? 'wait' : 'pointer',
            fontFamily: 'var(--font-display)',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            flexShrink: 0,
            opacity: isRunning ? 0.6 : 1,
          }}
        >
          {isRunning ? '⏳ Running…' : '▶ Run'}
        </button>
        <button
          onClick={onShare}
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            padding: '5px 12px',
            fontSize: '0.82rem',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          Share
        </button>
      </div>
    </header>
  );
}
