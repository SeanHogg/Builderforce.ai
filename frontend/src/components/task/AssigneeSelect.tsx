import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import type { AgentHost } from '@/lib/builderforceApi';
import {
  assigneeSelectValue,
  parseAssigneeSelectValue,
  type AssigneePatch,
  type CloudAgentTarget,
  type TeamMember,
} from '@/lib/taskAssignee';

/**
 * Assignee picker shared by the create dialog and the drawer's inline editor.
 * Lists human teammates, self-hosted agent hosts, and cloud agents in grouped
 * sections and emits the mutually-exclusive
 * (assignedAgentHostId | assignedAgentRef | assignedUserId) patch.
 */
export function AssigneeSelect({
  hosts,
  cloudAgents,
  members,
  hostId,
  agentRef,
  userId,
  onChange,
  autoFocus,
  disabled,
  onBlur,
  style,
}: {
  hosts: AgentHost[];
  cloudAgents: CloudAgentTarget[];
  members: TeamMember[];
  hostId?: number | null;
  agentRef?: string | null;
  userId?: string | null;
  onChange: (patch: AssigneePatch) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  onBlur?: () => void;
  style?: CSSProperties;
}) {
  const t = useTranslations('taskMgmt');
  return (
    <Select
      autoFocus={autoFocus}
      disabled={disabled}
      onBlur={onBlur}
      value={assigneeSelectValue(hostId, agentRef, userId)}
      onChange={(e) => onChange(parseAssigneeSelectValue(e.target.value))}
      style={style}
    >
      <option value="">{t('unassigned')}</option>
      {members.length > 0 && (
        <optgroup label={t('teamMembers')}>
          {members.map((m) => (
            <option key={`u:${m.id}`} value={`u:${m.id}`}>{m.name}</option>
          ))}
        </optgroup>
      )}
      {hosts.length > 0 && (
        <optgroup label={t('agentHosts')}>
          {hosts.map((h) => (
            <option key={`h:${h.id}`} value={`h:${h.id}`}>{h.name}</option>
          ))}
        </optgroup>
      )}
      {cloudAgents.length > 0 && (
        <optgroup label={t('cloudAgents')}>
          {cloudAgents.map((a) => (
            <option key={`c:${a.ref}`} value={`c:${a.ref}`}>{a.name}</option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}
