'use client';

import { Component } from 'react';
import { useTranslations } from 'next-intl';
import {
  isChunkLoadError,
  recoverFromChunkError,
  chunkRecoveryAlreadyAttempted,
} from '@/lib/chunkErrorRecovery';

/**
 * Boundary that self-heals webpack ChunkLoadError / stale-asset crashes.
 *
 * A `dynamic(() => import(...))` whose chunk 404s (e.g. `466.undefined.js` after
 * a deploy served a stale SW-cached webpack runtime) throws during render. This
 * boundary catches ONLY chunk errors: it purges the stale cache/SW and hard-
 * reloads onto the current build, so the user recovers automatically instead of
 * white-screening. Any non-chunk error is re-thrown so the nearest generic
 * ErrorBoundary handles it. A time-window guard (see chunkErrorRecovery) stops
 * an infinite reload loop when the reload doesn't fix it — then we show a manual
 * "Reload" instead. Replaces the per-editor boundaries that were duplicated in
 * CodeEditor.tsx and FileChangeViewer.tsx.
 */
interface Props {
  children: React.ReactNode;
  /** Inline/embedded surface (e.g. the editor pane) — compact fallback. */
  compact?: boolean;
}
interface State {
  error: Error | null;
}

export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Fire recovery from a lifecycle method (side effects are allowed here, not
    // in render). Loop-guarded inside recoverFromChunkError.
    if (isChunkLoadError(error)) void recoverFromChunkError();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // Not ours — let the closest generic ErrorBoundary own it.
    if (!isChunkLoadError(error)) throw error;
    // Already reloaded once inside the guard window and still broken → manual.
    return (
      <ChunkErrorFallback
        recovering={!chunkRecoveryAlreadyAttempted()}
        compact={this.props.compact}
      />
    );
  }
}

function ChunkErrorFallback({
  recovering,
  compact,
}: {
  recovering: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('chunkError');

  if (compact) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
          padding: 16,
          textAlign: 'center',
        }}
      >
        {recovering ? (
          <span>{t('recovering')}</span>
        ) : (
          <button
            type="button"
            onClick={() => void recoverFromChunkError(true)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-base)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {t('reload')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 32,
        textAlign: 'center',
        background: 'var(--bg-deep)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-display, system-ui, sans-serif)',
      }}
    >
      <div style={{ fontSize: '2.5rem', animation: recovering ? 'pulse 1.5s ease-in-out infinite' : undefined }}>
        {recovering ? '⚡' : '⚠️'}
      </div>
      {recovering ? (
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('recovering')}</p>
      ) : (
        <>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>{t('title')}</h2>
          <p style={{ color: 'var(--text-secondary)', margin: 0, maxWidth: 420 }}>{t('body')}</p>
          <button
            type="button"
            onClick={() => void recoverFromChunkError(true)}
            style={{
              marginTop: 8,
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: '#fff',
              border: 'none',
              padding: '10px 24px',
              borderRadius: 12,
              fontFamily: 'var(--font-display, system-ui, sans-serif)',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            {t('reload')}
          </button>
        </>
      )}
    </div>
  );
}
