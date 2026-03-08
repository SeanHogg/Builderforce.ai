'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

export interface ChatMessageContentProps {
  /** Message body (markdown). */
  content: string;
  /** When set, code blocks show an "Apply →" button that calls this with the code (IDE only). */
  onApplyCode?: (code: string) => void;
  /** When set, code blocks with a path-like language tag show "Create file" (IDE only). */
  onCreateFile?: (path: string, content: string) => void;
}

/** Language tag that looks like a file path (e.g. package.json, src/index.js). Used for "Create file" in IDE. */
function isFilePathLike(lang: string): boolean {
  const t = lang.trim().toLowerCase();
  if (!t) return false;
  if (t.includes('/')) return true;
  if (t.startsWith('.')) return true;
  const pathLike = /^[\w.-]+\.(json|js|ts|jsx|tsx|css|html|md|txt|yml|yaml|env|gitignore)$/i;
  return pathLike.test(t) || t === 'package.json' || t === 'readme.md';
}

/**
 * Shared chat message body: renders markdown with consistent styling for both
 * Brain Storm and IDE chat. Optional code-block actions (Apply / Create file) for IDE.
 */
export function ChatMessageContent({
  content,
  onApplyCode,
  onCreateFile,
}: ChatMessageContentProps) {
  const components: Components = {
    code({ node, className, children, ...props }) {
      const isBlock = className != null;
      if (isBlock) {
        const match = /language-([\w./-]+)/.exec(className ?? '');
        const lang = match ? match[1] : '';
        const code = String(children).replace(/\n$/, '');
        const pathLike = isFilePathLike(lang);
        return (
          <div style={{ position: 'relative', margin: '8px 0', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-deep)', padding: '4px 10px', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {lang || 'text'}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(code)}
                  style={{ fontSize: '0.68rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4 }}
                >
                  Copy
                </button>
                {onApplyCode && (
                  <button
                    type="button"
                    onClick={() => onApplyCode(code)}
                    style={{ fontSize: '0.68rem', color: 'var(--coral-bright)', background: 'var(--surface-coral-soft)', border: '1px solid var(--border-accent)', cursor: 'pointer', padding: '2px 8px', borderRadius: 4, fontFamily: 'var(--font-display)', fontWeight: 600 }}
                  >
                    Apply →
                  </button>
                )}
                {onCreateFile && pathLike && (
                  <button
                    type="button"
                    onClick={() => onCreateFile(lang.trim(), code)}
                    style={{ fontSize: '0.68rem', color: 'var(--coral-bright)', background: 'var(--surface-coral-soft)', border: '1px solid var(--border-accent)', cursor: 'pointer', padding: '2px 8px', borderRadius: 4, fontFamily: 'var(--font-display)', fontWeight: 600 }}
                  >
                    Create file
                  </button>
                )}
              </div>
            </div>
            <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--bg-elevated)', overflowX: 'auto', fontSize: '0.78rem', fontFamily: "'JetBrains Mono', 'Fira Code', monospace", color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre' }}>
              <code {...props}>{children}</code>
            </pre>
          </div>
        );
      }
      return (
        <code style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '1px 5px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: 'var(--coral-bright)' }} {...props}>
          {children}
        </code>
      );
    },
    p: ({ children }) => <p style={{ margin: '6px 0', lineHeight: 1.6, fontSize: '0.82rem' }}>{children}</p>,
    ul: ({ children }) => <ul style={{ margin: '6px 0', paddingLeft: 20 }}>{children}</ul>,
    ol: ({ children }) => <ol style={{ margin: '6px 0', paddingLeft: 20 }}>{children}</ol>,
    li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
    strong: ({ children }) => <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>
        {children}
      </a>
    ),
    h1: ({ children }) => <h1 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '10px 0 6px', color: 'var(--text-primary)' }}>{children}</h1>,
    h2: ({ children }) => <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '10px 0 4px', color: 'var(--text-primary)' }}>{children}</h2>,
    h3: ({ children }) => <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '8px 0 4px', color: 'var(--text-primary)' }}>{children}</h3>,
  };

  return (
    <div style={{ wordBreak: 'break-word' }} className="chat-message-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
