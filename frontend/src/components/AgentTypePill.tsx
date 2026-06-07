/**
 * The small uppercase designator pill shown on every agent card — Cloud / Remote
 * / Marketplace. Single source of truth; previously `TypePill` lived inside
 * WorkforceAgents and its style object was also copy-pasted for the "Marketplace"
 * and "Agent" pills elsewhere.
 */
export type AgentPillKind = 'cloud' | 'host' | 'marketplace';

const LABELS: Record<AgentPillKind, string> = {
  cloud: 'Cloud',
  host: 'Remote',
  marketplace: 'Marketplace',
};

export function AgentTypePill({ kind, label }: { kind: AgentPillKind; label?: string }) {
  // Remote/host is neutral; cloud + marketplace use the coral accent.
  const neutral = kind === 'host';
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        padding: '2px 7px',
        borderRadius: 6,
        background: neutral ? 'var(--bg-elevated)' : 'var(--surface-coral-soft)',
        color: neutral ? 'var(--text-strong)' : 'var(--accent)',
        border: '1px solid var(--border)',
      }}
    >
      {label ?? LABELS[kind]}
    </span>
  );
}
