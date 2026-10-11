/**
 * Campaign posts that go out as an upload JOB rather than one request.
 *
 * A network declaring `publishTransport: 'upload'` (YouTube) cannot be published in
 * the campaign batch's request: its post IS a video, sent in 256 KiB-multiple chunks
 * across many invocations. So the batch hands the post to the upload job here and
 * marks it `uploading`; when the job settles — minutes or hours later, on the sweep —
 * {@link settleCampaignPostFromUpload} writes the outcome back onto the post and
 * recounts the campaign with the same arithmetic the batch uses.
 *
 * Idempotency carries over from the post ledger: a post already handed to a live job
 * is never handed to a second one, so a resumed batch cannot upload the launch video
 * to the same channel twice.
 */

import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { connectorConnections, socialCampaignPosts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { resolveYouTubeUploadGrant } from '../youtube/youtubePublishing';
import {
  enqueueYouTubeUpload,
  youtubeUploadsForPosts,
  youtubeWatchUrl,
  type YouTubeUploadRow,
} from '../youtube/youtubeUploadJobs';
import { markSocialPost, settleSocialCampaign } from './socialCampaignTotals';

const VIDEO_EXTENSION = /\.(mp4|m4v|mov|webm|mkv|avi|mpe?g)$/i;

/**
 * The campaign media to upload. A URL whose path names a video wins; otherwise the
 * first URL is tried and the job checks its `Content-Type` — a picture is refused
 * there with a reason, rather than guessed at here from a URL with no extension.
 */
export function pickVideoUrl(mediaUrls: readonly string[]): string | null {
  const byExtension = mediaUrls.find((url) => {
    try { return VIDEO_EXTENSION.test(new URL(url).pathname); } catch { return false; }
  });
  return byExtension ?? mediaUrls[0] ?? null;
}

/** The description a campaign's YouTube video carries: the post copy, then the link. */
export function campaignVideoDescription(body: string, linkUrl: string): string {
  return [body.trim(), linkUrl.trim()].filter(Boolean).join('\n\n');
}

export type EnqueueCampaignUploadResult =
  | { ok: true; uploadId: string }
  /** `skip` — nothing to upload (no media); `fail` — cannot upload as configured. */
  | { ok: false; outcome: 'skip' | 'fail'; error: string };

export async function enqueueCampaignVideoUpload(
  db: Db, env: Env, tenantId: number,
  args: {
    campaign: { name: string; linkUrl: string; mediaUrls: readonly string[] };
    post: { id: number; connectionId: string; body: string };
  },
): Promise<EnqueueCampaignUploadResult> {
  const existing = (await youtubeUploadsForPosts(db, tenantId, [args.post.id])).get(args.post.id);
  if (existing && existing.state !== 'failed') return { ok: true, uploadId: existing.id };

  const video = pickVideoUrl(args.campaign.mediaUrls);
  if (!video) return { ok: false, outcome: 'skip', error: 'YouTube needs a video — this campaign has no media.' };

  const [connection] = await db.select({ createdByUserId: connectorConnections.createdByUserId }).from(connectorConnections)
    .where(scopedToTenant(connectorConnections, tenantId, eq(connectorConnections.id, args.post.connectionId))).limit(1);
  const grant = await resolveYouTubeUploadGrant(db, tenantId, connection?.createdByUserId ?? null);
  if ('error' in grant) return { ok: false, outcome: 'fail', error: grant.error };

  const upload = await enqueueYouTubeUpload(db, env, {
    tenantId,
    userId: grant.userId,
    connectionId: grant.connectionId,
    source: { sourceUrl: video },
    title: args.campaign.name,
    description: campaignVideoDescription(args.post.body, args.campaign.linkUrl),
    // A campaign is an announcement: every other network it reaches is public too.
    privacyStatus: 'public',
    campaignPostId: args.post.id,
  });
  return { ok: true, uploadId: upload.id };
}

/**
 * Write a settled upload back onto its campaign post, then recount the campaign.
 * A no-op for an upload no campaign queued (the canvas editor's).
 */
export async function settleCampaignPostFromUpload(db: Db, env: Env, upload: YouTubeUploadRow): Promise<void> {
  if (upload.campaignPostId == null) return;
  const [post] = await db.select({ id: socialCampaignPosts.id, campaignId: socialCampaignPosts.campaignId })
    .from(socialCampaignPosts)
    .where(scopedToTenant(socialCampaignPosts, upload.tenantId, eq(socialCampaignPosts.id, upload.campaignPostId))).limit(1);
  if (!post) return;
  await writeUploadOutcome(db, upload.tenantId, post.id, upload);
  await settleSocialCampaign(db, env, upload.tenantId, post.campaignId);
}

/** The post patch a terminal upload implies. */
async function writeUploadOutcome(db: Db, tenantId: number, postId: number, upload: YouTubeUploadRow): Promise<void> {
  if (upload.state === 'succeeded' && upload.videoId) {
    await markSocialPost(db, tenantId, postId, {
      status: 'published',
      externalId: upload.videoId,
      permalink: youtubeWatchUrl(upload.videoId),
      publishedAt: upload.completedAt ?? new Date(),
      error: null,
    });
    return;
  }
  await markSocialPost(db, tenantId, postId, {
    status: 'failed',
    error: (upload.lastError ?? 'The YouTube upload failed.').slice(0, 1000),
  });
}

/**
 * Settle any `uploading` post whose upload already finished.
 *
 * The backstop for a write-back that was lost — an isolate evicted between the job's
 * terminal write and its `onSettled` call. Without it such a post would read
 * `uploading` forever, because the job is terminal and will never tick again. The
 * publish batch runs this first, and the campaign sweep treats a campaign holding one
 * as due. Returns how many posts it settled; the caller recounts.
 */
export async function reconcileSettledCampaignUploads(db: Db, tenantId: number, campaignId: number): Promise<number> {
  const uploading = await db.select({ id: socialCampaignPosts.id }).from(socialCampaignPosts)
    .where(scopedToTenant(socialCampaignPosts, tenantId, and(eq(socialCampaignPosts.campaignId, campaignId), eq(socialCampaignPosts.status, 'uploading'))));
  if (uploading.length === 0) return 0;
  const uploads = await youtubeUploadsForPosts(db, tenantId, uploading.map((post) => post.id));
  let settled = 0;
  for (const post of uploading) {
    const upload = uploads.get(post.id);
    if (!upload || (upload.state !== 'succeeded' && upload.state !== 'failed')) continue;
    await writeUploadOutcome(db, tenantId, post.id, upload);
    settled += 1;
  }
  return settled;
}
