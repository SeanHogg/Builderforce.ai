/**
 * GuestPromptService — the S5 lead list.
 *
 * Scoring and visit context are derived on read (never stored). The SQL and the
 * record-path upsert are the parts a mock database would only agree with itself
 * about, so they are asserted on the source text; `withLeadScore` is the mapping
 * a driver row actually goes through and is exercised as a function.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withLeadScore } from './GuestPromptService';

const src = readFileSync(resolve(__dirname, 'GuestPromptService.ts'), 'utf8')
  .split(String.fromCharCode(13))
  .join('');

const NOW = Date.parse('2026-10-11T12:00:00.000Z');

const row = {
  id: 's1',
  visitorId: 'vis-1',
  guestChatCount: 0,
  guestChatTokens: 0,
  toolRuns: 0,
  landingPath: '/',
  referrer: null,
  converted: false,
  convertedUserId: null,
  convertedAt: null,
  convertedEmail: null,
  isPaid: false,
  firstSeenAt: '2026-10-11T10:00:00.000Z',
  lastSeenAt: '2026-10-11T11:00:00.000Z',
  promptCount: 0,
  firstPrompt: null,
  lastPrompt: null,
  lastPromptAt: null,
  lastSurface: null,
  visitCount: 0,
  lastVisitId: null,
};

describe('record() always has a lead row to hang the prompt on', () => {
  it('upserts marketing_sessions before inserting the prompt', () => {
    const record = src.slice(src.indexOf('async record('));
    const body = record.slice(0, record.indexOf('async listSessionsWithIntent'));
    expect(body).toContain('insert(marketingSessions)');
    expect(body).toContain('onConflictDoUpdate');
    expect(body).toContain('target: marketingSessions.visitorId');
    expect(body.indexOf('insert(marketingSessions)')).toBeLessThan(body.indexOf('insert(marketingSessionPrompts)'));
  });

  it('does not import GuestChatService — that import is a cycle', () => {
    expect(src).not.toMatch(/from ['"][^'"]*GuestChatService['"]/);
    expect(src).not.toMatch(/new GuestChatService\b/);
  });
});

describe('loadSessions joins visit context and stamps a derived score', () => {
  it('counts distinct visit ids on the prompt rows', () => {
    expect(src).toContain('COUNT(DISTINCT p.visit_id)');
    expect(src).toContain('AS last_visit_id');
    expect(src).toContain('AS "visitCount"');
    expect(src).toContain('AS "lastVisitId"');
  });

  it('maps every row through withLeadScore rather than returning the driver shape', () => {
    expect(src).toContain('withLeadScore(row)');
  });

  it('does not write a score column', () => {
    expect(src).not.toContain('marketing_sessions.score');
    expect(src).not.toMatch(/\.set\(\{[^}]*\bscore\b/);
  });
});

describe('listPromptsForVisitor carries the visit the prompt was typed in', () => {
  it('selects visitId', () => {
    const fn = src.slice(src.indexOf('async listPromptsForVisitor'));
    const body = fn.slice(0, fn.indexOf('async promptCount'));
    expect(body).toContain('visitId: marketingSessionPrompts.visitId');
  });
});

describe('withLeadScore', () => {
  it('coerces COUNT strings so a 2-visit lead is not ranked as silent', () => {
    const scored = withLeadScore({
      ...row,
      promptCount: '2' as unknown as number,
      visitCount: '3' as unknown as number,
      lastPrompt: 'Build me a pricing page with three tiers?',
      lastVisitId: 'visit-abc',
    }, NOW);
    expect(scored.promptCount).toBe(2);
    expect(scored.visitCount).toBe(3);
    expect(scored.lastVisitId).toBe('visit-abc');
    expect(scored.score).toBeGreaterThan(0);
    expect(scored.score).toBeLessThanOrEqual(100);
  });

  it('fills missing visit fields so a cached payload without them still ranks', () => {
    const { visitCount: _v, lastVisitId: _id, ...bare } = row;
    const scored = withLeadScore(bare as typeof row, NOW);
    expect(scored.visitCount).toBe(0);
    expect(scored.lastVisitId).toBeNull();
    expect(scored.score).toBeGreaterThan(0);
  });

  it('ranks a converted brief above a silent guest', () => {
    const silent = withLeadScore(row, NOW);
    const hot = withLeadScore({
      ...row,
      promptCount: 2,
      lastPrompt: 'I want a landing page that captures leads from LinkedIn ads.',
      visitCount: 2,
      guestChatCount: 3,
      converted: true,
      lastVisitId: 'visit-hot',
    }, NOW);
    expect(hot.score).toBeGreaterThan(silent.score);
  });
});
