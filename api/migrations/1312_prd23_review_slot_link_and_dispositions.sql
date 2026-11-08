-- 1312 · PRD 23: Validator review -> lifecycle slot bridge, ticket recovery dispositions, canary mode.
--
-- 1. task_reviews gains the three facts PRD 23 §5.2 says every accepted verdict must carry:
--      execution_id      the execution that produced the review
--      participant_id    the Validator ticket_participants slot the verdict was bridged to
--      reviewed_head_sha the PR head commit the review was made against; a newer head invalidates it
--    All nullable: reviews written before this migration, or with no PR / no Validator slot, simply have none.
--
-- 2. ticket_dispositions (§2/§6): the recovery disposition of a non-Done ticket. 1:1 with the ticket, a distinct
--    fact from the ticket itself. `applied_at` NULL = dry-run (a proposal); it is stamped only when an operator
--    triggers apply.
--
-- 3. project_manager_configs.canary (§5.6/§7): while true, auto-merge and auto-close are disabled for the project and
--    the sweeps log what they would have done. Default false.
--
-- Expand only: nullable/defaulted columns and one new table. Idempotent / re-runnable.
SET LOCAL lock_timeout = '3s';

ALTER TABLE task_reviews
  ADD COLUMN IF NOT EXISTS execution_id      integer REFERENCES executions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS participant_id    uuid    REFERENCES ticket_participants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_head_sha varchar(64);

CREATE INDEX IF NOT EXISTS idx_task_reviews_participant
  ON task_reviews (participant_id) WHERE participant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ticket_dispositions (
  task_id            integer      PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  tenant_id          integer      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  disposition        varchar(16)  NOT NULL,
  roadmap_capability text,
  prd_alignment      varchar(32),
  delivery_state     varchar(32),
  evidence           jsonb        NOT NULL DEFAULT '{}'::jsonb,
  duplicate_of       integer      REFERENCES tasks(id) ON DELETE SET NULL,
  superseded_by      integer      REFERENCES tasks(id) ON DELETE SET NULL,
  decided_by         varchar(64)  NOT NULL,
  decided_at         timestamp    NOT NULL DEFAULT now(),
  applied_at         timestamp,
  CONSTRAINT chk_ticket_dispositions_disposition
    CHECK (disposition IN ('keep', 'close', 'consolidate', 'quarantine'))
);

CREATE INDEX IF NOT EXISTS idx_ticket_dispositions_tenant ON ticket_dispositions (tenant_id, disposition);

ALTER TABLE project_manager_configs
  ADD COLUMN IF NOT EXISTS canary boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN project_manager_configs.canary IS
  'PRD 23 canary mode: auto-merge and auto-close are disabled for this project; sweeps log what they would have merged/closed. Default false. See application/manager/managerCanary.ts.';
