import {
  DEFAULT_PERSONA,
  agentPersonaChoice,
  modalityPersonaChoice,
  personaAgentOf,
  type BrainPersonaAgent,
  type BrainPersonaChoice,
} from '@seanhogg/builderforce-brain-embedded';
import { Avatar } from '../ParticipantBadge';
import { IconBolt, PickerItem, PickerShell } from '../picker/PickerShell';

export interface PersonaPickerLabels {
  /** Eyebrow on the pill, e.g. "Acting as". */
  actingAs: string;
  /** Names the control, e.g. "Brain agent or persona". */
  title: string;
  defaultBrain: string;
  /** Heading over the modality personas. */
  personas: string;
  /** Heading over the Brain-assigned agents. */
  assignedAgents: string;
}

export const DEFAULT_PERSONA_PICKER_LABELS: PersonaPickerLabels = {
  actingAs: 'Acting as',
  title: 'Brain agent or persona',
  defaultBrain: 'Default Brain',
  personas: 'Personas',
  assignedAgents: 'Assigned agents',
};

/** A modality persona as the host names it (the label is the host's translation). */
export interface PersonaModalityOption {
  id: string;
  label: string;
  icon?: string;
}

export interface PersonaPickerProps {
  value: BrainPersonaChoice;
  onChange: (value: BrainPersonaChoice) => void;
  modalities: readonly PersonaModalityOption[];
  /** Agents assigned to the Brain; the group is omitted when there are none. */
  agents: readonly BrainPersonaAgent[];
  labels?: Partial<PersonaPickerLabels>;
  disabled?: boolean;
}

/**
 * The composer's "Acting as" control: WHO the Brain answers as — the default Brain,
 * a modality persona, or an agent assigned to the Brain. ONE control for the web
 * composer and the VS Code webview; what a choice DOES to the run is the shared
 * persona domain's (`brainPersona.ts`), so this component only offers and names.
 */
export function PersonaPicker({ value, onChange, modalities, agents, labels, disabled }: PersonaPickerProps) {
  const l = { ...DEFAULT_PERSONA_PICKER_LABELS, ...labels };
  const modality = modalities.find((m) => modalityPersonaChoice(m.id) === value);
  const agent = personaAgentOf(value, agents);
  const leading = agent
    ? <Avatar name={agent.name} kind="agent" size={16} />
    : modality?.icon ? <span aria-hidden="true">{modality.icon}</span> : <IconBolt />;
  return (
    <PickerShell
      eyebrow={l.actingAs}
      leading={leading}
      name={modality?.label ?? agent?.name ?? l.defaultBrain}
      title={l.title}
      active={value !== DEFAULT_PERSONA && (modality != null || agent != null)}
      disabled={disabled}
    >
      {(close) => {
        const pick = (next: BrainPersonaChoice) => { onChange(next); close(); };
        return (
          <>
            <PickerItem icon={<IconBolt />} label={l.defaultBrain} active={!modality && !agent} onClick={() => pick(DEFAULT_PERSONA)} />
            {modalities.length > 0 && (
              <>
                <div className="bf-pmenu__sep" />
                <div className="bf-pmenu__group">{l.personas}</div>
                {modalities.map((m) => (
                  <PickerItem
                    key={m.id}
                    icon={m.icon ?? ''}
                    label={m.label}
                    active={modality?.id === m.id}
                    onClick={() => pick(modalityPersonaChoice(m.id))}
                  />
                ))}
              </>
            )}
            {agents.length > 0 && (
              <>
                <div className="bf-pmenu__sep" />
                <div className="bf-pmenu__group">{l.assignedAgents}</div>
                {agents.map((a) => (
                  <PickerItem
                    key={agentPersonaChoice(a)}
                    icon={<Avatar name={a.name} kind="agent" size={16} />}
                    label={a.name}
                    active={agent != null && agentPersonaChoice(agent) === agentPersonaChoice(a)}
                    onClick={() => pick(agentPersonaChoice(a))}
                  />
                ))}
              </>
            )}
          </>
        );
      }}
    </PickerShell>
  );
}
