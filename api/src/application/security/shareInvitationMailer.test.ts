/**
 * The two messages that leave the platform to people who are NOT users — a
 * named-recipient form and a signature/acknowledgement request — are written in
 * a language somebody chose, not in English by construction.
 *
 * The failure mode this guards is specific and was live: every word of these
 * mails was an English string literal at the call site, so the entire localized
 * platform sent its most externally-visible mail in one language. A regression
 * looks exactly like working code in review, because the English output is
 * unchanged — hence the assertions below run over all five locales and check for
 * the ABSENCE of the English sentence as well as the presence of the translated
 * one.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { deliverShareInvitations } from './shareInvitationMailer';
import { shareInvitationMessage } from './shareInvitationCopy';
import { deliverFormInvitations } from '../collection/formInvitations';
import { deliverSignatureInvitations, deliverSignatureReminders } from '../signature/signatureInvitations';
import { EMAIL_LOCALES, type EmailLocale } from '../../infrastructure/email/emailLocale';
import { EMAIL_MESSAGES } from '../../infrastructure/email/emailMessages';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const ENV = { RESEND_API_KEY: 'k', APP_URL: 'https://app.example' } as unknown as Env;

function stubFetch() {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function sent(fn: ReturnType<typeof stubFetch>, call = 0) {
  return JSON.parse(fn.mock.calls[call]![1]!.body as string) as {
    to: string[]; subject: string; html: string;
  };
}

/** A publisher row with a stored language, read by `publisherEmailLocale`. */
function stubDb(locale: string | null) {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ locale }]) }) }) }),
  } as unknown as Db;
}

const linkFor = (token: string) => `https://app.example/f/abc?t=${token}`;

afterEach(() => vi.unstubAllGlobals());

describe('the composed message reads from the catalog, in every locale', () => {
  it.each(EMAIL_LOCALES)('a form invitation in %s uses no English literal', (locale) => {
    const copy = EMAIL_MESSAGES[locale].shareInvitation;
    const message = shareInvitationMessage(
      locale,
      { kind: 'formInvitation', title: 'Q3 pulse', closesAt: '2026-09-01T00:00:00.000Z' },
      linkFor,
    );
    expect(message.actionLabel).toBe(copy.openForm);
    expect(message.body).toBe(copy.formInvitationBody.replace('{{Title}}', 'Q3 pulse'));
    // The deadline is localized too — it was a hardcoded English sentence built
    // beside the message rather than in it.
    expect(message.footnote).toBe(copy.formClosesNote.replace('{{Date}}', '2026-09-01'));
    expect(message.locale).toBe(locale);
  });

  it.each(EMAIL_LOCALES)('a form reminder in %s prefixes the subject in that language', (locale) => {
    const copy = EMAIL_MESSAGES[locale].shareInvitation;
    const message = shareInvitationMessage(locale, { kind: 'formReminder', title: 'Q3 pulse' }, linkFor);
    expect(message.subject).toBe(copy.reminderSubject.replace('{{Title}}', 'Q3 pulse'));
    expect(message.body).toBe(copy.formReminderBody.replace('{{Title}}', 'Q3 pulse'));
    expect(message.footnote).toBeUndefined();
  });

  it.each(EMAIL_LOCALES)('signing and acknowledging are different words in %s', (locale) => {
    const copy = EMAIL_MESSAGES[locale].shareInvitation;
    const sign = shareInvitationMessage(
      locale, { kind: 'signatureInvitation', subject: 'NDA', documentTitle: 'Mutual NDA', intent: 'sign' }, linkFor,
    );
    const ack = shareInvitationMessage(
      locale, { kind: 'signatureInvitation', subject: 'Policy', documentTitle: 'Code of conduct', intent: 'acknowledge' }, linkFor,
    );
    expect(sign.actionLabel).toBe(copy.reviewAndSign);
    expect(ack.actionLabel).toBe(copy.reviewAndAcknowledge);
    // The whole reason `intent` is carried rather than an English verb: these are
    // separate catalog keys because no language inflects both acts alike.
    expect(sign.body).not.toBe(ack.body);
    expect(sign.body).toBe(copy.signInvitationBody.replace('{{Title}}', 'Mutual NDA'));
    expect(ack.body).toBe(copy.acknowledgeInvitationBody.replace('{{Title}}', 'Code of conduct'));
  });

  it.each(EMAIL_LOCALES)('a signature reminder in %s never builds an English past tense', (locale) => {
    const copy = EMAIL_MESSAGES[locale].shareInvitation;
    const message = shareInvitationMessage(
      locale, { kind: 'signatureReminder', subject: 'NDA', documentTitle: 'Mutual NDA', intent: 'acknowledge' }, linkFor,
    );
    expect(message.body).toBe(copy.acknowledgeReminderBody.replace('{{Title}}', 'Mutual NDA'));
    expect(message.footnote).toBe('NDA');
  });

  it('drops an unparseable deadline rather than printing "Invalid Date"', () => {
    const message = shareInvitationMessage(
      'en', { kind: 'formInvitation', title: 'Q3 pulse', closesAt: 'not a date' }, linkFor,
    );
    expect(message.footnote).toBeUndefined();
  });
});

describe('the transport renders its own chrome in the message’s language', () => {
  it.each(EMAIL_LOCALES)('greeting and personal-link trailer are in %s', async (locale) => {
    const fetchMock = stubFetch();
    const copy = EMAIL_MESSAGES[locale];
    await deliverShareInvitations(
      ENV,
      [{ email: 'a@example.com', name: 'Ada', token: 'tok' }],
      shareInvitationMessage(locale, { kind: 'formInvitation', title: 'Q3 pulse' }, linkFor),
      'test',
    );
    const { html } = sent(fetchMock);
    expect(html).toContain(copy.common.greeting.replace('{{RecipientName}}', 'Ada'));
    expect(html).toContain(copy.shareInvitation.personalLink);
    expect(html).toContain(copy.shareInvitation.openForm);
    // The link itself is never translated.
    expect(html).toContain('https://app.example/f/abc?t=tok');
  });

  it('greets an unnamed recipient with the anonymous greeting, still localized', async () => {
    const fetchMock = stubFetch();
    await deliverShareInvitations(
      ENV,
      [{ email: 'a@example.com', name: null, token: 'tok' }],
      shareInvitationMessage('fr', { kind: 'formInvitation', title: 'Q3 pulse' }, linkFor),
      'test',
    );
    expect(sent(fetchMock).html).toContain(EMAIL_MESSAGES.fr.common.greetingAnonymous);
  });

  it('escapes a recipient-supplied title rather than emitting it as markup', async () => {
    const fetchMock = stubFetch();
    await deliverShareInvitations(
      ENV,
      [{ email: 'a@example.com', name: '<b>Ada</b>', token: 'tok' }],
      shareInvitationMessage('en', { kind: 'formInvitation', title: '<script>x</script>' }, linkFor),
      'test',
    );
    const { html } = sent(fetchMock);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Ada</b>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('the publisher’s stored language decides', () => {
  it('writes a form invitation in the publisher’s language, not English', async () => {
    const fetchMock = stubFetch();
    const result = await deliverFormInvitations(
      ENV,
      stubDb('de'),
      { slug: 'abc', title: 'Q3 pulse' },
      [{ email: 'a@example.com', name: 'Ada', token: 'tok' }],
      { userId: 'user-1' },
    );
    expect(result).toEqual({ sent: 1, failed: 0 });
    const { html } = sent(fetchMock);
    expect(html).toContain(EMAIL_MESSAGES.de.shareInvitation.openForm);
    expect(html).toContain(EMAIL_MESSAGES.de.shareInvitation.personalLink);
    expect(html).not.toContain('Open the form');
    expect(html).not.toContain('You have been asked to answer');
  });

  it('falls back to the publishing request’s own language when nothing is stored', async () => {
    const fetchMock = stubFetch();
    await deliverSignatureInvitations(
      ENV,
      stubDb(null),
      { subject: 'NDA', documentTitle: 'Mutual NDA', intent: 'sign' },
      [{ email: 'a@example.com', name: 'Ada', token: 'tok' }],
      { userId: 'user-1', headers: { explicit: 'es-ES' } },
    );
    const { html } = sent(fetchMock);
    expect(html).toContain(EMAIL_MESSAGES.es.shareInvitation.reviewAndSign);
    expect(html).not.toContain('Review and sign');
  });

  it('is English when there is no publisher and no request to read', async () => {
    const fetchMock = stubFetch();
    await deliverSignatureReminders(
      ENV,
      stubDb(null),
      { subject: 'NDA', documentTitle: 'Mutual NDA', intent: 'sign' },
      [{ email: 'a@example.com', name: 'Ada', token: 'tok' }],
    );
    const { subject, html } = sent(fetchMock);
    expect(subject).toBe('Reminder: Mutual NDA');
    expect(html).toContain('You have not yet signed');
  });
});

describe('delivery accounting is unchanged', () => {
  it('counts a failure per recipient and still sends the rest', async () => {
    let call = 0;
    const fn = vi.fn(async () => {
      call += 1;
      return call === 1 ? new Response('nope', { status: 500 }) : new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fn);

    const result = await deliverShareInvitations(
      ENV,
      [
        { email: 'a@example.com', name: 'Ada', token: 't1' },
        { email: 'b@example.com', name: 'Bo', token: 't2' },
      ],
      shareInvitationMessage('de', { kind: 'formInvitation', title: 'Q3 pulse' }, linkFor),
      'test',
    );
    expect(result).toEqual({ sent: 1, failed: 1 });
  });

  it('sends nothing and reports nothing for an empty list', async () => {
    const fetchMock = stubFetch();
    const result = await deliverFormInvitations(ENV, stubDb('de'), { slug: 'abc', title: 'Q3' }, []);
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('every locale resolves every key the invitations use', () => {
  const KEYS: (keyof typeof EMAIL_MESSAGES.en.shareInvitation)[] = [
    'personalLink', 'openForm', 'reviewAndSign', 'reviewAndAcknowledge', 'reminderSubject',
    'formInvitationBody', 'signInvitationBody', 'acknowledgeInvitationBody',
    'formReminderBody', 'signReminderBody', 'acknowledgeReminderBody',
    'formClosesNote', 'requestExpiresNote',
  ];

  it.each(EMAIL_LOCALES)('%s has every share-invitation string, translated', (locale: EmailLocale) => {
    for (const key of KEYS) {
      const value = EMAIL_MESSAGES[locale].shareInvitation[key];
      expect(typeof value, `${locale}.${key}`).toBe('string');
      expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
      // No markup: the mailer escapes the composed sentence wholesale, so a tag
      // here would be printed to the recipient rather than rendered.
      expect(value, `${locale}.${key}`).not.toMatch(/<[a-z/]/i);
      if (locale !== 'en') {
        expect(value, `${locale}.${key}`).not.toBe(EMAIL_MESSAGES.en.shareInvitation[key]);
      }
    }
  });
});
