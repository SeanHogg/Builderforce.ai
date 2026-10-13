/** Shared chrome for WorkforceAgents — invite button + remote-host card. */

export type AgentKind = 'cloud' | 'host';

// "Invite" (a person) — secondary to the coral "+ Agent" split button.
export const inviteBtn: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  background: 'transparent',
  color: 'var(--accent)',
  border: '1px solid var(--accent)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

// Host (remote agentHost) card chrome — cloud/purchased agents render via <AgentCard>.
export const cardStyle: React.CSSProperties = {
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  position: 'relative',
};
