-- 1205 · Release note: post the launch video to YouTube from a campaign.
--
-- `new`: YouTube was the one social network declared read-and-measure only
-- (`publishMode: 'none'`), because publishing is a resumable upload of the video bytes
-- that does not fit one Worker request. `youtube_uploads` (migration 1095) is now
-- written: a campaign post with video media is handed to a durable upload job that
-- sends 256 KiB-multiple chunks with `Content-Range` from R2 / ranged URL reads,
-- records the offset Google confirms, resumes after eviction and backs off 5xx (the
-- `youtube-upload` frequent sweep). The canvas editor's "Publish to YouTube" runs the
-- same uploader. Campaign posts show queued / uploading % / published / failed.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001205',
    '2026.10.36',
    'Post your launch video to YouTube straight from a campaign',
    'YouTube used to be the one network a campaign could only read: you could watch its views on the board, but the video itself had to be uploaded by hand in YouTube Studio. Now pick your YouTube account as a campaign target, attach the video, and publish. The video goes up in the background, a piece at a time, so a long launch film is as safe as a ten-second clip: if anything drops halfway, it carries on from the last piece YouTube confirmed instead of starting again. The campaign shows the upload''s progress next to every other network, then the link to the video once YouTube has it. Publishing a finished video from the canvas editor now uses the same uploader, so long renders no longer fail for being long, and you can close the tab while it finishes.',
    'new',
    'live',
    '2026-10-10 18:00:00'
  )
ON CONFLICT (id) DO NOTHING;
