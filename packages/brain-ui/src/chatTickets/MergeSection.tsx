/**
 * Consolidate other chats into this one.
 */
import { useState } from 'react';
import { V } from './tokens';
import { S } from './panelStyles';
import { chatSwitcherLabel } from './chatSwitcherLabel';
import type { ChatOptionVM, ChatTicketsLabels } from './types';

export function MergeSection({ chatId, chatList, labels, onMerge, busy }: {
  chatId: number; chatList: ChatOptionVM[]; labels: ChatTicketsLabels;
  onMerge: (ids: number[]) => Promise<void>; busy: boolean;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const candidates = chatList.filter((c) => c.id !== chatId);
  const toggle = (id: number) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  return (
    <div style={{ ...S.section, flexDirection: 'column', alignItems: 'stretch' }}>
      <span style={{ fontSize: 12, color: V.text2 }}>{labels.mergeHint}</span>
      <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {candidates.length === 0 ? <span style={S.muted}>{labels.mergeNoOthers}</span> : candidates.map((c) => (
          <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chatSwitcherLabel({ title: c.title, id: c.id, ticketCount: c.ticketCount, ticketProgressPct: c.ticketProgressPct })}</span>
          </label>
        ))}
      </div>
      <button type="button" onClick={() => { if (selected.length) void onMerge(selected).then(() => setSelected([])); }} disabled={busy || selected.length === 0} style={S.pill(true)}>
        {busy ? '…' : labels.mergeAction(selected.length)}
      </button>
    </div>
  );
}
