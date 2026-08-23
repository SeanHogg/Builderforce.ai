/**
 * The curated tool ALLOWLISTS an agent is granted — the data half of the
 * cloud-agent tool surface.
 *
 * ── WHY IT IS ITS OWN MODULE ─────────────────────────────────────────────────
 * These two arrays are pure strings, but they lived inside `builtinMcpService.ts`,
 * which pulls in most of the application layer (the same reason {@link ./toolNaming}
 * was carved out of it). Anything that only needs to know WHICH tools a surface
 * grants — the tool-surface registry, a prompt builder, a test — had to import the
 * whole catalog to read a list of ids.
 *
 * The schema builders that turn these ids into model-facing tool definitions stay
 * in `builtinMcpService` with the CATALOG they read: this module owns the POLICY
 * (which ids), that one owns the METADATA (what each id looks like). Both are
 * re-exported from `builtinMcpService` so every existing importer is unaffected,
 * and a CATALOG-membership test keeps the ids honest.
 */

/**
 * The curated subset of platform tools an AUTONOMOUS cloud coding agent may call
 * mid-run — the "work" surface so a run can create follow-up tasks for gaps it
 * finds, update OKR/objective progress, and read what's remaining, instead of
 * silently dropping out-of-scope work. It deliberately EXCLUDES every admin or
 * destructive tool: no deletes, no execution control-plane mutations
 * (executions.submit/cancel/post_message), and nothing under
 * api_keys/security/provider_keys/migrations/agent_hosts/board_connections/cron/…
 * An explicit allowlist is safe-by-default: a newly-added CATALOG tool is NOT
 * granted to an unattended agent until it is listed here. Kept honest by a
 * CATALOG-membership test (every id below must exist in CATALOG).
 */
export const CLOUD_AGENT_PLATFORM_TOOLS: readonly string[] = [
  // Compliance agents can explain the jurisdiction matrix and launch the tracked
  // repository audit. The launch mutates only by recording a report and filing
  // remediation tickets; it does not change source or external systems.
  'compliance.requirements', 'compliance.run_audit',
  // Session introspection — read-only. Lets a run answer "what model am I on?" and
  // report the model/tier it is actually driving on the timeline.
  'session.current_model',
  // Projects — read + write (no delete)
  'projects.list', 'projects.get', 'projects.create', 'projects.update', 'projects.check_key',
  // Tasks — read + write + move + assignees (no delete). "create other tasks for gaps".
  'tasks.list', 'tasks.get', 'tasks.create', 'tasks.update', 'tasks.move', 'tasks.assignees',
  // Sequencing is half of planning — a PM agent that can date work but not order it
  // can only ever produce a flat plan.
  'tasks.dependencies', 'tasks.add_dependency', 'tasks.remove_dependency',
  // Workforce roster — the tenant's own cloud agents (any publish state), so an agent
  // handing work off knows the REAL agents that exist and their ids (never invents a ref).
  'cloud_agents.list_mine',
  // Specs / PRDs — read + write (no delete)
  'specs.list', 'specs.get', 'specs.create', 'specs.patch',
  // Strategy / OKRs — read + write (no delete). "update project related items (OKR)".
  'portfolios.list', 'portfolios.create', 'portfolios.update',
  'initiatives.list', 'initiatives.create', 'initiatives.update',
  'objectives.list', 'objectives.create', 'objectives.update', 'objectives.add_link', 'objectives.remove_link', 'objectives.promote_orphans',
  'key_results.list', 'key_results.create', 'key_results.update',
  'work_items.convert_type', 'pmo.tree', 'pmo.rollup', 'pmo.link_project', 'pmo.add_dependency',
  // Team chat — a PM/manager agent asks the team for status or shares a burndown.
  'team_chat.read', 'team_chat.post',
  // Mailboxes and campaigns — READ AND DRAFT ONLY.
  //
  // An autonomous run may read an inbox, triage it, look at the template and
  // asset library, and draft a campaign, because none of that reaches anyone.
  // `mailbox.send`, `campaign.send` and `marketing.generate_logo` are all
  // deliberately absent: the first two contact real strangers with no human in
  // the loop to stop them, and the third spends the tenant's image credits. Same
  // restraint as excluding executions.submit — a run proposes, a person sends.
  'mailbox.list_connections', 'mailbox.list_messages', 'mailbox.get_message',
  'marketing.list_templates', 'marketing.create_template', 'marketing.list_assets',
  'campaign.list', 'campaign.create',
  // Social accounts — READ AND DRAFT ONLY, for the same reason and along the same
  // line. An autonomous run may read the workspace's own feed, see what performed,
  // and draft a campaign; `social.publish` and `social_campaign.publish` speak in
  // public as the brand with nobody in the loop to stop them, so they stay off.
  'social.list_accounts', 'social.read_feed', 'social_campaign.list', 'social_campaign.create',
  // Paid media: an autonomous run may LOOK at what is running, WHO it is aimed at and
  // what it cost, all three levels of it — but every write is absent. `create_campaign`
  // / `create_ad_set` / `create_ad` and their `update_*` siblings move real money (on
  // most networks the AD SET is where the budget lives, so that one is no safer than
  // the campaign), and `ads.sync` rewrites the ledger the others are judged by.
  'ads.list_accounts', 'ads.list_campaigns', 'ads.list_ad_sets', 'ads.list_ads', 'ads.insights',
  // Measurement is entirely read-only, so all of it is safe here.
  'measurement.list_properties', 'measurement.overview', 'measurement.breakdown',
  // Project knowledge, files, review
  'project_facts.recall', 'project_facts.remember',
  'project_files.list', 'project_files.read', 'project_files.save',
  'repos.pull_request_diff_summary',
  'attachments.read', 'attachments.write',
  'reviews.record', 'tickets.from_delta',
  // Kanban role sign-off — a reviewer agent clears a lane's role/review requirement so
  // the swimlane can advance (the round-trip that used to need a hand HTTP call). Read
  // the coverage audit to see what it still needs to satisfy.
  'kanban.signoff', 'kanban.audit',
  // Coordinated role participation (PRD "Coordinated Role Participation") — a Coordinator/
  // Manager agent reads the ticket's Participation Manifest + Accountability Report to know
  // which required roles still must execute + sign off, and performs a Resource Assessment
  // (add a role the ticket needs beyond the template). Without these on the allowlist an
  // unattended Coordinator can SEE the tools in the catalog but not invoke them.
  'kanban.participants', 'kanban.accountability', 'kanban.assess_resource', 'kanban.assign_participant', 'kanban.remove_participant',
  'kanban.coordinate', 'kanban.materialize_work_items',
  // Autonomy self-diagnosis — the wiring audit ("can work complete at all?"), the
  // outcome funnel, and a single ticket's chain of custody. All read-only. An agent
  // asked to fix a stuck board needs to SEE the broken invariant; without these on the
  // allowlist it could only guess, which is how a livelock and an empty sign-off ledger
  // survived for weeks. Diagnosis is deliberately separate from the remedies, which are
  // the already-audited mutating tools above.
  // `manager.stalled_tickets` also carries what the manager has ALREADY TRIED on each
  // stuck ticket and how many times it failed — so an agent asked to unstick a board
  // starts from the manager's own attempt history rather than repeating a remedy that
  // has provably not worked.
  'autonomy.wiring_audit', 'autonomy.summary', 'tickets.lifecycle', 'manager.stalled_tickets',
  // The manager's ACCOUNTABILITY surface. A human can now ask the manager, in its own
  // chat on the Manager page, "what did you get done today, and why not more?" — and an
  // agent that cannot read its own record can only apologise. `manager.policy` is the
  // one that makes the answer honest rather than merely contrite: the true reason
  // nothing merged is usually that merge authority is withheld or the workspace is out
  // of tokens, and neither fact is visible anywhere in the ticket data.
  'manager.digest', 'manager.census', 'manager.decisions', 'manager.policy',
  // Security agent: file SOC 2 findings mid-run. NOT security.configure_access —
  // deciding who can see security tickets is an admin action, never an unattended
  // agent reconfiguring its own findings' visibility.
  'security.record_finding',
  // Incident Manager: triage help-desk tickets into incidents, classify the affected
  // system, page/escalate on-call, and post war-room updates. NOT the on-call/policy
  // CRUD — configuring rotations & escalation policies is a human/admin action.
  'incidents.open', 'incidents.classify', 'incidents.update', 'incidents.add_note',
  'incidents.list', 'incidents.get', 'incidents.postmortem', 'oncall.page', 'oncall.list',
  // Knowledge recall — any agent can search the KB (SOPs, processes, prior RCAs /
  // known-errors) so it learns from documented practice + past incidents mid-run —
  // and author a standalone SOP / runbook / known-error article directly.
  'knowledge.search', 'knowledge.create',
  // Gig Marketplace: a Product-Manager/Designer agent may publish work, run the hiring
  // funnel, evaluate proposals with AI, and schedule review/interview meetings.
  'marketplace.publish_ticket', 'marketplace.unpublish_ticket',
  'jobs.create', 'jobs.list_mine', 'jobs.proposals',
  'proposals.evaluate', 'proposals.shortlist', 'proposals.decline',
  'meetings.schedule', 'deliverables.evaluate', 'deliverables.set_status',
  // Executions — READ ONLY (accurate "what's remaining"; no submit/cancel/post_message)
  'executions.get', 'executions.list_active', 'executions.list_for_task', 'executions.list_recent',
  'executions.task_file_changes', 'executions.trace',
  // Career — ANALYSIS ONLY, and the split here is deliberate rather than cautious.
  //
  // Everything below computes over text the run already holds: score a résumé, match it
  // to a posting, screen against STATED criteria, build an interview kit, search the job
  // board and the talent directory. Safe unattended, because none of it is visible to
  // anyone outside the run.
  //
  // Deliberately EXCLUDED: `proposals.submit`, `proposals.withdraw`, `listing.update`
  // and `listing.set_available_for_hire`. Each of those acts OUTWARD under a real
  // person's name — an application an employer reads, a public listing, the opt-in that
  // removes them from every search. An unattended agent must never send one of those on
  // someone's behalf without them seeing the words first, so the tool exists and the
  // unattended grant does not.
  'recruiter.parse_resume', 'recruiter.score_resume', 'recruiter.optimize_resume',
  'recruiter.tailor_resume', 'recruiter.match_job', 'recruiter.summarize_resume',
  'recruiter.extract_skills', 'recruiter.interview_questions', 'recruiter.screen_candidate',
  'recruiter.build_packet', 'recruiter.source_candidates',
  'hr.career360_suggest_targets', 'hr.career360_select_target', 'hr.career360_state',
  'hr.salary_analyze', 'hr.comp_analyze', 'hr.employer_research',
  'listing.get_mine', 'listing.audit', 'listing.readiness',
  'jobs.search', 'jobs.get', 'proposals.mine',
];

/** Chat-scoped tools an agent gets ONLY when it is replying INSIDE a Brain chat (the
 *  `@agent` addressed-reply loop) — where a current `chatId` exists to act on. Read the
 *  conversation's linked work + tie/untie tickets to THIS chat, so an agent asked to
 *  "link these tickets to the chat" actually can. Deliberately NOT part of
 *  CLOUD_AGENT_PLATFORM_TOOLS: an autonomous cloud run has no chat context, and the
 *  escalation/destructive members (dispatch_agent = start a run, invite_agent, consolidate
 *  = archive+merge chats) stay off — same restraint as excluding executions.submit. */
export const CHAT_SCOPED_AGENT_TOOLS: readonly string[] = [
  'chats.get_messages', 'chats.list_tickets', 'chats.link_ticket', 'chats.unlink_ticket',
  'chats.ticket_lineage', 'chats.list_agents',
];
