'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DaysWindowSelect } from './LensShell';
import { WidgetGrid } from '@/components/widgets/WidgetGrid';
import { CHAT_MODE_WIDGET_IDS, useChatModes } from './widgets/chatModeWidgets';
import { rowFor, executionRate } from '@/lib/chatModeApi';
import { int } from './format';

/**
 * LENS — "Conversations vs Executions": how much of what people start here is a
 * question, how much is work handed over, and how much of that work a machine
 * actually picked up.
 *
 * The verdict line above the grid is deliberate and is the point of the lens. The
 * cards can each be read as a healthy number in isolation — plenty of Work
 * conversations, plenty of tickets opened — while the thing that matters (did any of
 * it RUN) is a ratio between two of them. Stating it in a sentence means the report
 * answers the question rather than leaving the reader to divide.
 *
 * Tenant-wide by design: unlike the delivery lenses this is not project-scoped,
 * because the question is about how the product is being used, not about one board.
 */
export function ChatModeLens() {
  const t = useTranslations('insights');
  const [days, setDays] = useState(30);
  // The SAME deduped read the cards use — the verdict costs no extra request.
  const { data } = useChatModes(days);

  const work = rowFor(data, 'work');
  const chat = rowFor(data, 'chat');
  const rate = executionRate(work);
  const canvas = (data?.canvasSessions ?? []).reduce((sum, r) => sum + r.sessions, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <p style={{ margin: 0, flex: '1 1 260px', minWidth: 0, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
          {data
            ? rate == null
              ? t('chatModes.verdictNoWork', { chat: int(chat.conversations), work: int(work.conversations) })
              : t('chatModes.verdict', {
                  work: int(work.conversations),
                  chat: int(chat.conversations),
                  dispatched: int(work.ticketsDispatched),
                  linked: int(work.ticketsLinked),
                })
            : t('chatModes.subtitle')}
        </p>
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>

      {/* The Canvas is the other conversation surface and carries the same mode, so
          a report that counted only Brain chats would understate the picture. */}
      {canvas > 0 && (
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {t('chatModes.canvasNote', {
            sessions: int(canvas),
            work: int((data?.canvasSessions ?? []).find((r) => r.mode === 'work')?.sessions ?? 0),
          })}
        </p>
      )}

      <WidgetGrid ids={CHAT_MODE_WIDGET_IDS} days={days} showDrill={false} />
    </div>
  );
}
