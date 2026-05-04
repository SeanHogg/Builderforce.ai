'use client';

import { useState } from 'react';

type Mode = 'oneliner' | 'npm' | 'git';

const COMMANDS: Record<Mode, { comment: string; cmd: string }[]> = {
  oneliner: [
    { comment: '# Works everywhere. Installs everything. You\'re welcome. 🦞', cmd: 'curl -fsSL https://coderclaw.ai/install.sh | bash' },
  ],
  npm: [
    { comment: '# Install CoderClaw', cmd: 'npm i -g coderclaw' },
    { comment: '# Meet your lobster', cmd: 'coderclaw onboard' },
  ],
  git: [
    { comment: '# Hackable build from source', cmd: 'git clone https://github.com/seanhogg/coderclaw.git' },
    { comment: '', cmd: 'cd coderclaw && pnpm install && pnpm run build' },
    { comment: '# You built it, now meet it', cmd: 'pnpm run coderclaw onboard' },
  ],
};

export default function QuickStart() {
  const [mode, setMode] = useState<Mode>('oneliner');
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <section className="cc-quickstart">
      <h2 className="cc-section-title">
        <span className="cc-claw-accent">⟩</span> Quick Start
      </h2>
      <div className="cc-code-block">
        <div className="cc-code-header">
          <span className="cc-dot" />
          <span className="cc-dot" />
          <span className="cc-dot" />
          <div className="cc-mode-switch">
            {(['oneliner', 'npm', 'git'] as const).map((m) => (
              <button
                key={m}
                className={`cc-mode-btn${mode === m ? ' active' : ''}`}
                onClick={() => setMode(m)}
                type="button"
              >
                {m === 'oneliner' ? 'One-liner' : m === 'npm' ? 'npm' : 'From source'}
              </button>
            ))}
          </div>
        </div>
        <div className="cc-code-content">
          {COMMANDS[mode].map((line, i) => (
            <div key={i}>
              {line.comment && <div className="cc-code-line cc-comment">{line.comment}</div>}
              <div className="cc-code-line cc-cmd">
                <span className="cc-prompt">$</span>
                <span className="cc-cmd-text">{line.cmd}</span>
                <button
                  type="button"
                  className="cc-copy-btn"
                  onClick={() => copy(line.cmd, `${mode}-${i}`)}
                  aria-label="Copy command"
                >
                  {copied === `${mode}-${i}` ? '✓' : '⧉'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <style>{`
        .cc-quickstart {
          max-width: 820px;
          margin: 48px auto 0;
          padding: 0 24px;
        }
        .cc-section-title {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: clamp(1.5rem, 3vw, 2rem);
          margin-bottom: 24px;
          color: var(--text-primary);
        }
        .cc-claw-accent {
          color: var(--coral-bright);
          margin-right: 8px;
        }
        .cc-code-block {
          background: #0a0f1a;
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          overflow: hidden;
          font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
          font-size: 0.875rem;
        }
        .cc-code-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.02);
          flex-wrap: wrap;
        }
        .cc-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: rgba(255,255,255,0.18);
        }
        .cc-mode-switch {
          display: flex;
          gap: 4px;
          margin-left: 12px;
        }
        .cc-mode-btn {
          background: transparent;
          color: rgba(240,244,255,0.6);
          border: 1px solid transparent;
          padding: 4px 10px;
          border-radius: 7px;
          font-size: 0.78rem;
          font-family: var(--font-display);
          cursor: pointer;
          transition: all 0.15s;
        }
        .cc-mode-btn:hover {
          color: var(--text-primary);
          background: rgba(255,255,255,0.05);
        }
        .cc-mode-btn.active {
          color: var(--coral-bright);
          background: rgba(77,158,255,0.12);
          border-color: rgba(77,158,255,0.3);
        }
        .cc-code-content {
          padding: 18px 20px;
          color: #f0f4ff;
        }
        .cc-code-line {
          padding: 4px 0;
          line-height: 1.5;
        }
        .cc-comment {
          color: rgba(136,146,176,0.75);
        }
        .cc-cmd {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .cc-prompt {
          color: var(--coral-bright);
          user-select: none;
        }
        .cc-cmd-text {
          flex: 1;
          color: #e0e6f5;
          word-break: break-all;
        }
        .cc-copy-btn {
          background: transparent;
          color: rgba(240,244,255,0.5);
          border: none;
          cursor: pointer;
          padding: 4px 8px;
          font-size: 0.95rem;
          border-radius: 6px;
          transition: color 0.15s, background 0.15s;
        }
        .cc-copy-btn:hover {
          color: var(--coral-bright);
          background: rgba(77,158,255,0.1);
        }
      `}</style>
    </section>
  );
}
