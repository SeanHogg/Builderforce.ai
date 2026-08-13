/**
 * What Brain may READ off a canvas object.
 *
 * ── WHY THIS IS NOT IN `creationObjectRegistry.ts` ───────────────────────────────
 * The registry answers "what objects exist and what may be written to them". This
 * answers a different question — "what does the model get to see, and how much of it" —
 * and it is the question with the safety properties: a field absent from `CONTEXT_FIELDS`
 * is invisible to every model turn, and the per-field array and depth budgets are the
 * difference between a course arriving with its lessons and arriving with titled empty
 * modules. Splitting them also brought the registry back under the 800-line ratchet.
 *
 * ── THE DEFECT THE FIELD LIST EXISTS TO STOP ─────────────────────────────────────
 * `value`, `target`, `unit` and `trend` were authorable on a `kpi` and missing here, so
 * `creationObjectAiContext` stripped all four: Brain could author a KPI onto the board
 * and was then blind to what it said. Asked "is the runway KPI below target?" the model
 * saw a titled card with no value. Every spec vocabulary now folds its own field names in
 * via `specFieldNames()`, so for those kinds the read list and the write list are derived
 * from one declaration and cannot disagree.
 *
 * ── AND THE ONE EXCLUSION ────────────────────────────────────────────────────────
 * `specFieldNames()` omits `restricted` fields. That is the whole reason the flag exists:
 * a candidate's self-identified EEO data is collected because statutory reporting
 * requires it and is unlawful to use in an assessment, so it must never reach the model
 * that ranks the shortlist. Enforced once, here, rather than by every consumer.
 */

import type { CreationNodeData } from './types';
import { MAX_TABULAR_COLUMNS } from '@/lib/canvasTabularData';
import { DATA_ARCHITECTURE_FIELD_NAMES } from '@/lib/dataArchitectureObjects';
import { specFieldNames } from '@/lib/specObjects';

const CONTEXT_FIELDS = [
  'kind', 'title', 'subtitle', 'status', 'resourceId', 'model', 'role', 'focus',
  'fetchedAt', 'dateRange', 'projectLens', 'columns', 'rowCount', 'sampleRows', 'profile', 'highlightRules', 'sourceDatasetId',
  // ── Data architecture ────────────────────────────────────────────────────
  // The model, its verdict, and its generated DDL. Brain must be able to READ a
  // model it did not author this turn — otherwise "add an invoices table to that
  // ERD" starts from nothing and silently replaces the diagram on the board.
  'dataModel', 'dialect', 'issues', 'ddl', 'mermaid', 'notes',
  // Governance and quality: the tags, the declared shape, and the last verdict.
  // `violations` and `results` are the evidence behind a red card — without them
  // "why is this failing" is unanswerable from the snapshot.
  'classifications', 'dataContract', 'violations', 'checks', 'results', 'score',
  // Lineage: WHERE a number came from and HOW. `producedAt` next to a source's
  // `fetchedAt` is what makes "this chart predates its data" visible at all.
  'lineage', 'producedAt', 'lineageNodes', 'lineageEdges', 'staleDerivatives', 'focusObjectId',
  // The semantic layer, and the id a chart or KPI quotes it by.
  'definition', 'sourceObjectId', 'metricId',
  // A live data source: what it is bound to and what its schema looks like.
  'connectionId', 'sql', 'tables', 'relationships', 'scanned', 'sourceUri',
  'fileName', 'mimeType', 'fileSize', 'chartType', 'chartTitle', 'xAxisLabel', 'yAxisLabel', 'chartLabels', 'chartValues', 'widgets',
  // `mapOutline` is deliberately absent: a boundary polygon is thousands of coordinate
  // pairs, and the snapshot is the model's context budget. Brain needs to know WHAT is
  // plotted, not the shape of the coastline behind it.
  'mapPoints', 'mapTitle', 'mapValueLabel', 'mapRegion', 'mapRegionName', 'mapAttribution',
  'projects', 'sources', 'items', 'summary', 'participants', 'evermindVersion',
  'contributions', 'inferenceEnabled', 'teacherModel', 'viewport', 'content', 'markdown',
  'steps', 'websiteHeadline', 'websiteBody', 'websiteCta', 'websiteTheme', 'activeWebsitePageId', 'pages', 'kpis', 'verdict',
  'modality', 'template', 'ideProjectId', 'storageProjectId', 'fileCount', 'previewUrl',
  'gaps', 'recommendations', 'milestones', 'code', 'language', 'path', 'url', 'branch',
  'diagnostics', 'findings', 'checks', 'results', 'result', 'nextSteps', 'actions', 'remediation',
  'mediaKind', 'capabilityId', 'provider', 'templateId', 'templateCategory', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'duration', 'pages', 'units', 'mcpServer', 'mcpTool', 'resumeFamily',
  'diagramFormat',
  // A framed page is opaque to everything else on the board; the title and text
  // the panel read off it are what let Brain reason about the page a user is
  // looking at rather than only knowing its address.
  'pageTitle', 'frameable',
  'instructions', 'parameters', 'assignee', 'agentName', 'agentRef', 'priority', 'acceptanceCriteria', 'taskKey',
  'criteria', 'testPrompt', 'testExpected', 'testResponse', 'testStatus', 'testResults', 'passRate', 'runCount', 'lastRunAt',
  'prdTitle', 'prdStatus', 'prdSummary', 'prdCount', 'requirements',
  'userStories', 'responsibilities', 'tools', 'autonomy', 'transcript', 'stages',
  'approvalMode', 'runTarget', 'deliveryProjectRef', 'deliveryProjectName', 'mockupAgentRef', 'mockupAgentName',
  'qualityScore', 'qualityLabel', 'qualityHeadline', 'diagnosticCount', 'gapCount', 'qualityUpdatedAt',
  'ownerUserId', 'contactId', 'campaignId', 'email', 'company', 'market', 'stage', 'lastTouchAt',
  'pipelineCounts', 'subject', 'sent', 'replies', 'scheduledAt', 'segments', 'channels',
  'outreachTarget', 'contactsTarget', 'meetingsTarget', 'progress', 'durationMinutes', 'attendees', 'meetingUrl',
  'revenueGoalCents', 'referralLink', 'salesLink',
  // A pitch object's substance IS its arrays — Brain cannot strengthen a weak
  // criterion or tighten an over-length answer it was never shown.
  'competitionId', 'beats', 'questions', 'answers', 'eligibility', 'category',
  // A mailbox object's substance IS the messages and the filter that produced
  // them — Brain cannot triage an inbox, or say why a message matters, from a
  // title alone. `bodyText` is already excerpt-length by the time it gets here
  // (the service truncates on read) and `safeContextValue` caps it again.
  'connectionId', 'accountEmail', 'provider', 'filter', 'messages', 'unreadCount', 'fetchedAt',
  'messageId', 'from', 'fromName', 'to', 'receivedAt', 'bodyText', 'unread', 'hasAttachments', 'webUrl',
  // Campaign counters are what "how did that send do?" is answered from; the
  // body is deliberately absent — it is KB of table markup, and the model edits
  // it through the template tools rather than reading it out of the snapshot.
  'audienceId', 'audienceName', 'transport', 'recipients', 'failed', 'opened', 'clicked', 'blockers',
  'mergeFields', 'assetId', 'logoUrl',
  // A social object's substance IS the posts and their engagement — Brain cannot say
  // which message worked, or write the next one, from a title alone. `posts` carries
  // the compact projection (no media bytes), and `safeContextValue` caps it again.
  'posts', 'accounts', 'networks', 'engagement', 'topPost', 'postCount',
  'network', 'accountName', 'authorName', 'text', 'permalink', 'publishedAt', 'metrics',
  'body', 'linkUrl', 'mediaUrls', 'variants', 'targets', 'publishedCount', 'failedCount',
  'course', 'exportStandards', 'tour',
  // A practice set's substance IS its questions and how they have been going —
  // Brain cannot say "you keep missing the ones about photosynthesis" from a
  // title. `attempts` is read-only context here: the model may reason about the
  // record, and MUTABLE_FIELDS never lets it write one.
  'practiceMode', 'attempts', 'subject', 'sourceObjectId',
  /**
   * A KPI's NUMBER. `value`, `target`, `unit` and `trend` were in `MUTABLE_FIELDS.kpi`
   * and missing from this list, so `creationObjectAiContext` stripped all four: Brain
   * could author a KPI onto the board and was then blind to what it said. Asked "is the
   * runway KPI on this canvas below target?" the model saw a titled card with no value
   * and had to either say it could not tell or answer from the conversation.
   *
   * The founder objects reuse this exact vocabulary for `metric`, which is why the drift
   * surfaced — and why the fix belongs here rather than in a founder-only branch.
   */
  'value', 'target', 'unit', 'trend',
  /**
   * The QA vocabulary.
   *
   * A test object whose STEPS Brain cannot read is a test Brain cannot extend, and
   * "add a case for the checkout" would start from nothing and silently replace the
   * suite — the same defect the ERD note above records. The derived halves
   * (`gateVerdict`, `passRate`) are readable and NOT authorable: the model must be
   * able to say "the gate is failing on open defects" and must never be able to
   * assert that it passed.
   */
  'targetUrl', 'routes', 'exitCriteria', 'signOffs', 'gateVerdict', 'caseCount', 'passRate',
  'spec', 'priority', 'intent', 'caseId', 'lastStatus', 'route',
  'defectType', 'expected', 'actual', 'reproSteps', 'fingerprint', 'resolution', 'evidenceUrl',
  'startedAt', 'finishedAt', 'browser', 'commitSha', 'explorationId', 'planObjectId',
  // The page audit, on the `diagnostics` object it lands on.
  'auditFindings', 'auditScore', 'auditPassed', 'auditTarget',
  // Which edge each generated fixture row exercises.
  'fixtureCases',
  /**
   * A sheet's formulas, and a role's cost.
   *
   * `formulas` was authorable and unreadable — the exact drift this list's header
   * describes, and worse than the `kpi.value` case it records, because "change the
   * growth assumption" requires READING the expression that is there before replacing
   * it. Without this the model could only ever overwrite a model it could not see.
   * (`rows` stays out deliberately: the snapshot carries `sampleRows` instead, because
   * a full sheet would crowd out everything else on the board.)
   *
   * The role fields are the finance half of headcount — salary, fully-loaded cost, start
   * date and level. `headcountPlan` rolls these up, so they are held once on the role and
   * read from there rather than copied into the plan and allowed to drift.
   */
  'formulas', 'salary', 'loadedCost', 'startAt', 'level', 'team', 'headcountStatus',
  ...DATA_ARCHITECTURE_FIELD_NAMES,
  /**
   * Every field name any registered spec vocabulary declares — founder, academic,
   * hiring, people and the cross-domain kinds today,
   * and whatever registers next without another edit here.
   *
   * `specFieldNames()` deliberately includes `derived` fields: Brain must be able to
   * READ a mark, an integrity ledger and a coverage gap to answer "who is struggling"
   * or "which outcome has no evidence". It can never WRITE one, because
   * `specMutableFields` omits them. The read list and the write list are different
   * lists on purpose — that is the entire point of the derived flag.
   */
  ...specFieldNames(),
] as const;
const SENSITIVE_CONTEXT_KEY = /(?:secret|token|password|credential|authorization|api.?key|cookie)/i;

/**
 * Fields that must NEVER reach the AI snapshot, whichever vocabulary declares them.
 *
 * ── WHY THIS IS A DENY-LIST AND NOT A COMMENT ────────────────────────────────────
 * `CONTEXT_FIELDS` is assembled from a hand-written list plus four DERIVED spreads
 * (`FOUNDER_FIELD_NAMES`, `DATA_ARCHITECTURE_FIELD_NAMES`, `specFieldNames()`, …). The
 * hand-written half carries a comment saying `rows` stays out deliberately — the
 * snapshot carries `sampleRows` instead, because a full sheet crowds out everything
 * else on the board and because those rows are the user's actual data.
 *
 * A comment cannot enforce that against a spread. `datasource` declares `rows` among
 * its authorable fields (correctly — an import writes them), that name flows through
 * the derived spread, and the whole sheet lands back in the prompt with the deliberate
 * exclusion silently reversed. Caught by `creationObjectRegistry.test.ts`, whose
 * fixture row is labelled "secret request" for exactly this reason.
 *
 * So the rule lives here, once, applied to the assembled list — a vocabulary may
 * declare whatever its objects need, and the snapshot boundary is enforced centrally.
 */
const NEVER_IN_CONTEXT: ReadonlySet<string> = new Set([
  // The user's data. `sampleRows` (bounded to 8) is the snapshot's window onto it.
  'rows',
  // The raw generation prompt: long, and never what a reader is asking about.
  'prompt',
]);

const DEFAULT_CONTEXT_ARRAY_LIMIT = 25;
/**
 * Per-field array budgets. A wide operational export must not have the column
 * a user is asking about silently truncated away, while row samples stay small
 * because Brain reads real numbers through canvas_query_dataset instead of
 * counting sampled rows by hand.
 */
const CONTEXT_ARRAY_LIMITS: Readonly<Partial<Record<string, number>>> = {
  columns: MAX_TABULAR_COLUMNS,
  profile: MAX_TABULAR_COLUMNS,
  highlightRules: 20,
  sampleRows: 8,
  // Enough for Brain to name what is on the map and answer "which one is highest"
  // without carrying every coordinate of a 500-point plot into the prompt.
  mapPoints: 12,
  resumeFamily: 10,
  // Enough attempts for a trend ("the last five were right") without carrying a
  // whole study log into every prompt.
  attempts: 20,
  // A model's substance IS its columns. Truncating an ERD's attributes at the
  // default 25 is how "add a foreign key to orders" ends up targeting a column
  // the model was never shown, so these get the wide-table budget.
  classifications: MAX_TABULAR_COLUMNS,
  checks: 60,
  results: 60,
  violations: 60,
  tables: 60,
  relationships: 60,
  lineageNodes: 40,
  lineageEdges: 60,
  // A plan is the steps. Truncating a case at the default 25 is how "tighten the
  // checkout test" ends up rewriting a scenario the model was shown half of — and
  // MAX_QA_STEPS is 80, so this is the real ceiling rather than a guess.
  steps: 80,
  reproSteps: 80,
  routes: 60,
  auditFindings: 40,
  fixtureCases: 20,
  /**
   * The academic budgets.
   *
   * A cohort is the case that forces this: at the default of 25, Brain asked "who has
   * not submitted?" about a class of 180 would be shown the first 25 names and would
   * answer confidently about the wrong seven people. A roster is the one field on the
   * canvas where truncation produces a fluent, specific, wrong answer about a real
   * person, so it gets the largest budget on the board.
   */
  roster: 250,
  entries: 200,
  included: 100,
  screening: 20,
  demographics: 40,
  slots: 60,
  comments: 100,
  outcomes: 60,
  markBreakdown: 40,
  integrity: 8,
  variables: 40,
  workPackages: 40,
  budget: 40,
  measures: 40,
  procedure: 60,
  derivation: 40,
};
const DEFAULT_CONTEXT_DEPTH_LIMIT = 3;
/**
 * Per-field nesting budgets, for the same reason {@link CONTEXT_ARRAY_LIMITS}
 * exists: three levels is the right default for the snapshot, and wrong for the
 * one field that is legitimately deeper.
 *
 * A `course` nests `course → modules[] → module → lessons[] → lesson`, so at the
 * default the lesson objects were dropped and Brain was handed a course whose
 * modules had titles and nothing else. That is fatal to the thing a Course is
 * FOR: a teacher agent asked to work through the material one step at a time,
 * check understanding, and mark progress could not read a single lesson or
 * assessment off the board, so it re-invented the curriculum instead of teaching
 * the one the learner was looking at.
 */
const CONTEXT_DEPTH_LIMITS: Readonly<Partial<Record<string, number>>> = {
  course: 5,
  tour: 5,
  resumeFamily: 6,
  // `dataModel → entities[] → entity → attributes[] → attribute → references` is
  // six levels. At the default of three, Brain is handed entities with names and
  // no columns — the same defect the `course` note above records, and fatal to
  // the thing an ERD is FOR: amending a model that is already on the board.
  dataModel: 6,
  // `lineage → transform → query → filter[] → filter` — the stored transform is
  // the whole point of lineage, so it must survive the trip into the snapshot.
  lineage: 6,
  // A metric's substance is its aggregate and filters, one level down each.
  definition: 5,
  dataContract: 5,
  /**
   * The `matrix` fields — `criteria → rows[] → row → cells[] → cell` is four levels,
   * so at the default of three the DESCRIPTORS are dropped and Brain is handed a rubric
   * whose criteria have names and no standards. That is the same defect the `course`
   * note above records, and it is fatal to the thing a rubric is FOR: marking against
   * a published standard, and explaining to a student why they got what they got.
   */
  criteria: 5,
  mapping: 5,
  marks: 5,
};

function safeContextValue(
  value: unknown,
  depth = 0,
  arrayLimit = DEFAULT_CONTEXT_ARRAY_LIMIT,
  depthLimit = DEFAULT_CONTEXT_DEPTH_LIMIT,
): unknown {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 2_000);
  if (depth >= depthLimit) return undefined;
  // Nested arrays keep the DEFAULT budget rather than inheriting the top-level
  // field's — a wide `columns` list does not license 64 nested rows underneath it.
  if (Array.isArray(value)) return value.slice(0, arrayLimit).map((item) => safeContextValue(item, depth + 1, DEFAULT_CONTEXT_ARRAY_LIMIT, depthLimit)).filter((item) => item !== undefined);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, MAX_TABULAR_COLUMNS).flatMap(([key, item]) => {
      if (SENSITIVE_CONTEXT_KEY.test(key)) return [];
      const safe = safeContextValue(item, depth + 1, DEFAULT_CONTEXT_ARRAY_LIMIT, depthLimit);
      return safe === undefined ? [] : [[key, safe]];
    }));
  }
  return undefined;
}

export function creationObjectAiContext(data: CreationNodeData): Record<string, unknown> {
  return Object.fromEntries(CONTEXT_FIELDS.flatMap((field) => {
    // The snapshot boundary, enforced once — see NEVER_IN_CONTEXT.
    if (NEVER_IN_CONTEXT.has(field)) return [];
    const value = safeContextValue(
      data[field],
      0,
      CONTEXT_ARRAY_LIMITS[field] ?? DEFAULT_CONTEXT_ARRAY_LIMIT,
      CONTEXT_DEPTH_LIMITS[field] ?? DEFAULT_CONTEXT_DEPTH_LIMIT,
    );
    return value === undefined ? [] : [[field, value]];
  }));
}
