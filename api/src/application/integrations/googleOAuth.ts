/**
 * Google OAuth offline-credential helpers — shared by the Gmail workflow node
 * and the Google Drive storage backend.
 *
 * The tenant stores `{ clientId, clientSecret, refreshToken, ... }` (encrypted)
 * as an integration credential. We exchange the refresh token for a short-lived
 * access token on demand (Google tokens last ~1h; minting per call is simplest
 * and safe on Workers — no shared mutable cache needed). Everything here is pure
 * fetch against Google's public REST endpoints; no SDK.
 */

export interface GoogleOAuthCreds {
  clientId?: unknown;
  clientSecret?: unknown;
  refreshToken?: unknown;
  fromEmail?: unknown;
  rootFolderId?: unknown;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Exchange the stored refresh token for a fresh access token. Throws on failure. */
export async function googleAccessToken(creds: GoogleOAuthCreds): Promise<string> {
  const clientId = str(creds.clientId);
  const clientSecret = str(creds.clientSecret);
  const refreshToken = str(creds.refreshToken);
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google credentials require clientId, clientSecret and refreshToken');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || `Token exchange failed (${res.status})`);
  }
  return body.access_token;
}

/** Base64url-encode a UTF-8 string (RFC 4648 §5, no padding) for the Gmail raw message. */
function base64Url(input: string): string {
  const b64 = btoa(unescape(encodeURIComponent(input)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface GmailMessage {
  to: string;
  subject: string;
  body: string;
  /** When set, overrides the credential's default fromEmail. */
  from?: string;
}

/** Send an email via the Gmail API using the stored credentials. Returns the
 *  Gmail message id. Throws with a readable message on failure. */
export async function sendGmail(creds: GoogleOAuthCreds, msg: GmailMessage): Promise<{ id: string }> {
  const to = msg.to.trim();
  if (!to) throw new Error('A recipient (to) is required');
  const from = (msg.from ?? '').trim() || str(creds.fromEmail);
  const token = await googleAccessToken(creds);
  const headers = [
    `To: ${to}`,
    from ? `From: ${from}` : '',
    `Subject: ${msg.subject ?? ''}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
  ].filter(Boolean).join('\r\n');
  const raw = base64Url(`${headers}\r\n\r\n${msg.body ?? ''}`);
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !body.id) throw new Error(body.error?.message || `Gmail send failed (${res.status})`);
  return { id: body.id };
}

/** Connectivity check for Gmail creds — reads the profile (cheap, no side-effect). */
export async function testGmail(creds: GoogleOAuthCreds): Promise<{ ok: boolean; message: string }> {
  try {
    const token = await googleAccessToken(creds);
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as { emailAddress?: string; error?: { message?: string } };
    return res.ok && body.emailAddress
      ? { ok: true, message: `Connected as ${body.emailAddress}` }
      : { ok: false, message: body.error?.message || `Gmail check failed (${res.status})` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Gmail check failed' };
  }
}

/** Connectivity check for Google Drive creds — reads the About/storageQuota. */
export async function testGoogleDrive(creds: GoogleOAuthCreds): Promise<{ ok: boolean; message: string }> {
  try {
    const token = await googleAccessToken(creds);
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as { user?: { emailAddress?: string }; error?: { message?: string } };
    return res.ok && body.user?.emailAddress
      ? { ok: true, message: `Connected as ${body.user.emailAddress}` }
      : { ok: false, message: body.error?.message || `Drive check failed (${res.status})` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Drive check failed' };
  }
}
