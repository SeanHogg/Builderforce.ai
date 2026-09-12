/**
 * Attachments (0985) — the EXISTING bucket, not a new blob store.
 *
 * `env.UPLOADS` is the same R2 bucket `POST /api/freelancers/me/resume` and
 * `/me/avatar` already put into, and the shape here is theirs: a prefixed key, an
 * `httpMetadata.contentType`, and a row that holds METADATA pointing at the bytes.
 * Nothing about a job brief justifies a second storage mechanism, and a second one is
 * how a deployment ends up with files it cannot enumerate.
 *
 * The key prefix encodes ownership (`job-attachments/<tenant>/<job>/…`,
 * `proposal-attachments/<job>/<proposal>/…`) but the ACCESS CHECK is never the key: an
 * attachment is served only after its id has been found on a row the caller is entitled
 * to read. A key is a name, not a credential.
 */
import type { Env } from '../../../env';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import type { PostingAttachment } from '../jobPostings';

/** Put the bytes and describe them. The caller owns where the description is stored. */
export async function putAttachment(env: Env, prefix: string, file: File): Promise<PostingAttachment | null> {
  if (!env.UPLOADS) return null;
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const id = crypto.randomUUID();
  const key = `${prefix}/${id}.${ext}`;
  await env.UPLOADS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  return { id, key, name: file.name.slice(0, 200), mime: file.type || null, size: file.size };
}

/** Stream one already-authorised attachment out of R2. */
export async function serveAttachment(env: Env, attachments: PostingAttachment[], attachmentId: string): Promise<Response> {
  const found = attachments.find((a) => a.id === attachmentId);
  if (!found) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  if (!env.UPLOADS) return new Response(JSON.stringify({ error: 'File storage is not configured' }), { status: 503, headers: { 'content-type': 'application/json' } });
  const obj = await env.UPLOADS.get(found.key);
  if (!obj) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  const headers = new Headers();
  headers.set('Content-Type', found.mime ?? obj.httpMetadata?.contentType ?? 'application/octet-stream');
  // An attachment is somebody's brief or work sample: shown in the app, never cached by
  // a shared proxy.
  headers.set('Cache-Control', 'private, max-age=300');
  headers.set('Content-Disposition', `inline; filename="${found.name.replace(/[^\w.\- ]/g, '_')}"`);
  return new Response(obj.body, { headers });
}

/**
 * Delete a detached attachment's bytes.
 *
 * Called only AFTER the row no longer references the file, so the file is unreachable
 * either way; a failed blob delete is a cleanup problem, not a failed request. Logged,
 * never silent — `operation` names which detach it was.
 */
export async function deleteAttachmentBlob(env: Env, key: string, operation: string): Promise<void> {
  if (!env.UPLOADS) return;
  await env.UPLOADS.delete(key).catch((error) => {
    reportCaughtError(error, { source: 'application/marketplace/jobs/jobAttachmentStore.ts', operation, level: 'warning', context: { key } });
  });
}
