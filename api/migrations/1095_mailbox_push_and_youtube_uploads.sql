-- 1095 — Inbound mail becomes a CAUSE, and a video becomes something we can actually publish.
--
-- Three tables and one index, for two gaps that turned out to share one machine.
--
-- ── 1. mailbox_watches — the provider push subscription, per connected mailbox ──
-- A connected mailbox could only ever be PULLED from: the canvas inbox tile
-- re-read on demand, the automation sweep re-listed unread mail, and a workflow
-- could not start from "an email arrived" at all — `inbound-email` covers a
-- purpose-made address we own, never the mailbox somebody actually reads.
--
-- Both providers offer a real push, and both push subscriptions EXPIRE:
--   • Gmail  `users.watch` → 7 days, re-armed by calling watch again. The
--     notification carries only a `historyId`; the mail itself comes from
--     `users.history.list` starting at the cursor we stored.
--   • Graph  `POST /subscriptions` → ~3 days (4230 minutes), renewed by PATCH.
--     Creation is a HANDSHAKE: Graph immediately calls the notification URL with
--     `?validationToken=` and refuses the subscription unless it is echoed back.
--
-- So the row has to carry three different things and they are genuinely different
-- facts: WHERE the subscription is (`subscription_id`), WHEN it dies
-- (`expires_at`), and HOW FAR we have read (`cursor` — a Gmail historyId or a
-- Graph deltaLink). Collapsing any two of them would make renewal or delta
-- impossible for one of the two providers.
--
-- `push_token` is the URL-addressable half: the provider posts to
-- `/api/mailbox/push/<provider>/<push_token>`, which is how an UNAUTHENTICATED
-- notification resolves to a tenant. Same primitive `workflow_triggers.token`
-- uses for a webhook, and the same 128 bits of entropy. For Graph it is also the
-- `clientState` the notification must echo, so a guessed URL alone is not enough.
--
-- ── 2. mailbox_push_receipts — why a push cannot fire the same workflow twice ──
-- Both providers guarantee AT LEAST ONCE. Gmail will re-deliver a notification
-- whose ack was lost, two notifications can be in flight while the cursor is still
-- being advanced, and a renewal re-issues a watch from the same historyId. Every
-- one of those replays the same message id.
--
-- The cursor alone cannot prevent it, because the cursor advances AFTER the work.
-- The receipt is the thing that can: one row per (tenant, connection, message),
-- inserted with ON CONFLICT DO NOTHING ... RETURNING, so only the messages whose
-- insert actually produced a row are new. Everything downstream — the workflow
-- trigger, the canvas tile delta — consumes that filtered set, which is what makes
-- "an email arrived" fire exactly once for one email.
--
-- Deliberately NOT a `_messages` table: it stores no mail. It is a claim check.
--
-- ── 3. youtube_uploads — publishing a video is a job, not a request ──────────
-- YouTube was the one network declared `publishMode: 'none'`, because a publish is
-- a resumable multipart upload of the bytes and a Worker cannot hold one open. The
-- honest fix is not a longer request; it is durable state a sweep can resume.
--
-- One row per upload attempt, carrying the resumable session URI Google handed
-- back and how many bytes it has acknowledged. A tick sends a bounded number of
-- chunks with `Content-Range`, reads the 308's `Range:` header for the truth about
-- what landed, and stores it. A tick that dies loses at most one chunk, because
-- the next tick asks Google where it got to rather than trusting our own counter.
--
-- The three nullable back-references are what the finished upload writes to. They
-- are three real foreign keys and not a polymorphic pair on purpose: a canvas video
-- tile, and a social campaign post, are different rows in different tables, and the
-- one thing worse than three columns is a `subject_type`/`subject_id` that no
-- constraint can hold to.

-- ---------------------------------------------------------------------------
-- 1 — Gmail / Graph push subscription + read cursor, per connected mailbox
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mailbox_watches (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The grant this watch is against. Dropping the mailbox drops the watch; the
  -- provider-side subscription is best-effort stopped first, and expires anyway.
  connection_id   INTEGER NOT NULL REFERENCES mailbox_connections(id) ON DELETE CASCADE,
  -- 'microsoft' | 'google'. Denormalized from the connection so the push route can
  -- pick an adapter from the URL alone, before it has read the connection.
  provider        VARCHAR(24) NOT NULL,
  -- 'push'  — the provider notifies us (Graph always; Gmail when a Pub/Sub topic
  --           is configured on this deployment).
  -- 'poll'  — no push transport available, so the renewal sweep drains the SAME
  --           cursor on its own tick. One delta engine, two ways of being woken.
  mode            VARCHAR(16) NOT NULL DEFAULT 'push',
  -- Graph subscription id. Gmail has no per-watch handle (the mailbox IS the
  -- subscription), so it stays NULL there.
  subscription_id VARCHAR(255),
  -- The unguessable local-part of the notification URL, and Graph's clientState.
  push_token      VARCHAR(64) NOT NULL,
  -- Gmail historyId, or a Graph deltaLink. Opaque to everything above the adapter.
  cursor          TEXT,
  -- When the PROVIDER drops this subscription. The renewal sweep is driven off it.
  expires_at      TIMESTAMP,
  last_notified_at TIMESTAMP,
  last_delta_at   TIMESTAMP,
  last_error      TEXT,
  -- 'active' | 'error' | 'stopped'
  status          VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One watch per mailbox. Re-arming upserts on it, so a renewal cannot leave two
-- subscriptions pointing at the same cursor and double-deliver every message.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mailbox_watches_connection
  ON mailbox_watches (connection_id);

-- The push route's only lookup: token → watch. Unique so a token collision is a
-- write error rather than an ambiguous read.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mailbox_watches_token
  ON mailbox_watches (push_token);

-- "Which watches are about to expire?" — the renewal sweep's single scan. It runs
-- on the frequent tick behind the KV work-gate, so it must be an index seek and
-- must return nothing at all for an idle platform.
CREATE INDEX IF NOT EXISTS idx_mailbox_watches_renewal
  ON mailbox_watches (status, expires_at);

-- ---------------------------------------------------------------------------
-- 2 — Exactly-once: the claim check that makes a replayed push a no-op
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mailbox_push_receipts (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id INTEGER NOT NULL REFERENCES mailbox_connections(id) ON DELETE CASCADE,
  -- The provider's message id. 512 matches mailbox_automation_replies.message_id,
  -- which is the same identifier from the same two providers.
  message_id    VARCHAR(512) NOT NULL,
  received_at   TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- THE constraint. Everything else in this table is bookkeeping; this is the
-- mechanism. An insert that conflicts here is a message we have already acted on.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mailbox_push_receipts_message
  ON mailbox_push_receipts (tenant_id, connection_id, message_id);

-- Receipts are only useful for as long as a provider might replay one. The drain
-- prunes past a horizon using this index rather than a sequential scan.
CREATE INDEX IF NOT EXISTS idx_mailbox_push_receipts_pruning
  ON mailbox_push_receipts (connection_id, created_at);

-- ---------------------------------------------------------------------------
-- 3 — The resumable YouTube upload, as durable state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS youtube_uploads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Whose grant is being spent. Not an FK for the same reason mailbox_connections
  -- does not FK it: a deleted user's upload must fail closed, not vanish.
  user_id         VARCHAR(64) NOT NULL,
  -- The kernel `connections` row (vendor 'google', capability 'youtube').
  connection_id   INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  -- Exactly one source is set. R2 for a canvas render, a URL for a campaign's
  -- media. Both are read in ranges, so the engine above them is the same.
  storage_key     VARCHAR(512),
  source_url      TEXT,
  mime_type       VARCHAR(128) NOT NULL DEFAULT 'video/mp4',
  byte_size       BIGINT NOT NULL DEFAULT 0,
  title           VARCHAR(200) NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  privacy_status  VARCHAR(16) NOT NULL DEFAULT 'private',
  -- Google's resumable session URI, handed back by the initiate call. It carries
  -- its own credentials, expires in about a week, and is the whole reason this row
  -- can survive a Worker eviction.
  upload_url      TEXT,
  -- Bytes GOOGLE has acknowledged, never bytes we believe we sent.
  bytes_sent      BIGINT NOT NULL DEFAULT 0,
  video_id        VARCHAR(64),
  -- 'queued' | 'uploading' | 'processing' | 'succeeded' | 'failed'
  state           VARCHAR(24) NOT NULL DEFAULT 'queued',
  -- YouTube's own processingDetails.processingStatus, once there is a video.
  processing_status VARCHAR(32),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  -- Where the finished video is written back to. All three nullable; a job started
  -- from the REST route has none of them.
  session_id      UUID REFERENCES creation_sessions(id) ON DELETE SET NULL,
  object_id       UUID REFERENCES creation_session_objects(id) ON DELETE SET NULL,
  campaign_post_id BIGINT REFERENCES social_campaign_posts(id) ON DELETE SET NULL,
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- The sweep's claim query: the unfinished jobs, oldest first. Partial, so a table
-- full of completed uploads costs the idle tick nothing.
CREATE INDEX IF NOT EXISTS idx_youtube_uploads_pending
  ON youtube_uploads (state, updated_at)
  WHERE state IN ('queued', 'uploading', 'processing');

-- "What is this workspace uploading right now?" — the status read behind the
-- canvas tile and the campaign row.
CREATE INDEX IF NOT EXISTS idx_youtube_uploads_tenant
  ON youtube_uploads (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4 — Reaching the inbox tiles a push should update
-- ---------------------------------------------------------------------------
-- A delta has a connection id and needs the canvas objects bound to it. Without
-- this the push path is a sequential scan of every object on every canvas in the
-- deployment — on the hot path of an inbound email, which is the one place that
-- cost is unacceptable. Partial on `kind`, because inbox tiles are a rounding
-- error in that table.
CREATE INDEX IF NOT EXISTS idx_creation_objects_inbox_connection
  ON creation_session_objects ((canvas_data ->> 'connectionId'))
  WHERE kind = 'inbox';
