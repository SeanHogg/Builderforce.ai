import { describe, expect, it } from 'vitest';
import { chatWorkLinkingDirective, linkedTicketsStillOpen, linkedTicketsToAdvance, linkedTicketsToComplete } from './chatWorkLinking';

/** The real `builtin_chats_list_tickets` answer: a page envelope whose rows carry the ticket's display name as `label`. */
const page = (tickets: unknown[]) => ({ tickets, total: tickets.length, matched: tickets.length, hasMore: false });

describe('linkedTicketsStillOpen', () => {
  it('keeps task-tier tickets still owed, with their status and title', () => {
    const listed = page([
      { kind: 'epic', ref: '6902', status: 'in_progress', exists: true, label: 'Implement the PRD' },
      { kind: 'task', ref: '6903', status: 'Backlog', exists: true, label: 'Seeds migration' },
      { kind: 'gap', ref: '6904', status: 'todo', exists: true },
    ]);
    expect(linkedTicketsStillOpen(listed)).toEqual([
      { kind: 'epic', ref: '6902', status: 'in_progress', title: 'Implement the PRD' },
      { kind: 'task', ref: '6903', status: 'backlog', title: 'Seeds migration' },
      { kind: 'gap', ref: '6904', status: 'todo', title: '' },
    ]);
  });

  it('excludes closed, cancelled, blocked, in_review, deleted and non-task tiers', () => {
    const listed = [
      { kind: 'task', ref: '1', status: 'done', exists: true },
      { kind: 'task', ref: '2', status: 'cancelled', exists: true },
      { kind: 'task', ref: '3', status: 'blocked', exists: true },
      { kind: 'task', ref: '4', status: 'in_review', exists: true },
      { kind: 'task', ref: '5', status: 'in_progress', exists: false },
      { kind: 'spec', ref: 'spec-uuid', status: 'draft', exists: true },
      { kind: 'task', ref: '6', status: 'completed', exists: true },
    ];
    expect(linkedTicketsStillOpen(listed)).toEqual([]);
  });

  it('tolerates a JSON-string result (envelope or bare array) and returns [] for anything unusable', () => {
    const row = { kind: 'task', ref: 7, status: 'in_progress', exists: true, label: 'T' };
    expect(linkedTicketsStillOpen(JSON.stringify(page([row])))).toEqual([{ kind: 'task', ref: '7', status: 'in_progress', title: 'T' }]);
    expect(linkedTicketsStillOpen(JSON.stringify([row]))).toHaveLength(1);
    expect(linkedTicketsStillOpen({ error: 'Chat not found' })).toEqual([]);
    expect(linkedTicketsStillOpen('not json')).toEqual([]);
    expect(linkedTicketsStillOpen(null)).toEqual([]);
  });

  it('the move selectors read the real page envelope too', () => {
    const listed = page([
      { kind: 'task', ref: '10', status: 'backlog', exists: true },
      { kind: 'task', ref: '11', status: 'in_review', exists: true },
    ]);
    expect(linkedTicketsToAdvance(listed)).toEqual([{ kind: 'task', ref: '10' }]);
    expect(linkedTicketsToComplete(listed)).toEqual([{ kind: 'task', ref: '11' }]);
  });
});

describe('chatWorkLinkingDirective · an open linked epic', () => {
  it('tells a bound chat to file its change and its remaining slices under the epic', () => {
    const d = chatWorkLinkingDirective(42);
    expect(d).toContain('parentTaskId=<the epic');
    expect(d).toContain('builtin_tickets_from_delta passing parentTaskId');
  });

  it('says nothing about an epic in an unbound chat', () => {
    expect(chatWorkLinkingDirective(null)).not.toContain('open EPIC');
  });
});
