import { describe, it, expect } from 'vitest';
import {
  chatWorkLinkingDirective,
  isCodeChangeTool,
  isTicketRecordingTool,
  codeChangeFile,
  workItemLinkFromCreate,
  linkedTicketsToAdvance,
} from './chatWorkLinking';

describe('chatWorkLinkingDirective', () => {
  it('bakes the resolved chatId into the linking instructions', () => {
    const d = chatWorkLinkingDirective(42);
    expect(d).toContain('Brain chat #42');
    // Both operator requirements are present, wired to THIS chat's id.
    expect(d).toContain('builtin_chats_link_ticket (chatId=42, linkType="created")');
    expect(d).toContain('builtin_tickets_from_delta (chatId=42');
    expect(d).toContain('builtin_tasks_create');
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

describe('code-change vs ticket-recording predicates', () => {
  it('recognises the workspace file tools that change code', () => {
    expect(isCodeChangeTool('write_file')).toBe(true);
    expect(isCodeChangeTool('edit_file')).toBe(true);
    expect(isCodeChangeTool('delete_file')).toBe(true);
    // Reads and shell are NOT code changes (run_command commonly runs tests/build).
    expect(isCodeChangeTool('read_file')).toBe(false);
    expect(isCodeChangeTool('run_command')).toBe(false);
    expect(isCodeChangeTool('search_code')).toBe(false);
  });

  it('recognises the platform tools that record work against the chat', () => {
    expect(isTicketRecordingTool('builtin_tickets_from_delta')).toBe(true);
    expect(isTicketRecordingTool('builtin_chats_link_ticket')).toBe(true);
    expect(isTicketRecordingTool('builtin_reviews_record')).toBe(true);
    expect(isTicketRecordingTool('builtin_tasks_create')).toBe(false);
  });
});

describe('workItemLinkFromCreate', () => {
  it('maps a created task/epic/gap to its taskType kind + numeric ref, linkType created', () => {
    expect(workItemLinkFromCreate('builtin_tasks_create', { id: 158, taskType: 'epic' }))
      .toEqual({ kind: 'epic', ref: '158', linkType: 'created' });
    expect(workItemLinkFromCreate('builtin_tasks_create', { id: 12, taskType: 'gap' }))
      .toEqual({ kind: 'gap', ref: '12', linkType: 'created' });
    // A task with no/unknown taskType defaults to the 'task' tier.
    expect(workItemLinkFromCreate('builtin_tasks_create', { id: 7 }))
      .toEqual({ kind: 'task', ref: '7', linkType: 'created' });
  });

  it('maps the strategy + spec create tools to their tier with the uuid ref', () => {
    expect(workItemLinkFromCreate('builtin_objectives_create', { id: 'obj-uuid' }))
      .toEqual({ kind: 'objective', ref: 'obj-uuid', linkType: 'created' });
    expect(workItemLinkFromCreate('builtin_specs_create', { id: 'spec-uuid' }))
      .toEqual({ kind: 'spec', ref: 'spec-uuid', linkType: 'created' });
    expect(workItemLinkFromCreate('builtin_portfolios_create', { id: 'pf-uuid' }))
      .toEqual({ kind: 'portfolio', ref: 'pf-uuid', linkType: 'created' });
    expect(workItemLinkFromCreate('builtin_initiatives_create', { id: 'init-uuid' }))
      .toEqual({ kind: 'initiative', ref: 'init-uuid', linkType: 'created' });
  });

  it('records an idempotent-hit (deduped) result as a linked, not created, edge', () => {
    expect(workItemLinkFromCreate('builtin_tasks_create', { id: 5, taskType: 'epic', deduped: true }))
      .toEqual({ kind: 'epic', ref: '5', linkType: 'linked' });
  });

  it('returns null for non-create tools and results without a usable id', () => {
    expect(workItemLinkFromCreate('builtin_tasks_update', { id: 1 })).toBeNull();
    expect(workItemLinkFromCreate('builtin_specs_list', { specs: [] })).toBeNull();
    expect(workItemLinkFromCreate('builtin_objectives_create', {})).toBeNull();
    expect(workItemLinkFromCreate('builtin_objectives_create', { id: '  ' })).toBeNull();
    expect(workItemLinkFromCreate('builtin_tasks_create', null)).toBeNull();
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
