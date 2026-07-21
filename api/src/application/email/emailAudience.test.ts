/**
 * The two decisions every send makes before it renders anything: WHAT LANGUAGE,
 * and (for lifecycle only) MAY WE SEND AT ALL.
 *
 * These are the parts that, if wrong, are invisible in review and loud in
 * production — a stale cached consent row keeps mailing someone who unsubscribed,
 * and a mis-ordered locale chain silently ships English to a user who picked
 * Chinese. So the coverage here is deliberately about ORDERING and CACHE
 * INVALIDATION rather than about happy-path plumbing.
 */
import { describe, expect, it } from 'vitest';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { resolveEmailLocale } from './emailLocaleResolver';
import {
  DEFAULT_EMAIL_PREFERENCES,
  canSendLifecycleEmail,
  getEmailPreferences,
  normalizeEmailKey,
  LIFECYCLE_CATEGORIES,
} from './emailPreferences';
import { sendLifecycleEmail, sendTransactionalEmail, signUnsubscribeToken, verifyUnsubscribeToken } from './sendEmail';

// No AUTH_CACHE_KV → only the L1 Map engages, which test/setup.ts clears between
// tests. JWT_SECRET is needed for the unsubscribe-token cases.
const env = { JWT_SECRET: 'test-secret' } as Env;

/** db mock for the single-column `select().from().where().limit()` reads both
 *  modules use. Counts loader invocations so cache behaviour is observable. */
function makeDb(rows: Record<string, unknown>[]) {
  const calls = { count: 0 };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            calls.count += 1;
            return rows;
          },
        }),
      }),
    }),
  } as unknown as Db;
  return { db, calls };
}

describe('resolveEmailLocale — the priority chain', () => {
  it('prefers an already-loaded stored locale over everything, with no lookup', async () => {
    const { db, calls } = makeDb([{ locale: 'fr' }]);
    const locale = await resolveEmailLocale(env, db, {
      email: 'a@example.com',
      stored: 'zh',
      headers: { explicit: 'de' },
    });
    expect(locale).toBe('zh');
    // The whole point of passing `stored`: the row was already in hand.
    expect(calls.count).toBe(0);
  });

  it('looks the stored locale up when the caller did not load it', async () => {
    const { db, calls } = makeDb([{ locale: 'de' }]);
    const locale = await resolveEmailLocale(env, db, {
      email: 'lookup@example.com',
      headers: { explicit: 'fr' },
    });
    expect(locale).toBe('de');
    expect(calls.count).toBe(1);
  });

  it('falls through to the request when the stored locale is explicitly unset', async () => {
    // `stored: null` means "loaded, and it is NULL" — the resolver must not stop.
    const { db } = makeDb([]);
    const locale = await resolveEmailLocale(env, db, {
      email: 'a@example.com',
      stored: null,
      headers: { acceptLanguage: 'es-ES,es;q=0.9' },
    });
    expect(locale).toBe('es');
  });

  it('falls through to the request when the user row has no locale', async () => {
    const { db } = makeDb([{ locale: null }]);
    expect(await resolveEmailLocale(env, db, {
      email: 'nolocale@example.com',
      headers: { cookie: 'NEXT_LOCALE=fr' },
    })).toBe('fr');
  });

  it('ignores an unsupported stored locale rather than erroring on it', async () => {
    const { db } = makeDb([]);
    expect(await resolveEmailLocale(env, db, {
      email: 'a@example.com',
      stored: 'ja',
      headers: { explicit: 'de' },
    })).toBe('de');
  });

  it('ends at English for a cron send with no stored locale and no request', async () => {
    const { db } = makeDb([{ locale: null }]);
    expect(await resolveEmailLocale(env, db, { email: 'cron@example.com' })).toBe('en');
  });

  it('never fails a send when the locale lookup throws', async () => {
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => { throw new Error('db down'); } }) }) }),
    } as unknown as Db;
    expect(await resolveEmailLocale(env, db, {
      email: 'boom@example.com',
      headers: { explicit: 'zh' },
    })).toBe('zh');
  });

  it('caches the stored-locale lookup instead of re-querying per recipient', async () => {
    const { db, calls } = makeDb([{ locale: 'de' }]);
    for (let i = 0; i < 4; i++) {
      await resolveEmailLocale(env, db, { email: 'bulk@example.com' });
    }
    expect(calls.count).toBe(1);
  });

  it('caches a MISSING locale too, so an English-defaulting user is not re-queried', async () => {
    // Regression guard: caching only the hit would make every send for a user who
    // never picked a language hit the database.
    const { db, calls } = makeDb([{ locale: null }]);
    await resolveEmailLocale(env, db, { email: 'nopref@example.com' });
    await resolveEmailLocale(env, db, { email: 'nopref@example.com' });
    expect(calls.count).toBe(1);
  });

  it('keys the cache case-insensitively', async () => {
    const { db, calls } = makeDb([{ locale: 'fr' }]);
    await resolveEmailLocale(env, db, { email: 'Case@Example.com' });
    await resolveEmailLocale(env, db, { email: 'case@example.com' });
    expect(calls.count).toBe(1);
  });
});

describe('email preferences', () => {
  it('treats a missing row as all-allowed', async () => {
    const { db } = makeDb([]);
    expect(await getEmailPreferences(env, db, 'unknown@example.com'))
      .toEqual(DEFAULT_EMAIL_PREFERENCES);
  });

  it('allows every lifecycle category by default', async () => {
    const { db } = makeDb([]);
    for (const category of LIFECYCLE_CATEGORIES) {
      expect(await canSendLifecycleEmail(env, db, `default-${category}@example.com`, category)).toBe(true);
    }
  });

  it('blocks a category the recipient turned off', async () => {
    const { db } = makeDb([{
      productUpdates: false, onboardingTips: true, digests: true, unsubscribedAll: false,
    }]);
    expect(await canSendLifecycleEmail(env, db, 'partial@example.com', 'product_updates')).toBe(false);
    expect(await canSendLifecycleEmail(env, db, 'partial@example.com', 'onboarding_tips')).toBe(true);
  });

  it('lets a global unsubscribe override every category flag', async () => {
    // This is the CAN-SPAM contract: one footer click stops everything, even
    // categories still marked true.
    const { db } = makeDb([{
      productUpdates: true, onboardingTips: true, digests: true, unsubscribedAll: true,
    }]);
    for (const category of LIFECYCLE_CATEGORIES) {
      expect(await canSendLifecycleEmail(env, db, 'gone@example.com', category)).toBe(false);
    }
  });

  it('normalizes addresses so consent is not case-sensitive', () => {
    expect(normalizeEmailKey('  Ada@Example.COM ')).toBe('ada@example.com');
  });
});

describe('the transactional / lifecycle split', () => {
  it('sends a transactional mail without ever consulting consent', async () => {
    // An unsubscribed user must still get their magic link.
    const { db } = makeDb([{
      productUpdates: false, onboardingTips: false, digests: false, unsubscribedAll: true,
    }]);
    let sent = 0;
    await sendTransactionalEmail(env, db, 'gone@example.com', async () => { sent += 1; });
    expect(sent).toBe(1);
  });

  it('gives a transactional template no unsubscribe url to render', async () => {
    const { db } = makeDb([]);
    let ctxUnsubscribe: string | undefined = 'not-called';
    await sendTransactionalEmail(env, db, 'a@example.com', async (ctx) => {
      ctxUnsubscribe = ctx.unsubscribeUrl;
    });
    expect(ctxUnsubscribe).toBeUndefined();
  });

  it('suppresses a lifecycle mail to an unsubscribed recipient', async () => {
    const { db } = makeDb([{
      productUpdates: true, onboardingTips: true, digests: true, unsubscribedAll: true,
    }]);
    let sent = 0;
    const result = await sendLifecycleEmail(
      env, db, 'gone@example.com', 'product_updates', async () => { sent += 1; },
    );
    expect(result).toBe('suppressed');
    expect(sent).toBe(0);
  });

  it('sends a lifecycle mail with a working unsubscribe url', async () => {
    const { db } = makeDb([]);
    let captured = '';
    const result = await sendLifecycleEmail(
      env, db, 'ok@example.com', 'digests', async (ctx) => { captured = ctx.unsubscribeUrl; },
    );
    expect(result).toBe('sent');
    expect(captured).toContain('/api/email-preferences/unsubscribe?token=');

    // And the url it handed over must actually round-trip back to this address.
    const token = decodeURIComponent(new URL(captured).searchParams.get('token')!);
    expect(await verifyUnsubscribeToken(env.JWT_SECRET, token)).toBe('ok@example.com');
  });
});

describe('unsubscribe tokens', () => {
  it('round-trips the address, lowercased', async () => {
    const token = await signUnsubscribeToken(env.JWT_SECRET, 'Ada@Example.com');
    expect(await verifyUnsubscribeToken(env.JWT_SECRET, token)).toBe('ada@example.com');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signUnsubscribeToken('other-secret', 'ada@example.com');
    expect(await verifyUnsubscribeToken(env.JWT_SECRET, token)).toBeNull();
  });

  it('rejects garbage without throwing', async () => {
    expect(await verifyUnsubscribeToken(env.JWT_SECRET, 'not-a-token')).toBeNull();
    expect(await verifyUnsubscribeToken(env.JWT_SECRET, '')).toBeNull();
  });

  it('rejects a validly-signed token minted for a DIFFERENT purpose', async () => {
    // Guards against replaying e.g. an OAuth `state` (same HMAC primitives, same
    // secret) to opt an address out.
    const { signState } = await import('../../infrastructure/auth/oauthState');
    const foreign = await signState(env.JWT_SECRET, { email: 'victim@example.com', purpose: 'oauth' });
    expect(await verifyUnsubscribeToken(env.JWT_SECRET, foreign)).toBeNull();
  });
});
