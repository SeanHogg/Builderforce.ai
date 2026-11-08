-- 1320 · A vulnerability scan can belong to a pull request / agent run, and a finding has a category.
--
-- WHY. PRD 08 §10 (Agentic DevSecOps): every agent PR is scanned, the findings are "linked to the
-- agent run", and an open BLOCKER security finding gates auto-merge. The merge gate has to ask
-- "does THIS pull request have an open blocking finding?" — which needs the scan to name the PR it
-- scanned. Until now a scan only named a repo and a ref, so a gate could only guess by branch name.
--
--   vulnerability_scans.pull_request_id  the recorded PR the scan covered (NULL = a repo-level scan).
--                                        FK to pull_requests, SET NULL: deleting the PR row must not
--                                        delete the evidence that it was scanned.
--   vulnerability_scans.execution_id     the agent run (executions.id) that opened that PR. A plain id
--                                        by value, no FK: `executions` is another domain's root.
--   vulnerability_findings.category      'SCAN' (a scanner rule matched) | 'SECURITY' (the security
--                                        review agent's assessment — PRD 08 §10 CodeReviewFinding
--                                        category=SECURITY). Defaults to 'SCAN', which is what every
--                                        existing row is.
--
-- Expand-only: three nullable/defaulted columns and two indexes. Nothing is dropped or rewritten.
ALTER TABLE vulnerability_scans ADD COLUMN IF NOT EXISTS pull_request_id UUID REFERENCES pull_requests(id) ON DELETE SET NULL;
ALTER TABLE vulnerability_scans ADD COLUMN IF NOT EXISTS execution_id INTEGER;
ALTER TABLE vulnerability_findings ADD COLUMN IF NOT EXISTS category VARCHAR(16) NOT NULL DEFAULT 'SCAN';

--   vulnerability_scans.head_sha         the PR head commit the scan covered. The merge gate honours a scan
--                                        only for the PR's CURRENT head, so a push after the scan makes every
--                                        row stale and the PR is held until it is re-scanned. NULL for a
--                                        repo-level scan with no PR.
--   vulnerability_scans.truncated        the scan did not see everything (file cap, review size cap, package
--                                        cap). A truncated scan never counts as complete for the gate.
ALTER TABLE vulnerability_scans ADD COLUMN IF NOT EXISTS head_sha VARCHAR(64);
ALTER TABLE vulnerability_scans ADD COLUMN IF NOT EXISTS truncated BOOLEAN NOT NULL DEFAULT false;

-- (No separate non-unique index on (pull_request_id, head_sha, scan_type): the unique index below covers
-- every lookup the gate and the scan store make.)
-- One scan row per (pull request, head commit, scan type): the arbiter for scan creation, so two
-- finalizes racing on the same commit cannot both insert one (a duplicate would let a stale 'completed'
-- row satisfy the gate while the live one is still running).
CREATE UNIQUE INDEX IF NOT EXISTS uq_vulnerability_scans_pr_sha_type
  ON vulnerability_scans(pull_request_id, head_sha, scan_type)
  WHERE pull_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vulnerability_scans_execution
  ON vulnerability_scans(execution_id)
  WHERE execution_id IS NOT NULL;
