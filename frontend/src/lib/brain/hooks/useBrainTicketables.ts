import { useCallback, useEffect, useState } from 'react';
import type { TicketTag } from '@seanhogg/builderforce-brain-embedded';
import { brain, tasksApi } from '@/lib/builderforceApi';
import { dispatchBrainDataChanged } from '@/lib/brain/brainDataEvent';

/** #ticket autocomplete — the tickets the composer can tag, and the tag handler. */
export function useBrainTicketables(ticketProjectId: number | null, activeChatId: number | null) {
  // #ticket autocomplete — tickets available to tag in the composer.
  const [ticketables, setTicketables] = useState<TicketTag[]>([]);
  // No project in context ⇒ nothing to tag. Cleared while rendering, the moment the
  // project goes away (React's "adjust state when a prop changes"), not by an effect.
  const [prevProjectId, setPrevProjectId] = useState(ticketProjectId);
  if (prevProjectId !== ticketProjectId) {
    setPrevProjectId(ticketProjectId);
    if (ticketProjectId == null) setTicketables([]);
  }
  useEffect(() => {
    if (ticketProjectId == null) return;
    let live = true;
    tasksApi.list(ticketProjectId).then((tasks) => {
      if (!live) return;
      setTicketables(tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, key: t.key, ref: `#${t.id}` })));
    }).catch(() => { if (live) setTicketables([]); });
    return () => { live = false; };
  }, [ticketProjectId]);

  // Handle a ticket tagged in the composer — link it to the active chat.
  const handleTicketTag = useCallback((t: TicketTag) => {
    if (activeChatId == null) return;
    brain.linkChatTicket(activeChatId, { kind: 'task', ref: String(t.id) })
      .then(() => dispatchBrainDataChanged({ domain: 'brain', method: 'link' }))
      .catch(() => { /* global error surface */ });
  }, [activeChatId]);

  return { ticketables, handleTicketTag };
}
