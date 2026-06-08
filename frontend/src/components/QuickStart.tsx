'use client';

import { useEffect, useState } from 'react';

type Mode = 'oneliner' | 'npm' | 'hackable' | 'macos';
type Pm = 'npm' | 'pnpm';
type HackableMode = 'installer' | 'pnpm';
type Os = 'unix' | 'windows';
type WinShell = 'powershell' | 'cmd';

const RELEASES_URL = 'https://github.com/seanhogg/agents/releases/latest';

const COMMENTS = {
  oneliner: {
    stable: "# Works everywhere. Installs everything. You're welcome.",
    beta: '# Living on the edge. Bugs are features you found first.',
  },
  quickInstall: {
    stable: '# Install BuilderForce Agents',
    beta: '# Install BuilderForce Agents (beta) — Fresh from the lab 🧪',
  },
  quickOnboard: {
    stable: '# Meet your agent',
    beta: '# Meet your experimental agent',
  },
} as const;

const WIN_PS = 'iwr -useb https://builderforce.ai/install.ps1 | iex';
const WIN_PS_BETA = '& ([scriptblock]::Create((iwr -useb https://builderforce.ai/install.ps1))) -Tag beta';
const WIN_CMD = 'curl -fsSL https://builderforce.ai/install.cmd -o install.cmd && install.cmd && del install.cmd';
const WIN_CMD_BETA = 'curl -fsSL https://builderforce.ai/install.cmd -o install.cmd && install.cmd --tag beta && del install.cmd';

function detectOs(): Os {
  if (typeof navigator === 'undefined') return 'unix';
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const isWindows = uaData?.platform === 'Windows' || navigator.userAgent.toLowerCase().includes('windows');
  return isWindows ? 'windows' : 'unix';
}

/**
 * Copy-to-clipboard button. Declared at module scope (not inside QuickStart) so
 * it is a stable component identity across renders — `copied`/`onCopy` are threaded
 * in as props rather than closed over.
 */
function CopyBtn({
  text,
  copyKey,
  copied,
  onCopy,
}: {
  text: string;
  copyKey: string;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  return (
    <button
      type="button"
      className="cc-copy-btn"
      onClick={() => onCopy(text, copyKey)}
      aria-label="Copy command"
    >
      {copied === copyKey ? '✓' : '⧉'}
    </button>
  );
}

export default function QuickStart() {
  const [mode, setMode] = useState<Mode>('oneliner');
  const [pm, setPm] = useState<Pm>('npm');
  const [hackable, setHackable] = useState<HackableMode>('installer');
  const [beta, setBeta] = useState(false);
  const [selectedOs, setSelectedOs] = useState<Os>('unix');
  const [osPickerExpanded, setOsPickerExpanded] = useState(false);
  const [winShell, setWinShell] = useState<WinShell>('powershell');
  const [copied, setCopied] = useState<string | null>(null);

  // Detect OS on the client only to avoid a hydration mismatch.
  useEffect(() => {
    setSelectedOs(detectOs());
  }, []);

  const betaMode = beta ? 'beta' : 'stable';
  const osLabel = selectedOs === 'windows' ? 'Windows' : 'macOS/Linux';

  const onelinerCommand = (() => {
    if (selectedOs === 'unix') {
      return beta
        ? 'curl -fsSL https://builderforce.ai/install.sh | bash -s -- --beta'
        : 'curl -fsSL https://builderforce.ai/install.sh | bash';
    }
    if (winShell === 'cmd') return beta ? WIN_CMD_BETA : WIN_CMD;
    return beta ? WIN_PS_BETA : WIN_PS;
  })();

  const quickInstallCommand = (() => {
    const suffix = beta ? '@beta' : '';
    return pm === 'npm'
      ? `npm i -g @seanhogg/builderforce-agents${suffix}`
      : `pnpm add -g @seanhogg/builderforce-agents${suffix}`;
  })();

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      // ignore
    }
  };

  const showOsControls = mode === 'oneliner';
  const showPmControls = mode === 'npm';
  const showHackableControls = mode === 'hackable';
  const showBetaControls = mode === 'oneliner' || mode === 'npm';
  const showWinShellControls = showOsControls && selectedOs === 'windows';

  const selectMode = (m: Mode) => {
    setMode(m);
    setOsPickerExpanded(false);
  };

  return (
    <section className="cc-quickstart">
      <h2 className="cc-section-title">
        <span className="cc-agentHost-accent">⟩</span> Quick Start
      </h2>
      <div className="cc-code-block">
        <div className="cc-code-header">
          <span className="cc-dot" />
          <span className="cc-dot" />
          <span className="cc-dot" />

          <div className="cc-mode-switch">
            {(['oneliner', 'npm', 'hackable', 'macos'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`cc-mode-btn${mode === m ? ' active' : ''}`}
                onClick={() => selectMode(m)}
              >
                {m === 'oneliner' ? 'One-liner' : m === 'npm' ? 'npm' : m === 'hackable' ? 'Hackable' : 'macOS'}
              </button>
            ))}
          </div>

          {showPmControls && (
            <div className="cc-sub-switch">
              {(['npm', 'pnpm'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`cc-sub-btn${pm === p ? ' active' : ''}`}
                  onClick={() => setPm(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {showHackableControls && (
            <div className="cc-sub-switch">
              {(['installer', 'pnpm'] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  className={`cc-sub-btn${hackable === h ? ' active' : ''}`}
                  onClick={() => setHackable(h)}
                >
                  {h}
                </button>
              ))}
            </div>
          )}

          {showOsControls && !osPickerExpanded && (
            <div className="cc-os-indicator">
              <span className="cc-os-detected">{osLabel}</span>
              <button type="button" className="cc-os-change-btn" onClick={() => setOsPickerExpanded(true)}>
                change
              </button>
            </div>
          )}

          {showOsControls && osPickerExpanded && (
            <div className="cc-sub-switch">
              <button
                type="button"
                className={`cc-sub-btn${selectedOs === 'unix' ? ' active' : ''}`}
                onClick={() => {
                  setSelectedOs('unix');
                  setOsPickerExpanded(false);
                }}
              >
                macOS/Linux
              </button>
              <button
                type="button"
                className={`cc-sub-btn${selectedOs === 'windows' ? ' active' : ''}`}
                onClick={() => {
                  setSelectedOs('windows');
                  setOsPickerExpanded(false);
                }}
              >
                Windows
              </button>
            </div>
          )}

          {showWinShellControls && (
            <div className="cc-sub-switch">
              {(['powershell', 'cmd'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`cc-sub-btn${winShell === s ? ' active' : ''}`}
                  onClick={() => setWinShell(s)}
                >
                  {s === 'powershell' ? 'PowerShell' : 'CMD'}
                </button>
              ))}
            </div>
          )}

          {showBetaControls && (
            <div className="cc-beta-switch">
              <button
                type="button"
                className={`cc-beta-btn${beta ? ' active' : ''}`}
                onClick={() => setBeta((b) => !b)}
              >
                <span className="cc-beta-label">β</span>
                <span className="cc-beta-text">Beta</span>
              </button>
            </div>
          )}
        </div>

        <div className="cc-code-content">
          {mode === 'oneliner' && (
            <>
              <div className="cc-code-line cc-comment">{COMMENTS.oneliner[betaMode]}</div>
              <div className="cc-code-line cc-cmd">
                <span className="cc-prompt">$</span>
                <span className="cc-cmd-text">{onelinerCommand}</span>
                <CopyBtn text={onelinerCommand} copyKey="oneliner" copied={copied} onCopy={copy} />
              </div>
            </>
          )}

          {mode === 'npm' && (
            <>
              <div className="cc-code-line cc-comment">{COMMENTS.quickInstall[betaMode]}</div>
              <div className="cc-code-line cc-cmd">
                <span className="cc-prompt">$</span>
                <span className="cc-cmd-text">{quickInstallCommand}</span>
                <CopyBtn text={quickInstallCommand} copyKey="install" copied={copied} onCopy={copy} />
              </div>
              <div className="cc-code-line cc-comment">{COMMENTS.quickOnboard[betaMode]}</div>
              <div className="cc-code-line cc-cmd">
                <span className="cc-prompt">$</span>
                <span className="cc-cmd-text">builderforce onboard</span>
                <CopyBtn text="builderforce onboard" copyKey="onboard" copied={copied} onCopy={copy} />
              </div>
            </>
          )}

          {mode === 'hackable' && hackable === 'installer' && (
            <>
              <div className="cc-code-line cc-comment"># For those who read source code for fun</div>
              <div className="cc-code-line cc-cmd">
                <span className="cc-prompt">$</span>
                <span className="cc-cmd-text">curl -fsSL https://builderforce.ai/install.sh | bash -s -- --install-method git</span>
                <CopyBtn
                  text="curl -fsSL https://builderforce.ai/install.sh | bash -s -- --install-method git"
                  copyKey="hackable-installer"
                  copied={copied}
                  onCopy={copy}
                />
              </div>
            </>
          )}

          {mode === 'hackable' && hackable === 'pnpm' && (
            <>
              <div className="cc-code-line cc-comment"># You clearly know what you&apos;re doing</div>
              <div className="cc-code-line cc-cmd">
                <span className="cc-prompt">$</span>
                <span className="cc-cmd-text">git clone https://github.com/seanhogg/agents.git</span>
                <CopyBtn text="git clone https://github.com/seanhogg/agents.git" copyKey="clone" copied={copied} onCopy={copy} />
              </div>
              <div className="cc-code-line cc-cmd">
                <span className="cc-prompt">$</span>
                <span className="cc-cmd-text">cd builderforce-agents &amp;&amp; pnpm install &amp;&amp; pnpm run build</span>
                <CopyBtn text="cd builderforce-agents && pnpm install && pnpm run build" copyKey="build" copied={copied} onCopy={copy} />
              </div>
              <div className="cc-code-line cc-comment"># You built it, now meet it</div>
              <div className="cc-code-line cc-cmd">
                <span className="cc-prompt">$</span>
                <span className="cc-cmd-text">pnpm run builderforce onboard</span>
                <CopyBtn text="pnpm run builderforce onboard" copyKey="hackable-onboard" copied={copied} onCopy={copy} />
              </div>
            </>
          )}

          {mode === 'macos' && (
            <div className="cc-macos">
              <div className="cc-macos-desc">
                <span className="cc-macos-tagline">Companion App (Beta)</span>
                <span className="cc-macos-subtitle">Menubar access to your agent. Works great alongside the CLI.</span>
              </div>
              <a href={RELEASES_URL} className="cc-macos-btn" target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download for macOS
              </a>
              <span className="cc-macos-meta">Requires macOS 14+ · Universal Binary</span>
            </div>
          )}
        </div>
      </div>

      <p className="cc-quickstart-note">
        Works on macOS, Windows &amp; Linux. The one-liner installs Node.js and everything else for you.
      </p>

      <style>{`
        .cc-quickstart {
          max-width: 1200px;
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
        .cc-agentHost-accent {
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
        .cc-sub-switch {
          display: flex;
          gap: 4px;
          margin-left: 4px;
          padding-left: 8px;
          border-left: 1px solid rgba(255,255,255,0.08);
        }
        .cc-sub-btn {
          background: transparent;
          color: rgba(240,244,255,0.45);
          border: 1px solid transparent;
          padding: 3px 9px;
          border-radius: 6px;
          font-size: 0.72rem;
          font-family: var(--font-display);
          cursor: pointer;
          transition: all 0.15s;
        }
        .cc-sub-btn:hover {
          color: var(--text-primary);
          background: rgba(255,255,255,0.05);
        }
        .cc-sub-btn.active {
          color: var(--coral-bright);
          background: rgba(77,158,255,0.1);
          border-color: rgba(77,158,255,0.25);
        }
        .cc-os-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-left: 4px;
          padding-left: 8px;
          border-left: 1px solid rgba(255,255,255,0.08);
        }
        .cc-os-detected {
          color: rgba(240,244,255,0.55);
          font-size: 0.72rem;
        }
        .cc-os-change-btn {
          background: transparent;
          color: rgba(240,244,255,0.4);
          border: none;
          padding: 0;
          font-size: 0.72rem;
          font-family: var(--font-display);
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 2px;
          transition: color 0.15s;
        }
        .cc-os-change-btn:hover {
          color: var(--coral-bright);
        }
        .cc-beta-switch {
          display: flex;
          margin-left: auto;
        }
        .cc-beta-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: transparent;
          color: rgba(240,244,255,0.45);
          border: 1px solid rgba(255,255,255,0.12);
          padding: 3px 10px;
          border-radius: 999px;
          font-size: 0.72rem;
          font-family: var(--font-display);
          cursor: pointer;
          transition: all 0.15s;
        }
        .cc-beta-btn:hover {
          color: var(--text-primary);
          border-color: rgba(255,255,255,0.22);
        }
        .cc-beta-btn.active {
          color: var(--coral-bright);
          background: rgba(77,158,255,0.12);
          border-color: rgba(77,158,255,0.35);
        }
        .cc-beta-label {
          font-weight: 700;
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
        .cc-macos {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 14px;
          padding: 8px 0;
        }
        .cc-macos-desc {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .cc-macos-tagline {
          color: #f0f4ff;
          font-weight: 600;
        }
        .cc-macos-subtitle {
          color: rgba(136,146,176,0.9);
          font-size: 0.82rem;
        }
        .cc-macos-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(77,158,255,0.12);
          color: var(--coral-bright);
          border: 1px solid rgba(77,158,255,0.3);
          padding: 8px 16px;
          border-radius: 9px;
          font-size: 0.85rem;
          font-family: var(--font-display);
          text-decoration: none;
          transition: all 0.15s;
        }
        .cc-macos-btn:hover {
          background: rgba(77,158,255,0.2);
        }
        .cc-macos-btn svg {
          width: 16px;
          height: 16px;
        }
        .cc-macos-meta {
          color: rgba(136,146,176,0.7);
          font-size: 0.74rem;
        }
        .cc-quickstart-note {
          margin: 14px 2px 0;
          color: var(--text-secondary);
          font-size: 0.82rem;
        }
      `}</style>
    </section>
  );
}
