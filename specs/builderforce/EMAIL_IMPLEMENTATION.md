# Email Implementation Guide

This document covers the complete email architecture used in hired.video — provider setup, templates, token management, and patterns for adapting this system to any TypeScript application.

---

## Architecture Overview

The email system uses a **Provider Interface pattern** to decouple sending logic from the rest of the application. Swapping providers (SendPulse → Resend, Postmark, etc.) means changing a single implementation class.

```
EmailProvider (interface)
    └── SendPulseEmailProvider (implementation)
            └── sendpulse.com REST API (OAuth2 + SMTP endpoint)
```

### Core types

```typescript
interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  fromName?: string;
  fromEmail?: string;
}

interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}
```

---

## SendPulse Setup

### 1. Create an account and API key

1. Go to [sendpulse.com](https://sendpulse.com) → **Settings → API**
2. Generate a Client ID and Client Secret
3. Verify your sender domain/address under **Email → Senders**

### 2. Environment variables

```bash
# .env / wrangler secrets
EMAIL_CLIENTID=your_sendpulse_client_id
EMAIL_SECRET=your_sendpulse_client_secret
EMAIL_FROM=noreply@yourdomain.com
FRONTEND_URL=https://yourdomain.com
```

For Cloudflare Workers (wrangler), store secrets via:
```bash
wrangler secret put EMAIL_CLIENTID --env production
wrangler secret put EMAIL_SECRET --env production
```

For non-sensitive values, use `[vars]` in `wrangler.toml`:
```toml
[vars]
EMAIL_FROM = "noreply@yourdomain.com"
FRONTEND_URL = "https://yourdomain.com"
```

### 3. SendPulse OAuth2 token flow

SendPulse uses OAuth2 `client_credentials` grant. Tokens expire after 3600 seconds. Cache them in memory and refresh 60 seconds before expiry.

```typescript
// Token cache (module-level singleton)
let cachedToken: string | null = null;
let tokenExpiresAt: number | null = null;

async function getSendPulseToken(clientId: string, clientSecret: string): Promise<string> {
  const now = Date.now();
  // Refresh if expired or within 60s of expiry
  if (cachedToken && tokenExpiresAt && now < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const response = await fetch('https://api.sendpulse.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`SendPulse token request failed: ${response.status}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000;
  return cachedToken;
}
```

### 4. Sending an email via SendPulse SMTP API

SendPulse's SMTP endpoint requires the HTML body base64-encoded.

```typescript
async function sendViaSendPulse(
  message: EmailMessage,
  clientId: string,
  clientSecret: string,
  fromEmail: string,
): Promise<void> {
  const token = await getSendPulseToken(clientId, clientSecret);

  const payload = {
    email: {
      html: btoa(unescape(encodeURIComponent(message.html))), // base64 encode UTF-8 HTML
      text: '',
      subject: message.subject,
      from: {
        name: message.fromName ?? 'Your App',
        email: message.fromEmail ?? fromEmail,
      },
      to: [{ name: message.to, email: message.to }],
    },
  };

  const response = await fetch('https://api.sendpulse.com/smtp/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SendPulse send failed: ${response.status} — ${body}`);
  }
}
```

> **Note on `btoa` encoding:** `btoa(unescape(encodeURIComponent(html)))` handles non-ASCII characters correctly. In Node.js you can use `Buffer.from(html).toString('base64')` instead.

---

## Template System

### Layout + body composition

All emails share a **layout** (header + footer) with the body swapped per email type. The layout is composed at render time — there are no external template files.

```typescript
const LAYOUT_HEADER = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background:#f8fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc; padding:40px 20px;">
    <tr><td align="center">
      <!-- Header bar -->
      <table width="600" cellpadding="0" cellspacing="0" style="background:#1e293b; border-radius:8px 8px 0 0; padding:24px 40px;">
        <tr>
          <td>
            <a href="{{AppUrl}}" style="color:#ffffff; font-size:22px; font-weight:700; text-decoration:none;">
              YourApp
            </a>
          </td>
        </tr>
      </table>
      <!-- Body wrapper -->
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; padding:40px;">
        <tr><td>
`;

const LAYOUT_FOOTER = `
        </td></tr>
      </table>
      <!-- Footer -->
      <table width="600" cellpadding="0" cellspacing="0" style="background:#f1f5f9; border-radius:0 0 8px 8px; padding:24px 40px;">
        <tr>
          <td style="color:#64748b; font-size:13px; text-align:center;">
            <p style="margin:0 0 8px;">© {{Year}} YourApp. All rights reserved.</p>
            <p style="margin:0; font-size:12px;">
              You received this email because you have an account at YourApp.<br>
              This is a transactional email — it cannot be unsubscribed from.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;
```

### Variable substitution

```typescript
function render(body: string, vars: Record<string, string>): string {
  let out = LAYOUT_HEADER + body + LAYOUT_FOOTER;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  // Always inject year and app URL
  out = out.replaceAll('{{Year}}', new Date().getFullYear().toString());
  out = out.replaceAll('{{AppUrl}}', process.env.FRONTEND_URL ?? '');
  return out;
}
```

---

## Email Templates

### Reusable button component

```typescript
function ctaButton(href: string, label: string): string {
  return `
    <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background:#2563eb; border-radius:6px;">
          <a href="${href}" style="display:inline-block; padding:14px 28px; color:#ffffff; font-size:16px; font-weight:600; text-decoration:none; border-radius:6px;">
            ${label}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:8px 0 0; font-size:13px; color:#64748b;">
      Or copy this link: <a href="${href}" style="color:#2563eb;">${href}</a>
    </p>
  `;
}
```

---

### Template 1: Email Verification

**Trigger:** User registers
**Variables:** `RecipientName`, `VerifyUrl`

```typescript
const VERIFY_EMAIL_BODY = `
  <h2 style="margin:0 0 8px; color:#1e293b; font-size:24px;">Verify your email</h2>
  <p style="margin:0 0 16px; color:#475569;">Hi {{RecipientName}},</p>
  <p style="margin:0 0 24px; color:#475569; line-height:1.6;">
    Thanks for creating an account. Click the button below to verify your email address.
    This link expires in <strong>24 hours</strong>.
  </p>
  {{VerifyButton}}
  <p style="margin:24px 0 0; color:#94a3b8; font-size:13px;">
    If you didn't create an account, you can safely ignore this email.
  </p>
`;

export async function sendVerificationEmail(
  to: string,
  recipientName: string,
  token: string,
  env: Env,
): Promise<void> {
  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${token}`;
  const html = render(VERIFY_EMAIL_BODY, {
    RecipientName: recipientName,
    VerifyButton: ctaButton(verifyUrl, 'Verify Email Address'),
  });
  await sendViaSendPulse(
    { to, subject: 'Verify your email address', html },
    env.EMAIL_CLIENTID,
    env.EMAIL_SECRET,
    env.EMAIL_FROM,
  );
}
```

---

### Template 2: Password Reset

**Trigger:** `POST /auth/forgot-password`
**Variables:** `RecipientName`, `ResetUrl`
**Token expiry:** 1 hour (enforced in DB)

```typescript
const PASSWORD_RESET_BODY = `
  <h2 style="margin:0 0 8px; color:#1e293b; font-size:24px;">Reset your password</h2>
  <p style="margin:0 0 16px; color:#475569;">Hi {{RecipientName}},</p>
  <p style="margin:0 0 24px; color:#475569; line-height:1.6;">
    We received a request to reset your password. Click the button below.
    This link expires in <strong>1 hour</strong>.
  </p>
  {{ResetButton}}
  <p style="margin:24px 0 0; color:#94a3b8; font-size:13px;">
    If you didn't request a password reset, no action is needed — your account is safe.
  </p>
`;

export async function sendPasswordResetEmail(
  to: string,
  recipientName: string,
  token: string,
  env: Env,
): Promise<void> {
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`;
  const html = render(PASSWORD_RESET_BODY, {
    RecipientName: recipientName,
    ResetButton: ctaButton(resetUrl, 'Reset Password'),
  });
  await sendViaSendPulse(
    { to, subject: 'Reset your password', html },
    env.EMAIL_CLIENTID,
    env.EMAIL_SECRET,
    env.EMAIL_FROM,
  );
}
```

---

### Template 3: Two-Factor Authentication Code

**Trigger:** Login when `mfaEnabled = true`
**Variables:** `RecipientName`, `TwoFactorCode`, `CodeExpiryMinutes`
**Token expiry:** 10 minutes (enforced in DB)

```typescript
const TWO_FACTOR_BODY = `
  <h2 style="margin:0 0 8px; color:#1e293b; font-size:24px;">Your login code</h2>
  <p style="margin:0 0 16px; color:#475569;">Hi {{RecipientName}},</p>
  <p style="margin:0 0 24px; color:#475569; line-height:1.6;">
    Use this code to complete your sign-in. It expires in <strong>{{CodeExpiryMinutes}} minutes</strong>.
  </p>
  <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="background:#f1f5f9; border:2px dashed #cbd5e1; border-radius:8px; padding:20px 40px;">
        <span style="font-size:36px; font-weight:700; letter-spacing:12px; color:#1e293b; font-family:monospace;">
          {{TwoFactorCode}}
        </span>
      </td>
    </tr>
  </table>
  <p style="margin:0; color:#94a3b8; font-size:13px;">
    If you didn't try to sign in, someone may have your password. Change it immediately.
  </p>
`;

export async function sendTwoFactorEmail(
  to: string,
  recipientName: string,
  code: string,
  expiryMinutes: number = 10,
  env: Env,
): Promise<void> {
  const html = render(TWO_FACTOR_BODY, {
    RecipientName: recipientName,
    TwoFactorCode: code,
    CodeExpiryMinutes: String(expiryMinutes),
  });
  await sendViaSendPulse(
    { to, subject: `${code} is your login code`, html },
    env.EMAIL_CLIENTID,
    env.EMAIL_SECRET,
    env.EMAIL_FROM,
  );
}
```

---

### Template 4: Resend Email Verification

Same structure as the initial verification email but with different copy.

```typescript
const RESEND_VERIFY_BODY = `
  <h2 style="margin:0 0 8px; color:#1e293b; font-size:24px;">New verification link</h2>
  <p style="margin:0 0 16px; color:#475569;">Hi {{RecipientName}},</p>
  <p style="margin:0 0 24px; color:#475569; line-height:1.6;">
    Here's a new link to verify your email. This link expires in <strong>24 hours</strong>.
    Your previous verification link is now invalid.
  </p>
  {{VerifyButton}}
`;
```

---

### Template 5: Team Invitation (if applicable)

```typescript
const TEAM_INVITE_BODY = `
  <h2 style="margin:0 0 8px; color:#1e293b; font-size:24px;">You've been invited</h2>
  <p style="margin:0 0 16px; color:#475569;">Hi there,</p>
  <p style="margin:0 0 24px; color:#475569; line-height:1.6;">
    <strong>{{InviterName}}</strong> has invited you to join their team on YourApp
    as a <strong>{{Role}}</strong>. Click the button below to accept.
    This invitation expires in <strong>7 days</strong>.
  </p>
  {{InviteButton}}
  <p style="margin:24px 0 0; color:#94a3b8; font-size:13px;">
    If you weren't expecting this invitation, you can ignore this email.
  </p>
`;
```

---

## Token Management

All one-time tokens follow the same DB pattern.

### Schema (Drizzle ORM)

```typescript
export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const twoFactorCodes = pgTable('two_factor_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 6 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

### Token generation

```typescript
import { randomBytes } from 'crypto'; // Node.js / Cloudflare Workers

function generateToken(bytes: number = 32): string {
  return randomBytes(bytes).toString('hex'); // 64-char hex string
}

function generate2FACode(): string {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit numeric
}
```

### Token validation pattern

```typescript
// Generic: works for email verification, password reset, magic links
async function validateToken(
  db: Database,
  table: TokenTable,
  token: string,
): Promise<{ userId: string } | null> {
  const record = await db.query.table.findFirst({
    where: and(
      eq(table.token, token),
      eq(table.used, false),
      gt(table.expiresAt, new Date()),
    ),
  });

  if (!record) return null;

  // Mark used immediately to prevent replay attacks
  await db.update(table).set({ used: true }).where(eq(table.id, record.id));

  return { userId: record.userId };
}
```

### Rate limiting resend requests

Prevent resend abuse at the DB level without a cache:

```typescript
async function canResendVerification(db: Database, userId: string): Promise<boolean> {
  const oneMinuteAgo = new Date(Date.now() - 60_000);
  const recent = await db.query.emailVerificationTokens.findFirst({
    where: and(
      eq(emailVerificationTokens.userId, userId),
      gt(emailVerificationTokens.createdAt, oneMinuteAgo),
    ),
    orderBy: desc(emailVerificationTokens.createdAt),
  });
  return !recent; // true = can resend
}
```

---

## Cloudflare Workers: Fire-and-Forget Pattern

On Cloudflare Workers, async work must be registered with `executionCtx.waitUntil()` or it will be terminated when the response returns.

```typescript
// In a Hono route handler
app.post('/auth/register', async (c) => {
  // ... create user, generate token ...

  // Fire-and-forget: don't await, don't block the response
  c.executionCtx.waitUntil(
    sendVerificationEmail(user.email, user.name, token, c.env).catch((err) => {
      console.error('[register] Failed to send verification email:', err);
      // Log to Sentry here if needed — but never throw
    }),
  );

  return c.json({ message: 'Registration successful. Check your email.' }, 201);
});
```

> **Critical:** Always `.catch()` inside `waitUntil`. An unhandled rejection inside `waitUntil` will silently terminate the Worker on some runtimes.

---

## Error Handling Strategy

| Scenario | Handling |
|---|---|
| Token request fails (network) | Throw — caller will catch and log |
| Token request fails (401 bad credentials) | Throw with descriptive message |
| Send fails (invalid email address) | Throw — log, don't retry automatically |
| Send fails (rate limit / 429) | Throw — implement exponential backoff if needed |
| Email send failure on registration | Log, don't fail the registration response (user can resend) |
| Email send failure on password reset | Log — the user will just see "if your email exists, we sent a link" |
| 2FA send failure | Surface as error to user ("Failed to send code — try again") |

---

## Adapting to Other Providers

The `EmailProvider` interface makes switching trivial:

### Resend

```typescript
import { Resend } from 'resend';

class ResendEmailProvider implements EmailProvider {
  private client: Resend;
  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }
  async send(message: EmailMessage): Promise<void> {
    await this.client.emails.send({
      from: message.fromEmail ?? 'noreply@yourdomain.com',
      to: message.to,
      subject: message.subject,
      html: message.html,
    });
  }
}
```

### Postmark

```typescript
import * as postmark from 'postmark';

class PostmarkEmailProvider implements EmailProvider {
  private client: postmark.ServerClient;
  constructor(serverToken: string) {
    this.client = new postmark.ServerClient(serverToken);
  }
  async send(message: EmailMessage): Promise<void> {
    await this.client.sendEmail({
      From: message.fromEmail ?? 'noreply@yourdomain.com',
      To: message.to,
      Subject: message.subject,
      HtmlBody: message.html,
    });
  }
}
```

### Provider factory

```typescript
function getEmailProvider(env: Env): EmailProvider {
  switch (env.EMAIL_PROVIDER ?? 'sendpulse') {
    case 'resend':
      return new ResendEmailProvider(env.RESEND_API_KEY);
    case 'postmark':
      return new PostmarkEmailProvider(env.POSTMARK_SERVER_TOKEN);
    case 'sendpulse':
    default:
      return new SendPulseEmailProvider(env.EMAIL_CLIENTID, env.EMAIL_SECRET, env.EMAIL_FROM);
  }
}
```

---

## Adapting to Non-Edge Runtimes

### Node.js / Express

- Replace `c.executionCtx.waitUntil(...)` with `Promise.resolve().then(...)` or a job queue (BullMQ, etc.)
- Replace `btoa(unescape(encodeURIComponent(html)))` with `Buffer.from(html).toString('base64')`
- Replace `randomBytes` import from `'crypto'` (already the same)
- Token caching in module-level variables works as-is

### Next.js (App Router)

- Use `after()` (Next.js 15+) or a background job for fire-and-forget email
- Keep the service layer as-is; just inject env vars from `process.env`

---

## Checklist: Adding a New Email

1. [ ] Write a `BODY` constant with `{{Placeholder}}` variables
2. [ ] Add a `ctaButton(url, label)` call if the email needs a CTA
3. [ ] Export a typed `sendXxxEmail(to, name, ..., env)` function
4. [ ] Create the matching DB token table if a one-time token is needed
5. [ ] Add the trigger call in the relevant route with `waitUntil()` + `.catch()`
6. [ ] Verify the sender address is confirmed in SendPulse (or it will bounce)
7. [ ] Test with a real inbox — check both Gmail and a plain-text client

---

## Full Service File Structure

```
api/src/services/email.ts
├── Token cache (module-level variables)
├── getSendPulseToken()
├── sendViaSendPulse()
├── render()
├── ctaButton()
├── buildVerifyUrl()
├── buildPasswordResetUrl()
├── LAYOUT_HEADER
├── LAYOUT_FOOTER
├── VERIFY_EMAIL_BODY
├── RESEND_VERIFY_BODY
├── PASSWORD_RESET_BODY
├── TWO_FACTOR_BODY
├── sendVerificationEmail()          ← exported
├── sendResendVerificationEmail()    ← exported
├── sendPasswordResetEmail()         ← exported
└── sendTwoFactorEmail()             ← exported
```

Only the `send*` functions should be imported by routes. Everything else is internal.
