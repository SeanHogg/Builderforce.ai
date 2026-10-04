-- 1195 · Release note: video clips, scenes and movies on the canvas and in Studio.
--
-- `new`: before this, the only moving picture the product could make was a few
-- frames diffused in the browser. A `scene` object now plans a story into shots and
-- renders each one as a real video clip. The shots cut together into a `video`
-- object on the timeline editor. Brain can do all of it from one sentence
-- (`canvas_add_video`, `canvas_create_scene`). The Studio agent can put a generated
-- clip in an app (`generate_video_asset`). Paid plans can also render the finished
-- movie on the server, so the tab can close (`serverVideoRender`).
--
-- The vendor chain is plumbing and gets no note of its own: Pollinations Wan first,
-- then Seedance and Veo on paid plans.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001195',
    '2026.10.6',
    'Make video clips, scenes and short movies',
    'Describe a shot and the canvas turns it into a real video clip. Describe a story, an ad or a trailer and it plans the shots, renders every one and cuts them into a movie on the video timeline, where you add music, narration and captions. Rewrite any shot and only that shot is rendered again. Brain can make a whole movie from one sentence, and Studio can now put a generated clip in the app it is building, such as a looping hero video. Clips come in landscape, vertical or square. Export the finished movie in your browser on any plan, or on Pro and Teams render it on our servers and close the tab while it finishes. Video uses a daily allowance of seconds on every plan.',
    'new',
    'live',
    '2026-10-04 20:00:00'
  )
ON CONFLICT (id) DO NOTHING;
