/**
 * The small uppercase designator pill shown on every agent card — Cloud / Remote
 * / Marketplace. Single source of truth; previously `TypePill` lived inside
 * WorkforceAgents and its style object was also copy-pasted for the "Marketplace"
 * and "Agent" pills elsewhere.
 */
export type AgentPillKind = 'cloud' | 'host' | 'marketplace' | 'human' | 'pending' | 'vscode';

const LABELS: Record<AgentPillKind, string> = {
  cloud: 'Cloud',
  host: 'Remote',
  marketplace: 'Marketplace',
  human: 'Human',
  pending: 'Pending',
  vscode: 'VS Code',
};

// Three palettes: coral accent (agents), amber (pending invite), neutral (human/host).
type Palette = { background: string; color: string };
const ACCENT: Palette = { background: 'var(--surface-coral-soft)', color: 'var(--accent)' };
const NEUTRAL: Palette = { background: 'var(--bg-elevated)', color: 'var(--text-strong)' };
const AMBER: Palette = { background: 'rgba(245,158,11,0.15)', color: '#d97706' };

const PALETTES: Record<AgentPillKind, Palette> = {
  cloud: ACCENT,
  marketplace: ACCENT,
  host: NEUTRAL,
  human: NEUTRAL,
  pending: AMBER,
  vscode: NEUTRAL,
};

export function AgentTypePill({ kind, label }: { kind: AgentPillKind; label?: string }) {
  const palette = PALETTES[kind];
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        padding: '2px 7px',
        borderRadius: 6,
        background: palette.background,
        color: palette.color,
        border: '1px solid var(--border)',
      }}
    >
      {label ?? LABELS[kind]}
    </span>
  );
}
