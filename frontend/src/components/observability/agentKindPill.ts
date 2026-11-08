/**
 * The kind pill on an Observability agent chip: ONE mapping from an agent's kind to the
 * pill's localized label key (`observability.agentKind.<kind>`) and its theme-token colors.
 * Each kind owns its own label, so a CLOUD run can never read as ON-PREM.
 */
export type AgentKind = 'host' | 'cloud' | 'vscode';

export interface AgentKindPill {
  /** Key under the `observability` namespace. */
  labelKey: `agentKind.${AgentKind}`;
  bg: string;
  color: string;
}

export const AGENT_KIND_PILL: Record<AgentKind, AgentKindPill> = {
  host: { labelKey: 'agentKind.host', bg: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
  cloud: { labelKey: 'agentKind.cloud', bg: 'var(--surface-coral-soft)', color: 'var(--accent)' },
  vscode: { labelKey: 'agentKind.vscode', bg: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
};
