-- 1333 · The durable queue behind deferred one-shot dispatches (expand-only, idempotent).
--
-- A one-shot dispatcher (CI auto-fix, incident triage, security audit, validation review) whose run admission
-- DEFERRED (a live run on the ticket, the plan's concurrent cap) parks its dispatch here; the `deferred-dispatch`
-- cron sweep claims due rows, re-dispatches them through the same dispatcher and settles them. It replaces parking
-- as `dispatch.deferred` rows in the append-only audit table, which lives on another database, had no claim,
-- attempt or backoff (one stuck row blocked the queue) and collapsed different dispatchers into one `task:<id>` key.
--
-- `kind` is the dispatcher (one pending row per tenant + ticket + kind); `payload` is `{ dispatchPayload, meta }`
-- (the dispatch params and what the kind's after-start bookkeeping needs). `claimed_at` is a lease: a claim older
-- than the sweep's lease is retakeable, so a tick that died mid-batch does not strand its rows.
CREATE TABLE IF NOT EXISTS deferred_dispatches (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  payload         JSONB NOT NULL,
  submitted_by    TEXT,
  agent_host_id   TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at      TIMESTAMPTZ,
  state           TEXT NOT NULL DEFAULT 'pending',
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_deferred_dispatches_pending
  ON deferred_dispatches (tenant_id, task_id, kind) WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS idx_deferred_dispatches_due
  ON deferred_dispatches (next_attempt_at) WHERE state = 'pending';
