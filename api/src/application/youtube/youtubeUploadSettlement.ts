/**
 * Where a settled YouTube upload is written back to — the ONE handler every caller
 * of the upload job passes as `onSettled` (the sweep, and the editor's advance route).
 *
 * `youtube_uploads` carries three nullable back-references for exactly this. A campaign
 * post is settled here; the canvas editor reads its own upload by id, so a canvas
 * render needs no server-side write-back. Kept out of `youtubeUploadJobs.ts` so the
 * job engine does not depend on the domains that queue it.
 */

import type { YouTubeUploadSettled } from './youtubeUploadJobs';
import { settleCampaignPostFromUpload } from '../social/socialCampaignUploads';

export const settleYouTubeUploadBackReferences: YouTubeUploadSettled = async (db, env, upload) => {
  if (upload.campaignPostId != null) await settleCampaignPostFromUpload(db, env, upload);
};
