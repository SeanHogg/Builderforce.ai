'use client';

import React from 'react';
import { copyTextToClipboard } from '@/lib/useCopyToClipboard';

interface ErrorBoundaryProps {
  homePath?: string;
  homeLabel?: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches React render crashes and shows a full-screen error page.
 * Separate from API errors (those go through GlobalErrorHandler).
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  private handleReset = () => this.setState({ error: null });

  private handleCopy = async () => {
    const { error } = this.state;
    if (!error) return;

    const ticket = [
      `## Support Ticket — UI Crash`,
      `**Time:** ${new Date().toISOString()}`,
      `**Error:** ${error.name}: ${error.message}`,
      `**Page:** ${window.location.href}`,
      error.stack ? `**Stack:**\n\`\`\`\n${error.stack}\n\`\`\`` : null,
      `**User Agent:** ${navigator.userAgent}`,
    ]
      .filter(Boolean)
      .join('\n');

    // This is a class component, so the hook is illegal here — the plain shared
    // function is the same one implementation. A refused clipboard resolves false and
    // is ignored, exactly as the old try/catch did (there is no feedback state here).
    await copyTextToClipboard(ticket);
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { homePath = '/', homeLabel = 'Go Home' } = this.props;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          fontFamily: 'var(--font-body, system-ui, sans-serif)',
          background: 'var(--bg-deep, var(--bg-deep))',
          color: 'var(--text-primary, var(--text-primary))',
        }}
      >
        <div style={{ maxWidth: 560, width: '100%' }}>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: 'var(--error, var(--error))',
              fontFamily: 'var(--font-display, system-ui, sans-serif)',
              marginBottom: 8,
            }}
          >
            {error.name}
          </h1>
          <p
            style={{
              fontSize: 16,
              color: 'var(--text-secondary, var(--text-secondary))',
              marginBottom: 24,
            }}
          >
            {error.message}
          </p>

          {error.stack && (
            <details
              style={{
                marginBottom: 24,
                background: 'var(--bg-elevated, var(--bg-elevated))',
                border: '1px solid var(--border, rgba(136,146,176,0.15))',
                borderRadius: 'var(--radius-md, 8px)',
                overflow: 'hidden',
              }}
            >
              <summary
                style={{
                  padding: '10px 14px',
                  cursor: 'pointer',
                  fontSize: 14,
                  color: 'var(--text-muted, var(--text-muted))',
                }}
              >
                Stack trace
              </summary>
              <pre
                style={{
                  padding: '10px 14px',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono, monospace)',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--text-secondary, var(--text-secondary))',
                  maxHeight: 300,
                  overflowY: 'auto',
                  borderTop: '1px solid var(--border, rgba(136,146,176,0.15))',
                }}
              >
                {error.stack}
              </pre>
            </details>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={this.handleReset} style={primaryBtnStyle}>
              Try Again
            </button>
            <a href={homePath} style={secondaryBtnStyle}>
              {homeLabel}
            </a>
            <button onClick={this.handleCopy} style={secondaryBtnStyle}>
              Copy Support Ticket
            </button>
          </div>
        </div>
      </div>
    );
  }
}

const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 14,
  fontWeight: 600,
  borderRadius: 'var(--radius-md, 8px)',
  border: 'none',
  cursor: 'pointer',
  background: 'var(--coral-bright, var(--coral-bright))',
  color: 'var(--text-on-accent)',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 14,
  fontWeight: 500,
  borderRadius: 'var(--radius-md, 8px)',
  border: '1px solid var(--border, rgba(136,146,176,0.15))',
  cursor: 'pointer',
  background: 'var(--bg-elevated, var(--bg-elevated))',
  color: 'var(--text-primary, var(--text-primary))',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};
