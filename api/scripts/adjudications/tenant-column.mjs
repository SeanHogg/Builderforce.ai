/**
 * TENANT-COLUMN VERDICTS — tables that are genuinely tenant-independent.
 *
 * Four kinds qualify, and each entry below says which one it is:
 *
 *   GLOBAL CATALOGUE   the same rows for every tenant.
 *   PRE-TENANT         written before a tenant exists to scope it to.
 *   PERSON-OWNED       the row belongs to a human who spans many workspaces, so
 *                      scoping it to one would be wrong rather than missing.
 *   PLATFORM DESK      owned by Builderforce staff, about people who are not
 *                      customers yet.
 *
 * A fifth used to live here and no longer does: INHERITED tenancy, where a child
 * hangs off a tenant-scoped parent. That is a structural fact about the foreign
 * key, so the guard COMPUTES it — see `scopedByInheritance` in
 * `check-tenant-column.mjs`. It was previously the same paragraph hand-written
 * about thirty-five times.
 *
 * None of the four is an omission, and telling them apart from an omission is the
 * whole job of this guard: a global catalogue with no argument attached is
 * indistinguishable from a customer-data table somebody forgot to scope, and a
 * table with no `tenant_id` is invisible to `check-tenant-scope.mjs` by
 * construction — every query against it is unscoped structurally rather than by
 * oversight.
 *
 * So the reason is mandatory, and it lives here rather than in the baseline, which
 * is regenerated wholesale and drops comments. See `scripts/lib/adjudications.mjs`.
 */
export default {
  // ── GLOBAL CATALOGUE ──────────────────────────────────────────────────────

  cities:
    'a geographic catalogue — the same city for every tenant, and the join key for territory and search-by-place.',

  countries:
    'the ISO 3166 country list — the same rows for every tenant, and the join key territory, tax jurisdiction and address validation all resolve through. A tenant-scoped copy would let two workspaces disagree about what "DE" means.',

  stage_lookup:
    'the platform-wide company-stage vocabulary a tenant selects FROM; a tenant-owned stage is a `pipeline_stages` row.',

  web_search_robots:
    'a cache of the public robots.txt policy for a DNS domain. The policy and its expiry are identical for every tenant; tenant-owned crawl sources and frontier rows remain tenant-scoped.',

  extension_categories:
    'the public directory\'s category taxonomy (1094) — platform configuration, identical for every workspace, and the vocabulary a published listing files itself under. A tenant-scoped copy would mean one workspace\'s "finance" was a different category from another\'s, in a directory whose entire purpose is that a stranger can find a listing under the same name the publisher chose.',

  tenants:
    'the workspace ROW. It cannot carry a foreign key to itself as its own scope; it IS the scope every other table resolves through.',

  discount_codes:
    'platform-issued promotional codes, redeemed at checkout BEFORE a workspace is chosen and usually before one exists. A tenant-scoped code could not be handed out in a campaign, which is the only way these are used.',

  industry_benchmarks:
    'the cohort percentiles a tenant compares ITSELF against, keyed by (industry, size_band, metric). The whole value is that they are the same numbers for everyone; a per-tenant copy would be a tenant benchmarking against itself.',

  legal_documents:
    'the platform\'s own Terms of Use and Privacy Policy versions (migration 0012). One published document governs every workspace; a per-tenant copy would mean the platform held a different contract with each customer.',

  legal_document_versions:
    'the immutable version history of those same platform documents. Global for exactly the reason its parent is, and it is the table a compliance question ("what did this version say on that date") is answered from.',

  llm_health_probes:
    'reachability probes the platform runs against its own model vendors. A probe result is a fact about the VENDOR, identical for every workspace, and the probe runs on a schedule with no tenant in the request to scope it to.',

  marketplace_skills:
    'a public marketplace LISTING. `author_id` names who published it, but the listing is browsable and installable by every workspace — that is what makes it a marketplace. Scoping it would make each listing visible only to its own publisher.',

  newsletter_templates:
    'the platform marketing team\'s email templates. One set, used to send to one global subscriber list; there is no per-workspace newsletter for them to belong to.',

  platform_modules:
    'the built-in permission modules a tenant\'s custom roles are composed FROM — platform configuration, identical everywhere. The tenant-owned counterpart is `tenant_custom_roles`, and the two being separate tables is what lets a workspace compose without editing the catalogue.',

  platform_personas:
    'the built-in agent persona catalogue shipped with the product. A tenant-authored persona is a different table; these are the ones every workspace picks from.',

  platform_pricing_configuration:
    'the plan and price document the whole platform bills against, holding a draft and a published copy. A per-tenant price is an override on the tenant row, never a row here.',

  release_notes:
    'Builderforce\'s own changelog, marketed to every user. Deliberately NOT tenant-scoped — the table\'s docstring contrasts it with `changelog_entries`, which is each tenant\'s changelog for THEIR product. One global list feeds the "What\'s new" panel and the weekly digest.',

  role_permission_overrides:
    'platform-wide adjustments to what a ROLE may do. A tenant-level override is a `tenant_custom_roles` row; this is the base grant those start from, so scoping it would leave the base itself undefined.',

  email_delivery_failures:
    'a bounce or reject recorded against a RECIPIENT ADDRESS by the mail provider. The address is frequently not a member of any workspace (invites, marketing, verification), and suppression has to hold for the address globally or the platform keeps mailing a dead inbox.',

  // ── PRE-TENANT ────────────────────────────────────────────────────────────

  email_otp_challenges:
    'PRE-TENANT: a signup challenge is issued before the account exists. Scoped by (user_ref, purpose), which is narrower than tenant, not looser. Absorbed `email_verification_codes`, which was baselined here for the same reason.',

  marketing_sessions:
    'PRE-TENANT: an anonymous visitor IS the row, and it is written on their first prompt — before an account, and therefore before a tenant, exists. Scoped by the opaque `visitor_id`, which is narrower than tenant. Moved out of the baseline (0434) because it is a decision, not an omission.',

  marketing_session_prompts:
    'PRE-TENANT: the prompts behind a `marketing_sessions` row, written on the same pre-signup path and scoped by the same `visitor_id` (0434).',

  release_digest_runs:
    'PLATFORM-WIDE: a release digest announces the platform release notes to EVERY user on the deployment, so the fan-out has no tenant to belong to — its identity is the digest (`note_key`) and its cursor is a global keyset position over recipients. A tenant column here would have to be invented, and inventing one would make the partial unique index that keeps the send idempotent (one open run per digest) wrong: it would permit one open run per tenant for a message that is sent once.',

  demo_events:
    'PRE-TENANT: anonymous demo-tour telemetry keyed by `visitor_id`. Written before signup, so there is no tenant to scope to, and the visitor id is narrower than a tenant rather than looser.',

  marketing_tool_runs:
    'PRE-TENANT: a free calculator or diagnostic run by an anonymous visitor, keyed by `visitor_id` — the same pre-signup path as `marketing_sessions`. The tenant-scoped counterpart, for a run inside a workspace, is `tool_runs`.',

  sales_leads:
    'PRE-TENANT: an inbound contact-form lead, keyed by `visitor_id` and an email address. Written, by definition, by somebody who is not a customer yet.',

  pending_prompts:
    'PRE-TENANT: a prompt typed by an anonymous visitor (`anon_id`) and claimed after they sign up. It exists precisely in the window before an account, and therefore before a tenant.',

  magic_link_tokens:
    'PRE-TENANT: a sign-in token issued to an EMAIL. Minted before authentication, so there is no user yet, let alone a workspace.',

  // ── PERSON-OWNED ──────────────────────────────────────────────────────────
  // A tenant column on these would be WRONG, not missing: the row is a fact about
  // a human who belongs to several workspaces, and filing it under one of them
  // would make the same person a different person in each.

  users:
    'PERSON-OWNED: the account itself. A user belongs to many workspaces, so scoping the identity to one would make the same person a different account in each — the opposite of what the table exists for.',

  user_legal_acceptances:
    'PERSON-OWNED: which Terms/Privacy version this human accepted. Acceptance is given once by a person, not once per workspace; a tenant column would ask the same user to re-accept on joining a second workspace and would leave the platform unable to say who accepted what.',

  user_mfa_recovery_codes:
    'PERSON-OWNED: recovery codes for one account. MFA protects the LOGIN, which happens before any workspace is chosen, so there is no tenant in scope at the moment these are read.',

  webauthn_credentials:
    'PERSON-OWNED: a passkey registered to an account. Bound to the user and the origin and verified before tenant selection; a per-workspace passkey would mean re-registering the same authenticator once per workspace.',

  auth_user_sessions:
    'PERSON-OWNED: a login session for an account. One session spans every workspace the user can switch to, which is exactly why the session list is a security surface — scoping it per tenant would hide half of a user\'s live sessions from them.',

  oauth_accounts:
    'PERSON-OWNED: the external identity (Google/GitHub) linked to an account. The link is to the PERSON and is what resolves them at sign-in, before any workspace exists in the request.',

  email_preferences:
    'PERSON-OWNED: a person\'s product-email opt-outs, keyed by email address so it also works for a recipient with no account (`user_id` is nullable, ON DELETE SET NULL). An unsubscribe is a promise made to a human, not a workspace setting, and honouring it per tenant would keep mailing someone who opted out.',

  newsletter_subscribers:
    'PERSON-OWNED: a marketing-list subscriber keyed by unique email, whose `user_id` is nullable because most rows predate any account. Pre-tenant at write time and person-owned thereafter.',

  newsletter_events:
    'PERSON-OWNED: open/click/bounce events for a `newsletter_subscribers` row, which is itself a pre-tenant marketing record. It inherits its (absent) scope from the subscriber; adding a tenant here would invent one the parent never had.',

  marketplace_skill_likes:
    'PERSON-OWNED: a like the person pressed on a public marketplace listing, and the listing (`marketplace_skills`) is global. The like counts once platform-wide; a per-workspace like would let one user inflate a public count by switching workspace.',

  artifact_likes:
    'PERSON-OWNED: the same rule as `marketplace_skill_likes`, one noun out — a person\'s like on a public artifact slug. The signal is global because the thing liked is.',

  professional_references:
    'PERSON-OWNED: a person\'s professional referees, carried on their profile across every workspace they work in. Scoping them would mean re-collecting the same referee once per employer, which is what having a profile exists to avoid.',

  reference_shares:
    'PERSON-OWNED: a revocable share link a person mints over their OWN references. Granted by the human and redeemed by a stranger who has no workspace, so there is no tenant on either end of it.',

  freelancer_profiles:
    'PERSON-OWNED: the public profile a freelancer publishes, keyed by user. It is deliberately visible ACROSS workspaces — that is the marketplace — and a tenant column would make the same person a different freelancer to each client.',

  privacy_requests:
    'PERSON-OWNED: a GDPR/CCPA subject request made by a person about all of their data. Scoping it to one workspace would answer only part of a request the law defines over the whole account, and a deletion honoured in one tenant is not a deletion.',

  release_note_beta_enrollments:
    'PERSON-OWNED: one user opting into one platform beta. Both ends are global — `release_notes` is the platform changelog — so the enrolment follows the person, not whichever workspace they happened to be viewing when they opted in.',

  // ── PLATFORM DESK ─────────────────────────────────────────────────────────
  // Builderforce's own sales function, owned per associate. Every row is about a
  // PROSPECT: somebody who is not a customer, and therefore has no tenant.

  sales_contacts:
    'PLATFORM DESK: the sales desk\'s own pipeline, owned per associate (`owner_user_id`). These are prospects — people who are not customers yet and so have no tenant to belong to. Scoping them would file a lead under the workspace of whoever happened to be signed in.',

  sales_campaigns:
    'PLATFORM DESK: the same desk and the same owner key — an outbound campaign an associate runs against prospects. Pre-customer by definition.',

  sales_weekly_goals:
    'PLATFORM DESK: one associate\'s own weekly targets. A personal quota belonging to a member of staff, not workspace data.',

  sales_coaching_notes:
    'PLATFORM DESK: a note one associate writes about another. Both ends are platform staff, and the note follows the person being coached rather than any customer workspace.',

  sales_associate_settings:
    'PLATFORM DESK: an associate\'s referral and sales codes plus their notification toggles. Keyed by the person because the codes are attributed to the person and pay out to them.',

  sales_commission_rules:
    'PLATFORM DESK: the platform commission schedule, keyed by `rule_key`. One rate table the whole desk is paid against — a per-tenant copy would mean the same sale paid differently depending on who bought.',

  // ── INHERITED, but outside what the guard can derive ───────────────────────

  admin_impersonation_role_switches:
    'a role switch inside one `admin_impersonation_sessions` row, which IS tenant-scoped. Not picked up by `scopedByInheritance` because the foreign key carries no ON DELETE CASCADE — deliberately, since both tables are append-only audit records that are never deleted. The strict cascade requirement is right for the general rule; this is the one place an audit trail earns the exemption by never being deleted in the first place.',

  // `developer_orgs` and `developer_org_members` were declared here on the
  // argument that a publisher is not a tenant. Migration 0472 rejected that: a
  // developer IS a tenant, both tables are gone, and `extension_packages` now
  // carries the publisher's `tenant_id` like everything else. That the exemption
  // could be argued for at all is what this file is supposed to surface — the
  // reason is written down precisely so it can be re-read and overruled.
  //
  // `extension_versions` and `extension_review_stages` were argued here too, on
  // inherited tenancy. That argument is now COMPUTED — see `scopedByInheritance`
  // in the guard — so the paragraphs are gone rather than duplicated in prose.
};
