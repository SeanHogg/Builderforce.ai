/**
 * The chats that reference one ticket (its lineage), the current chat in bold.
 */
import { V } from './tokens';
import { S } from './panelStyles';
import type { ChatTicketsLabels, LineageVM } from './types';

export function LineageDrawer({ lineage, chatId, labels }: { lineage: readonly LineageVM[]; chatId: string | number; labels: ChatTicketsLabels }) {
  return (
    <div style={S.drawer}>
      <strong style={{ color: V.text }}>{labels.lineageTitle}</strong>
      {lineage.length === 0 ? <span style={{ marginLeft: 8, ...S.muted }}>{labels.lineageEmpty}</span> : (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {lineage.map((c) => (
            <li key={c.chatId} style={{ marginBottom: 2 }}>
              <span style={{ fontWeight: c.chatId === chatId ? 700 : 400 }}>{c.title}</span>
              {c.linkType === 'created' ? <em style={{ color: V.accent, marginLeft: 6 }}>{labels.spawned}</em> : null}
              {c.isArchived ? <span style={{ marginLeft: 6, ...S.muted }}>({labels.merged})</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
