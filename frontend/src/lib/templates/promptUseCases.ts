/**
 * The prompt starting points, as DATA.
 *
 * Extracted out of `PromptUseCasePicker` so the catalogue merge
 * (`lib/templates/catalog.ts`) can read them without importing a React
 * component — and so the picker becomes what it should have been: a renderer
 * over the one catalogue, owning no catalogue of its own.
 *
 * The 48 localized starting points live in the message catalogs under
 * `promptUseCases.items`; this file holds the 48 executive intents, whose
 * prompts carry an execution contract and are therefore not translatable copy.
 */

export type PromptUseCase = { id?: string; category: string; label: string; prompt: string; categoryLabel?: string };

/** Explicit extraction owners: source screens become existing Canvas objects
 * backed by existing domain APIs. This is also the table-need decision—none of
 * these families requires a new persistence shape. */
export const C_SUITE_CANVAS_OWNERS = {
  executiveDelivery: { stages: ['make', 'measure'], domains: ['delivery'], objects: ['dashboard', 'chart', 'report', 'table', 'roadmap'] },
  executiveRevenue: { stages: ['run', 'measure'], domains: ['revenue'], objects: ['salesPipeline', 'dashboard', 'table', 'chart', 'kpi'] },
  executiveOverview: { stages: ['measure'], domains: ['delivery', 'revenue', 'finance', 'governance', 'people'], objects: ['dashboard', 'report'] },
  executiveFinance: { stages: ['run', 'measure'], domains: ['finance'], objects: ['kpi', 'dashboard', 'table', 'chart', 'report'] },
  executiveGovernance: { stages: ['run'], domains: ['governance'], objects: ['table', 'report', 'dashboard', 'roadmap'] },
  executiveInvestor: { stages: ['idea', 'run'], domains: ['investor'], objects: ['targetMarket', 'report', 'dataset'] },
  executiveMarketing: { stages: ['run', 'measure'], domains: ['growth'], objects: ['table', 'dashboard', 'report', 'chart', 'evaluation'] },
  executivePeople: { stages: ['run'], domains: ['people'], objects: ['dashboard', 'roadmap', 'chart', 'spreadsheet', 'report'] },
  executiveProduct: { stages: ['idea', 'make'], domains: ['investor', 'delivery', 'canvas'], objects: ['table', 'featureSummary', 'report', 'targetMarket', 'dashboard'] },
  executiveResearch: { stages: ['idea'], domains: ['canvas'], objects: ['dataset', 'report', 'document', 'slides'] },
  // -- THE ONE CATEGORY THAT IS NOT AN EXECUTIVE ------------------------------
  // Every entry above addresses somebody with a company: a sprint, a pipeline, a
  // control register. The visitor this product acquires most of is a person looking
  // for work, and until the career object kinds existed there was nothing on the
  // canvas for a starting point here to produce. `objects` names those kinds because
  // that is what the execution contract permits the turn to create -- a career intent
  // that could only author a `document` would be exactly the prose-in-a-document
  // failure the whole vocabulary was written to end.
  personalCareer: { stages: ['idea', 'run', 'measure'], domains: ['canvas'], objects: ['job', 'jobApplication', 'applicationPipeline', 'coverLetter', 'interviewPrep', 'runway', 'resume'] },
} as const;

export function cSuiteCanvasOwner(useCase: PromptUseCase) {
  return C_SUITE_CANVAS_OWNERS[useCase.category as keyof typeof C_SUITE_CANVAS_OWNERS] ?? null;
}

export type ExecutiveCanvasWorkflow = {
  evidence: 'domain' | 'canvas' | 'web';
  operation: 'summarize' | 'analyze' | 'upsert' | 'update' | 'delete' | 'append' | 'rename' | 'research';
  /**
   * Tools that MUST have run before this use case may author its output.
   *
   * ── WHY A COMPLETION SENTENCE WAS NOT ENOUGH ───────────────────────────────
   * Every entry below states a `completion`, and for the domain-evidence intents that
   * is sufficient: the rows only exist behind a domain read, so a turn that skips the
   * tool has nothing to write and says so. The CANVAS-evidence intents have the
   * opposite property, and the career set is where it bites. A résumé and a job
   * posting are both already in the model's context, so "report the match score" is a
   * sentence a language model can answer plausibly and unreproducibly — a number that
   * moves when you ask twice, which is the exact failure `careerToolCatalog.ts` was
   * written to end by making every reading a measurement over the documents.
   *
   * So the requirement is DATA on the workflow and enforced at the authoring boundary
   * rather than described in a prompt: the canvas refuses to create the use case's own
   * output kinds until the named tool has actually been called this turn, and the
   * refusal names the tool. A model that reasons its way to a score still cannot write
   * it onto a card.
   *
   * Empty/absent means the completion sentence governs alone, which is right for the
   * intents whose evidence cannot be fabricated.
   */
  requiredTools?: readonly string[];
  /** Terms used to select relevant entities from the owning domain's live
   * catalog. They are hints, not table names: unmatched terms fall back to the
   * domain summary, object registry and metrics instead of inventing schema. */
  entityTerms: readonly string[];
  outputs: readonly string[];
  completion: string;
  confirmTarget?: boolean;
};

const executiveWorkflow = (
  evidence: ExecutiveCanvasWorkflow['evidence'],
  operation: ExecutiveCanvasWorkflow['operation'],
  entityTerms: readonly string[],
  outputs: readonly string[],
  completion: string,
  confirmTarget = false,
): ExecutiveCanvasWorkflow => ({ evidence, operation, entityTerms, outputs, completion, ...(confirmTarget ? { confirmTarget: true } : {}) });

/**
 * The same workflow, with the tools its answer must be MEASURED by.
 *
 * A separate constructor rather than a ninth positional argument: `executiveWorkflow`
 * already takes six, the flag on the end is the one nobody reads correctly, and the
 * forty intents that need no tool must stay one short call. See
 * `ExecutiveCanvasWorkflow.requiredTools` for why the requirement exists at all.
 */
const measuredWorkflow = (
  evidence: ExecutiveCanvasWorkflow['evidence'],
  operation: ExecutiveCanvasWorkflow['operation'],
  entityTerms: readonly string[],
  outputs: readonly string[],
  completion: string,
  requiredTools: readonly string[],
): ExecutiveCanvasWorkflow => ({ evidence, operation, entityTerms, outputs, completion, requiredTools });

/** Execution contracts for the 48 extracted intents. The contract says what to
 * read, what existing Canvas kinds may constitute the result, and what must be
 * true before the turn is reported complete. */
export const C_SUITE_CANVAS_WORKFLOWS: Readonly<Record<string, ExecutiveCanvasWorkflow>> = {
  'agile.sprint.current': executiveWorkflow('domain', 'summarize', ['sprint', 'work_item', 'capacity'], ['dashboard', 'table'], 'A dated sprint view exists with goal, capacity, progress, blockers and evidence gaps.'),
  'agile.velocity.summary': executiveWorkflow('domain', 'analyze', ['sprint', 'velocity', 'work_item'], ['chart', 'report'], 'A period-labelled committed-versus-completed trend exists and every value is sourced.'),
  'agile.bottlenecks.list': executiveWorkflow('domain', 'analyze', ['bottleneck', 'work_item', 'task_time'], ['table', 'report'], 'Bottlenecks are ranked with impact, owner, evidence and next action.'),
  'agile.technical_debt.list': executiveWorkflow('domain', 'upsert', ['technical_debt', 'work_item', 'action_item'], ['table', 'roadmap'], 'A deduplicated debt register is connected to a remediation roadmap.'),
  'agile.deployments.recent': executiveWorkflow('domain', 'summarize', ['release', 'deployment', 'incident'], ['table', 'report'], 'Recent releases show environment, outcome, failures and recovery evidence.'),
  'crm.pipeline.summary': executiveWorkflow('domain', 'summarize', ['deal', 'pipeline', 'sales'], ['salesPipeline', 'dashboard'], 'The canonical pipeline is mirrored with stage value, count, weighted value and movement.'),
  'crm.deals.at_risk': executiveWorkflow('domain', 'analyze', ['deal', 'risk', 'activity'], ['table'], 'At-risk deals are ranked by value and cited risk evidence with owner and next action.'),
  'crm.conversion_rates.list': executiveWorkflow('domain', 'analyze', ['deal', 'conversion', 'pipeline'], ['chart', 'kpi'], 'The funnel states its period, denominators and sourced conversion values.'),
  'crm.quota.attainment': executiveWorkflow('domain', 'analyze', ['quota', 'goal', 'deal'], ['dashboard', 'kpi'], 'Target, actual, attainment, gap, period and owner are present without inferred figures.'),
  'cross.risks.aggregate': executiveWorkflow('domain', 'analyze', ['risk', 'incident', 'objective'], ['dashboard', 'report'], 'A cross-domain risk rollup cites every source and leaves unsupported scores blank.'),
  'finance.runway.snapshot': executiveWorkflow('domain', 'analyze', ['expense', 'ledger', 'revenue', 'kpi'], ['kpi', 'dashboard'], 'Runway carries an as-of date, balance, burn basis, revenue basis and explicit assumptions.'),
  'finance.transactions.summary': executiveWorkflow('domain', 'summarize', ['ledger', 'expense', 'invoice'], ['table', 'chart'], 'The requested period is grouped and totaled from canonical finance rows.'),
  'finance.forecast_scenarios.list': executiveWorkflow('domain', 'analyze', ['scenario', 'simulation', 'assumption'], ['table', 'chart'], 'Comparable scenarios preserve their horizon and assumptions and expose missing inputs.'),
  'finance.breakeven.list': executiveWorkflow('domain', 'analyze', ['break_even', 'scenario', 'pricing'], ['chart', 'report'], 'The break-even point and horizon are traceable to fixed and variable assumptions.'),
  'finance.arr_projections.list': executiveWorkflow('domain', 'analyze', ['arr', 'revenue', 'scenario', 'kpi'], ['chart', 'kpi'], 'ARR projections label period, scenario, growth basis and source evidence.'),
  'governance.soc_controls.list': executiveWorkflow('domain', 'summarize', ['control', 'evidence', 'soc'], ['table', 'report'], 'Controls are grouped by status with owner and evidence gap; absent data is explicit.'),
  'governance.security_incidents.list': executiveWorkflow('domain', 'summarize', ['incident', 'finding', 'risk'], ['table', 'dashboard'], 'Incidents include severity, status, age, owner and containment evidence.'),
  'governance.compliance_events.upcoming': executiveWorkflow('domain', 'summarize', ['compliance', 'event', 'control'], ['roadmap', 'table'], 'Upcoming and overdue obligations carry framework, due date, owner and status.'),
  'governance.snapshot': executiveWorkflow('domain', 'summarize', ['control', 'incident', 'vendor', 'training', 'evidence'], ['dashboard', 'report'], 'The snapshot separates measured coverage from missing governance evidence.'),
  'governance.vendors.list': executiveWorkflow('domain', 'summarize', ['vendor', 'subprocessor', 'connection'], ['table', 'report'], 'The register shows risk, DPA/review state, owner and open action where evidence exists.'),
  'investor.market.get': executiveWorkflow('domain', 'summarize', ['market', 'company', 'analysis'], ['targetMarket', 'report'], 'TAM, SAM, SOM, growth, assumptions and sources are represented without fabricated values.'),
  'investor.market.upsert_analysis': executiveWorkflow('domain', 'upsert', ['market', 'company', 'analysis'], ['targetMarket', 'report'], 'The selected market is updated in place and unchanged sourced fields are preserved.', true),
  'investor.market.add_peers': executiveWorkflow('web', 'append', ['company', 'peer', 'market'], ['dataset'], 'One sourced row is appended per researched peer without changing existing rows.'),
  'investor.market.update_peer': executiveWorkflow('web', 'update', ['company', 'peer', 'market'], ['dataset'], 'Only the confirmed peer row changes and each changed value has a source.', true),
  'investor.market.delete_peer': executiveWorkflow('canvas', 'delete', ['peer', 'dataset'], ['dataset'], 'Only the confirmed peer row is removed and every other row is preserved.', true),
  'marketing.heatmaps.list': executiveWorkflow('domain', 'summarize', ['heatmap', 'session', 'traffic'], ['table', 'dashboard'], 'Each page entry states path, sample, period, click concentration and scroll depth.'),
  'marketing.heatmaps.analyze': executiveWorkflow('domain', 'analyze', ['heatmap', 'session', 'experiment'], ['report', 'evaluation'], 'Findings distinguish observed evidence, confidence limits and proposed experiments.', true),
  'marketing.campaigns.list': executiveWorkflow('domain', 'summarize', ['campaign', 'message', 'audience'], ['table'], 'Campaigns show channel, audience, status, schedule, delivery, engagement and outcome.'),
  'marketing.channel_performance.summary': executiveWorkflow('domain', 'analyze', ['channel', 'campaign', 'conversion', 'spend'], ['dashboard', 'chart'], 'All channels use the same period and expose spend, reach, leads, conversion, revenue, CAC and return only where sourced.'),
  'marketing.ab_tests.list': executiveWorkflow('domain', 'summarize', ['experiment', 'ab_test', 'variant'], ['table', 'evaluation'], 'Experiments carry hypothesis, variants, sample, primary metric, state and supported conclusion.'),
  'ops.employees.summary': executiveWorkflow('domain', 'summarize', ['employee', 'department', 'employment'], ['dashboard', 'chart'], 'Only aggregate people data is shown, including headcount cuts, starts, departures and manager coverage.'),
  'ops.hiring_forecast.list': executiveWorkflow('domain', 'analyze', ['headcount', 'hiring', 'forecast'], ['roadmap', 'chart'], 'Planned head delta, cost, timing, department and status are traceable to source plans.'),
  'ops.headcount_plan.list': executiveWorkflow('domain', 'analyze', ['headcount', 'budget', 'department'], ['spreadsheet', 'dashboard'], 'Planned versus actual heads and budget are aligned by period and department.'),
  'ops.performance_reviews.summary': executiveWorkflow('domain', 'summarize', ['review', 'objective', 'performance'], ['dashboard', 'report'], 'The output is aggregate, period-labelled and omits unnecessary personal detail.'),
  'ops.one_on_ones.cadence': executiveWorkflow('domain', 'analyze', ['one_on_one', 'meeting', 'action_item'], ['report', 'dashboard'], 'Recent and overdue cadence is grouped by team/manager with sourced follow-up actions.'),
  'product.ideas.list': executiveWorkflow('domain', 'summarize', ['idea', 'feature', 'validation'], ['table', 'featureSummary'], 'Canonical ideas are deduplicated and grouped by status, priority and type.'),
  'product.ideas.get': executiveWorkflow('domain', 'summarize', ['idea', 'feature', 'validation', 'work_item'], ['featureSummary', 'report'], 'The selected idea brief connects problem, evidence, hypothesis, status and delivery work.', true),
  'product.company.snapshot': executiveWorkflow('domain', 'summarize', ['company', 'portfolio', 'market'], ['dashboard', 'report'], 'The selected company snapshot shows sourced stage, sector, headcount, ARR, valuation, market and priorities.', true),
  'product.company.list': executiveWorkflow('domain', 'summarize', ['company', 'portfolio'], ['table'], 'Companies are listed from canonical records with ownership state and last update.'),
  'product.company.update': executiveWorkflow('domain', 'update', ['company', 'portfolio', 'market'], ['targetMarket', 'report'], 'The selected company profile is updated in place; assumptions are marked and unchanged fields preserved.', true),
  'research.web_search': executiveWorkflow('web', 'research', [], ['dataset', 'report'], 'Search and fetched sources produce a row-level evidence dataset and a cited decision report.'),
  'scratchpad.read': executiveWorkflow('canvas', 'summarize', ['document', 'note'], ['document'], 'Working-note pages are represented in their existing title/order/content without loss.'),
  'scratchpad.add_page': executiveWorkflow('canvas', 'append', ['document'], ['document'], 'One fully authored page is appended to the selected notes document.', true),
  'scratchpad.append_to_page': executiveWorkflow('canvas', 'append', ['document'], ['document'], 'Requested markdown is appended to the confirmed page without replacing prior content.', true),
  'scratchpad.update_page': executiveWorkflow('canvas', 'update', ['document'], ['document'], 'Only the confirmed page content/title changes and other pages remain identical.', true),
  'scratchpad.rename_page': executiveWorkflow('canvas', 'rename', ['document'], ['document'], 'Only the confirmed page title changes; its content and sibling pages are preserved.', true),
  'scratchpad.set_title': executiveWorkflow('canvas', 'rename', ['document'], ['document'], 'Only the selected working-notes document title changes.', true),
  // -- Career -----------------------------------------------------------------
  // `evidence: 'canvas'` on every one of these, deliberately: a job search has no
  // owning DOMAIN to read -- the resume, the postings and the money are all on the
  // board or supplied in the turn -- and pointing them at `domain` evidence would make
  // each intent fail on a tenant that has no hiring data because it is one person.
  'career.runway.snapshot': measuredWorkflow('canvas', 'analyze', ['runway', 'savings', 'expenses'], ['runway'], 'The card leads with WEEKS, states its currency, and every figure it shows came from the person rather than an assumption.', ['builtin_hr_runway']),
  'career.job.assess': measuredWorkflow('canvas', 'analyze', ['job', 'posting', 'resume'], ['job'], 'The posting is on the board with its stated compensation, its requirements in the wording the posting used, a measured match score, and the missing skills named honestly.', ['builtin_recruiter_match_job']),
  'career.resume.tailor': measuredWorkflow('canvas', 'upsert', ['resume', 'job', 'tailor'], ['resume'], 'A NEW resume variant exists carrying `tailoredFor`, and every move it applied quotes the existing line it changed. No skill was added that the person did not confirm.', ['builtin_recruiter_tailor_resume']),
  'career.cover_letter.draft': measuredWorkflow('canvas', 'upsert', ['coverLetter', 'job', 'resume'], ['coverLetter'], 'The letter names the posting it answers, its opening sentence would break if the employer name were swapped, and every claim in the evidence rows has a proof beside it.', ['builtin_recruiter_match_job']),
  // NO required tool, deliberately: tracking an application records what the PERSON
  // did — where they sent it, which variant went, when to chase. There is no
  // measurement to fabricate, so a gate here would only stand between somebody and
  // writing down a fact about their own week.
  'career.application.track': executiveWorkflow('canvas', 'upsert', ['jobApplication', 'proposal', 'followUp'], ['jobApplication'], 'The application carries its stage, the resume variant that went, and a follow-up date. Nothing claims it was submitted unless it was.'),
  'career.pipeline.review': measuredWorkflow('canvas', 'analyze', ['applicationPipeline', 'jobApplication', 'proposal'], ['applicationPipeline'], 'The pipeline names ONE bottleneck -- volume, replies, or interview conversion -- with the rate behind it, and every count is derived from the applications rather than typed.', ['builtin_proposals_mine']),
  'career.interview.prepare': measuredWorkflow('canvas', 'upsert', ['interviewPrep', 'job', 'resume'], ['interviewPrep'], 'Every question carries the rubric it is scored against and the gap it targets, and the answer column is left for the person to write.', ['builtin_recruiter_interview_questions']),
  'career.offer.compare': measuredWorkflow('canvas', 'analyze', ['offer', 'runway', 'compensation'], ['jobApplication', 'runway'], 'Each offer is broken into components and compared in WEEKS OF RUNWAY, so a bigger number arriving after the balance hits zero is visibly worth less.', ['builtin_hr_compare_work_options']),
  'scratchpad.create_deck': executiveWorkflow('canvas', 'upsert', ['document', 'slides'], ['slides'], 'A fully authored ordered slide narrative exists rather than an empty deck shell.'),
};

export function cSuiteCanvasWorkflow(useCase: PromptUseCase): ExecutiveCanvasWorkflow | null {
  return useCase.id ? C_SUITE_CANVAS_WORKFLOWS[useCase.id] ?? null : null;
}

/**
 * The tools this use case's answer must be measured by, or an empty list.
 *
 * Read by BOTH the contract the preparation tool returns and the refusal at the
 * authoring boundary — one lookup, so a requirement cannot be advertised and not
 * enforced, or enforced and never advertised.
 */
export function executiveRequiredTools(useCase: PromptUseCase | null | undefined): readonly string[] {
  const workflow = useCase ? cSuiteCanvasWorkflow(useCase) : null;
  return workflow?.requiredTools ?? [];
}

/**
 * Which required tools have NOT run yet.
 *
 * Compared on the ADVERTISED name (`builtin_hr_runway`) because that is what the trace
 * carries and what the model must type — the same contract
 * [[prompt-tool-name-contract]] states for every prompt that names a tool. Matching is
 * suffix-tolerant on the namespace separator so a gateway that prefixes its own server
 * id does not silently make every requirement unsatisfiable: the failure mode of a
 * strict compare here is a turn that can never author anything, which is worse than a
 * turn that occasionally accepts a near-match.
 */
export function missingRequiredTools(
  required: readonly string[],
  called: Iterable<string>,
): readonly string[] {
  const ran = new Set<string>();
  for (const name of called) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) continue;
    ran.add(trimmed);
    // `server.builtin_hr_runway` and `builtin_hr_runway` are one call.
    const tail = trimmed.split(/[.:/]/).pop();
    if (tail) ran.add(tail);
  }
  return required.filter((tool) => !ran.has(tool));
}

export function executiveCanvasPrompt(useCase: PromptUseCase): string | null {
  const owner = cSuiteCanvasOwner(useCase);
  const workflow = cSuiteCanvasWorkflow(useCase);
  if (!owner || !workflow || !useCase.id) return null;
  return `${useCase.prompt}\n\nExecution contract ${useCase.id}: first call canvas_prepare_executive_use_case with useCaseId "${useCase.id}". Perform the ${workflow.operation} operation for the ${owner.stages.join(' → ')} stage of Builderforce's IDEA → REAL loop. Use only the returned evidence and create or update only these existing Canvas object kinds: ${workflow.outputs.join(', ')}. Completion means: ${workflow.completion}${workflow.confirmTarget ? ' Confirm the exact target before changing it.' : ''} Do not propose a new database table and do not report completion without a successful Canvas mutation.`;
}

/**
 * BurnRateOS' 48 executive "tools" were starting-point intents: each one asked
 * the assistant to assemble or amend a management view.  Creation Canvas already
 * owns the durable primitives for those views, so the migration maps every intent
 * to an existing Canvas object instead of adding parallel APIs, object kinds, or
 * database tables.  Keeping the legacy dotted id makes the migration auditable and
 * lets an operator find an item by its old contract name.
 */
export const C_SUITE_CANVAS_USE_CASES: readonly PromptUseCase[] = [
  { id: 'agile.sprint.current', category: 'executiveDelivery', categoryLabel: 'Delivery', label: 'Current sprint', prompt: 'Create a current-sprint dashboard from the available project and task evidence, showing the sprint goal, dates, capacity, progress, blockers, and open work. Do not invent missing values.' },
  { id: 'agile.velocity.summary', category: 'executiveDelivery', categoryLabel: 'Delivery', label: 'Velocity summary', prompt: 'Create a verified velocity chart and concise delivery report from the available sprint history, including committed versus completed work and trend.' },
  { id: 'agile.bottlenecks.list', category: 'executiveDelivery', categoryLabel: 'Delivery', label: 'Delivery bottlenecks', prompt: 'Create a prioritized bottleneck report and table from current delivery evidence, including severity, affected stage, impact, owner, and recommended next action.' },
  { id: 'agile.technical_debt.list', category: 'executiveDelivery', categoryLabel: 'Delivery', label: 'Technical debt', prompt: 'Create a technical-debt register from existing project work, grouped by priority and type, and connect it to a remediation roadmap. Do not create duplicate canonical tasks.' },
  { id: 'agile.deployments.recent', category: 'executiveDelivery', categoryLabel: 'Delivery', label: 'Recent deployments', prompt: 'Create a recent-deployments table and release-health summary from available project evidence, including environment, status, failures, and recovery time.' },

  { id: 'crm.pipeline.summary', category: 'executiveRevenue', categoryLabel: 'Revenue', label: 'Pipeline summary', prompt: 'Create or refresh a sales-pipeline object and executive dashboard using the canonical sales workspace, with stage value, deal count, weighted value, and movement.' },
  { id: 'crm.deals.at_risk', category: 'executiveRevenue', categoryLabel: 'Revenue', label: 'Deals at risk', prompt: 'Create a deals-at-risk table from the canonical sales workspace, ranked by value and risk evidence with owner and next action.' },
  { id: 'crm.conversion_rates.list', category: 'executiveRevenue', categoryLabel: 'Revenue', label: 'Conversion rates', prompt: 'Create a sales conversion funnel chart and KPI set from canonical pipeline evidence, labeling the period and calculation basis.' },
  { id: 'crm.quota.attainment', category: 'executiveRevenue', categoryLabel: 'Revenue', label: 'Quota attainment', prompt: 'Create a quota-attainment dashboard with target, actual, attainment percentage, gap, period, and owner using available canonical sales metrics.' },
  { id: 'cross.risks.aggregate', category: 'executiveOverview', categoryLabel: 'Executive overview', label: 'Enterprise risk rollup', prompt: 'Create an enterprise risk dashboard that consolidates delivery, revenue, finance, security, and people risks already available on the canvas or in connected project evidence. Cite each source and do not invent scores.' },

  { id: 'finance.runway.snapshot', category: 'executiveFinance', categoryLabel: 'Finance', label: 'Runway snapshot', prompt: 'Create a runway KPI and finance dashboard from available balances, burn, and revenue evidence, clearly showing the as-of date and assumptions.' },
  { id: 'finance.transactions.summary', category: 'executiveFinance', categoryLabel: 'Finance', label: 'Transaction summary', prompt: 'Create a transaction summary table and chart for the requested period from available finance data, grouped by account or category with totals.' },
  { id: 'finance.forecast_scenarios.list', category: 'executiveFinance', categoryLabel: 'Finance', label: 'Forecast scenarios', prompt: 'Create a scenario-comparison table and chart from available best-case, base-case, worst-case, and custom forecasts, preserving their assumptions.' },
  { id: 'finance.breakeven.list', category: 'executiveFinance', categoryLabel: 'Finance', label: 'Break-even analysis', prompt: 'Create a break-even chart and decision report from available scenario evidence, including fixed assumptions, variable assumptions, horizon, and break-even point.' },
  { id: 'finance.arr_projections.list', category: 'executiveFinance', categoryLabel: 'Finance', label: 'ARR projections', prompt: 'Create an ARR projection chart and KPI summary from available recurring-revenue metrics, with period, scenario, growth, and source evidence.' },

  { id: 'governance.soc_controls.list', category: 'executiveGovernance', categoryLabel: 'Governance', label: 'SOC controls', prompt: 'Create a SOC controls table and readiness report from available governance evidence, grouped by category and status with owners and evidence gaps.' },
  { id: 'governance.security_incidents.list', category: 'executiveGovernance', categoryLabel: 'Governance', label: 'Security incidents', prompt: 'Create a security-incident table and risk dashboard from available incident evidence, including severity, status, age, owner, and containment state.' },
  { id: 'governance.compliance_events.upcoming', category: 'executiveGovernance', categoryLabel: 'Governance', label: 'Upcoming compliance events', prompt: 'Create a compliance calendar roadmap and table from available governance events, including overdue items, framework, due date, owner, and status.' },
  { id: 'governance.snapshot', category: 'executiveGovernance', categoryLabel: 'Governance', label: 'Governance snapshot', prompt: 'Create an executive governance dashboard from available controls, incidents, compliance events, vendors, training, and evidence. Show coverage and gaps without inventing values.' },
  { id: 'governance.vendors.list', category: 'executiveGovernance', categoryLabel: 'Governance', label: 'Security vendors', prompt: 'Create a vendor and subprocessor register from available governance evidence, including risk, DPA status, review date, owner, and open actions.' },

  { id: 'investor.market.get', category: 'executiveInvestor', categoryLabel: 'Investor', label: 'Market analysis', prompt: 'Create a target-market object and investor report from the current company analysis, including industry, TAM, SAM, SOM, growth, assumptions, and sources.' },
  { id: 'investor.market.upsert_analysis', category: 'executiveInvestor', categoryLabel: 'Investor', label: 'Update market analysis', prompt: 'Create or update the selected target-market object with an authored industry, TAM, SAM, SOM, growth, assumptions, and cited source notes. Preserve fields that are not being changed.' },
  { id: 'investor.market.add_peers', category: 'executiveInvestor', categoryLabel: 'Investor', label: 'Add market peers', prompt: 'Add researched peer companies to the selected comparison dataset, with one sourced row per peer and comparable revenue, valuation, multiple, growth, stage, and notes where available.' },
  { id: 'investor.market.update_peer', category: 'executiveInvestor', categoryLabel: 'Investor', label: 'Update market peer', prompt: 'Update the identified peer row in the selected comparison dataset using sourced evidence. Preserve other peer rows and unchanged fields.' },
  { id: 'investor.market.delete_peer', category: 'executiveInvestor', categoryLabel: 'Investor', label: 'Remove market peer', prompt: 'Remove the specifically identified peer from the selected comparison dataset only after confirming the target row; leave every other row unchanged.' },

  { id: 'marketing.heatmaps.list', category: 'executiveMarketing', categoryLabel: 'Marketing', label: 'Page heatmaps', prompt: 'Create a page-heatmap inventory table and dashboard from available marketing evidence, including path, sample size, period, click concentration, and scroll depth.' },
  { id: 'marketing.heatmaps.analyze', category: 'executiveMarketing', categoryLabel: 'Marketing', label: 'Analyze heatmap', prompt: 'Create a heatmap analysis report for the identified page using available click and scroll evidence, with findings, confidence limits, and prioritized experiments.' },
  { id: 'marketing.campaigns.list', category: 'executiveMarketing', categoryLabel: 'Marketing', label: 'Marketing campaigns', prompt: 'Create a campaign portfolio table from available email and marketing campaign evidence, with channel, audience, status, schedule, delivery, engagement, and outcome.' },
  { id: 'marketing.channel_performance.summary', category: 'executiveMarketing', categoryLabel: 'Marketing', label: 'Channel performance', prompt: 'Create a channel-performance dashboard and chart from available metrics, comparing spend, reach, leads, conversion, revenue, CAC, and return for the same period.' },
  { id: 'marketing.ab_tests.list', category: 'executiveMarketing', categoryLabel: 'Marketing', label: 'A/B tests', prompt: 'Create an experiment register and evaluation view from available A/B tests, including hypothesis, variants, sample, primary metric, status, winner, and conclusion.' },

  { id: 'ops.employees.summary', category: 'executivePeople', categoryLabel: 'People', label: 'Employee summary', prompt: 'Create a people dashboard from available employee evidence, showing active headcount by department, employment type, location, manager coverage, starts, and departures.' },
  { id: 'ops.hiring_forecast.list', category: 'executivePeople', categoryLabel: 'People', label: 'Hiring forecast', prompt: 'Create a hiring forecast roadmap and chart from available headcount plans and hiring impacts, including timing, department, head delta, cost, and status.' },
  { id: 'ops.headcount_plan.list', category: 'executivePeople', categoryLabel: 'People', label: 'Headcount plan', prompt: 'Create a headcount planning spreadsheet and dashboard from available plans, comparing planned versus actual heads and budget by period and department.' },
  { id: 'ops.performance_reviews.summary', category: 'executivePeople', categoryLabel: 'People', label: 'Performance reviews', prompt: 'Create an aggregate performance-review dashboard from available objective outcomes, showing completion, rating distribution, periods, and overdue gaps without exposing unnecessary personal detail.' },
  { id: 'ops.one_on_ones.cadence', category: 'executivePeople', categoryLabel: 'People', label: 'One-on-one cadence', prompt: 'Create a one-on-one cadence report from available meeting evidence, showing recent and overdue conversations by team and manager with follow-up actions.' },

  { id: 'product.ideas.list', category: 'executiveProduct', categoryLabel: 'Product', label: 'Product ideas', prompt: 'Create a product-ideas table and feature summary from available product evidence, grouped by status, priority, and type without duplicating canonical ideas.' },
  { id: 'product.ideas.get', category: 'executiveProduct', categoryLabel: 'Product', label: 'Product idea brief', prompt: 'Create a decision-ready product idea brief for the identified idea using its problem, evidence, hypothesis, status, and linked delivery work.' },
  { id: 'product.company.snapshot', category: 'executiveProduct', categoryLabel: 'Product', label: 'Company snapshot', prompt: 'Create a company snapshot dashboard and report from available company evidence, including stage, sector, headcount, ARR, valuation, market, and current priorities.' },
  { id: 'product.company.list', category: 'executiveProduct', categoryLabel: 'Product', label: 'Company portfolio', prompt: 'Create a company portfolio table from available company records, with stage, sector, location, headcount, ARR, valuation, ownership status, and last update.' },
  { id: 'product.company.update', category: 'executiveProduct', categoryLabel: 'Product', label: 'Update company profile', prompt: 'Create or update the selected company profile as a target-market and company brief on the canvas. Preserve unchanged fields and clearly mark any assumption that lacks canonical evidence.' },

  { id: 'research.web_search', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Web research', prompt: 'Research the requested executive question from cited web sources, create a supporting dataset with one row per finding, and synthesize it into a decision report. Do not answer from memory.' },
  { id: 'scratchpad.read', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Open working notes', prompt: 'Create or open a document that consolidates the working notes already present on this canvas, preserving page titles, order, and content.' },
  { id: 'scratchpad.add_page', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Add notes page', prompt: 'Add a new, fully authored document page to the current executive working notes using the requested title and content.' },
  { id: 'scratchpad.append_to_page', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Append to notes page', prompt: 'Append the requested markdown to the identified document page without replacing or summarizing its existing content.' },
  { id: 'scratchpad.update_page', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Update notes page', prompt: 'Update the identified document page with the requested complete content and optional title, leaving other pages unchanged.' },
  { id: 'scratchpad.rename_page', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Rename notes page', prompt: 'Rename the identified document page and preserve all of its content and the rest of the working notes.' },
  { id: 'scratchpad.set_title', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Rename working notes', prompt: 'Update the title of the selected working-notes document without changing its pages or content.' },
  { id: 'career.runway.snapshot', category: 'personalCareer', categoryLabel: 'Career', label: 'How long does my money last?', prompt: 'Create a personal runway card from the savings, monthly outgoings and any income still arriving. Lead with the WEEKS, not the currency, and record the assumptions rather than hiding them. Ask for any figure you do not have instead of estimating it.' },
  { id: 'career.job.assess', category: 'personalCareer', categoryLabel: 'Career', label: 'Is this job worth applying for?', prompt: 'Create a job card for this posting: what it pays as ADVERTISED, its requirements in the wording the posting used, the measured match against the resume, and the skills it names that the resume does not evidence. Report the gaps honestly rather than talking the person into or out of it.' },
  { id: 'career.resume.tailor', category: 'personalCareer', categoryLabel: 'Career', label: 'Tailor my resume to this job', prompt: 'Build the tailoring plan for this resume against this posting and author the result as a NEW resume variant carrying tailoredFor, so the original survives. Quote every existing line you change. Never add a skill the person has not confirmed.' },
  { id: 'career.cover_letter.draft', category: 'personalCareer', categoryLabel: 'Career', label: 'Write a cover letter', prompt: 'Create a cover letter against this posting: an opening sentence that would break if the employer name were swapped, three short paragraphs, and an evidence table mapping each requirement to a specific thing the person actually did. Do not restate the resume.' },
  { id: 'career.application.track', category: 'personalCareer', categoryLabel: 'Career', label: 'Track this application', prompt: 'Create an application card for this posting with its stage, which resume variant went, how it was sent, and the date to follow up. Do not mark it submitted unless it has been sent.' },
  { id: 'career.pipeline.review', category: 'personalCareer', categoryLabel: 'Career', label: 'How is my job search going?', prompt: 'Create or refresh the application pipeline from the applications on this canvas and from builtin_proposals_mine, then name the ONE bottleneck with the rate behind it: not enough applications, applications not converting to replies, or interviews not converting to offers. Do not type any count the rows can compute.' },
  { id: 'career.interview.prepare', category: 'personalCareer', categoryLabel: 'Career', label: 'Prepare me for this interview', prompt: 'Create an interview prep card from what this posting actually emphasises: each question with why it is being asked and the rubric a strong answer must satisfy, plus the gaps between the resume and the posting that the hard questions will target. Leave the answer column empty for the person to write.' },
  { id: 'career.offer.compare', category: 'personalCareer', categoryLabel: 'Career', label: 'Should I take this offer?', prompt: 'Break each offer into its components on its application card, then compare the options in WEEKS OF RUNWAY against the runway card. The comparison people get wrong is the start date, not the rate: a bigger number arriving after the balance hits zero is worth less.' },

  { id: 'scratchpad.create_deck', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Create executive deck', prompt: 'Create a polished slides object from the supplied deck title and slide content, preserving the requested slide order and authoring a clear executive narrative.' },
];

/** Every executive use-case id, as a set — the closed value space the tool's
 *  `useCaseId` enum advertises. */
export const C_SUITE_USE_CASE_IDS: ReadonlySet<string> = new Set(
  C_SUITE_CANVAS_USE_CASES.map((item) => item.id!),
);

/** The marker `executiveCanvasPrompt` writes into a prompt, and the only place
 *  its shape is stated — so the writer and the reader cannot drift. */
export const EXECUTION_CONTRACT_MARKER = 'Execution contract ';

/**
 * The use case a REQUEST is running, read from the prompt itself.
 *
 * The prompt carries `Execution contract <id>:` because `executiveCanvasPrompt`
 * put it there when the entry was selected. That makes the canvas — not the
 * model — the authority on which contract is in flight, which is the property
 * the recovery below depends on.
 */
export function executiveUseCaseFromPrompt(text: string): PromptUseCase | null {
  return C_SUITE_CANVAS_USE_CASES.find(
    (candidate) => text.includes(`${EXECUTION_CONTRACT_MARKER}${candidate.id}:`),
  ) ?? null;
}

/**
 * The use-case id a TOOL CALL meant, resolved tolerantly.
 *
 * ── WHY THIS IS NOT JUST `args.useCaseId` ───────────────────────────────────
 * It was, and a real run died on it: the model emitted `{"useCas1eId":
 * "scratchpad.create_deck"}` — one transposed character in the KEY, the value
 * perfectly correct — so the lookup missed, the tool answered "Unknown
 * executive Canvas use case", and the whole turn ended having created nothing.
 * The contract was never in doubt; a typo in a parameter name was.
 *
 * Recovery is safe here for a reason that does not generalise: this tool takes
 * ONE meaningful argument and its value space is a CLOSED ENUM of 48 dotted
 * ids. So a value that IS one of those ids can only have been meant as the use
 * case, whatever key it arrived under — there is no second argument it could
 * have been intended for and no ambiguity to resolve wrongly. A tool with two
 * free-text arguments must never do this.
 *
 * `inFlightId` is the last line: when the args carry nothing recognisable at
 * all, the contract the PROMPT declared is used, because the canvas put it
 * there and knows it independently of anything the model typed.
 */
export function resolveExecutiveUseCaseId(
  args: unknown,
  inFlightId?: string | null,
): string | null {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    const exact = record.useCaseId;
    if (typeof exact === 'string' && C_SUITE_USE_CASE_IDS.has(exact)) return exact;
    for (const value of Object.values(record)) {
      if (typeof value === 'string' && C_SUITE_USE_CASE_IDS.has(value)) return value;
    }
  }
  return inFlightId && C_SUITE_USE_CASE_IDS.has(inFlightId) ? inFlightId : null;
}
