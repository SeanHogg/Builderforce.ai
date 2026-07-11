import { describe, it, expect } from 'vitest';
import {
  chatWorkLinkingDirective,
  isCodeChangeTool,
  isTicketRecordingTool,
  codeChangeFile,
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
