import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import { isProviderOAuthConfigured } from '../../application/shared/providerOAuthConnect';
import { grantFromTokenResponse } from '../../application/integrations/oauthTokenVault';
import { mountProviderOAuthConnect } from './providerOAuthConnectRoutes';
import {
  deleteYouTubeConnection,
  listYouTubeConnections,
  saveYouTubeConnection,
  YOUTUBE_PROVIDER,
} from '../../application/youtube/youtubePublishing';
import { publishCanvasVideoToYouTube } from '../../application/youtube/youtubeCanvasPublish';
import {
  advanceYouTubeUpload,
  getYouTubeUpload,
  YouTubeUploadError,
  youtubeUploadView,
} from '../../application/youtube/youtubeUploadJobs';
import { settleYouTubeUploadBackReferences } from '../../application/youtube/youtubeUploadSettlement';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { parseBody, z } from './requestBody';

/** `POST /publish` — the handler answers its own required-field messages. */
const PublishVideoBody = z.object({
  connectionId: z.number().nullish(),
  storageKey: z.string().nullish(),
  title: z.string().nullish(),
  description: z.string().optional(),
  privacyStatus: z.string().nullish(),
  mimeType: z.string().nullish(),
});

const DEFAULT_RETURN_TO = '/create';
/** `youtube_uploads.id` is a UUID; anything else is a 404, not a database error. */
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createYouTubeRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', async (c, next) => c.req.path.includes('/callback') ? next() : authMiddleware(c, next));

  router.get('/connections', async (c) => c.json({
    configured: isProviderOAuthConfigured(c.env as unknown as Record<string, unknown>, YOUTUBE_PROVIDER),
    connections: await listYouTubeConnections(db, c.get('tenantId') as number, c.get('userId') as string),
  }));

  // GET /connect + GET /callback — the shared connect pair (one provider, so no
  // `:provider` segment); only naming the channel and storing the grant is YouTube's.
  mountProviderOAuthConnect<typeof YOUTUBE_PROVIDER>(router, {
    callbackPath: () => '/api/youtube/callback',
    fixedProvider: 'youtube',
    outcomeParam: 'youtube',
    defaultReturnTo: DEFAULT_RETURN_TO,
    source: 'presentation/routes/youtubeRoutes.ts',
    resolveConnect: () => ({ provider: YOUTUBE_PROVIDER, oauth: YOUTUBE_PROVIDER, label: YOUTUBE_PROVIDER.label }),
    onConnected: async (c, { state, tokens }) => {
      const profile = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const account = await profile.json() as { email?: string; name?: string };
      if (!profile.ok || !account.email) return 'no_account';
      await saveYouTubeConnection(db, c.env as Env, {
        tenantId: state.tenantId, userId: state.userId, accountEmail: account.email,
        displayName: account.name ?? account.email,
        tokens: grantFromTokenResponse(tokens),
      });
      return 'connected';
    },
  });

  router.delete('/connections/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid connection id.' }, 400);
    await deleteYouTubeConnection(db, c.get('tenantId') as number, c.get('userId') as string, id);
    return c.json({ ok: true });
  });

  router.post('/publish', async (c) => {
    // Read BEFORE the `try`: its catch answers 502 (YouTube failed), and a malformed
    // body is the caller's 400, not an upstream failure.
    const body = await parseBody(c, PublishVideoBody);
    try {
      if (!Number.isInteger(body.connectionId) || !body.storageKey || !body.title?.trim()) return c.json({ error: 'connectionId, storageKey, and title are required.' }, 400);
      if (!['private', 'unlisted', 'public'].includes(body.privacyStatus ?? '')) return c.json({ error: 'privacyStatus must be private, unlisted, or public.' }, 400);
      if (!body.mimeType?.startsWith('video/')) return c.json({ error: 'A rendered video is required.' }, 400);
      const upload = await publishCanvasVideoToYouTube(db, c.env as Env, c.get('tenantId') as number, c.get('userId') as string, {
        connectionId: body.connectionId!, storageKey: body.storageKey, title: body.title.trim(), description: body.description,
        privacyStatus: body.privacyStatus as 'private' | 'unlisted' | 'public', mimeType: body.mimeType,
      });
      // 201 when a short render finished inside this request; 202 while the job carries
      // on (the editor polls `/uploads/:id/advance`, and the sweep finishes it if not).
      if (upload.state === 'failed') return c.json({ error: upload.error ?? 'YouTube publishing failed.', upload }, 502);
      return c.json(upload, upload.state === 'succeeded' ? 201 : 202);
    } catch (error) {
      if (error instanceof YouTubeUploadError) return c.json({ error: error.message }, error.status === 404 ? 404 : error.status === 500 ? 500 : 400);
      reportCaughtError(error, { source: 'presentation/routes/youtubeRoutes.ts', operation: 'publish' });
      return c.json({ error: error instanceof Error ? error.message : 'YouTube publishing failed.' }, 502);
    }
  });

  router.get('/uploads/:id', async (c) => {
    const id = c.req.param('id');
    if (!UPLOAD_ID.test(id)) return c.json({ error: 'Upload not found.' }, 404);
    const row = await getYouTubeUpload(db, c.get('tenantId') as number, c.get('userId') as string, id);
    return row ? c.json({ upload: youtubeUploadView(row) }) : c.json({ error: 'Upload not found.' }, 404);
  });

  /** Run one tick now, if no other tick holds the upload — how an open editor drives
   *  its own upload faster than the five-minute sweep. Same tick, same claim. */
  router.post('/uploads/:id/advance', async (c) => {
    const id = c.req.param('id');
    if (!UPLOAD_ID.test(id)) return c.json({ error: 'Upload not found.' }, 404);
    const row = await getYouTubeUpload(db, c.get('tenantId') as number, c.get('userId') as string, id);
    if (!row) return c.json({ error: 'Upload not found.' }, 404);
    try {
      const next = await advanceYouTubeUpload(db, c.env as Env, row, { onSettled: settleYouTubeUploadBackReferences });
      return c.json({ upload: youtubeUploadView(next) });
    } catch (error) {
      reportCaughtError(error, { source: 'presentation/routes/youtubeRoutes.ts', operation: 'advance' });
      return c.json({ upload: youtubeUploadView(row) });
    }
  });
  return router;
}
