/**
 * Email preferences + one-click unsubscribe — /api/email-preferences/*
 *
 *   GET  /                  — the signed-in user's consent + language.
 *   PUT  /                  — update either. Invalidates both caches.
 *   GET  /unsubscribe?token — PUBLIC, no session: the footer link in every
 *                             lifecycle mail. Returns a small HTML page, because
 *                             it is opened by a mail client, not by the SPA.
 *
 * The unsubscribe endpoint is deliberately session-free and JavaScript-free: a
 * person clicking "unsubscribe" is usually not logged in, often on a different
 * device, and CAN-SPAM requires the mechanism to work anyway. Authorization comes
 * from the HMAC token, which contains the address — so it can only ever opt out an
 * address we actually mailed, and cannot be used to enumerate or target others.
 */
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv, Env } from '../../env';
import { users } from '../../infrastructure/database/schema';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import type { UserId } from '../../domain/shared/types';
import {
  getEmailPreferences,
  setEmailPreferences,
  type EmailPreferenceState,
} from '../../application/email/emailPreferences';
import { verifyUnsubscribeToken } from '../../application/email/sendEmail';
import { setUserLocale } from '../../application/email/emailLocaleResolver';
import {
  DEFAULT_EMAIL_LOCALE,
  EMAIL_LOCALES,
  isEmailLocale,
  normalizeLocale,
} from '../../infrastructure/email/emailLocale';
import { emailCopy } from '../../infrastructure/email/emailMessages';

/** Only these three are user-settable. `unsubscribedAll` is NOT patchable here —
 *  it is owned by the unsubscribe link and by the explicit resubscribe action
 *  below, so a category toggle can never silently clear a global opt-out. */
const PATCHABLE: (keyof EmailPreferenceState)[] = ['productUpdates', 'onboardingTips', 'digests'];

export function createEmailPreferenceRoutes(db: Db) {
  const router = new Hono<HonoEnv>();

  // -------------------------------------------------------------------------
  // GET / — current consent + language for the signed-in user.
  // -------------------------------------------------------------------------
  router.get('/', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as UserId;
    const [user] = await db
      .select({ email: users.email, locale: users.locale })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return c.json({ error: 'User not found' }, 404);

    const preferences = await getEmailPreferences(c.env as Env, db, user.email);
    return c.json({
      email: user.email,
      // null (not 'en') when never captured, so the UI can show "auto-detect"
      // rather than claiming the user chose English.
      locale: normalizeLocale(user.locale),
      supportedLocales: EMAIL_LOCALES,
      preferences,
    });
  });

  // -------------------------------------------------------------------------
  // PUT / — update consent and/or language.
  // -------------------------------------------------------------------------
  router.put('/', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as UserId;
    const body = await c.req.json<Partial<EmailPreferenceState> & { locale?: string; resubscribe?: boolean }>()
      .catch(() => ({} as Partial<EmailPreferenceState> & { locale?: string; resubscribe?: boolean }));

    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return c.json({ error: 'User not found' }, 404);

    if (body.locale !== undefined) {
      if (!isEmailLocale(body.locale)) {
        return c.json({ error: `locale must be one of: ${EMAIL_LOCALES.join(', ')}` }, 400);
      }
      await setUserLocale(c.env as Env, db, userId, body.locale);
    }

    const patch: Partial<EmailPreferenceState> = {};
    for (const key of PATCHABLE) {
      if (typeof body[key] === 'boolean') patch[key] = body[key];
    }
    // The ONLY way back out of a global opt-out, and it must be explicit — a
    // signed-in user re-enabling their own mail is consent, a category toggle is not.
    if (body.resubscribe === true) patch.unsubscribedAll = false;

    const preferences = Object.keys(patch).length > 0
      ? await setEmailPreferences(c.env as Env, db, user.email, patch, { userId })
      : await getEmailPreferences(c.env as Env, db, user.email);

    return c.json({ preferences });
  });

  // -------------------------------------------------------------------------
  // GET /unsubscribe?token=… — PUBLIC one-click global opt-out.
  // -------------------------------------------------------------------------
  router.get('/unsubscribe', async (c) => {
    const token = c.req.query('token') ?? '';
    const email = token ? await verifyUnsubscribeToken((c.env as Env).JWT_SECRET, token) : null;

    // The confirmation page is rendered in the locale of the account when we know
    // it — the person just clicked a link in a mail written in that language, so
    // switching them to English at the last step would be jarring.
    const locale = email ? await localeForEmail(db, email) : DEFAULT_EMAIL_LOCALE;

    if (!email) {
      return c.html(unsubscribePage(emailCopy(locale).common.unsubscribeLabel, INVALID_MESSAGE), 400);
    }

    // Link the row to the account when the address has one, so /settings shows the
    // same state the mail footer just changed.
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    await setEmailPreferences(c.env as Env, db, email, { unsubscribedAll: true }, { userId: user?.id ?? null });

    return c.html(unsubscribePage(
      emailCopy(locale).common.unsubscribeLabel,
      confirmedMessage(locale, email),
    ));
  });

  return router;
}

/** The account's stored locale for an address, defaulted. Read directly rather
 *  than through the send-path resolver: there is no send happening here. */
async function localeForEmail(db: Db, email: string) {
  const [row] = await db
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return normalizeLocale(row?.locale) ?? DEFAULT_EMAIL_LOCALE;
}

const INVALID_MESSAGE = 'This unsubscribe link is not valid. '
  + 'You can manage your email preferences from Settings once signed in.';

/** Localized confirmation copy. Kept beside the page it renders — it is chrome for
 *  a two-line HTML page, not template copy shared by any email. */
const CONFIRMED: Record<string, string> = {
  en: 'You have been unsubscribed. {{Email}} will no longer receive non-essential email from Builderforce. '
    + 'Account and security messages are still sent.',
  zh: '您已成功退订。{{Email}} 将不再收到来自 Builderforce 的非必要邮件。账户与安全相关的通知仍会发送。',
  es: 'Te has dado de baja. {{Email}} ya no recibirá correos no esenciales de Builderforce. '
    + 'Los mensajes de cuenta y seguridad se siguen enviando.',
  fr: 'Vous êtes désabonné. {{Email}} ne recevra plus d’e-mails non essentiels de Builderforce. '
    + 'Les messages de compte et de sécurité continuent d’être envoyés.',
  de: 'Sie wurden abgemeldet. {{Email}} erhält keine nicht notwendigen E-Mails von Builderforce mehr. '
    + 'Konto- und Sicherheitsnachrichten werden weiterhin gesendet.',
};

function confirmedMessage(locale: string, email: string): string {
  return (CONFIRMED[locale] ?? CONFIRMED.en!).replaceAll('{{Email}}', escapeHtml(email));
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A self-contained confirmation page. No JS, no external assets — it is opened
 * from a mail client and must render everywhere. Uses `prefers-color-scheme` so it
 * is readable in both light and dark, like every other surface in the product.
 */
function unsubscribePage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Builderforce</title>
  <style>
    :root { color-scheme: light dark; --bg: #f4f4f4; --card: #ffffff; --fg: #1e293b; --muted: #64748b; --line: #e2e8f0; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #0b1120; --card: #111a2e; --fg: #e2e8f0; --muted: #94a3b8; --line: #1e293b; }
    }
    body { font-family: Arial, sans-serif; background: var(--bg); color: var(--fg);
           margin: 0; padding: 40px 16px; }
    .card { max-width: 520px; margin: 0 auto; background: var(--card);
            border: 1px solid var(--line); border-radius: 12px; padding: 32px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { font-size: 15px; line-height: 1.6; margin: 0 0 12px; }
    .muted { color: var(--muted); font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${message}</p>
    <p class="muted">Builderforce</p>
  </div>
</body></html>`;
}
