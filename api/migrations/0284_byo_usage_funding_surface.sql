-- BYO (bring-your-own-provider) usage funding + surface dimensions on the LLM
-- usage ledger, so metering can tell tenant-funded tokens apart from
-- platform-funded ones AND know which agent modality produced them.
--
--   byo      → the call was served by the tenant's OWN provider credential (a BYO
--              API key or a connected subscription). The platform pays $0 for
--              these tokens, so cost_usd_millicents is forced to 0 at write time.
--   surface  → which modality produced the row: 'web' | 'vsix' | 'on_prem' |
--              'cloud' | 'sdk'. The metering accountant EXEMPTS a BYO row on the
--              on-prem or VSIX surface from the plan token allowance (the run
--              executes on the user's own machine — free), while a BYO cloud-agent
--              row still counts against the allowance (charged for cloud usage).
--
-- Both are additive with safe defaults so historical rows read as platform-funded
-- web calls and existing sums are unchanged.
ALTER TABLE llm_usage_log
  ADD COLUMN IF NOT EXISTS byo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS surface VARCHAR(16) NOT NULL DEFAULT 'web';
