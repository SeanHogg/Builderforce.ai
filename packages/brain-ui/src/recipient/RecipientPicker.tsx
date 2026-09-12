import React from 'react';
import type { DirectedRecipient, RecipientChoice } from '@seanhogg/builderforce-brain-embedded';
import { Avatar } from '../ParticipantBadge';
import { IconBolt, PickerItem, PickerShell } from '../picker/PickerShell';

export interface RecipientPickerLabels {
  /** Eyebrow on the pill, e.g. "To". */
  to: string;
  /** Names the control and heads its list, e.g. "Send to". */
  title: string;
  /** The BRAIN row, e.g. "BuilderForce". */
  brain: string;
  /** What sending to the BRAIN does, e.g. "Runs it". */
  brainHint: string;
  /** What sending to an invited agent does, e.g. "Replies & acts". */
  agentHint: string;
  /** What sending to an invited person does, e.g. "Notified". */
  humanHint: string;
}

export const DEFAULT_RECIPIENT_PICKER_LABELS: RecipientPickerLabels = {
  to: 'To',
  title: 'Send to',
  brain: 'BuilderForce',
  brainHint: 'Runs it',
  agentHint: 'Replies & acts',
  humanHint: 'Notified',
};

export interface RecipientPickerProps {
  /** The chat's invited participants. None ⇒ the control does not render. */
  participants: readonly DirectedRecipient[];
  /** The EFFECTIVE recipient of the next message (null = the BRAIN). */
  recipient: DirectedRecipient | null;
  /** An explicit pick: the BRAIN, or a participant. */
  onChoose: (choice: Exclude<RecipientChoice, null>) => void;
  labels?: Partial<RecipientPickerLabels>;
  disabled?: boolean;
  /** Wrap the chosen participant's avatar — the web adds its personality hovercard. */
  renderAvatar?: (recipient: DirectedRecipient, avatar: React.ReactNode) => React.ReactNode;
}

/**
 * The composer's "To" control: who the next message goes to. The BRAIN (the default)
 * executes it; an invited agent replies and can act; an invited person is notified.
 * ONE control for the web composer and the VS Code webview, so the two cannot route a
 * message differently or describe the same choice in different words.
 *
 * Self-gating: a chat with no participants has nothing to route, so nothing renders.
 */
export function RecipientPicker({ participants, recipient, onChoose, labels, disabled, renderAvatar }: RecipientPickerProps) {
  if (participants.length === 0) return null;
  const l = { ...DEFAULT_RECIPIENT_PICKER_LABELS, ...labels };
  const avatar = recipient ? <Avatar name={recipient.name} kind={recipient.kind} size={16} /> : <IconBolt />;
  return (
    <PickerShell
      eyebrow={l.to}
      leading={recipient && renderAvatar ? renderAvatar(recipient, avatar) : avatar}
      name={recipient ? recipient.name : l.brain}
      title={l.title}
      active={recipient != null}
      disabled={disabled}
    >
      {(close) => (
        <>
          <div className="bf-pmenu__group">{l.title}</div>
          <PickerItem
            icon={<IconBolt />}
            label={l.brain}
            hint={l.brainHint}
            active={recipient == null}
            onClick={() => { onChoose('brain'); close(); }}
          />
          {participants.map((p) => (
            <PickerItem
              key={`${p.kind}:${p.ref}`}
              icon={<Avatar name={p.name} kind={p.kind} size={16} />}
              label={p.name}
              hint={p.kind === 'agent' ? l.agentHint : l.humanHint}
              active={recipient?.kind === p.kind && recipient.ref === p.ref}
              onClick={() => { onChoose(p); close(); }}
            />
          ))}
        </>
      )}
    </PickerShell>
  );
}
