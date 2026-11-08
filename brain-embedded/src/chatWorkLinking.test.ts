import { describe, it, expect } from 'vitest';
import {
  chatWorkLinkingDirective,
  isTicketRecordingTool,
  codeChangeFile,
  stampRunChat,
  createLinkedToChat,
  CHAT_STAMPED_CREATE_TOOLS,
  linkedTicketsToAdvance,
  isReadOnlyPlatformTool,
} from './chatWorkLinking';

describe('chatWorkLinkingDirective', () => {
  it('bakes the resolved chatId into the linking instructions', () => {
    const d = chatWorkLinkingDirective(42);
    expect(d).toContain('Brain chat #42');
    // Both operator requirements are present, wired to THIS chat's id.
    // A created item links itself — the prompt says so instead of asking for a link step.
    expect(d).toContain('It is linked to this chat automatically');
    expect(d).not.toContain('linkType="created"');
    expect(d).toContain('builtin_tickets_from_delta (chatId=42');
    expect(d).toContain('pass its numeric ref as taskId');
    expect(d).toContain('builtin_tasks_create');
    expect(d).toContain('builtin_tasks_assignees');
    expect(d).toContain('builtin_kanban_assess_resource');
    expect(d).toContain('builtin_kanban_materialize_work_items');
    expect(d).toContain('builtin_chats_list_tickets (chatId=42)');
    // The status-progression requirement is present (the reported "worked a ticket but
    // never moved it off backlog" gap).
    expect(d).toContain('builtin_tasks_update');
    expect(d).toContain('in_progress');
  });
});

describe('linkedTicketsToAdvance', () => {
  it('selects task-tier tickets still in a not-started lane', () => {
    const listed = [
      { kind: 'task', ref: '488', status: 'backlog', exists: true },
      { kind: 'gap', ref: '489', status: 'todo', exists: true },
      { kind: 'epic', ref: '77', status: 'ready', exists: true },
    ];
    expect(linkedTicketsToAdvance(listed)).toEqual([
      { kind: 'task', ref: '488' },
      { kind: 'gap', ref: '489' },
      { kind: 'epic', ref: '77' },
    ]);
  });

  it('never regresses or re-touches tickets already at/past in_progress, blocked, or done', () => {
    const listed = [
      { kind: 'task', ref: '1', status: 'in_progress', exists: true },
      { kind: 'task', ref: '2', status: 'in_review', exists: true },
      { kind: 'task', ref: '3', status: 'done', exists: true },
      { kind: 'task', ref: '4', status: 'blocked', exists: true },
    ];
    expect(linkedTicketsToAdvance(listed)).toEqual([]);
  });

  it('ignores non-task tiers and deleted/unresolved links', () => {
    const listed = [
      { kind: 'objective', ref: 'obj-uuid', status: 'active', exists: true },
      { kind: 'spec', ref: 'spec-uuid', status: 'draft', exists: true },
      { kind: 'task', ref: '9', status: 'backlog', exists: false }, // deleted
    ];
    expect(linkedTicketsToAdvance(listed)).toEqual([]);
  });

  it('tolerates a JSON-string result, numeric refs, and mixed-case status', () => {
    const raw = JSON.stringify([
      { kind: 'task', ref: 500, status: 'Backlog', exists: true },
    ]);
    expect(linkedTicketsToAdvance(raw)).toEqual([{ kind: 'task', ref: '500' }]);
  });

  it('returns [] for an error object, non-array, or unparseable input', () => {
    expect(linkedTicketsToAdvance({ error: 'Chat not found' })).toEqual([]);
    expect(linkedTicketsToAdvance('not json')).toEqual([]);
    expect(linkedTicketsToAdvance(null)).toEqual([]);
    expect(linkedTicketsToAdvance(undefined)).toEqual([]);
  });
});

// The code-change predicates moved to `localWorkspaceTools` (their own module, which
// the run loop also reads to keep those tools advertised) and are tested there.
describe('ticket-recording predicates', () => {
  it('recognises the platform tools that record work against the chat', () => {
    expect(isTicketRecordingTool('builtin_tickets_from_delta')).toBe(true);
    expect(isTicketRecordingTool('builtin_chats_link_ticket')).toBe(true);
    expect(isTicketRecordingTool('builtin_reviews_record')).toBe(true);
    expect(isTicketRecordingTool('builtin_tasks_create')).toBe(false);
  });
});

// The kind mapping moved to the server (api `createdWorkItemChatLink.test.ts` carries the
// ported expectations); the client only stamps the run's chat onto the create call.
describe('stampRunChat', () => {
  it('stamps every server create tool, the ceremonies included', () => {
    expect([...CHAT_STAMPED_CREATE_TOOLS]).toEqual([
      'builtin_tasks_create', 'builtin_objectives_create', 'builtin_specs_create', 'builtin_portfolios_create',
      'builtin_initiatives_create', 'builtin_retro_create', 'builtin_poker_create_session',
    ]);
  });

  it("stamps the run's chat over the model's, and strips a guessed chat for an unbound chat", () => {
    const bound: Record<string, unknown> = { title: 'T', chatId: 999 };
    stampRunChat('builtin_tasks_create', bound, 42);
    expect(bound).toEqual({ title: 'T', chatId: 42 });
    const unbound: Record<string, unknown> = { title: 'T', chatId: 999 };
    stampRunChat('builtin_tasks_create', unbound, null);
    expect(unbound).toEqual({ title: 'T' });
  });

  it('leaves every other tool untouched', () => {
    const delta: Record<string, unknown> = { summary: 's', chatId: 7 };
    stampRunChat('builtin_tickets_from_delta', delta, 42);
    expect(delta).toEqual({ summary: 's', chatId: 7 });
  });
});

describe('createLinkedToChat', () => {
  it("reads the server's chatLink verdict off a stamped create's result", () => {
    expect(createLinkedToChat('builtin_tasks_create', { id: 5, chatLink: { linked: true, chatId: 42, linkType: 'created' } })).toBe(true);
    expect(createLinkedToChat('builtin_specs_create', JSON.stringify({ id: 's', chatLink: { linked: true } }))).toBe(true);
    expect(createLinkedToChat('builtin_tasks_create', { id: 5, chatLink: { linked: false, reason: 'Chat not found' } })).toBe(false);
    expect(createLinkedToChat('builtin_tasks_create', { id: 5 })).toBe(false);
    expect(createLinkedToChat('builtin_tasks_update', { chatLink: { linked: true } })).toBe(false);
    expect(createLinkedToChat('builtin_tasks_create', 'not json')).toBe(false);
  });
});

describe('codeChangeFile', () => {
  it('extracts a usable path and rejects everything else', () => {
    expect(codeChangeFile({ path: 'src/app.ts' })).toBe('src/app.ts');
    expect(codeChangeFile({ path: '  ' })).toBeNull();
    expect(codeChangeFile({ path: 42 })).toBeNull();
    expect(codeChangeFile({})).toBeNull();
    expect(codeChangeFile(null)).toBeNull();
    expect(codeChangeFile('nope')).toBeNull();
  });
});

describe('isReadOnlyPlatformTool · the board-survey reads', () => {
  it('covers the expensive surveys a run repeats verbatim', () => {
    // VS Code chat #115 (2026-09-20) called `builtin_tickets_pending_changes` twice with
    // byte-identical arguments — six seconds and ~19 KB apiece for an answer already in
    // its context — because none of these three suffixes was in the dedupe set.
    expect(isReadOnlyPlatformTool('builtin_tickets_pending_changes')).toBe(true);
    expect(isReadOnlyPlatformTool('builtin_manager_stalled_tickets')).toBe(true);
    expect(isReadOnlyPlatformTool('builtin_manager_census')).toBe(true);
  });

  it('still covers the listings it always did', () => {
    expect(isReadOnlyPlatformTool('builtin_tasks_list')).toBe(true);
    expect(isReadOnlyPlatformTool('builtin_chats_list_tickets')).toBe(true);
  });

  it('never claims a WRITE is a read — a stubbed mutation would silently not happen', () => {
    for (const w of [
      'builtin_tasks_update',
      'builtin_tasks_create',
      'builtin_specs_patch',
      'builtin_tickets_from_delta',
      'builtin_chats_link_ticket',
    ]) {
      expect(isReadOnlyPlatformTool(w), w).toBe(false);
    }
  });

  it('is limited to platform tools — local file tools are the caller’s own set', () => {
    expect(isReadOnlyPlatformTool('read_file')).toBe(false);
    expect(isReadOnlyPlatformTool('review_ticket_branches')).toBe(false);
  });
});
