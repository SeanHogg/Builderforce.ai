-- Make provider PR synchronization idempotent before the reconciler moves to the
-- frequent/event-signalled path. Preserve the best canonical row and repoint the
-- manager audit ledger before deleting historical duplicates.

WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY tenant_id, repo_id, number
      ORDER BY
        CASE WHEN status IN ('open', 'draft') THEN 0 ELSE 1 END,
        CASE WHEN task_id IS NOT NULL THEN 0 ELSE 1 END,
        updated_at DESC,
        id
    ) AS keeper_id,
    row_number() OVER (
      PARTITION BY tenant_id, repo_id, number
      ORDER BY
        CASE WHEN status IN ('open', 'draft') THEN 0 ELSE 1 END,
        CASE WHEN task_id IS NOT NULL THEN 0 ELSE 1 END,
        updated_at DESC,
        id
    ) AS position
  FROM pull_requests
  WHERE repo_id IS NOT NULL AND number IS NOT NULL
), duplicates AS (
  SELECT id, keeper_id FROM ranked WHERE position > 1
)
UPDATE manager_actions action
SET pr_id = duplicate.keeper_id
FROM duplicates duplicate
WHERE action.pr_id = duplicate.id;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, repo_id, number
      ORDER BY
        CASE WHEN status IN ('open', 'draft') THEN 0 ELSE 1 END,
        CASE WHEN task_id IS NOT NULL THEN 0 ELSE 1 END,
        updated_at DESC,
        id
    ) AS position
  FROM pull_requests
  WHERE repo_id IS NOT NULL AND number IS NOT NULL
)
DELETE FROM pull_requests victim
USING ranked duplicate
WHERE victim.id = duplicate.id AND duplicate.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pull_requests_provider_number
  ON pull_requests(tenant_id, repo_id, number)
  WHERE repo_id IS NOT NULL AND number IS NOT NULL;
