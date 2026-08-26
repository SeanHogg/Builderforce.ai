/**
 * SHAPE-LINT VERDICTS — table names that match a kernel primitive's suffix and
 * are, on inspection, a genuinely different noun.
 *
 * `check-shape-lint.mjs` asks a question, not an accusation: a name ending in
 * `_runs` might be the `runs` primitive re-modelled for one feature, or it might
 * be a word two nouns happen to share. Answering that question is real work, and
 * the answer has to be kept somewhere it survives — the baseline file is
 * regenerated wholesale and drops comments, so a verdict written there lasts
 * until the next `--update`.
 *
 * Each entry below removes one table from the guard's open balance and owes an
 * argument for doing so. `scripts/lib/adjudications.mjs` refuses an entry with no
 * reason, and `reportRatchet` reports any entry here that stops matching a real
 * table — a verdict about a table that was renamed or dropped is a reason nobody
 * needs.
 *
 * The test each of these has to pass is the TWO-NOUNS test: can the primitive
 * hold this row without losing a column that carries an invariant, an identity or
 * a foreign key the row's behaviour depends on? If yes it is duplication and
 * belongs in the baseline as work. If no, the argument goes here.
 */
export default {
  "pay_runs":
    'the kernel `runs` primitive is an EXECUTION — it has an attempt number, a parent ' +
      'run, a queued/running/succeeded status and jsonb input/output, because it models ' +
      'work the platform performed and may retry. A pay run is none of those: the ' +
      'platform did not perform it, cannot retry it, and the money has already left. ' +
      'The two share a word and no invariant. Folding it in would put `total_cost` — ' +
      'the number that IS burn, and that a forecast sums — inside an `output` blob, ' +
      'which is exactly the un-summable shape the pay-run work exists to replace.',

  "agent_definition_versions":
    'an executable identity boundary, not an edit-history entry. Releases, runs and ' +
      'rehearsals hold restrictive foreign keys to its content-addressed UUID; the generic ' +
      '`revisions` primitive has a bigint history id, requires an objects-registry owner, ' +
      'and stores patches or external snapshot keys rather than the executable definition. ' +
      'Substituting it would weaken exact-definition pinning and release rollback.',

  "placement_documents":
    'the DOCUMENT is an `artifacts` row; this is the obligation to hold one — a ' +
      'compliance requirement with a status, an expiry and a verifier. Deleting the ' +
      'file must not delete the requirement, which is the test that they are two nouns.',

  "lrs_documents":
    'xAPI Learning Record Store state, addressed exactly as the specification ' +
      'addresses it — (scope, activityId, agentKey, registration, documentId). It is a ' +
      'key/value store an external standard defines the shape of, not a made object with ' +
      'a kind; an `artifacts` row could not be looked up the way the spec requires.',

  "due_diligence_documents":
    'the same two-nouns test as `placement_documents`: this is the REQUEST for a ' +
      'document, with a reviewer and an accept/reject decision. It exists before any file ' +
      'does, which an `artifacts` row cannot.',

  "scratch_pad_attachments":
    'not the file — the file is an `artifacts` row. This is its PLACEMENT on a canvas ' +
      'board: a coordinate, a label and who pinned it. The same artifact can be pinned to ' +
      'two pads at two positions, which is an edge, not a property of the artifact.',

  "stock_media_assets":
    'an `artifacts` row is something the tenant MADE and owns. This is something a ' +
      'provider LICENSED, and the terms — attribution, territory, expiry, per-seat caps — ' +
      'are the reason the row exists. Using one copies it into `artifacts`.',

  "web_search_documents":
    'a mutable search-index record for externally crawled content, not a tenant-made ' +
      'artifact. Its identity is a canonical URL and content hash; crawl freshness, HTTP ' +
      'state, duplicate detection and term-frequency rows control recrawling and retrieval. ' +
      'An `artifacts` row instead identifies an owned creation and its stored rendition.',

  "extension_versions":
    'an installable ARTIFACT, not a step in an edit history. `tenant_extension_installs` ' +
      'holds an ON DELETE RESTRICT foreign key to it, every tenant installs the SAME ' +
      'version, and the row carries the review verdict and the scopes an admin is asked to ' +
      'approve. `revisions` is tenant-scoped, keyed by a bigint history number under one ' +
      "object, and stores a patch or a snapshot key — none of which a stranger's install " +
      'can point at. Same argument as `agent_definition_versions` above, one layer out.',

  "stage_sandbox_runs":
    "a CONTENT-ADDRESSED cache entry, not a task execution. Its primary access pattern " +
      "is \"find the newest row for (tenant, payload_hash)\" — a re-stage of an unchanged " +
      "build must reuse its prior clean run, and a one-byte edit must invalidate it — which " +
      "needs `payload_hash` as a first-class indexed column, not a value buried inside the " +
      "kernel `runs` primitive's opaque `input` jsonb. `runs`/`executions` are looked up by " +
      "id or by (tenant, kind, status); neither shape has a content-hash access path. The " +
      "kernel `runs` table is also unadopted by any real feature today (migration 0418, " +
      "referenced only by the generic read-only entity browser) — becoming its first write " +
      "consumer inside an already-large change would be validating two unproven things at " +
      "once instead of one.",

  "legal_document_files":
    'the same two-nouns test as `placement_documents`: the FILE is an `artifacts` row — ' +
      '`currentArtifactId` points at one, sealed at rest by `fileCrypto.ts` — and this is ' +
      'the case-file record around it: which entity/matter/IP it belongs to, its category, ' +
      'and the `signature_requests` row its signing flow created. Re-uploading points ' +
      '`currentArtifactId` at a NEW `artifacts` row rather than overwriting, which only ' +
      'works because the two are separate rows with separate identity. The kernel name ' +
      '`legal_documents` is already taken (migration 0012, the platform\'s own Terms of Use ' +
      '/ Privacy Policy versioning), hence `_files`.',

  "legal_document_shares":
    'a revocable view/download link scoped to one `legal_document_files` row, following ' +
      'the same mint/hash/resolve convention as `signature_parties.tokenHash` and ' +
      '`form_recipients.tokenHash` (`shareToken.ts`) — both already kernel-adjacent domain ' +
      'tables rather than rows in `share_links`, because `share_links` grants access to an ' +
      'object-registry `objects.id` and a document may not be registered as an object yet ' +
      'when it is first shared for review, before any signature flow exists. Recipient ' +
      'gating (`recipientEmail`) and the view/download permission are read at the FK\'s own ' +
      'granularity the same way the other two tables are; centralising through `share_links` ' +
      'would require the kernel primitive to grow a legal-specific recipient column three ' +
      'domains want and the other twenty-one do not.',

  "data_room_shares":
    'the same adjudication as `legal_document_shares`, and one noun further apart. A ' +
      'legal-document share grants a recipient ONE sealed file; a data-room share grants ' +
      'a NEGOTIATED RELATIONSHIP with a firm — it can require an NDA to be signed first ' +
      '(`ndaSignatureRequestId`), it inherits the ROOM\'s own `expiresAt` on top of its ' +
      'own, it names the firm as a `party_roles.party_ref` so "which fund read the cap ' +
      'table" joins to the same investor object the raise pipeline uses, and it is the ' +
      'grain view analytics are reported per. Folding it into `share_links` would trade a ' +
      'real foreign key for a string discriminator and put three NDA columns on every ' +
      'share in the platform that can never use them. What IS shared is the credential ' +
      'mechanics, and those already live in exactly one place — `shareToken.ts`, whose ' +
      '`shareGrantState()` is the single revoked/expired predicate this table and the ' +
      'other three all resolve through.',

  "activity_events":
      'an ingested THIRD-PARTY event, not a platform audit entry. Every row arrives from a ' +
      'provider (`provider` + `externalId` = a commit SHA or a PR number) and carries the ' +
      'quantitative payload DevEx metrics are computed from — `linesAdded`, `filesChanged`, ' +
      '`cycleTimeHours`. `activity_log` records what a principal of THIS platform did; nobody ' +
      'here did any of this. It also holds `mergedFromContributorId`, a reversibility marker ' +
      'that lets a contributor un-merge re-point exactly its own rows — an append-only audit ' +
      'log has no such operation by construction.',

  "agent_dispatches":
      'a unit of agent EXECUTION whose name happened to match the `deliveries` suffix list. ' +
      'Nothing is delivered: it carries a model, a runtime tier, an input, an output, a ' +
      '`dependsOn` fan-in and a `stageSeq` the swimlane coordinator advances on. It is nearer ' +
      'the `runs` primitive than `deliveries`, and it is not that either — a stage is the SET ' +
      'of dispatches sharing (ticketRun, swimlane, stageSeq), which is a grain `runs` cannot ' +
      'express without a second table to group them.',

  "agent_host_directory_files":
      'a synced directory MIRROR, not a stored artifact. Identity is (agentHost, directory, ' +
      'relPath) with a `contentHash` — the row is replaced in place when the file on the host ' +
      'changes, and deleting it means the path no longer exists on that host. An `artifacts` ' +
      'row is immutable content with its own identity that outlives the place it came from; ' +
      'these rows exist only as the current state of somebody else\'s disk.',

  "business_value_configs":
      'a named CATALOGUE, not a settings bag. Each row is a value type an operator defined, ' +
      'with a display mode and a reward multiplier, and tickets reference it by id — so rows ' +
      'are created, renamed and deactivated like any domain entity. `settings` is a key/value ' +
      'store scoped to an owner; a row of it is never referenced by another table.',

  "compliance_events":
      'an OBLIGATION, not an event. It has a `dueDate`, an `assignedTo`, an `isRecurring` ' +
      'cadence and a `completedAt` — a thing that has not happened yet and that somebody ' +
      'owes. `activity_log` is append-only and records the past. The test is that this row is ' +
      'created before its subject occurs and is then updated when it does.',

  "creation_session_connections":
      'an EDGE between two canvas objects (`sourceObjectId` → `targetObjectId` with a kind ' +
      'and a label), not a connection to a vendor. It shares one word with the `connection` ' +
      'primitive and not one column: there is no provider, no credential, no token and no ' +
      'sync state, because nothing outside the canvas is on the other end.',

  "creation_session_events":
      'the ORDERED OPERATION LOG that drives collaborative replay, not an audit trail. Each ' +
      'row carries a monotonic `revision` and an `idempotencyKey`, and a client that ' +
      'reconnects replays them from its last known revision to rebuild the graph — so the ' +
      'rows ARE the document\'s state, and deleting old ones changes what the canvas is. ' +
      '`activity_log` is a record OF state changes that can be truncated without changing ' +
      'anything.',

  "creation_session_members":
      'realtime PRESENCE, not membership. `viewport`, `cursor`, `selection`, `typing` and ' +
      '`followingUserId` are written many times a second and are meaningless the moment the ' +
      'socket drops; `lastSeenRevision` is the replay cursor above. `memberships` answers ' +
      '"may this principal act on this object", which is a durable authorisation fact. ' +
      'Putting a cursor position on the kernel membership row would make every permission ' +
      'read a write target.',

  "cron_jobs":
      'a SCHEDULE, not an execution. `schedule`, `enabled` and `nextRunAt` describe work that ' +
      'is going to happen repeatedly; `lastRunAt`/`lastStatus` are a cache of the most recent ' +
      'one. The `runs` primitive models ONE attempt with an input and an output. A cron job ' +
      'produces runs; it is not one, the same way a recurring meeting is not a meeting.',

  "equity_events":
      'the append-only OWNERSHIP LEDGER — the only place a share quantity lives, and the cap ' +
      'table is the fold over it. Seven verbs with declared debit and credit legs, cut on ' +
      '`effectiveAt` rather than `createdAt` so a March issuance typed in May still answers ' +
      '"what did we own in March". That is `ledger_entries`\' shape, not `activity_log`\'s, and ' +
      'it is not `ledger_entries` either: those legs are share classes and holders, not a ' +
      'denomination and an account.',

  "error_events":
      'high-volume ingest keyed to an `errorGroups` row, retention-bounded and written by an ' +
      'adapter rather than by a principal. It carries no actor at all — `userKey` is the ' +
      'AFFECTED end user, not the one who acted — and the interesting operations on it are ' +
      '"count by release" and "drop everything older than N days". `activity_log` is a ' +
      'tenant\'s own audit record and must not be pruned.',

  "headcount_events":
      'an EFFECTIVE-DATED employment change: `effectiveOn` is a date the fold cuts on and is ' +
      'deliberately not `createdAt`, so a leave recorded a week late still lands in the right ' +
      'month of the attrition rate. `activity_log` has one timestamp and it is when the write ' +
      'happened, which is the wrong number for every HR question this table answers.',

  "ide_training_logs":
      'a training-curve DATAPOINT — (job, epoch, step, loss) — that a chart plots and that ' +
      'the trainer emits thousands of per job. It is a numeric series, not a record of ' +
      'something a principal did, and its access pattern is "give me the loss curve for this ' +
      'job" rather than "what happened to this object".',

  "legal_documents":
      'the PLATFORM\'s own legal instruments — Terms of Use, Privacy Policy — versioned ' +
      'globally with one `isActive` row per `documentType` that every signup is bound to. ' +
      'There is no tenant, no owner object and no author beyond a superadmin, so `artifacts` ' +
      '(tenant-scoped, owned, made by somebody) cannot hold it. The tenant-side counterpart ' +
      'is `legal_document_files`, adjudicated above, which is why THAT one carries the ' +
      'suffix.',

  "lens_snapshots":
      'a periodic MATERIALISED ROLLUP, not a step in an edit history. The cron sweep upserts ' +
      'one row per (tenant, lens, period) from data that already exists elsewhere; nothing ' +
      'was edited, and re-running the sweep legitimately overwrites the row. `revisions` is ' +
      'keyed by a monotonic history number under one object and must never be overwritten, ' +
      'because the history IS the value.',

  "llm_action_ratings":
      'labelled ROUTING SIGNAL, not a user\'s comment on an object. Grain is one row per rater ' +
      'per rated thing, keyed by (surface, subject, resolvedModel), and the reader is the ' +
      'model router — the sibling fact to `run_model_outcomes`, which learns from merges and ' +
      'CI while this learns from thumbs on turns that have no run and no PR. An `annotations` ' +
      'row is content a person authored for other people to read; nobody reads these.',

  "marketing_audience_members":
      'an EMAIL-GRAIN contact, not a principal↔object membership. The member may never become ' +
      'a user: the row is an address with a phone, a subscription status and free-form ' +
      '`attributes` a campaign segments on. `memberships` joins a principal that exists to an ' +
      'object that exists, and answers an authorisation question; this answers "who receives ' +
      'this send".',

  "newsletter_subscribers":
      'the same argument as `marketing_audience_members`, one product earlier: `userId` is ' +
      'nullable and most rows never have one, because a subscriber is an address that ' +
      'consented. It carries its own lifecycle — `subscribedAt`, `unsubscribedAt`, ' +
      '`unsubscribeReason` — which is consent state, not access.',

  "pii_data_assets":
      'a DATA-INVENTORY register entry: what personal data the company holds, its ' +
      'classification, where it is stored, its retention period and its legal basis. There is ' +
      'no file. It is the GDPR Article 30 record, created by a compliance officer describing ' +
      'systems, and an `artifacts` row cannot exist without content to point at.',

  "qa_journey_events":
      'captured INPUT to test generation, not a record of the past. A journey is replayed ' +
      'step by step (`seq`, `selector`, `value`) to synthesise a Playwright spec, so the rows ' +
      'are consumed as a program rather than read as history, and they are pruned once the ' +
      'spec is generated. `activity_log` rows are never executed and never pruned.',

  "reference_shares":
      'grants a chosen SUBSET — `referenceIds` is a set, immutable once issued, because ' +
      'widening an existing token would silently extend access a holder already has. ' +
      '`share_links` grants one object-registry `objects.id`; expressing "these four ' +
      'references and no others" would need either a link row per reference (four tokens ' +
      'where the product issues one) or a set column on the kernel primitive that only this ' +
      'caller uses. The credential mechanics are already shared through `shareToken.ts`, ' +
      'which is the part that must not be duplicated.',

  "release_notes":
      'a PUBLISHED PRODUCT UPDATE — global, authored by the vendor, with a stage, a category, ' +
      'an optional beta opt-in and its own terms. It annotates nothing: there is no owner ' +
      'object, and the audience is everyone who uses the platform. `annotations` hangs off an ' +
      'object and is scoped to the tenant that owns it.',

  "manager_runs":
      'the STRUCTURED SUMMARY of a manager pass, keyed 1:1 by the `run_task_id` of the ' +
      '"Backlog management pass" card it closes — UNIQUE, so a retried finalize upserts. ' +
      'It carries no lifecycle of its own: no attempt, no parent, no queued/started/finished ' +
      'stamps, because the pass IS that task and the task already has them. The kernel ' +
      '`runs` shape describes an execution with a status that moves; this describes what one ' +
      'pass CONCLUDED (ok, changed, which stages were shed) so the overview can stop ' +
      'regex-parsing the card prose. An annotation on a task, not a second run row beside it.',

  "release_digest_runs":
      'a PLATFORM-WIDE fan-out with a resumable cursor, not a tenant execution. Its identity ' +
      'is `note_key` — a fingerprint of the ordered note set — under a partial unique index ' +
      'that permits exactly one OPEN run per digest, which is what makes the send idempotent ' +
      'across Worker evictions. The column that matters is `cursor_user_id`, a keyset ' +
      'position the next tick resumes from; the kernel `runs` shape has nowhere to put it ' +
      'except an `output` blob, and a resume cursor that cannot be indexed or compared is a ' +
      'cursor that cannot resume. It is also the one run-shaped table with no tenant at all ' +
      '(see the tenant-column adjudication): the audience is every user on the deployment.',

  "security_audits":
      'a scan RUN with a verdict, not an audit trail. It goes running → complete|failed, ' +
      'carries a score and rollups by severity and Trust Service Criterion, and each finding ' +
      'it produces becomes a SECURITY task pointing back at it. The `_audits` suffix names ' +
      'the subject matter, not the shape — the shape is `runs`, and it stays its own table ' +
      'because the rollup columns are what the Security seat reads and they would be ' +
      'unqueryable inside a kernel `output` blob.',

  "service_assets":
      'physical EQUIPMENT — an asset tag, a serial number, a site address, a criticality, a ' +
      'meter reading and a next-service date. The `_assets` suffix collides with the ' +
      '`artifacts` shape and shares nothing else: there is no content, no rendition and no ' +
      'storage key, because the thing is a chiller in a plant room.',

  "sso_connections":
      'a FEDERATION CONFIG that gates login, not an outbound credential. It holds an issuer, ' +
      'a JWKS url, a client secret used only in the authorisation code exchange, plus ' +
      '`jitProvisioning` and `defaultRole` — policy about who may become a member. It is read ' +
      'BEFORE a session exists, by the sign-in path, once per tenant. The `connections` ' +
      'primitive holds a per-user token the platform later calls somebody else\'s API with; ' +
      'the direction of trust is opposite.',

  "ticket_audits":
      'a COMPUTED VERDICT, upserted one row per task — `coverage`, `requiredCount`, ' +
      '`satisfiedCount`, `missing`, `computedAt`. It is recomputed and overwritten, never ' +
      'appended, which is the exact inverse of `activity_log`\'s invariant. It is a ' +
      'materialised projection of `ticket_participants`, kept as a table because the board ' +
      'renders the flag chip for every visible ticket in one read.',

  "ticket_participants":
      'a role OBLIGATION with state, not a membership. Each row is a required responsibility ' +
      'at a stage, with a `state`, a `signoffId`, an `evidence` payload, a `quorumGroup` and ' +
      'an optional child task — the row is what the role-gated lifecycle advances on and what ' +
      'blocks Done. `memberships` answers "may this principal act"; this answers "has this ' +
      'role discharged its duty on this ticket, and with what proof".',

  "ticket_runs":
      'a per-ticket STATE-MACHINE CURSOR sitting above the workflow engine, not an execution ' +
      'attempt. There is no attempt number, no input, no output and no retry: there is one ' +
      'row per ticket, long-lived, whose `lifecycle` and `currentSwimlaneId` are updated in ' +
      'place as the board advances it, and whose `stageHistory` records where it has been. ' +
      'The executions it causes are `agent_dispatches`; the kernel `runs` shape describes ' +
      'those, not this.',

  "usage_snapshots":
      'a telemetry SAMPLE at a timestamp — token counts and context-window occupancy read off ' +
      'a live session, emitted on a timer. Nothing was revised: two consecutive rows for the ' +
      'same session are two observations, not two versions, and the series is what the ' +
      'context-pressure chart plots. `revisions` requires an object whose content changed.',

  "vscode_connections":
      'device PRESENCE, not a stored credential. `machineName`, `extensionVersion`, ' +
      '`connectedAt` and `lastSeenAt` say which editor is currently attached and on what ' +
      'build; there is no token, no provider and no scope, because the extension ' +
      'authenticates as the user rather than holding a secret of its own. The `connections` ' +
      'primitive exists to hold that secret.',

  "job_invites":
      'the kernel `invitations` primitive grants ACCESS to something the invitee is not ' +
      'yet inside — it carries a `role`, a NOT NULL UNIQUE `token_hash`, and an ' +
      '`object_id` into the objects registry, because the invitee is typically not a user ' +
      'yet and the token IS the credential that admits them. A job invite is the opposite ' +
      'act: the invitee is an already-authenticated platform user with a for-hire profile, ' +
      'no role is being granted, and the invitation is answered in-app — folding it in ' +
      'would mean minting a bearer credential per invite that grants nothing and must ' +
      'never be honoured, which is a worse security posture than the row it replaced. ' +
      'The decisive column is `proposal_id`: accepting an invite OPENS that person’s ' +
      '`job_proposals` row and records its id, which is precisely what makes this a step ' +
      'in the bidding flow rather than a notification, and `invitations` has nowhere to ' +
      'put it. `job_id` is likewise a real ON DELETE CASCADE foreign key to ' +
      '`job_postings`; `invitations.object_id` points at the objects registry, which ' +
      'postings are not in, so the move would trade an enforced key for an unenforced ' +
      'one. Two nouns that share a word: one admits somebody to a workspace, the other ' +
      'asks somebody already here to bid on a posting.',

  "feedback_collector_integrations":
    'not a `connection`: the kernel connection models a WORKSPACE account with a ' +
      'vendor — an OAuth identity, tokens, a refresh cycle. This row is a child of ONE ' +
      'feedback collector holding ONE inbound signing secret, with no identity, no token ' +
      'lifecycle and no outbound calls. It cascades with its collector, which a ' +
      'workspace-level connection row could not. Same verdict as its twin ' +
      '`error_collector_integrations`, argued at length in the signature-duplication ' +
      'adjudications.',

  "feedback_webhook_deliveries":
    'the name matches, the shape does not. The `deliveries` primitive models something ' +
      'WE SEND — a dispatch, its attempts, its outcome. This is the mirror image: an ' +
      'index of what a provider sent US, existing only so a retry of an already-handled ' +
      'delivery cannot open a second ticket. It has no recipient, no payload, no attempt ' +
      'count and no terminal state; a unique index is its entire behaviour.',

  marketplace_skill_likes:
    '`annotations` is NOT NULL on both `tenant_id` and `object_id`. This like is pressed on a PUBLIC marketplace slug, which has no tenant and no objects row — the listing is global precisely so a stranger can find it. There is nothing for either required column to hold.',

  artifact_likes:
    'the same wall as `marketplace_skill_likes`: identity is (artifact_type, artifact_slug), a SLUG rather than an object id, and the row is global. `annotations` requires a tenant and a registered object; this has neither.',

  sales_coaching_notes:
    '`annotations.tenant_id` is NOT NULL. Both ends of this note are Builderforce sales staff and the row has no tenant at all — see the tenant-column adjudication. A primitive that cannot represent the row is not a home for it.',

  sales_associate_settings:
    '`settings.tenant_id` is NOT NULL and this row has no tenant: it holds one platform associate\'s own referral codes. Same wall, different primitive.',

  legal_document_versions:
    '`revisions` requires a tenant AND an `object_id` into the registry. These are the PLATFORM\'s own Terms and Privacy versions — no tenant by design, and not registered objects. It is also a full published document, not a patch or a snapshot key.',

  marketing_tool_runs:
    '`runs.tenant_id` is NOT NULL. This is an anonymous visitor\'s free-tool result keyed by `visitor_id`, written before any account exists. The tenant-scoped counterpart IS a separate table (`tool_runs`), which is the point: two populations, one of which the primitive cannot hold.',

  email_preferences:
    '`settings` is (scope, scope_ref, feature, value) under a NOT NULL tenant. This is keyed on EMAIL precisely so it works for a recipient with no account and no workspace — a cold invite\'s unsubscribe must survive both \'no account yet\' and \'account later deleted\'. A tenant-scoped setting cannot make that promise.',

  chat_messages:
    '`messages` requires `thread_id` NOT NULL into `threads`. This transcript\'s parent is `chat_sessions` — an agent-host session, not a thread — so adopting the primitive means creating a threads row per session purely to satisfy a foreign key, and routing every read through it.',

  brain_chat_messages:
    'the same missing thread as `chat_messages`, plus a unique (chat_id, event_key) that makes a producer\'s retry idempotent. `messages` has no idempotency column, so that guarantee would move back into application code, which is where it was before this index existed.',

  freelancer_messages:
    'child of `freelancer_conversations`, which is itself not a `threads` row for the reason given there. A message cannot move to the primitive before its thread can.',

  execution_messages:
    'not a transcript — a STEERING QUEUE. Rows with role \'user\' and a null `consumedAt` are pending steers the cloud loop drains on its next step, and `consumedAt` is stamped once so a steer is delivered exactly once. `messages` has no consumption state and no queue semantics; it records what was said, not what has yet to be acted on.',

  chat_members:
    '`memberships` needs `object_id` NOT NULL into the registry and identifies the member by (member_kind, member_ref). This row carries `invited_email` — a COLD invite to somebody with no account, converting to a `user_id` on first access. A member_ref cannot name a person who does not exist yet.',

  dev_team_members:
    '`memberships.tenant_id` is NOT NULL; this table has none (it inherits through `dev_teams`), and `dev_teams` is not registered in `objects` for the `object_id` the primitive also requires. Two required columns, neither available.',

  team_members:
    'the same two walls as `dev_team_members`, and one more: `member_ref` is deliberately polymorphic with no foreign key, because a team member may be a human or an agent.',

  on_call_members:
    '`memberships` needs a registered `object_id` and `on_call_rotations` is not one. `member_ref` is assignee-encoded across three populations (\'u:\', \'c:\', \'contact:\'), and `position` is the ROTATION ORDER — the column the paging schedule advances on, which a membership has nowhere to put.',

  ceremony_participants:
    'not a membership but an ATTENDANCE RECORD: `attendance`, `attendance_source`, `attendance_set_by`, `attendance_set_at`, `notified_at`, `turn_order`, `duration_ms`. `memberships` says who belongs; this says who turned up, who says so, and how long they spoke. Different question, and the primitive has no column for any of the evidence.',

  meeting_attendees:
    'an INVITE and its response (`response`, `email`, `joined_at`, `left_at`), including for an attendee with no account to be a member of anything. `memberships` models standing access, not one meeting\'s guest list.',

  tenant_members:
    '`memberships` identifies its owner by `object_id` into the registry, and a TENANT is not an object — `objects.tenant_id` points AT it. The seat also carries `monthly_spend_cap_millicents` and its notify thresholds, which the billing gate reads on the hot path; a jsonb metadata blob is not something a spend gate can be indexed on.',

  coaching_notes:
    '`annotations` requires `object_id` NOT NULL. This is deliberately polymorphic over (member_kind, member_ref) with NO foreign key, because a coached workforce member may be an agent rather than a row in any one table. There is no object id to supply.',

  coordination_notes:
    'not an annotation — a BLACKBOARD CELL. One row per (scope_key, key); posting the same key OVERWRITES, because the board holds CURRENT intent that a peer must not contradict. `annotations` is append-and-resolve with an author and a thread; overwrite-by-key is the opposite lifecycle, and the note dies with its ticket rather than being resolved.',

  knowledge_document_tags:
    'a unique (document, tag) FILTER KEY, not an authored annotation: no author, no body, no lifecycle. `annotations` requires a registered `object_id` plus an author kind, and `knowledge_documents` is not in the registry.',

  poker_votes:
    'a BALLOT with a reveal gate: unique per (story, user), with `is_revealed` deciding whether anybody may read the value yet. `annotations` publishes on write and has no concept of a sealed value, which is the entire mechanic of planning poker.',

  prompt_library_versions:
    '`revisions` requires a registered `object_id` and stores a patch or an external snapshot key under a bigint history number. A prompt version IS its `body` — the executable text a run pins — and prompt entries are not registered objects. Same argument as `agent_definition_versions` above.',

  knowledge_document_versions:
    '`revisions` stores a patch or a snapshot key; this stores the FULL published title and content, because an SOP version is what a reader with a read-acknowledgement must be shown verbatim. Its parent is also unregistered, so the required `object_id` has nothing to hold.',

  spec_versions:
    '`revisions` again cannot hold it: the row carries THREE whole documents (`prd`, `arch_spec`, `task_list`) and a `frozen` flag that pins an execution to an exact spec. Freezing is a lifecycle `revisions` does not have, and it is the mechanism that stops a running build reading a spec that changed underneath it.',

  creation_session_snapshots:
    '`revisions` stores a patch or an external `snapshot_key`. This stores the whole `graph` inline together with the `viewport`, because the collaborative editor REWINDS to it — restoring a board means loading the graph, not fetching an object out of storage and replaying patches to reach it.',

  knowledge_documents:
    '`artifacts` models a stored FILE: `storage_key`, `mime`, `byte_size`, `checksum`. A knowledge document has no bytes — it is authored `content` with a `status`, a `version_number` and `requires_ack`, the read-acknowledgement an SOP is governed by. None of that is expressible as an artifact row.',

  freelancer_conversations:
    '`threads` has no per-side read state. This tracks it with two watermarks (`employer_last_read_at`, `freelancer_last_read_at`) rather than per message, deliberately, so a thread with several managers on the employer side stays correct. A single `last_message_at` cannot answer \'unread for whom\'.',

  freelancer_notifications:
    'nothing is DELIVERED. `deliveries` models an outbound send — a channel, a recipient, attempts, retryability, a provider reference. This is an in-app row with a `read_at`: the user comes to it. Adopting the primitive would leave every dispatch column permanently null and put the read state nowhere.',

  error_collector_integrations:
    'the child of ONE `error_collectors` row, holding ONE inbound signing secret. The kernel `connections` primitive models a WORKSPACE account with a vendor — an identity, a token lifecycle, outbound calls — and this has none of them. Argued at length in the signature-duplication adjudications, where its twin sits.',

  tool_audit_events:
    '`activity_log` records what a PRINCIPAL did, with a NOT NULL `verb` and actor. This is per-tool-call telemetry identified by `tool_call_id`, carrying `args`, `result` and `duration_ms` at a volume per run the audit log is not sized for. A tool call has a name, not a verb.',

  agent_inference_logs:
    'token counts and latency per inference call — `prompt_tokens`, `completion_tokens`, `latency_ms` — which are SUMMED into cost and performance reporting. `activity_log` has no numeric columns; the numbers would land in `metadata` jsonb and stop being aggregatable.',

  personality_events:
    'the persona provenance of a run and the execution parameters it produced (`think_level`, `reasoning_level`, `temperature`, `directive_count`). Read to explain why a run behaved as it did, not as an audit of who did what — and `activity_log.verb` has no value to carry.',

  project_insight_events:
    'per-execution code-change statistics that roll up into DevEx metrics. Numeric payload, summed — the same reason `activity_log` cannot hold `activity_events`, adjudicated above.',

  agent_host_sync_history:
    'a sync RUN and its result: `file_count`, `bytes_total`, `status`, `error_msg`. Both counters are reported and compared between syncs, which an audit row with a jsonb blob cannot support.',

  deployment_events:
    'the DORA signal `activity_events` lacks. `is_failure` gives change-failure-rate and `restored_at` minus `deployed_at` gives MTTR — two timestamps on one row, subtracted. `activity_log` has a single `occurred_at`, so the interval that IS the metric cannot be expressed.',

  monitor_events:
    'a monitor\'s own signal/breach/recovery history. Nobody DID any of this — `activity_log.actor_type` is NOT NULL and there is no actor; a threshold was crossed. Its incidents live in `prod_incidents`, which is the row an actor does act on.',

  incident_events:
    'the war-room feed AND the paging audit in one append-only timeline: `channel`, `target` and `level` record who was paged, how, and at what severity. `activity_log` has no notification columns, so half of every row would be lost.',

  alert_events:
    'one firing of a rule, carrying `observed_value`, `threshold` and `comparator` — the three numbers that let somebody see WHY it fired without re-running the rule. An audit entry records only that it fired.',

  connector_call_logs:
    'one outbound connector call: `status_code`, `duration_ms`, `ok`. It deliberately records the request SHAPE and never the body, because a connector body routinely carries customer PII. `activity_log.metadata` is an open jsonb blob — precisely the shape that invites somebody to put the body in it.',

  catalog_adoption_events:
    'an append-only analytics SERIES keyed (kind, item_id, event_type) feeding an over-time chart. `activity_log` requires a NOT NULL `verb` and actor per row; an adoption count has neither, and the series is read by grouping rather than by reading one principal\'s history.',

  integration_sync_logs:
    'one sync attempt with `items_processed`, `items_errored` and `cursor_after` — the cursor being what the NEXT sync resumes from. `runs` would bury it inside an opaque `output`, and resuming is a read of that column, not of a blob.',

  creation_outcome_events:
    'the value ledger for creation sessions: `metric_key`, `metric_value`, `unit`, `cost_usd_millicents`, rolled up session to project to tenant. `activity_log` has no numeric columns to roll up, and the unique (correlation_id, phase) that stops a started/terminal pair being double-counted has nowhere to live.',

  tool_runs:
    'the platform performed nothing: a USER filled in a questionnaire and kept the answer. `runs` is an execution with an attempt number, a queue time and a retry; none of the three applies. The `result` is also SCORED and rolls into a project diagnostic rating, so it is read and indexed rather than being an opaque `output` blob.',

  qa_runs:
    'a browser-test execution whose reported columns — `browser`, `target_url`, `commit_sha`, `total_steps`, `passed_steps`, `duration_ms` — are exactly what the QA dashboards filter on. In `runs` they become `input`/`output` jsonb. The objection recorded for `stage_sandbox_runs` also stands: the kernel `runs` table still has no feature consumer, only the generic entity browser, so this would be validating the primitive and the migration at once.',

  import_runs:
    'a migration job with a `mode` (migrate / sync / both) and a staged, resumable `status` machine the import UI drives step by step — discovering, staged, mapped, importing. `runs` has a queued/running/finished lifecycle and no notion of staging, mapping and resuming a partially applied import.',

  repo_analysis_runs:
    'a state machine the UI POLLS: `stage`, `progress`, `token_budget`, `tokens_used`. `runs` reports terminal status; this reports position and spend WHILE running, which is what the progress bar and the budget guard read.',

  ide_training_jobs:
    'a fine-tune plus its eval scorecard — `eval_score`, `eval_code_correctness`, `eval_reasoning_quality`, `eval_hallucination_rate`. The scorecard is compared ACROSS jobs to decide which checkpoint ships; inside `runs.output` it stops being comparable.',

  pr_reconciliation_runs:
    'one deterministic GitHub-to-ticket audit, carrying `approved_pr_numbers` and `error_count` as the evidence a reviewer reads before approving a merge. Same unproven-primitive objection as `qa_runs`.',

  audit_report_runs:
    'the LOG of an assembled period report — the report itself is computed live and never stored. There is no execution to model: the row records that a period was assembled and by whom, which is nearer an audit entry than a run, and is not cleanly either primitive.',

  project_manager_configs:
    '`settings` stores ONE fact per (scope, scope_ref, feature) row. This is a twenty-column policy read as a UNIT on the manager\'s sweep path — assignment, PR authority, ceremony autonomy, reassignment limits. Splitting it means twenty reads to answer one question, on a hot path. Its real duplication is `tenant_manager_defaults`, already tracked as a signature-duplication cluster.',

  qa_routing_settings:
    'the same argument one domain out: a per-project routing policy (`enabled`, `min_severity`, `target_lane_key`, `max_per_batch`) read together on the findings-ingestion path to decide whether to dispatch a PAID agent run. The decision needs all four; `settings` would make it four reads.',

  rd_tax_credit_config:
    'typed columns a calculation reads directly — `blended_labor_rate_usd` is numeric and is multiplied. `settings.value` is jsonb, so every read becomes a cast, and a bad cast inside a tax calculation is not a class of bug worth inviting.',

  marketing_assets:
    '`public_token` IS the access model, not a property of the file: a recipient\'s mail client has no session, so an authenticated artifact URL renders as a broken image in every inbox. Rotating the token — not deleting the row — is how an asset is un-published, which keeps the campaigns that referenced it explainable. `artifacts` has no unauthenticated access path.',

  board_connections:
    'not an account — a BINDING. The credential already lives elsewhere and this row points at it (`credential_id` into `integration_credentials`); what is left is which external board is bound to which Builderforce PROJECT, plus the poll cursor and webhook secret that drive the sync. `connections` models a workspace\'s account with a vendor and has no project, no external board id and no cursor. One vendor account backs many board bindings, which is the test that they are two rows.',

  calendar_connections:
    'a per-user OAuth grant, and since migration 1107 it is sealed through the SAME `oauthTokenVault` as `mailbox_connections` and `drive_connections` — which is where the shared behaviour actually lives. The three tables stay separate for the reason their own docstrings give: a grant is keyed (tenant, user, provider, account) because it belongs to a PERSON, and this one additionally carries `calendar_id`, the specific calendar within the account that events are written to. The kernel `connections` primitive is keyed to a workspace and has no per-user account slot; folding them in is the drive/mailbox cluster decision (PRD 20 §6), and this table is the third member of it, not a separate question.',

  drive_connections:
    'one half of the declared `drive_connections` = `mailbox_connections` duplicate-shape cluster, which is tracked as OPEN work by `check-signature-duplication` and is blocked on the PRD 20 §6 kernel-primitive decision. Recording it as a shape-lint finding as well counts one decision twice; the cluster is where it is owned.',

  mailbox_connections:
    'the other half of the same cluster, tracked as open work by `check-signature-duplication`. Same reason: one decision, counted once.',

  connector_connections:
    'keyed by connector KEY, not by vendor — deliberately, because the key resolves against built-in connectors AND tenant-defined ones, which is what lets a workspace connect a connector that has no `connectors` row at all. `connections.vendor` names a vendor the platform knows about; a tenant-defined connector is by definition one it does not. It also carries `base_url_override`, the self-hosted endpoint a tenant points the connector at, which a vendor-account primitive has nowhere to put.',

  source_control_integrations:
    'the workspace\'s VCS account (provider, account identifier, optional self-hosted `host_url`) — genuinely the `connections` shape, and genuinely a candidate to fold in. It stays out for one reason that is about sequencing rather than modelling: `connections` is keyed (tenant, vendor, capability, external_account) with a `cache_version`, and the six features already on it are all money-side (ledger, payouts, merchant). Moving source control across is a migration of live repo bindings that every delivery surface reads, so it belongs with the §6 primitive decision and the drive/mailbox cluster, not ahead of them.',

  tenant_openrouter_connections:
    'a named MODEL SET, not an account: a label plus an ordered `models` list plus a `priority`, of which a tenant may hold several. `key_enc` is optional — an unbound row routes through the platform\'s own OpenRouter key — so the row can exist with no credential at all, which a `connections` row cannot. What it expresses is routing order, and `connections` has no ordering column; the credential-per-provider table beside it (`tenant_llm_provider_keys`) is the one that models an account.',

  creation_session_comments:
    'the closest call of the sixty-five, and it turns on one column. `annotations` could hold the body, the anchor, the thread (`parent_id`) and the resolve state — its parent IS registered in `objects`, unlike most tables here. What it cannot hold is `object_id` pointing at a creation-session OBJECT rather than the session: a comment is anchored to one shape on the board, the shapes are `creation_session_objects` rows, and they are not registered individually. Registering every canvas shape as an object to make the comment fit would put millions of rows in the registry to move thousands of comments.',

  marketing_campaign_sends:
    'one row per (campaign, recipient), and the unique index on that pair is the entire point — it is what makes a resumed or retried campaign send idempotent, so a second pass cannot email the same person twice. `deliveries` has no idempotency key and identifies its owner through `object_id`, which `marketing_campaigns` is not registered for. Folding it in would move the no-double-send guarantee out of the database and into the sweep that retries.',

  webhook_deliveries:
    'the same shape of argument as `marketing_campaign_sends`, one domain out. `uq_webhook_delivery_event` on (subscription, event_type, event_id) is what stops an at-least-once emitter meeting a retrying caller from POSTing the same board event twice; the emit path inserts with `onConflictDoNothing` and reads \'no row came back\' as \'already enqueued\'. `deliveries` has no such key, and `subscription_id` is a real foreign key that would become an `object_id` into a registry `webhook_subscriptions` is not in.',

  newsletter_events:
    '`activity_log` requires a NOT NULL `actor_type` and `verb`. A bounce or an open has no actor — a mail server did it, or nobody did — and the subject is a `newsletter_subscribers` row that is pre-tenant by construction (adjudicated under tenant-column). Two required columns with nothing to put in them.',

  research_notes:
    'the same wall as `coaching_notes`/`knowledge_document_tags`: `annotations.object_id` is NOT NULL into the canvas objects registry, and this row\'s parent — a project, or nothing at all — is not a registered object. A research note is deliberately collectible before any board exists: a founder pastes a competitor teardown or a market stat during Read, often before a Creation Session or a company does. There is no shape on any canvas this note is anchored to, so there is no `object_id` to supply. `annotations`\' other half — `kind` (comment/tag/like/vote/rating/reaction), `authorKind` and the publish/pending/rejected moderation state — also answers a different question: those are reactions to somebody else\'s object; a research note is a first-class discovery artifact the founder authored for themselves, later cited when Prove ranks a proof against it.',

};
