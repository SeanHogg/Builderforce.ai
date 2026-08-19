-- 0931 — A build verdict that survives the request that asked for it.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
-- `buildProjectConnections` answered "is this repo's build green" by CALLING the
-- provider while composing the dashboard read. Two bounds fell straight out of
-- doing it at read time, and both of them showed the operator `unknown`:
--
--   (a) only GitHub was ever probed. `probeRepoDelivery` returned `not_probed`
--       for GitLab and Bitbucket, so those cards listed the connection and then
--       had nothing to say about it — and fell back to the Builderforce-recorded
--       PR count, which only ever describes PRs we opened ourselves.
--   (b) `LIVE_PROBE_BUDGET = 20` capped the probes per composition so a many-repo
--       tenant could not exhaust the Worker's subrequest allowance. Repo 21 and
--       beyond degraded to `unknown` for no reason the operator could see.
--
-- Both degraded honestly rather than showing a false green. Neither showed the
-- truth, and no amount of tuning at read time can: the honest fix is to stop
-- asking providers on the read path at all.
--
-- ── WHY A TABLE ─────────────────────────────────────────────────────────────
-- This is the same shape as `github_actions_*` reconciliation: a scheduled sweep
-- owns the provider conversation, persists what it learned, and the read path
-- serves rows. With the verdict persisted, a dashboard load costs ZERO provider
-- subrequests, so the budget cap has nothing left to protect and every provider
-- can be probed — the two defects have one fix.
--
-- ── WHY KEYED ON THE REPO AND NOT ON (repo, branch) ─────────────────────────
-- `open_pull_requests` is a fact about the REPOSITORY, not about a branch. Keying
-- on (repo, branch) would make it depend on part of the key only — a 2NF
-- violation, and in practice the same count copied onto every branch row with
-- nothing deciding which copy is right. So the row IS "the delivery status of
-- this repo", and `build_branch` records which branch the verdict was read from
-- (the repo's default). One repo, one latest verdict, one writer: the sweep.

CREATE TABLE IF NOT EXISTS repo_delivery_status (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  repo_id             uuid NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
  -- Shared vocabulary with ProjectConnectionHealth / ProjectConnectionReason in
  -- application/repos/projectConnectionStatus.ts. No CHECK: the application layer
  -- is the single place those vocabularies are written down.
  health              varchar(16) NOT NULL DEFAULT 'unknown',
  reason              varchar(32),
  open_pull_requests  integer,
  build_status        varchar(16),
  build_url           varchar(500),
  build_branch        varchar(255),
  build_at            timestamp,
  -- When the sweep last SUCCEEDED in reaching the provider. The read path shows a
  -- stale verdict rather than none, and the age is what tells the operator so.
  probed_at           timestamp NOT NULL DEFAULT now(),
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now()
);

-- One latest verdict per repo — the upsert target for the sweep.
CREATE UNIQUE INDEX IF NOT EXISTS uq_repo_delivery_repo
  ON repo_delivery_status (repo_id);

-- The read path's query: every verdict for a tenant, joined to its repos.
CREATE INDEX IF NOT EXISTS idx_repo_delivery_tenant
  ON repo_delivery_status (tenant_id);

-- The sweep's query: the least recently probed repos first, so a tenant with more
-- repos than one sweep can cover still gets every repo refreshed in rotation
-- instead of the same prefix every time (which is what the read-time budget did).
CREATE INDEX IF NOT EXISTS idx_repo_delivery_probed_at
  ON repo_delivery_status (probed_at);
