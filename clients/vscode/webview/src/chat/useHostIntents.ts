/**
 * Host-driven intents: the Sessions sidebar and the task / project-page commands drive
 * this singleton panel — open a fresh chat, focus an existing one, or open a chat
 * scoped to (and linked with) a work item, the prompt pre-filled. Lifted out of the
 * chat surface unchanged.
 */

import { useEffect } from 'react';
import type { BrainPersistenceAdapter } from '@seanhogg/builderforce-brain-embedded';
import { onIntent, type BrainIntent } from '../vscodeBridge';

export function useHostIntents({ persistence, projectId, setChatId, setInput, reloadChats, linkOpenedTicket, t }: {
  persistence: BrainPersistenceAdapter;
  /** The sidebar's project — a seeded chat lands there when its item names none. */
  projectId: number | null;
  setChatId: (id: number | null) => void;
  setInput: (text: string) => void;
  reloadChats: () => void;
  linkOpenedTicket: (chatId: number, ticket: { kind: string; ref: string }) => Promise<void>;
  t: (key: string, fallback: string) => string;
}) {
  useEffect(() => {
    return onIntent((intent: BrainIntent) => {
      if (intent.kind === 'new') {
        setChatId(null);
        setInput('');
      } else if (intent.kind === 'seed') {
        if (intent.ticket) {
          // A project-page row (roadmap/spec/…): create the chat eagerly, seed the
          // prompt, and link the item — the rail then shows the linked ticket.
          const ticket = intent.ticket;
          const seedTitle = (ticket.title ?? intent.text ?? t('app.newChat', 'New chat')).slice(0, 60);
          persistence
            .createChat({ title: seedTitle, projectId: ticket.projectId ?? projectId ?? null })
            .then((chat) => {
              setChatId(chat.id);
              setInput(intent.text ?? '');
              reloadChats();
              void linkOpenedTicket(chat.id, ticket);
            })
            .catch(() => {});
        } else {
          // Ticket-less editor entry point (review PRs / fix errors / open a PR): open a
          // fresh chat with the prompt pre-filled; the user can tweak before sending.
          setChatId(null);
          setInput(intent.text ?? '');
        }
      } else if (intent.kind === 'focus' && intent.chatId != null) {
        setChatId(intent.chatId);
      } else if (intent.kind === 'task' && intent.task) {
        const task = intent.task;
        const title = `${task.key ? `${task.key} ` : ''}${task.title}`.slice(0, 60);
        persistence
          .createChat({ title, projectId: task.projectId ?? null })
          .then((chat) => {
            setChatId(chat.id);
            const taskLabel = `${task.key ? `${task.key}: ` : ''}${task.title}`;
            const template = task.dispatched
              ? t('app.taskSeedDispatched', "I just dispatched {task} to run on the platform. Check the latest execution's status and trace, then help me follow up.")
              : t('app.taskSeed', "Let's work on {task}.");
            setInput(template.replace('{task}', taskLabel));
            reloadChats();
            // Link the task/epic/gap it was opened for (a host-supplied ticket wins;
            // else derive the kind from the task's own type).
            const ticket = intent.ticket
              ?? { kind: task.taskType === 'epic' ? 'epic' : task.taskType === 'gap' ? 'gap' : 'task', ref: String(task.id) };
            void linkOpenedTicket(chat.id, ticket);
          })
          .catch(() => {});
      }
    });
    // Same keys as before the lift: `setChatId` / `setInput` are stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistence, reloadChats, t, linkOpenedTicket, projectId]);
}
