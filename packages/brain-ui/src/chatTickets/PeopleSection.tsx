/**
 * The people in the chat — members and pending invites — and the chat's lock.
 */
import { useState } from 'react';
import { S } from './panelStyles';
import type { ChatMemberVM, ChatTicketsLabels } from './types';

export function PeopleSection({ members, labels, visibility, onSetVisibility, onInvite, onRemove, busy }: {
  members: ChatMemberVM[]; labels: ChatTicketsLabels;
  visibility?: 'shared' | 'locked'; onSetVisibility?: (v: 'shared' | 'locked') => Promise<void>;
  onInvite: (email: string) => Promise<void>; onRemove: (id: number) => Promise<void>; busy: boolean;
}) {
  const [email, setEmail] = useState('');
  const submit = async () => {
    const e = email.trim();
    if (!e) return;
    await onInvite(e);
    setEmail('');
  };
  const locked = visibility === 'locked';
  return (
    <div style={{ ...S.section, flexDirection: 'column', alignItems: 'stretch' }}>
      {visibility && onSetVisibility && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} onClick={() => void onSetVisibility(locked ? 'shared' : 'locked')} style={S.pill(locked)}>
            {locked ? `🔒 ${labels.visibilityLocked}` : `🔓 ${labels.visibilityShared}`}
          </button>
          <span style={{ fontSize: 11, ...S.muted }}>{labels.lockHint}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {members.length === 0 ? <span style={S.muted}>{labels.noPeople}</span> : members.map((m) => (
          <span key={m.id} style={S.agentChip}>
            <span aria-hidden>{m.status === 'pending' ? '✉️' : '👤'}</span>{m.name}
            <button type="button" title={labels.removePerson} disabled={busy} onClick={() => void onRemove(m.id)} style={{ ...S.icon, fontSize: 11 }}>✕</button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="email" value={email} disabled={busy}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          placeholder={labels.invitePerson} aria-label={labels.invitePerson}
          style={{ ...S.select, flex: 1, maxWidth: 260 }}
        />
        <button type="button" disabled={busy || !email.trim()} onClick={() => void submit()} style={S.pill(false)}>＋</button>
      </div>
      <span style={{ fontSize: 11, ...S.muted }}>{labels.invitePersonHint}</span>
    </div>
  );
}
