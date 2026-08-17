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

import { googleQueryValue } from '../drive/driveProviders';

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

export interface GoogleDriveSearchHit {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

/** Full-text search over the tenant's connected Google Drive — the `google-drive`
 *  workflow node's "search" operation. Uses the same `q` filter language and
 *  shared-drive params `driveProviders.ts`'s `list()` already proved work. */
export async function searchGoogleDrive(
  creds: GoogleOAuthCreds,
  query: string,
  maxResults = 10,
): Promise<GoogleDriveSearchHit[]> {
  const token = await googleAccessToken(creds);
  const q = `fullText contains '${googleQueryValue(query)}' and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id, name, mimeType, modifiedTime)',
    pageSize: String(Math.min(Math.max(Math.trunc(maxResults) || 10, 1), 50)),
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as { files?: GoogleDriveSearchHit[]; error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message || `Drive search failed (${res.status})`);
  return body.files ?? [];
}

/** What a Google-native file exports as PLAIN TEXT — narrower than
 *  `driveProviders.ts`'s Office-container exports (which feed the canvas's
 *  document editor); a workflow node reads/writes text, so text is what it gets. */
const GOOGLE_TEXT_EXPORTS: Readonly<Record<string, string>> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

export interface GoogleDriveFileText {
  name: string;
  mimeType: string;
  text: string;
}

/** Read one Drive file as text — the `google-drive` workflow node's "read"
 *  operation. A Google-native doc is exported to plain text/CSV; anything else
 *  is fetched raw and decoded as UTF-8 (correct for text/CSV/JSON/Markdown
 *  files; a genuinely binary file, e.g. a PDF or image, decodes to unreadable
 *  text — this node has no document-parsing pipeline, only Drive access). */
export async function readGoogleDriveFileText(
  creds: GoogleOAuthCreds,
  fileId: string,
  maxChars = 100_000,
): Promise<GoogleDriveFileText> {
  const token = await googleAccessToken(creds);
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const meta = (await metaRes.json().catch(() => ({}))) as { name?: string; mimeType?: string; error?: { message?: string } };
  if (!metaRes.ok) throw new Error(meta.error?.message || `Drive file lookup failed (${metaRes.status})`);

  const mimeType = meta.mimeType ?? '';
  const exportMime = GOOGLE_TEXT_EXPORTS[mimeType];
  const url = exportMime
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?${new URLSearchParams({ mimeType: exportMime })}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const errText = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Drive file read failed (${res.status})${errText ? `: ${errText}` : ''}`);
  }
  const text = (await res.text()).slice(0, maxChars);
  return { name: meta.name ?? fileId, mimeType: exportMime ?? mimeType, text };
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
