/**
 * Drive routes — /api/drive
 *
 * Connect a Google Drive or a OneDrive, browse it as a directory, and pull one
 * file's bytes so the Creation Canvas can open it. The canvas already knows how
 * to read a `.docx`, a `.xlsx`, a `.pptx` and a `.pdf`; this is only the part
 * that gets those bytes out of somebody's cloud storage without them having to
 * download the file and drag it back in.
 *
 *   GET  /providers                     → what this deployment offers + connected
 *   GET  /connect/:provider             → the consent URL to navigate to
 *   GET  /callback/:provider            → provider redirect (PUBLIC, signed state)
 *   DELETE /connections/:id             → disconnect
 *   GET  /connections/:id/files         → one folder's contents
 *   GET  /connections/:id/files/:fileId → the file's bytes
 *
 * Structure follows `mailboxRoutes` deliberately, including the callback's
 * auth-middleware exception: a provider redirect is a top-level navigation and
 * carries no bearer token, so it is authenticated by the SIGNED STATE instead.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { resolveAppBaseUrl, type Env, type HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import {
  buildProviderConsentUrl,
  completeProviderOAuthCallback,
} from '../../application/shared/providerOAuthConnect';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { failResponse } from '../middleware/errorResponse';
import { availableDriveProviders, getDriveProvider } from '../../application/drive/driveProviders';
import {
  deleteDriveConnection,
  downloadDriveFile,
  listDriveConnections,
  listDriveFolder,
  saveDriveConnection,
} from '../../application/drive/driveService';

/** Where the connect flow sends the browser back to when it is not told. */
const DEFAULT_RETURN_TO = '/create';

/**
 * A provider failure carries its own answer: {@link DriveProviderError} decides
 * the status (401 reconnect, 413 too big, 415 no downloadable form, 400 gone,
 * 503 transient) from the upstream code, and `driveService` turns anything else
 * into a `ServiceUnavailableError`. The route only renders.
 */
const SOURCE = 'presentation/routes/driveRoutes.ts';

export function createDriveRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  r.use('*', async (c, next) => {
    if (c.req.path.includes('/callback/')) return next();
    return authMiddleware(c, next);
  });

  const callbackUrl = (c: { req: { url: string } }, provider: string) =>
    `${new URL(c.req.url).origin}/api/drive/callback/${provider}`;

  // GET /providers — what this deployment can offer + what is already connected.
  r.get('/providers', async (c) => c.json({
    providers: availableDriveProviders(c.env as unknown as Record<string, unknown>),
    connections: await listDriveConnections(db, c.get('tenantId') as number, c.get('userId') as string),
  }));

  /**
   * GET /connect/:provider — build the consent URL.
   *
   * Returned as JSON for the client to navigate to, rather than a 302 from here:
   * a top-level navigation cannot carry the bearer token, so the browser must
   * make the jump itself after an authenticated fetch.
   */
  r.get('/connect/:provider', async (c) => {
    const env = c.env as Env;
    const name = c.req.param('provider');
    const provider = getDriveProvider(name);
    if (!provider) return c.json({ error: 'Unknown drive provider.' }, 400);

    const authUrl = await buildProviderConsentUrl(env, provider, {
      providerName: name,
      redirectUri: callbackUrl(c, name),
      userId: c.get('userId') as string,
      tenantId: c.get('tenantId') as number,
      returnTo: c.req.query('returnTo'),
      returnToFallback: DEFAULT_RETURN_TO,
    });
    if (!authUrl) {
      return c.json({ error: `${provider.label} is not configured on this deployment.` }, 503);
    }
    return c.json({ authUrl });
  });

  // GET /callback/:provider — provider redirect (PUBLIC; authed by signed state).
  r.get('/callback/:provider', async (c) => {
    const env = c.env as Env;
    const name = c.req.param('provider');
    const provider = getDriveProvider(name);
    const base = resolveAppBaseUrl(env);
    const code = c.req.query('code');
    const rawState = c.req.query('state');

    // Declining consent is a normal outcome, not an error — say so.
    if (c.req.query('error')) return c.redirect(`${base}${DEFAULT_RETURN_TO}?drive=declined`);
    if (!provider || !code || !rawState) return c.redirect(`${base}${DEFAULT_RETURN_TO}?drive=error`);

    const result = await completeProviderOAuthCallback(env, provider, {
      providerName: name, code, rawState, redirectUri: callbackUrl(c, name),
    });
    if (!result.ok) {
      if (result.reason === 'exchange_failed') {
        reportCaughtError(result.error, { source: SOURCE, operation: 'callback' });
      }
      const returnTo = result.returnTo ?? DEFAULT_RETURN_TO;
      const outcome = result.reason === 'exchange_failed' ? 'error' : result.reason;
      return c.redirect(`${base}${returnTo}?drive=${outcome}`);
    }
    const { state, tokens: tok } = result;

    try {
      // The account is the natural key of the row and the label a person picks
      // between two connected drives by, so a grant we cannot name is refused
      // rather than stored half-identified.
      const account = await provider.accountInfo(tok.access_token);
      if (!account.email) return c.redirect(`${base}${state.returnTo}?drive=no_account`);

      await saveDriveConnection(db, env, {
        tenantId: state.tenantId,
        userId: state.userId,
        provider: provider.name,
        accountEmail: account.email,
        displayName: account.displayName,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresInSeconds: tok.expires_in,
        scope: tok.scope ?? provider.scopes.join(' '),
      });
      return c.redirect(`${base}${state.returnTo}?drive=connected`);
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'callback' });
      return c.redirect(`${base}${state.returnTo}?drive=error`);
    }
  });

  r.delete('/connections/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid connection id.' }, 400);
    await deleteDriveConnection(db, c.get('tenantId') as number, c.get('userId') as string, id);
    return c.json({ ok: true });
  });

  /**
   * GET /connections/:id/files — one folder's contents.
   *
   * A folder at a time, not the whole tree: a drive is arbitrarily deep and
   * listing it eagerly would be an unbounded fan-out. `cursor` pages within a
   * folder, so a 5,000-file directory is paged rather than silently truncated.
   */
  r.get('/connections/:id/files', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid connection id.' }, 400);
    try {
      const listing = await listDriveFolder(
        db, c.env as Env, c.get('tenantId') as number, c.get('userId') as string, id,
        c.req.query('folderId')?.trim() || null,
        c.req.query('cursor')?.trim() || undefined,
      );
      return c.json(listing);
    } catch (error) {
      return failResponse(c, error, { source: SOURCE, operation: 'list-drive-folder' });
    }
  });

  /**
   * GET /connections/:id/files/:fileId — the file's bytes.
   *
   * Streamed straight back with the provider's own filename, so the client can
   * turn the response into a `File` and hand it to the SAME import engine a
   * dragged-in file goes through. A Google-native document arrives as the Office
   * container it was exported to, which is why no special case is needed here.
   */
  r.get('/connections/:id/files/:fileId', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid connection id.' }, 400);
    try {
      const file = await downloadDriveFile(
        db, c.env as Env, c.get('tenantId') as number, c.get('userId') as string, id, c.req.param('fileId'),
      );
      return new Response(file.bytes, {
        headers: {
          'content-type': file.mimeType,
          'content-disposition': `attachment; filename="${file.fileName.replace(/"/g, '')}"`,
          'cache-control': 'no-store',
        },
      });
    } catch (error) {
      return failResponse(c, error, { source: SOURCE, operation: 'download-drive-file' });
    }
  });

  return r;
}
