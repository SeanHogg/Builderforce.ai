import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formAudienceOf, formFromIdea, formJoinUrl, formPublishBody, formRecipientUrl,
  formShareUrl, questionsFromIdea, readFormInvitations, readFormQuestions, readFormRecipients,
} from './formObject';

describe('readFormQuestions', () => {
  it('accepts a bare string as a short-text prompt', () => {
    expect(readFormQuestions(['Would you use this?', '  '])).toEqual([
      { id: 'q1', type: 'shortText', label: 'Would you use this?', required: false },
    ]);
  });

  it('drops a row with no label rather than inventing one', () => {
    expect(readFormQuestions([{ id: 'x', type: 'boolean' }])).toEqual([]);
  });

  it('keeps a well-formed row, including options and a stringy required flag', () => {
    expect(readFormQuestions([{
      id: 'seg', type: 'select', label: 'Segment', required: 'true', options: ['ops', '', 3, 'founders'],
    }])).toEqual([{
      id: 'seg', type: 'select', label: 'Segment', required: true, options: ['ops', 'founders'],
    }]);
  });
});

describe('readFormRecipients', () => {
  it('accepts chips, rows, and a comma-separated string, de-duplicated', () => {
    expect(readFormRecipients(['Sam@Example.com', { email: 'sam@example.com', name: 'Sam' }, 'nope']))
      .toEqual([{ email: 'Sam@Example.com' }]);
    expect(readFormRecipients('a@x.com, b@x.com')).toEqual([{ email: 'a@x.com' }, { email: 'b@x.com' }]);
  });
});

describe('formAudienceOf', () => {
  it('falls back to anyone-with-the-link rather than inventing a private list', () => {
    expect(formAudienceOf({})).toBe('anyoneWithLink');
    expect(formAudienceOf({ audience: 'namedRecipients' })).toBe('namedRecipients');
  });
});

describe('questionsFromIdea', () => {
  it('authors problem, pay, and switch — and skips email when anonymous', () => {
    const named = questionsFromIdea({
      title: 'Scheduler',
      problem: 'Ops directors lose Fridays to dispatch',
      riskiestAssumptions: ['They will pay $40/seat', 'They will switch this quarter'],
    });
    expect(named.map((q) => q.id)).toEqual([
      'problem', 'wouldPay', 'whatWouldMakeYouSwitch', 'assumption-1', 'assumption-2', 'email',
    ]);
    expect(named[0]!.label).toContain('Ops directors');
    expect(questionsFromIdea({ title: 'Scheduler' }, true).some((q) => q.type === 'email')).toBe(false);
  });
});

describe('formFromIdea', () => {
  it('seeds a shareable form from the idea so the surface and the act cannot disagree', () => {
    const idea = {
      title: 'Scheduler',
      problem: 'Ops directors lose Fridays to dispatch',
      riskiestAssumptions: ['They will pay $40/seat'],
    };
    expect(formFromIdea(idea, 'Ask: Scheduler')).toEqual({
      title: 'Ask: Scheduler',
      purpose: 'Ops directors lose Fridays to dispatch',
      questions: questionsFromIdea(idea),
      audience: 'anyoneWithLink',
      anonymous: false,
    });
  });
});

describe('formPublishBody', () => {
  it('reads the card once, including a re-publish of an existing question set', () => {
    expect(formPublishBody({
      title: ' Validation ',
      purpose: 'Would you buy this',
      audience: 'workspace',
      anonymous: 'true',
      questions: ['Would you use this?'],
      questionSetId: 'qs_1',
      recipients: ['a@x.com'],
      confirmationMessage: 'Thanks',
      closesAt: '2026-10-01T00:00:00.000Z',
    }, 'obj-9')).toEqual({
      questionSetId: 'qs_1',
      title: 'Validation',
      description: 'Would you buy this',
      questions: [{ id: 'q1', type: 'shortText', label: 'Would you use this?', required: false }],
      anonymous: true,
      audience: 'workspace',
      closesAt: '2026-10-01T00:00:00.000Z',
      confirmationMessage: 'Thanks',
      objectId: 'obj-9',
      recipients: [{ email: 'a@x.com' }],
    });
  });
});

describe('formJoinUrl', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('is empty on the server so a canned host cannot leak into SSR HTML', () => {
    vi.stubGlobal('window', undefined);
    expect(formJoinUrl('hello')).toBe('/f/hello');
  });

  it('uses the origin the publisher is actually on', () => {
    vi.stubGlobal('window', { location: { origin: 'https://preview.example' } });
    expect(formJoinUrl('hello')).toBe('https://preview.example/f/hello');
  });
});

describe('formRecipientUrl', () => {
  it('appends the plaintext token as ?t= and leaves the public URL alone without one', () => {
    expect(formRecipientUrl('https://x/f/hello')).toBe('https://x/f/hello');
    expect(formRecipientUrl('https://x/f/hello', 'tok 1')).toBe('https://x/f/hello?t=tok%201');
    expect(formRecipientUrl('https://x/f/hello?ref=idea', 'tok')).toBe('https://x/f/hello?ref=idea&t=tok');
  });
});

describe('formShareUrl / readFormInvitations', () => {
  it('prefers shareUrl and keeps invitation tokens for named send', () => {
    expect(formShareUrl({ joinUrl: '/f/hello' })).toBe('/f/hello');
    expect(formShareUrl({ shareUrl: 'https://x/f/hello', joinUrl: '/f/hello' })).toBe('https://x/f/hello');
    expect(readFormInvitations([{ email: 'sam@x.com', token: 'tok-1' }, { email: 'nope' }]))
      .toEqual([{ email: 'sam@x.com', token: 'tok-1' }]);
  });
});
