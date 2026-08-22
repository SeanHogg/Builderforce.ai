import { describe, expect, it } from 'vitest';

import {
  MAX_CLIENT_REPORT_EVENTS,
  parseClientErrorReport,
} from './clientErrorReport';

const validEvent = { message: 'boom', stack: 'Error: boom\n  at x', operation: 'gateway/attach' };

describe('parseClientErrorReport', () => {
  it('normalizes a runtime report and stamps the surface environment', () => {
    const parsed = parseClientErrorReport({
      source: 'agent-runtime',
      projectId: 12,
      events: [{ ...validEvent, type: 'TypeError', level: 'fatal' }],
    });

    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.projectId).toBe(12);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      type: 'TypeError',
      message: 'boom',
      level: 'fatal',
      // The environment is decided server-side, so a client cannot file its errors
      // as somebody else's surface.
      environment: 'on-prem-runtime',
      source: 'native',
      tags: { reporter: 'agent-runtime', service: 'gateway/attach' },
    });
  });

  it('defaults the type per surface and the level to error', () => {
    const parsed = parseClientErrorReport({ source: 'vscode-extension', events: [{ message: 'nope' }] });
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.events[0]?.type).toBe('ExtensionError');
    expect(parsed.events[0]?.level).toBe('error');
    expect(parsed.events[0]?.environment).toBe('vscode-extension');
    expect(parsed.projectId).toBeNull();
  });

  it.each([
    ['a non-object body', 'nope'],
    ['an unknown source', { source: 'curl', events: [validEvent] }],
    ['no events', { source: 'agent-runtime', events: [] }],
    ['an event with no message', { source: 'agent-runtime', events: [{ stack: 'x' }] }],
    ['a non-integer projectId', { source: 'agent-runtime', projectId: 'abc', events: [validEvent] }],
  ])('rejects %s', (_label, body) => {
    expect(parseClientErrorReport(body)).toHaveProperty('error');
  });

  it('caps the batch so a crash loop cannot become a flood', () => {
    const events = Array.from({ length: MAX_CLIENT_REPORT_EVENTS + 1 }, () => validEvent);
    expect(parseClientErrorReport({ source: 'agent-runtime', events })).toHaveProperty('error');
  });

  it('truncates an oversized message rather than rejecting the report', () => {
    const parsed = parseClientErrorReport({
      source: 'agent-runtime',
      events: [{ message: 'x'.repeat(20_000) }],
    });
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.events[0]?.message).toHaveLength(10_000);
  });
});
