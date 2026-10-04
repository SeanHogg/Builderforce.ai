/** Connected mailboxes on the board — add an inbox, refresh it, pin an email. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { describeMailboxFilter, mailboxApi, type MailboxFilter, resolveMailboxConnection } from '@/lib/mailboxApi';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import type { CanvasActionContext } from './context';

export function canvasInboxActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, fmt, stage } = ctx;
  return [  {
    /**
     * The whole point of "show me my inbox on the canvas".
     *
     * A dedicated action rather than `canvas_add_object` with hand-authored
     * fields, because a model cannot invent someone's real mail: this READS the
     * connected mailbox and puts what is actually there on the board. It also
     * stores the `filter` alongside the messages, which is what makes the tile a
     * live, reproducible view rather than a one-off screenshot — `canvas_refresh_inbox`
     * re-runs exactly the same query later.
     */
    name: 'canvas_add_inbox',
    description: 'Put a LIVE INBOX from a connected Microsoft 365 or Gmail mailbox onto the canvas, optionally filtered. Use this whenever the user asks to see, show, display, review or triage their email or inbox — it reads their real mailbox rather than inventing messages. Filters combine: query (free text), from, subject, unreadOnly, hasAttachments, after/before (ISO dates). The filter is saved with the tile, so it can be refreshed later and still mean the same thing. Name the mailbox with accountEmail when the workspace has more than one connected.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        accountEmail: { type: 'string', description: 'Which connected mailbox. Omit when exactly one is connected.' },
        title: { type: 'string', description: 'Tile title, e.g. "Unread from Acme". Defaults to a description of the filter.' },
        query: { type: 'string', description: 'Free-text search across subject, body and participants.' },
        from: { type: 'string', description: 'Match the sender address.' },
        subject: { type: 'string', description: 'Match the subject line.' },
        unreadOnly: { type: 'boolean' },
        hasAttachments: { type: 'boolean' },
        after: { type: 'string', description: 'ISO instant — only mail received at or after this.' },
        before: { type: 'string', description: 'ISO instant — only mail received before this.' },
        limit: { type: 'number', description: 'Up to 100. Defaults to 25.' },
        x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as {
        accountEmail?: string; title?: string; query?: string; from?: string; subject?: string;
        unreadOnly?: boolean; hasAttachments?: boolean; after?: string; before?: string;
        limit?: number; x?: number; y?: number;
      };
      const { connections } = await mailboxApi.listConnections().catch(() => ({ connections: [] }));
      const resolved = resolveMailboxConnection(connections, { accountEmail: args.accountEmail ?? null });
      if (!resolved.ok) {
        // Actionable rather than a bare failure: the user has to leave the
        // canvas to fix this, so say where to go.
        return { error: `${resolved.error} Connect one in Growth → Mailboxes.` };
      }

      const filter = {
        q: args.query, from: args.from, subject: args.subject,
        unread: args.unreadOnly, hasAttachments: args.hasAttachments,
        after: args.after, before: args.before, limit: args.limit,
      };
      let read: Awaited<ReturnType<typeof mailboxApi.listMessages>>;
      try {
        read = await mailboxApi.listMessages(resolved.connection.id, filter);
      } catch (error) {
        return { error: toolErrorMessage(error, 'That mailbox could not be read.') };
      }

      const node = stage.createObject('inbox', args);
      const unreadCount = read.triage.filter((m) => m.unread).length;
      node.data = {
        ...node.data,
        title: args.title?.trim().slice(0, 160) || read.accountEmail,
        // No `subtitle`: the card renders the persisted `filter` in the reader's
        // language (InboxBody); a baked-in English sentence would be one locale forever.
        status: `${read.triage.length} message${read.triage.length === 1 ? '' : 's'}`,
        connectionId: resolved.connection.id,
        accountEmail: read.accountEmail,
        provider: read.provider,
        filter,
        // The TRIAGE projection, not the full messages: a canvas node's data is
        // persisted with the session AND fed to Brain's snapshot, and 25 full
        // emails would bloat both.
        messages: read.triage,
        unreadCount,
        fetchedAt: new Date().toISOString(),
      };
      node.style = { width: 460, height: 520 };
      stage.addObject(`Add inbox “${node.data.title}”`, node);
      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'inbox', title: node.data.title },
        accountEmail: read.accountEmail,
        filter: describeMailboxFilter(filter),
        total: read.triage.length,
        unread: unreadCount,
        messages: read.triage,
      };
    },
  },   {
    name: 'canvas_refresh_inbox',
    description: 'Re-read a mailbox already on the canvas, using the filter that tile was created with, and return what is there now. Use this when asked to refresh, re-check or "look again at" an inbox on the board — it updates the tile in place rather than adding a second one.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { objectId: { type: 'string', description: 'The inbox object. Omit when the canvas holds exactly one.' } },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const objectId = (raw as { objectId?: string }).objectId;
      const inboxes = ctx.nodes().filter((node) => node.data.kind === 'inbox');
      const target = objectId ? inboxes.find((node) => node.id === objectId) : inboxes.length === 1 ? inboxes[0] : undefined;
      if (!target) {
        return { error: inboxes.length ? 'Say which inbox to refresh.' : 'There is no inbox on this canvas yet.' };
      }
      const connectionId = Number(target.data.connectionId);
      if (!Number.isInteger(connectionId)) return { error: 'That inbox is not bound to a connected mailbox.' };

      let read: Awaited<ReturnType<typeof mailboxApi.listMessages>>;
      try {
        read = await mailboxApi.listMessages(connectionId, (target.data.filter as MailboxFilter) ?? {});
      } catch (error) {
        return { error: toolErrorMessage(error, 'That mailbox could not be read.') };
      }
      const unreadCount = read.triage.filter((m) => m.unread).length;
      const patch = {
        messages: read.triage,
        unreadCount,
        fetchedAt: new Date().toISOString(),
        status: `${read.triage.length} message${read.triage.length === 1 ? '' : 's'}`,
      };
      stage.updateObject(`Refresh inbox ${target.id}`, target.id, patch);
      return { ok: true, proposed: true, objectId: target.id, total: read.triage.length, unread: unreadCount, messages: read.triage };
    },
  },   {
    /** Lifting one message out of a live view is what makes it durable: an
     *  `email` object stops changing, so it can be annotated and connected to a
     *  task and will still be there after the inbox has moved on. */
    name: 'canvas_pin_email',
    description: 'Pin ONE message from an inbox on the canvas as its own object, and read it in full while doing so. Use this when a specific email needs to be discussed, annotated, or connected to a task — unlike the live inbox tile, a pinned email does not change when the mailbox does.',
    parameters: {
      type: 'object', required: ['messageId'], additionalProperties: false,
      properties: {
        messageId: { type: 'string', description: 'The message id, as listed by the inbox tile.' },
        objectId: { type: 'string', description: 'Which inbox it came from. Omit when the canvas holds exactly one.' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { messageId?: string; objectId?: string };
      const inboxes = ctx.nodes().filter((node) => node.data.kind === 'inbox');
      const source = args.objectId ? inboxes.find((node) => node.id === args.objectId) : inboxes.length === 1 ? inboxes[0] : undefined;
      if (!source) return { error: inboxes.length ? 'Say which inbox the message is in.' : 'There is no inbox on this canvas yet.' };
      const connectionId = Number(source.data.connectionId);
      if (!Number.isInteger(connectionId) || !args.messageId) return { error: 'That inbox is not bound to a connected mailbox.' };

      let message: Awaited<ReturnType<typeof mailboxApi.getMessage>>;
      try {
        message = await mailboxApi.getMessage(connectionId, args.messageId);
      } catch (error) {
        return { error: toolErrorMessage(error, 'That message could not be read.') };
      }

      const node = stage.createObject('email', { x: source.position.x + 500, y: source.position.y });
      node.data = {
        ...node.data,
        title: message.subject,
        subtitle: message.fromName ? `${message.fromName} <${message.from}>` : message.from,
        status: fmt.dateTime(message.receivedAtISO),
        messageId: message.id,
        connectionId,
        accountEmail: source.data.accountEmail,
        from: message.from, fromName: message.fromName, to: message.to,
        subject: message.subject, receivedAt: message.receivedAtISO,
        bodyText: message.bodyText, unread: message.unread,
        hasAttachments: message.hasAttachments, webUrl: message.webUrl,
      };
      node.style = { width: 460, height: 420 };
      stage.addObject(`Pin email “${message.subject}”`, node);
      stage.addConnection(
        `Connect ${source.data.title} to ${message.subject}`,
        { id: crypto.randomUUID(), source: source.id, target: node.id, type: 'smoothstep', animated: false, label: 'pinned from', data: { connectionKind: 'reference' } },
      );
      return { ok: true, proposed: true, object: { id: node.id, kind: 'email', title: message.subject }, message };
    },
  }];
}
