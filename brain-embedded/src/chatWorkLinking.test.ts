import { describe, it, expect } from 'vitest';
import {
  chatWorkLinkingDirective,
  isCodeChangeTool,
  isTicketRecordingTool,
  codeChangeFile,
  workItemLinkFromCreate,
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
