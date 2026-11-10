import { describe, expect, it } from 'vitest';
import { chatWorkLinkingDirective } from './chatWorkLinking';
import { detectUnbackedTicketClaim, isTicketWriteTool, type BrainTraceEvent } from './brainTriage';
import { previewReviewDirective } from './previewReview';
import { restatedReplyNudge } from './restatedReply';
import { executeHandOff, type HandOffPorts, type HandOffTask } from './planHandoff';
import { SERVER_TICKET_TOOLS, ticketStatusMove, ticketToolVocabulary } from './ticketToolVocabulary';

const LOCAL = ticketToolVocabulary(['read_file', 'ticket-create', 'ticket-update']);
const task = (title: string): HandOffTask => ({ title, brief: `do ${title}`, paths: [] });

describe('ticketToolVocabulary', () => {
  it('reads the editor catalog as local: no kanban scoping', () => {
    expect(LOCAL).toMatchObject({ createTool: 'ticket-create', local: true, kanbanScoping: false });
    // Neither vocabulary has a link step after a create any more.
    expect(LOCAL).not.toHaveProperty('needsLinkStep');
    expect(SERVER_TICKET_TOOLS).not.toHaveProperty('needsLinkStep');
  });

  it('keeps the account vocabulary for web / cloud and for a surface that does not say', () => {
    expect(ticketToolVocabulary(['builtin_tasks_create', 'builtin_chats_link_ticket'])).toBe(SERVER_TICKET_TOOLS);
    expect(ticketToolVocabulary()).toBe(SERVER_TICKET_TOOLS);
    expect(ticketToolVocabulary(['read_file'])).toMatchObject({ createTool: undefined, createName: 'builtin_tasks_create' });
  });

  it('prompt text: local files with ticket-create and does not ask for a link or kanban scoping', () => {
    const text = chatWorkLinkingDirective(7, LOCAL);
    expect(text).toContain('ticket-create');
    expect(text).toContain('do NOT call builtin_chats_link_ticket');
    expect(text).not.toContain('Every created ticket must be resource-scoped');
    expect(text).not.toContain('AND link it with');
    expect(text).toContain('ticket-move');
    const server = chatWorkLinkingDirective(7);
    expect(server).toContain('builtin_tasks_create');
    // The server create links its chat in the same call: no link step is asked for.
    expect(server).not.toContain('AND link it with');
    expect(server).toContain('It is linked to this chat automatically');
    expect(server).toContain('Every created ticket must be resource-scoped');
  });

  it('preview review and the restated-reply nudge name the right create/link tool', () => {
    expect(previewReviewDirective(7, LOCAL)).not.toContain('builtin_chats_link_ticket (chatId=7) first');
    expect(previewReviewDirective(7)).toContain('builtin_chats_link_ticket (chatId=7) first');
    expect(restatedReplyNudge(LOCAL)).toContain('ticket-create');
    expect(restatedReplyNudge()).toContain('builtin_tasks_create — it links this chat itself');
  });

  it('triage counts a successful ticket-create as filing work', () => {
    expect(isTicketWriteTool('ticket-create')).toBe(true);
    const events = [{ category: 'tool', label: 'ticket-create', isError: false, result: { id: 'u' } }] as unknown as BrainTraceEvent[];
    const messages = [{ role: 'assistant', content: 'I created the ticket for the login bug.' }] as never;
    expect(detectUnbackedTicketClaim(events, messages)).toBe(false);
  });

  it('hand-off files through ticket-create and treats the returned local id as the ticket ref', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const ports: HandOffPorts = {
      runTool: async (name, args) => {
        calls.push({ name, args });
        return JSON.stringify({ kind: 'local', id: `local-${calls.length}` });
      },
      toolNames: new Set(['ticket-create']),
      projectId: 12,
    };
    const out = await executeHandOff({ summary: '', tasks: [task('A'), task('B')] }, ports);
    expect(calls.map((c) => c.name)).toEqual(['ticket-create', 'ticket-create']);
    expect(calls[0]!.args.projectId).toBe('12');
    expect(out.tickets.map((t) => t.id)).toEqual(['local-1', 'local-2']);
  });
});

describe('the ONE ticket-id parse and status move', () => {
  it('moves by the vocabulary that filed the ticket', () => {
    expect(ticketStatusMove('41', 'done', SERVER_TICKET_TOOLS)).toEqual({ tool: 'builtin_tasks_update', args: { id: 41, status: 'done' } });
    expect(ticketStatusMove('1e3', 'done', SERVER_TICKET_TOOLS)).toBeNull();
    expect(ticketStatusMove(' u-1 ', 'done', ticketToolVocabulary(['ticket-create']))).toEqual({ tool: 'ticket-move', args: { id: 'u-1', status: 'done' } });
  });
});
