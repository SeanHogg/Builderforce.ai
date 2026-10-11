import { describe, expect, it } from 'vitest';
import { promptQuality, scoreLead } from './leadScore';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const hourAgo = '2026-10-11T11:00:00.000Z';
const eightDaysAgo = '2026-10-03T12:00:00.000Z';
const fortyDaysAgo = '2026-09-01T12:00:00.000Z';

const silent = {
  promptCount: 0,
  lastPrompt: null,
  guestChatCount: 0,
  toolRuns: 0,
  visitCount: 0,
  converted: false,
  isPaid: false,
  lastSeenAt: hourAgo,
  nowMs: NOW,
};

describe('promptQuality', () => {
  it('is zero when there is no prompt', () => {
    expect(promptQuality(null)).toBe(0);
    expect(promptQuality('')).toBe(0);
  });

  it('scores a one-word greeting as almost nothing', () => {
    expect(promptQuality('hello')).toBe(0);
  });

  it('scores a real brief higher than a greeting', () => {
    const brief = 'Can you build a kanban board for my agency with swimlanes?';
    expect(promptQuality(brief)).toBeGreaterThan(promptQuality('hello there'));
    expect(promptQuality(brief)).toBeGreaterThanOrEqual(10);
  });

  it('does not reward a paste over a shorter brief', () => {
    const brief = 'Build me a pricing page with three tiers and a FAQ.';
    const paste = `${brief} ${'lorem ipsum '.repeat(80)}`;
    expect(paste.length).toBeGreaterThan(800);
    expect(promptQuality(paste)).toBeLessThanOrEqual(promptQuality(brief));
  });
});

describe('scoreLead', () => {
  it('is zero-ish for a visitor who never typed and never came back', () => {
    const score = scoreLead({ ...silent, lastSeenAt: fortyDaysAgo });
    expect(score.total).toBe(0);
    expect(score.parts).toEqual({ intent: 0, engagement: 0, recency: 0, conversion: 0 });
  });

  it('caps at 100', () => {
    const score = scoreLead({
      promptCount: 20,
      lastPrompt: 'Can you build a full CRM with pipelines, reporting, and a mobile app?',
      guestChatCount: 40,
      toolRuns: 20,
      visitCount: 20,
      converted: true,
      isPaid: true,
      lastSeenAt: hourAgo,
      nowMs: NOW,
    });
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.parts.intent).toBeLessThanOrEqual(40);
    expect(score.parts.engagement).toBeLessThanOrEqual(30);
    expect(score.parts.recency).toBe(15);
    expect(score.parts.conversion).toBe(15);
  });

  it('ranks a recent brief above a silent bounce', () => {
    const hot = scoreLead({
      ...silent,
      promptCount: 2,
      lastPrompt: 'I want a landing page that captures leads from LinkedIn ads.',
      visitCount: 2,
      guestChatCount: 3,
    });
    const cold = scoreLead({ ...silent, lastSeenAt: fortyDaysAgo });
    expect(hot.total).toBeGreaterThan(cold.total);
    expect(hot.parts.intent).toBeGreaterThan(0);
    expect(hot.parts.engagement).toBeGreaterThan(0);
  });

  it('gives paid more conversion than registered, and registered more than guest', () => {
    const guest = scoreLead(silent);
    const registered = scoreLead({ ...silent, converted: true });
    const paid = scoreLead({ ...silent, converted: true, isPaid: true });
    expect(paid.parts.conversion).toBeGreaterThan(registered.parts.conversion);
    expect(registered.parts.conversion).toBeGreaterThan(guest.parts.conversion);
    expect(paid.total).toBeGreaterThan(registered.total);
  });

  it('decays recency across a day, a week, and a month', () => {
    expect(scoreLead({ ...silent, lastSeenAt: hourAgo }).parts.recency).toBe(15);
    expect(scoreLead({ ...silent, lastSeenAt: eightDaysAgo }).parts.recency).toBe(5);
    expect(scoreLead({ ...silent, lastSeenAt: fortyDaysAgo }).parts.recency).toBe(0);
  });

  it('accepts a Date for lastSeenAt so a driver that did not stringify still scores', () => {
    expect(scoreLead({ ...silent, lastSeenAt: new Date(hourAgo) }).parts.recency).toBe(15);
  });

  it('treats a missing lastSeen as no recency rather than NaN', () => {
    expect(scoreLead({ ...silent, lastSeenAt: null }).parts.recency).toBe(0);
    expect(Number.isFinite(scoreLead({ ...silent, lastSeenAt: null }).total)).toBe(true);
  });

  it('counts visits, chats and tool runs separately inside the engagement cap', () => {
    const visits = scoreLead({ ...silent, visitCount: 3 });
    const chats = scoreLead({ ...silent, guestChatCount: 4 });
    const tools = scoreLead({ ...silent, toolRuns: 3 });
    expect(visits.parts.engagement).toBe(12);
    expect(chats.parts.engagement).toBe(12);
    expect(tools.parts.engagement).toBe(6);
    expect(scoreLead({ ...silent, visitCount: 3, guestChatCount: 4, toolRuns: 3 }).parts.engagement).toBe(30);
  });
});
