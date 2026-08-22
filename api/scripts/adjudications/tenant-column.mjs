/**
 * TENANT-COLUMN VERDICTS — tables that are genuinely tenant-independent.
 *
 * Two kinds qualify. A GLOBAL CATALOGUE is the same rows for every tenant. A
 * PRE-TENANT row is written before a tenant exists to scope it to. A third,
 * narrower kind INHERITS tenancy through a NOT NULL foreign key to a table that
 * has it, where copying `tenant_id` down would create a second place for one fact
 * to be wrong.
 *
 * All three are decisions. None is an omission — and telling them apart is the
 * whole job of this guard, because a global catalogue with no argument attached
 * is indistinguishable from a customer-data table somebody forgot to scope, and
 * a table with no `tenant_id` is invisible to `check-tenant-scope.mjs` by
 * construction: every query against it is unscoped structurally rather than by
 * oversight.
 *
 * So the reason is mandatory and it lives here rather than in the baseline, which
 * is regenerated wholesale and drops comments. See `scripts/lib/adjudications.mjs`.
 */
export default {
  cities:
    'a geographic catalogue — the same city for every tenant, and the join key for territory and search-by-place.',

  countries:
    'the ISO 3166 country list — the same rows for every tenant, and the join key territory, tax jurisdiction and address validation all resolve through. A tenant-scoped copy would let two workspaces disagree about what "DE" means.',

  stage_lookup:
    'the platform-wide company-stage vocabulary a tenant selects FROM; a tenant-owned stage is a `pipeline_stages` row.',

  email_otp_challenges:
    'PRE-TENANT: a signup challenge is issued before the account exists. Scoped by (user_ref, purpose), which is narrower than tenant, not looser. Absorbed `email_verification_codes`, which was baselined here for the same reason.',

  marketing_sessions:
    'PRE-TENANT: an anonymous visitor IS the row, and it is written on their first prompt — before an account, and therefore before a tenant, exists. Scoped by the opaque `visitor_id`, which is narrower than tenant. Moved out of the baseline (0434) because it is a decision, not an omission.',

  marketing_session_prompts:
    'PRE-TENANT: the prompts behind a `marketing_sessions` row, written on the same pre-signup path and scoped by the same `visitor_id` (0434).',

  release_digest_runs:
    'PLATFORM-WIDE: a release digest announces the platform release notes to EVERY user on the deployment, so the fan-out has no tenant to belong to — its identity is the digest (`note_key`) and its cursor is a global keyset position over recipients. A tenant column here would have to be invented, and inventing one would make the partial unique index that keeps the send idempotent (one open run per digest) wrong: it would permit one open run per tenant for a message that is sent once.',

  web_search_robots:
    'a cache of the public robots.txt policy for a DNS domain. The policy and its expiry are identical for every tenant; tenant-owned crawl sources and frontier rows remain tenant-scoped.',

  // `developer_orgs` and `developer_org_members` were declared here on the
  // argument that a publisher is not a tenant. Migration 0472 rejected that: a
  // developer IS a tenant, both tables are gone, and `extension_packages` now
  // carries the publisher's `tenant_id` like everything else. That the exemption
  // could be argued for at all is what this file is supposed to surface — the
  // reason is written down precisely so it can be re-read and overruled.
  extension_versions:
    'the immutable versions of an `extension_packages` row. Tenancy is INHERITED through `package_id` — the publisher owns the package, and a version cannot belong to a different workspace than the package it versions. Copying `tenant_id` down would be a second place for the same fact to be wrong.',

  extension_categories:
    'the public directory\'s category taxonomy (1094) — platform configuration, identical for every workspace, and the vocabulary a published listing files itself under. A tenant-scoped copy would mean one workspace\'s "finance" was a different category from another\'s, in a directory whose entire purpose is that a stranger can find a listing under the same name the publisher chose.',

  extension_review_stages:
    'one stage of the review pipeline for an `extension_versions` row (1094). Tenancy is INHERITED through `version_id` → `package_id`, exactly as `extension_versions` inherits it. The `sandbox_tenant_id` column names the workspace the DYNAMIC stage installed into, which is a piece of evidence about where the stage ran and is deliberately not a scoping column — scoping a review by the sandbox it borrowed would hand the sandbox ownership of every publisher’s submissions.',

};
