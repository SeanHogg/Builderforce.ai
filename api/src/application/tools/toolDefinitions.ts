/**
 * The free Diagnostics & Tools registry. Each entry is data + a pure
 * compute/score function. Add a tool here and it is instantly listable,
 * runnable (public compute), and savable (account) with no new page — the
 * generic runner renders it. See toolTypes.ts for the contract.
 */
import {
  type Tool,
  type CalculatorTool,
  type QuestionnaireTool,
  type QuizTool,
  type ToolResult,
  scoreQuestionnaire,
  scoreQuiz,
} from './toolTypes';

const TIER_NAME = ['Low', 'Low', 'Medium', 'High', 'Elite'];
const tierName = (t: number): string => TIER_NAME[Math.max(1, Math.min(5, Math.round(t))) - 1]!;
const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

// ─────────────────────────────────────────────────────────────────────────────
// DORA Quick-Check (calculator)
// ─────────────────────────────────────────────────────────────────────────────

const doraQuickCheck: CalculatorTool = {
  id: 'dora-quickcheck',
  name: 'DORA Quick-Check',
  tagline: 'Rate your delivery on the DORA four keys in 30 seconds.',
  icon: '🚀',
  category: 'delivery',
  kind: 'calculator',
  about:
    'The four DORA metrics — deployment frequency, lead time for changes, change-failure rate, and time to restore — are the industry-standard measure of software delivery performance. Enter rough numbers to see your performance tier and what to improve first. Sign in to score this automatically from your real deployment data.',
  inputs: [
    { id: 'deploysPerWeek', label: 'Deployments to production per week', type: 'number', min: 0, step: 0.5, default: 2 },
    { id: 'leadTimeHours', label: 'Lead time for a change (commit → production)', type: 'number', unit: 'hours', min: 0, step: 1, default: 48 },
    { id: 'changeFailurePct', label: 'Change-failure rate', type: 'number', unit: '%', min: 0, max: 100, step: 1, default: 15 },
    { id: 'mttrHours', label: 'Time to restore service after a failed change', type: 'number', unit: 'hours', min: 0, step: 1, default: 8 },
  ],
  compute: (v): ToolResult => {
    const freqTier = v.deploysPerWeek! >= 7 ? 5 : v.deploysPerWeek! >= 1 ? 4 : v.deploysPerWeek! >= 0.25 ? 3 : 2;
    const leadTier = v.leadTimeHours! <= 24 ? 5 : v.leadTimeHours! <= 168 ? 4 : v.leadTimeHours! <= 730 ? 3 : 2;
    const cfrTier = v.changeFailurePct! <= 5 ? 5 : v.changeFailurePct! <= 15 ? 4 : v.changeFailurePct! <= 30 ? 3 : 2;
    const mttrTier = v.mttrHours! <= 1 ? 5 : v.mttrHours! <= 24 ? 4 : v.mttrHours! <= 168 ? 3 : 2;
    const overall = Math.round((freqTier + leadTier + cfrTier + mttrTier) / 4);

    const recs: ToolResult['recommendations'] = [];
    if (freqTier < 4) recs.push({ title: 'Deploy more often', detail: 'Shrink batch sizes and automate the release pipeline so deploys are routine, not events. Aim for at least weekly, then daily.' });
    if (leadTier < 4) recs.push({ title: 'Cut lead time', detail: 'Reduce hand-offs and manual gates between commit and production. Trunk-based development and CI on every change are the biggest levers.' });
    if (cfrTier < 4) recs.push({ title: 'Lower change-failure rate', detail: 'Add automated tests and progressive delivery (canary / feature flags) so risky changes are caught or contained before full rollout.' });
    if (mttrTier < 4) recs.push({ title: 'Restore faster', detail: 'Invest in alerting, one-click rollback, and runbooks so a failed change is reverted in minutes, not hours.' });
    if (recs.length === 0) recs.push({ title: 'Sustain elite performance', detail: 'Keep the four keys under continuous review and protect them as you scale — elite teams optimize, they do not coast.' });

    return {
      headline: `${tierName(overall)} performer`,
      summary: 'Your overall DORA performance tier across the four keys.',
      score: overall,
      scoreLabel: tierName(overall),
      metrics: [
        { label: 'Deployment frequency', value: `${v.deploysPerWeek}/week`, hint: tierName(freqTier), tier: freqTier },
        { label: 'Lead time for changes', value: `${v.leadTimeHours}h`, hint: tierName(leadTier), tier: leadTier },
        { label: 'Change-failure rate', value: `${v.changeFailurePct}%`, hint: tierName(cfrTier), tier: cfrTier },
        { label: 'Time to restore', value: `${v.mttrHours}h`, hint: tierName(mttrTier), tier: mttrTier },
      ],
      recommendations: recs,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// AI Cost / FinOps Estimator (calculator)
// ─────────────────────────────────────────────────────────────────────────────

const PRICE_PER_MTOK = [9, 2, 0.3]; // frontier, mid, budget/local — blended $/1M tokens

const aiCostEstimator: CalculatorTool = {
  id: 'ai-cost-estimator',
  name: 'AI Cost Estimator',
  tagline: 'Project your monthly agentic-AI spend — and what caching saves.',
  icon: '💰',
  category: 'finops',
  kind: 'calculator',
  about:
    'Estimate what an AI agent workforce costs per month based on team size, task volume, token usage, and model tier — and see how much a semantic cache saves. Sign in to replace the estimate with your real, attributed spend (cost per task, per project, per merged PR).',
  inputs: [
    { id: 'developers', label: 'People using agents', type: 'number', min: 1, step: 1, default: 10 },
    { id: 'tasksPerWeek', label: 'AI tasks per person per week', type: 'number', min: 0, step: 1, default: 10 },
    { id: 'avgTokensPerTask', label: 'Avg tokens per task (in + out)', type: 'number', unit: 'tokens', min: 0, step: 1000, default: 40000 },
    { id: 'modelTier', label: 'Model tier', type: 'select', default: 0, options: [
      { value: 0, label: 'Frontier (e.g. Opus / GPT-class)' },
      { value: 1, label: 'Mid (e.g. Sonnet / mid-tier)' },
      { value: 2, label: 'Budget / local' },
    ] },
    { id: 'cacheHitPct', label: 'Expected semantic-cache hit rate', type: 'number', unit: '%', min: 0, max: 95, step: 5, default: 30 },
  ],
  compute: (v): ToolResult => {
    const price = PRICE_PER_MTOK[Math.max(0, Math.min(2, Math.round(v.modelTier!)))]!;
    const tasksPerMonth = v.developers! * v.tasksPerWeek! * 4.33;
    const grossTokens = tasksPerMonth * v.avgTokensPerTask!;
    const cacheHit = Math.max(0, Math.min(95, v.cacheHitPct!)) / 100;
    const effectiveTokens = grossTokens * (1 - cacheHit);
    const grossCost = (grossTokens / 1_000_000) * price;
    const netCost = (effectiveTokens / 1_000_000) * price;
    const savings = grossCost - netCost;
    const costPerTask = tasksPerMonth > 0 ? netCost / tasksPerMonth : 0;

    const recs: ToolResult['recommendations'] = [];
    if (cacheHit < 0.4) recs.push({ title: 'Raise your cache hit rate', detail: 'A cross-surface semantic cache reuses prior answers for paraphrased prompts. Pushing the hit rate toward 40–60% directly cuts spend with no quality loss.' });
    if (v.modelTier === 0) recs.push({ title: 'Route routine work to cheaper models', detail: 'Reserve frontier models for hard tasks and route routine work to mid/budget tiers. Learned routing picks the cheapest model that still ships.' });
    recs.push({ title: 'Attribute and budget', detail: 'Attribute every token to a task, project, and initiative, then set a budget with overspend alerts so cost is managed, not discovered on the invoice.' });
    recs.push({ title: 'Track cost per outcome', detail: 'Measure cost per merged pull request, not just per token — the cheapest model that fails twice is more expensive than the right one.' });

    return {
      headline: `${money(netCost)} / month`,
      summary: `Estimated agentic-AI spend for ${Math.round(tasksPerMonth).toLocaleString('en-US')} tasks/month at the ${['frontier', 'mid', 'budget'][Math.round(v.modelTier!)]} tier.`,
      metrics: [
        { label: 'Tasks per month', value: Math.round(tasksPerMonth).toLocaleString('en-US') },
        { label: 'Tokens per month', value: `${(grossTokens / 1_000_000).toFixed(1)}M` },
        { label: 'Estimated monthly cost', value: money(netCost) },
        { label: 'Saved by caching', value: `${money(savings)} (${Math.round(cacheHit * 100)}%)` },
        { label: 'Cost per task', value: `$${costPerTask.toFixed(2)}` },
      ],
      recommendations: recs,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// COBIT Governance Readiness (questionnaire)
// ─────────────────────────────────────────────────────────────────────────────

const cobitGovernance: QuestionnaireTool = {
  id: 'cobit-governance',
  name: 'COBIT Governance Readiness',
  tagline: 'Rate your IT governance against COBIT’s core objectives.',
  icon: '🏛️',
  category: 'governance',
  kind: 'questionnaire',
  about:
    'A COBIT-flavored assessment of how well your organization governs and manages IT: evaluate-direct-monitor, risk, resourcing, performance, and compliance. Rate each statement 1 (never) to 5 (optimized) for a maturity level and a prioritized improvement plan.',
  scale: [
    { value: 1, label: 'Initial' }, { value: 2, label: 'Managed' }, { value: 3, label: 'Defined' },
    { value: 4, label: 'Quantified' }, { value: 5, label: 'Optimizing' },
  ],
  sections: [
    {
      key: 'edm', name: 'Govern (Evaluate, Direct, Monitor)', description: 'Governance framework, decision rights, and oversight.',
      questions: [
        { id: 'edm1', text: 'There is a clear governance framework with defined decision rights for technology investments.' },
        { id: 'edm2', text: 'Leadership sets direction and reviews whether technology delivers the intended value.' },
        { id: 'edm3', text: 'Governance and management responsibilities are separated and both are accountable.' },
      ],
      recommendations: {
        2: 'Define decision rights and an owner for technology governance — who decides what, and who is accountable.',
        3: 'Document the governance framework and apply it consistently to every significant investment.',
        4: 'Review value delivery against targets each period and adjust direction from the evidence.',
        5: 'Continuously refine governance from outcome data and benchmark against peers.',
      },
    },
    {
      key: 'risk', name: 'Risk Management (APO12)', description: 'Identifying, assessing, and mitigating IT risk.',
      questions: [
        { id: 'risk1', text: 'IT and security risks are identified and recorded in a maintained risk register.' },
        { id: 'risk2', text: 'Risks have owners and mitigation plans that are actually tracked to closure.' },
        { id: 'risk3', text: 'Risk appetite is defined and decisions are made within it.' },
      ],
      recommendations: {
        2: 'Start a risk register and capture your top technology and security risks with owners.',
        3: 'Standardize how risks are assessed and mitigated across teams, not ad hoc per project.',
        4: 'Quantify risk exposure and track mitigation effectiveness against your risk appetite.',
        5: 'Use leading indicators to act on risk before it materializes; continuously tune appetite.',
      },
    },
    {
      key: 'resource', name: 'Resource Optimization (APO07)', description: 'Skills, capacity, and vendor management.',
      questions: [
        { id: 'res1', text: 'We know our team’s skills and capacity and plan work against them.' },
        { id: 'res2', text: 'Key-person risk is managed — no critical capability depends on one individual.' },
        { id: 'res3', text: 'Vendors and external resources (including AI agents) are managed and measured.' },
      ],
      recommendations: {
        2: 'Capture team skills and capacity so work can be planned against reality, not hope.',
        3: 'Standardize resource and vendor management; reduce key-person risk with documentation and cross-training.',
        4: 'Manage capacity and vendor performance with metrics and targets.',
        5: 'Optimize the human + agent workforce mix continuously from performance and cost data.',
      },
    },
    {
      key: 'performance', name: 'Performance & Compliance (MEA)', description: 'Monitoring, evaluation, and assurance.',
      questions: [
        { id: 'mea1', text: 'IT performance is measured against goals and reported to leadership.' },
        { id: 'mea2', text: 'Controls are monitored and significant actions leave an audit trail.' },
        { id: 'mea3', text: 'We can produce compliance evidence on demand without a fire drill.' },
      ],
      recommendations: {
        2: 'Define a few key performance metrics and start reporting them to leadership.',
        3: 'Standardize monitoring and ensure significant actions are auditable by default.',
        4: 'Manage performance and control effectiveness against targets each period.',
        5: 'Generate compliance evidence on demand and continuously tighten controls from findings.',
      },
    },
  ],
  score(answers) { return scoreQuestionnaire(this, answers); },
};

// ─────────────────────────────────────────────────────────────────────────────
// Delivery Risk Audit (questionnaire)
// ─────────────────────────────────────────────────────────────────────────────

const deliveryRisk: QuestionnaireTool = {
  id: 'delivery-risk',
  name: 'Delivery Risk Audit',
  tagline: 'Find the weakest links in how your team ships software.',
  icon: '🧭',
  category: 'quality',
  kind: 'questionnaire',
  about:
    'A fast audit of delivery health across requirements, testing, deployment, flow, and incident response. Rate each statement 1 (never) to 5 (always) to surface where delivery risk concentrates and what to fix first.',
  scale: [
    { value: 1, label: 'Never' }, { value: 2, label: 'Rarely' }, { value: 3, label: 'Sometimes' },
    { value: 4, label: 'Usually' }, { value: 5, label: 'Always' },
  ],
  sections: [
    {
      key: 'requirements', name: 'Requirements', description: 'Clarity and readiness of work before it starts.',
      questions: [
        { id: 'req1', text: 'Work items have clear acceptance criteria before they are picked up.' },
        { id: 'req2', text: 'Scope is agreed up front and changes are managed, not silent.' },
      ],
      recommendations: {
        2: 'Adopt a definition-of-ready so nothing starts without clear acceptance criteria.',
        3: 'Standardize requirements grooming across teams.',
        4: 'Track requirement churn and rework caused by unclear scope.',
        5: 'Continuously improve upstream clarity from delivery feedback.',
      },
    },
    {
      key: 'testing', name: 'Testing', description: 'Automated verification and coverage.',
      questions: [
        { id: 'test1', text: 'Changes are covered by automated tests that run on every commit.' },
        { id: 'test2', text: 'Critical paths are protected by tests, not just manual checks.' },
      ],
      recommendations: {
        2: 'Add CI that runs tests on every change and blocks merges on red.',
        3: 'Set a coverage bar for critical paths and enforce it.',
        4: 'Measure CI pass rate and escaped defects as managed metrics.',
        5: 'Route detected defects to a fix automatically and track quality per change.',
      },
    },
    {
      key: 'deployment', name: 'Deployment', description: 'Release automation and recoverability.',
      questions: [
        { id: 'dep1', text: 'Deployments are automated and repeatable, not manual.' },
        { id: 'dep2', text: 'A bad release can be rolled back quickly and safely.' },
      ],
      recommendations: {
        2: 'Automate the deployment so releases are repeatable.',
        3: 'Standardize the pipeline across projects and add one-click rollback.',
        4: 'Track deploy frequency and failure rate; gate on them.',
        5: 'Use progressive delivery and continuously tune the release process.',
      },
    },
    {
      key: 'flow', name: 'Flow & Incidents', description: 'Work-in-progress discipline and incident response.',
      questions: [
        { id: 'flow1', text: 'The team limits work-in-progress and finishes before starting more.' },
        { id: 'flow2', text: 'Incidents are reviewed blamelessly and the fixes actually land.' },
      ],
      recommendations: {
        2: 'Make work visible on one board and cap work-in-progress.',
        3: 'Standardize flow and run blameless incident reviews.',
        4: 'Measure cycle time and incident recurrence; act on regressions.',
        5: 'Continuously optimize flow and prevention from the data.',
      },
    },
  ],
  score(answers) { return scoreQuestionnaire(this, answers); },
};

// ─────────────────────────────────────────────────────────────────────────────
// Incident & SRE Readiness (questionnaire)
// ─────────────────────────────────────────────────────────────────────────────

const incidentReadiness: QuestionnaireTool = {
  id: 'incident-readiness',
  name: 'Incident & SRE Readiness',
  tagline: 'How ready are you when production breaks?',
  icon: '🚨',
  category: 'quality',
  kind: 'questionnaire',
  about:
    'An SRE-style audit of how your team detects, responds to, recovers from, and learns from incidents. Rate each statement 1 (never) to 5 (always) to see where your operational resilience is weakest and what to shore up first.',
  scale: [
    { value: 1, label: 'Never' }, { value: 2, label: 'Rarely' }, { value: 3, label: 'Sometimes' },
    { value: 4, label: 'Usually' }, { value: 5, label: 'Always' },
  ],
  sections: [
    {
      key: 'detection', name: 'Detection', description: 'Knowing something is wrong — fast.',
      questions: [
        { id: 'det1', text: 'Monitoring and alerting catch problems before customers report them.' },
        { id: 'det2', text: 'Alerts are actionable and rarely ignored as noise.' },
      ],
      recommendations: {
        2: 'Add basic health checks and alerting on the signals that matter so failures are detected at all.',
        3: 'Tune alerts to reduce noise and define clear ownership for each.',
        4: 'Track alert precision and mean-time-to-detect as managed metrics.',
        5: 'Use SLOs and error budgets to drive what you alert on; continuously refine.',
      },
    },
    {
      key: 'response', name: 'Response', description: 'Mobilizing and coordinating a fix.',
      questions: [
        { id: 'res1', text: 'There is a clear on-call rotation and an incident commander role.' },
        { id: 'res2', text: 'Runbooks exist for the most likely failures and are actually used.' },
      ],
      recommendations: {
        2: 'Establish an on-call rotation so someone always owns production.',
        3: 'Write runbooks for your top failure modes and standardize incident roles.',
        4: 'Drill incident response and measure time-to-acknowledge / time-to-mitigate.',
        5: 'Automate common mitigations and continuously improve response from drills.',
      },
    },
    {
      key: 'recovery', name: 'Recovery', description: 'Restoring service and containing blast radius.',
      questions: [
        { id: 'rec1', text: 'A bad change can be rolled back or flagged off quickly.' },
        { id: 'rec2', text: 'Backups and failover are tested, not just assumed to work.' },
      ],
      recommendations: {
        2: 'Make rollback possible and verify backups can actually be restored.',
        3: 'Standardize rollback / feature-flag kill switches across services.',
        4: 'Measure time-to-restore (MTTR) and drive it down with automation.',
        5: 'Use progressive delivery and automated recovery to keep MTTR minimal.',
      },
    },
    {
      key: 'learning', name: 'Learning', description: 'Turning incidents into prevention.',
      questions: [
        { id: 'lrn1', text: 'Incidents get blameless postmortems with concrete action items.' },
        { id: 'lrn2', text: 'Postmortem action items actually get done and reduce recurrence.' },
      ],
      recommendations: {
        2: 'Run a blameless postmortem after every significant incident.',
        3: 'Track postmortem action items to completion, not just to a document.',
        4: 'Measure incident recurrence and the close rate of action items.',
        5: 'Feed prevention back into design and continuously cut repeat incidents.',
      },
    },
  ],
  score(answers) { return scoreQuestionnaire(this, answers); },
};

// ─────────────────────────────────────────────────────────────────────────────
// Security Posture Self-Check (questionnaire)
// ─────────────────────────────────────────────────────────────────────────────

const securityPosture: QuestionnaireTool = {
  id: 'security-posture',
  name: 'Security Posture Self-Check',
  tagline: 'Rate your application & operational security hygiene.',
  icon: '🔐',
  category: 'governance',
  kind: 'questionnaire',
  about:
    'A fast self-check of security hygiene across access control, secrets management, dependency/supply-chain risk, and monitoring & response. Rate each statement 1 (never) to 5 (always) for a posture score and a prioritized hardening plan.',
  scale: [
    { value: 1, label: 'Never' }, { value: 2, label: 'Rarely' }, { value: 3, label: 'Sometimes' },
    { value: 4, label: 'Usually' }, { value: 5, label: 'Always' },
  ],
  sections: [
    {
      key: 'access', name: 'Access Control', description: 'Who can do what, and least privilege.',
      questions: [
        { id: 'acc1', text: 'Access follows least privilege and is reviewed periodically.' },
        { id: 'acc2', text: 'MFA is enforced for all privileged and production access.' },
      ],
      recommendations: {
        2: 'Enforce MFA and remove standing admin access you don’t need.',
        3: 'Standardize role-based access and run periodic access reviews.',
        4: 'Measure access-review coverage and time-to-revoke on offboarding.',
        5: 'Move toward just-in-time, auditable access for privileged actions.',
      },
    },
    {
      key: 'secrets', name: 'Secrets & Data', description: 'Protecting credentials and sensitive data.',
      questions: [
        { id: 'sec1', text: 'Secrets live in a vault/manager, never in code or plain config.' },
        { id: 'sec2', text: 'Sensitive data is encrypted at rest and in transit.' },
      ],
      recommendations: {
        2: 'Get secrets out of source control and into a secrets manager now.',
        3: 'Standardize secret rotation and encryption across services.',
        4: 'Scan for leaked secrets continuously and measure exposure time.',
        5: 'Automate short-lived credentials and continuous secret hygiene.',
      },
    },
    {
      key: 'dependencies', name: 'Supply Chain', description: 'Third-party and dependency risk.',
      questions: [
        { id: 'dep1', text: 'Dependencies are scanned for known vulnerabilities and patched promptly.' },
        { id: 'dep2', text: 'Builds are reproducible and artifacts are integrity-checked.' },
      ],
      recommendations: {
        2: 'Turn on dependency vulnerability scanning and patch criticals fast.',
        3: 'Standardize patch SLAs and pin/verify your build dependencies.',
        4: 'Track mean-time-to-patch and known-vulnerability exposure.',
        5: 'Adopt SBOMs and signed, reproducible builds across the org.',
      },
    },
    {
      key: 'monitoring', name: 'Monitoring & Response', description: 'Detecting and handling security events.',
      questions: [
        { id: 'mon1', text: 'Security-relevant events are logged and monitored.' },
        { id: 'mon2', text: 'There is a tested plan for responding to a breach.' },
      ],
      recommendations: {
        2: 'Centralize security logging and define a basic incident response plan.',
        3: 'Standardize detection rules and rehearse the breach playbook.',
        4: 'Measure detection coverage and response time for security events.',
        5: 'Continuously test (red-team/tabletop) and improve detection & response.',
      },
    },
  ],
  score(answers) { return scoreQuestionnaire(this, answers); },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tech-Debt Cost Estimator (calculator)
// ─────────────────────────────────────────────────────────────────────────────

const techDebtEstimator: CalculatorTool = {
  id: 'tech-debt-estimator',
  name: 'Tech-Debt Cost Estimator',
  tagline: 'Put a dollar figure on the drag from technical debt.',
  icon: '🧱',
  category: 'delivery',
  kind: 'calculator',
  about:
    'Estimate what technical debt actually costs you per year: the engineering capacity lost to working around debt and to rework. Turning debt into a number is the first step to getting time budgeted to pay it down.',
  inputs: [
    { id: 'teamSize', label: 'Engineers on the team', type: 'number', min: 1, step: 1, default: 8 },
    { id: 'costPerDev', label: 'Fully-loaded cost per engineer / year', type: 'number', unit: '$', min: 0, step: 5000, default: 150000 },
    { id: 'debtTimePct', label: 'Share of time spent working around debt', type: 'number', unit: '%', min: 0, max: 90, step: 5, default: 25 },
    { id: 'reworkPct', label: 'Share of time on avoidable rework / bug-fixing', type: 'number', unit: '%', min: 0, max: 90, step: 5, default: 15 },
  ],
  compute: (v): ToolResult => {
    const payroll = v.teamSize! * v.costPerDev!;
    const debtPct = Math.min(90, Math.max(0, v.debtTimePct!)) / 100;
    const reworkPct = Math.min(90, Math.max(0, v.reworkPct!)) / 100;
    const debtCost = payroll * debtPct;
    const reworkCost = payroll * reworkPct;
    const total = debtCost + reworkCost;
    const fteEquivalent = v.costPerDev! > 0 ? total / v.costPerDev! : 0;
    const capacityPct = Math.round((debtPct + reworkPct) * 100);

    const recs: ToolResult['recommendations'] = [];
    if (capacityPct >= 40) recs.push({ title: 'Debt is a top-line problem', detail: `You’re losing roughly ${fteEquivalent.toFixed(1)} engineers’ worth of capacity a year. Budget a standing share of every sprint to paydown and protect it like a feature.` });
    else if (capacityPct >= 20) recs.push({ title: 'Budget explicit paydown', detail: 'Allocate a fixed slice of each iteration to debt reduction and track whether the drag goes down.' });
    else recs.push({ title: 'Keep debt in check', detail: 'Maintain the discipline that’s keeping debt low — definition-of-done, tests, and refactoring as you go.' });
    recs.push({ title: 'Make it visible', detail: 'Track cycle time and rework as metrics so the cost of debt is measured, not argued, and paydown can be justified by data.' });

    return {
      headline: `${money(total)} / year`,
      summary: `Estimated engineering capacity lost to technical debt and rework — about ${fteEquivalent.toFixed(1)} full-time engineers.`,
      metrics: [
        { label: 'Annual team cost', value: money(payroll) },
        { label: 'Lost to working around debt', value: money(debtCost) },
        { label: 'Lost to avoidable rework', value: money(reworkCost) },
        { label: 'Capacity lost', value: `${capacityPct}%` },
        { label: 'Equivalent engineers', value: fteEquivalent.toFixed(1) },
      ],
      recommendations: recs,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Build vs Buy vs Agent (calculator)
// ─────────────────────────────────────────────────────────────────────────────

const buildBuyAgent: CalculatorTool = {
  id: 'build-buy-agent',
  name: 'Build vs Buy vs Agent',
  tagline: 'Compare the 3-year cost of building, buying, or running an agent.',
  icon: '⚖️',
  category: 'finops',
  kind: 'calculator',
  about:
    'A quick 3-year total-cost-of-ownership comparison for a capability you need: build it yourself, buy a SaaS product, or run an AI agent. Estimates are directional — they surface the order of magnitude and the break-even, not a precise quote.',
  inputs: [
    { id: 'devMonths', label: 'Engineer-months to build it', type: 'number', unit: 'mo', min: 0, step: 1, default: 6 },
    { id: 'devMonthlyCost', label: 'Fully-loaded cost per engineer-month', type: 'number', unit: '$', min: 0, step: 1000, default: 13000 },
    { id: 'maintPctPerYear', label: 'Annual maintenance (% of build cost)', type: 'number', unit: '%', min: 0, max: 100, step: 5, default: 20 },
    { id: 'buyAnnualLicense', label: 'Buy: annual license / subscription', type: 'number', unit: '$', min: 0, step: 1000, default: 30000 },
    { id: 'agentMonthlyCost', label: 'Agent: all-in monthly run cost', type: 'number', unit: '$', min: 0, step: 100, default: 800 },
  ],
  compute: (v): ToolResult => {
    const buildUpfront = v.devMonths! * v.devMonthlyCost!;
    const buildMaintPerYear = buildUpfront * (Math.min(100, Math.max(0, v.maintPctPerYear!)) / 100);
    const build3yr = buildUpfront + 3 * buildMaintPerYear;
    const buy3yr = 3 * v.buyAnnualLicense!;
    const agent3yr = 3 * 12 * v.agentMonthlyCost!;

    const options = [
      { key: 'build', label: 'Build', cost: build3yr },
      { key: 'buy', label: 'Buy', cost: buy3yr },
      { key: 'agent', label: 'Agent', cost: agent3yr },
    ].sort((a, b) => a.cost - b.cost);
    const winner = options[0]!;
    const runnerUp = options[1]!;
    const margin = runnerUp.cost - winner.cost;

    const recs: ToolResult['recommendations'] = [
      { title: `${winner.label} looks cheapest over 3 years`, detail: `${winner.label} is about ${money(margin)} less than the next option (${runnerUp.label}) over three years. Cost isn’t everything — weigh control, time-to-value, and strategic fit.` },
    ];
    if (winner.key === 'build') recs.push({ title: 'But you own the maintenance', detail: 'Building means carrying the maintenance and opportunity cost forever. Make sure this capability is core enough to justify owning it.' });
    if (winner.key === 'buy') recs.push({ title: 'Watch lock-in & per-seat scaling', detail: 'Buying is fast but check how the price scales with usage/seats and how hard it is to leave.' });
    if (winner.key === 'agent') recs.push({ title: 'Agents scale with usage', detail: 'An agent is cheap to start; model the cost at your real volume and protect it with a budget and caching.' });

    return {
      headline: `${winner.label} — ${money(winner.cost)} over 3 years`,
      summary: 'Directional 3-year total cost of ownership for each option.',
      metrics: [
        { label: 'Build (3-year)', value: money(build3yr), hint: `${money(buildUpfront)} upfront + maintenance` },
        { label: 'Buy (3-year)', value: money(buy3yr) },
        { label: 'Agent (3-year)', value: money(agent3yr) },
        { label: 'Cheapest', value: winner.label },
      ],
      recommendations: recs,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Agentic Maturity Diagnostic (questionnaire) — the flagship. Also has a
// telemetry-derived "from your data" mode (see toolDataProviders.ts), which the
// generic engine surfaces because a data provider is registered for this id.
// ─────────────────────────────────────────────────────────────────────────────

export const agenticMaturity: QuestionnaireTool = {
  id: 'agentic-maturity',
  name: 'Agentic Maturity Diagnostic',
  tagline: 'Rate how your organization runs across six practices — CMMI-style.',
  icon: '📈',
  category: 'delivery',
  kind: 'questionnaire',
  about:
    'A CMMI/COBIT-style maturity model that rates how your technology organization actually runs across six practices — software delivery, release & operations (DORA), quality assurance, project management, agentic AI operations, and governance & security — on a 1–5 scale (Initial → Optimizing). Rate each statement, or sign in to score it objectively from your real delivery data, and get a prioritized plan to mature and innovate.',
  scale: [
    { value: 1, label: 'Initial' }, { value: 2, label: 'Managed' }, { value: 3, label: 'Defined' },
    { value: 4, label: 'Quantitatively Managed' }, { value: 5, label: 'Optimizing' },
  ],
  sections: [
    {
      key: 'delivery', name: 'Software Delivery', description: 'How predictably work flows from start to done — cycle time, WIP discipline, and rework.',
      questions: [
        { id: 'delivery_cycle', text: 'Work items move from "in progress" to "done" within a predictable, short cycle time.' },
        { id: 'delivery_wip', text: 'The team limits work-in-progress and finishes started work before pulling more.' },
        { id: 'delivery_rework', text: 'Completed work rarely has to be reopened or redone.' },
        { id: 'delivery_estimation', text: 'Delivery dates are forecast from historical throughput, not guessed.' },
      ],
      recommendations: {
        2: 'Make work visible: put every task on the board and define a clear "done" so cycle time can be measured at all.',
        3: 'Standardize a WIP limit per lane and a definition-of-ready/done so flow is consistent across teams, not per-person.',
        4: 'Track cycle time and rework as managed metrics with targets; review them every iteration and act on regressions.',
        5: 'Forecast delivery from throughput distributions and continuously tune flow — let the data drive process changes.',
      },
    },
    {
      key: 'devops', name: 'Release & Operations (DORA)', description: 'Deployment frequency, change-failure-rate, and time-to-restore — the DORA four keys.',
      questions: [
        { id: 'devops_freq', text: 'Changes are deployed to production frequently (at least weekly).' },
        { id: 'devops_automation', text: 'Deployments are automated and require no manual hand-holding.' },
        { id: 'devops_cfr', text: 'Deployments rarely cause a failure that needs a fix or rollback.' },
        { id: 'devops_mttr', text: 'When a deployment does fail, service is restored quickly (within hours).' },
      ],
      recommendations: {
        2: 'Capture deployments as events so frequency, failure rate, and restore time can be measured at all.',
        3: 'Automate the deploy pipeline and standardize it across projects so releases are repeatable, not bespoke.',
        4: 'Manage the DORA four keys against targets; add automated rollback and alerting to drive down MTTR.',
        5: 'Use progressive delivery (canary/feature flags) and treat DORA trends as the input to continuous release tuning.',
      },
    },
    {
      key: 'quality', name: 'Quality Assurance', description: 'How well work is verified before and after it ships — CI health, escaped defects, and outcome quality.',
      questions: [
        { id: 'quality_ci', text: 'Changes pass automated tests/CI before they merge.' },
        { id: 'quality_coverage', text: 'Critical paths are covered by automated tests, not just manual checks.' },
        { id: 'quality_escaped', text: 'Defects are rarely found in production after release.' },
        { id: 'quality_feedback', text: 'Quality findings feed back into the backlog and get fixed, not ignored.' },
      ],
      recommendations: {
        2: 'Add CI that runs on every change and block merges on red so quality is verified before it ships.',
        3: 'Standardize a coverage bar and a triage path for findings so quality practice is consistent across teams.',
        4: 'Measure CI pass rate and escaped-defect rate as managed metrics; gate releases on them.',
        5: 'Close the loop automatically — route detected defects to a fix agent and track quality outcomes per change.',
      },
    },
    {
      key: 'project_management', name: 'Project Management', description: 'Planning, board hygiene, and throughput — how well work is organized and tracked.',
      questions: [
        { id: 'pm_planning', text: 'Work is planned into prioritized, well-described items before it starts.' },
        { id: 'pm_hygiene', text: 'The board reflects reality — statuses are current and stale items are groomed.' },
        { id: 'pm_throughput', text: 'The team delivers a steady, predictable amount of work each iteration.' },
        { id: 'pm_ceremony', text: 'Regular ceremonies (standup, planning, retro) actually happen and drive decisions.' },
      ],
      recommendations: {
        2: 'Adopt a single board for all work with clear statuses so planning and tracking have a home.',
        3: 'Standardize prioritization and grooming so the board stays trustworthy across teams.',
        4: 'Track throughput and board-hygiene as metrics; run data-informed planning and retros.',
        5: 'Drive portfolio-level planning from forecast and capacity — plan by evidence, not opinion.',
      },
    },
    {
      key: 'agentic_ops', name: 'Agentic AI Operations', description: 'How effectively the organization adopts AI agents, picks the right models, and controls AI cost.',
      questions: [
        { id: 'agentic_adoption', text: 'AI agents do meaningful delivery work, not just experiments.' },
        { id: 'agentic_effectiveness', text: 'We know which agents/models actually ship working changes and route work accordingly.' },
        { id: 'agentic_cost', text: 'AI spend is attributed to work and managed against a budget.' },
        { id: 'agentic_governance', text: 'Agent actions are reviewed/approved where it matters, with an audit trail.' },
      ],
      recommendations: {
        2: 'Put agents on real tasks on the board and capture their runs so adoption and outcomes are visible.',
        3: 'Standardize how agents are assigned and which models are approved so usage is consistent and governed.',
        4: 'Manage AI effectiveness and cost-per-outcome as metrics; route by measured success rate, not habit.',
        5: 'Let learned routing and outcome scoring continuously optimize which agent/model does which work.',
      },
    },
    {
      key: 'governance', name: 'Governance & Security', description: 'Roles, approvals, auditability, and risk control over both human and agent work.',
      questions: [
        { id: 'gov_roles', text: 'Access is governed by clear roles — people and agents only do what their role allows.' },
        { id: 'gov_approvals', text: 'High-impact actions require explicit human approval before they take effect.' },
        { id: 'gov_audit', text: 'Every significant action is recorded in an immutable audit trail.' },
        { id: 'gov_compliance', text: 'We can produce evidence for security/compliance reviews without a fire drill.' },
      ],
      recommendations: {
        2: 'Assign workspace roles and turn on approval gates for high-impact actions.',
        3: 'Document who-can-do-what and standardize approval policies across projects.',
        4: 'Review the audit trail routinely and measure approval/escape rates.',
        5: 'Generate compliance evidence on demand from the audit trail and continuously tighten policy.',
      },
    },
  ],
  score(answers) { return scoreQuestionnaire(this, answers); },
};

// ─────────────────────────────────────────────────────────────────────────────
// AI Development Maturity (quiz) — a level-banded assessment of how AI-native the
// *development workflow* is (idea-to-customer speed, prototype fidelity, who can
// ship, org-level impact). Single-select prose answers per dimension, each mapping
// to a maturity level — distinct from the CMMI-style agenticMaturity above, which
// rates statements across six operating practices.
// ─────────────────────────────────────────────────────────────────────────────

const aiDevMaturity: QuizTool = {
  id: 'ai-dev-maturity',
  name: 'AI Development Maturity',
  tagline: 'See how AI-native your development workflow really is — in four questions.',
  icon: '⚡',
  category: 'delivery',
  kind: 'quiz',
  about:
    'Most teams have adopted AI coding tools yet still ship at the same pace, because the tools were bolted onto an unchanged process. This assessment rates where your organization actually sits across four dimensions of AI-native development — idea-to-customer speed, prototype fidelity, who can ship, and org-level impact — and what it takes to reach the next level. Pick the statement that best fits each dimension, or sign in to track your level over time.',
  levels: [
    {
      level: 1,
      name: 'AI-assisted steps',
      summary:
        'AI helps individual steps, but the development process is otherwise unchanged. Planning cycles, hand-offs, and review queues look the same as they did before the tools arrived, so the time from idea to customer has barely moved.',
      advance:
        'Pick one workflow and let AI compress a whole stage, not just keystrokes — e.g. generate a working slice on the real codebase instead of a hand-off document — so the speed-up shows up in delivery, not just in the editor.',
    },
    {
      level: 2,
      name: 'Faster individuals',
      summary:
        'Individuals are noticeably faster with AI, but the gains stop at the person. Sprint cadence, release frequency, and the queue between roles are unchanged, so the organization ships at roughly the old pace.',
      advance:
        'Move the speed-up from the individual to the flow: shrink hand-offs so a faster step actually shortens the cycle, and let non-engineers validate on the real stack instead of waiting for an engineering slot.',
    },
    {
      level: 3,
      name: 'AI-native workflow',
      summary:
        'The workflow itself is built around AI. Ideas become working software on the real codebase without a dedicated engineering sprint, and review and governance have been adapted to the higher output rather than left as the old bottleneck.',
      advance:
        'Open up contribution: let PMs, designers, and QA propose reviewed production changes directly, and make review scale with output so a faster front end does not just refill the review queue.',
    },
    {
      level: 4,
      name: 'Cross-functional delivery',
      summary:
        'Every role contributes directly to production, with engineers reviewing and merging rather than gatekeeping every change. Delivery timelines reflect the new workflow, and you can point to the specific changes that drove the improvement.',
      advance:
        'Run work in parallel: have multiple agents and workstreams advance simultaneously, and harden the review structure so parallel output does not recreate the queue problem you already solved.',
    },
    {
      level: 5,
      name: 'Parallel agentic delivery',
      summary:
        'Multiple agents run in parallel across multiple workstreams, and review and governance scale with the output. Product leaders can place several bets at once, read early signal on each, and steer investment toward what is working without waiting for any one initiative to close.',
      advance:
        'You are operating at the frontier — keep review capacity and governance ahead of agent output, and treat that balance as the thing you continuously tune.',
    },
  ],
  questions: [
    {
      id: 'speed',
      dimension: 'Idea-to-customer speed',
      text: 'How quickly can a raw idea become something a customer can actually use?',
      options: [
        { level: 1, text: 'Ideas run the full PRD → design → sprint-planning → engineering path before anyone can try them — weeks to months from idea to working software.' },
        { level: 2, text: 'Once an idea is prioritized AI speeds the individual steps, but it still waits on engineering capacity to become testable. Timelines are measured in sprints.' },
        { level: 3, text: 'Product or design can stand up a working version on the real codebase without booking an engineering sprint — measured in days.' },
        { level: 4, text: 'Most ideas reach a real, testable version within a day, and the team validates before committing engineering time.' },
        { level: 5, text: 'Several ideas are taken to working versions in parallel within hours, and the team kills or doubles down on each from real signal.' },
      ],
    },
    {
      id: 'fidelity',
      dimension: 'Prototype fidelity',
      text: 'When you validate an idea before building it, what is the prototype actually made of?',
      options: [
        { level: 1, text: 'Static mockups or click-through flows. Feedback is about how things look.' },
        { level: 2, text: 'Placeholder components in a separate tool — the real thing gets rebuilt from scratch when engineering implements it.' },
        { level: 3, text: 'Built on the real stack, but only engineering can set it up and keep it running.' },
        { level: 4, text: 'Built from your actual components and design system; once approved it becomes the starting point for production.' },
        { level: 5, text: 'Prototypes are production-grade from the first pass — validated against real data and constraints, then promoted rather than rebuilt.' },
      ],
    },
    {
      id: 'contributors',
      dimension: 'Who can ship',
      text: 'Who can currently move work forward on the production codebase?',
      options: [
        { level: 1, text: 'Only engineers touch production code — everyone else files tickets and waits.' },
        { level: 2, text: 'Engineers own all production work; PMs and designers review via mockups and comments, then wait for implementation.' },
        { level: 3, text: 'Non-engineers can contribute in separate tools, but engineering rebuilds it for production.' },
        { level: 4, text: 'PMs, designers, and QA contribute directly to production code; engineers review and merge.' },
        { level: 5, text: 'Every role — including agents — opens reviewed changes against production; the limit is review capacity, not who is allowed.' },
      ],
    },
    {
      id: 'impact',
      dimension: 'Org-level impact',
      text: 'What has measurably changed at the org level since you adopted AI development tools?',
      options: [
        { level: 1, text: 'No measurable change in how fast ideas reach customers.' },
        { level: 2, text: 'Individual developers are faster, but sprint velocity and release frequency are unchanged.' },
        { level: 3, text: 'Some teams ship noticeably faster, but the improvement is inconsistent across the org.' },
        { level: 4, text: 'Delivery timelines have shortened, and we can point to the specific workflow changes that drove it.' },
        { level: 5, text: 'Throughput scales with parallel agentic work, and we steer investment from early signal across many simultaneous bets.' },
      ],
    },
  ],
  score(answers) { return scoreQuiz(this, answers); },
};

// ─────────────────────────────────────────────────────────────────────────────
// Ticket Role & Diagnostic Coverage (questionnaire + data mode)
// Part of the Manager AI agent's diagnostic: are the key roles and diagnostics
// actually performed on each ticket before it advances? The data mode scores this
// objectively from the per-ticket audit ledger (ticket_audits).
// ─────────────────────────────────────────────────────────────────────────────

const ticketRoleCoverage: QuestionnaireTool = {
  id: 'ticket-role-coverage',
  name: 'Ticket Role & Diagnostic Coverage',
  tagline: 'Are the right roles and checks performed on every ticket?',
  icon: '✅',
  category: 'governance',
  kind: 'questionnaire',
  about:
    'Audits whether each ticket passed through its required roles (BA, Architect, Developer, Review, QA) and diagnostics before it advanced. The "from your data" mode scores this objectively from the per-ticket audit ledger and lists flagged tickets to fix first.',
  scale: [
    { value: 1, label: 'Never' }, { value: 2, label: 'Rarely' }, { value: 3, label: 'Sometimes' },
    { value: 4, label: 'Usually' }, { value: 5, label: 'Always' },
  ],
  sections: [
    {
      key: 'roles', name: 'Role coverage', description: 'The right people (or agents) touch each ticket.',
      questions: [
        { id: 'role1', text: 'Every ticket is reviewed by an Architect before it is built or tested.' },
        { id: 'role2', text: 'Code review and QA sign-off happen before a ticket is Done.' },
      ],
      recommendations: {
        2: 'Adopt a kanban template that assigns a responsible role to every lane.',
        3: 'Require reviewer sign-off on the review and Done lanes.',
        4: 'Flag tickets that skip a required role and route them back automatically.',
        5: 'Continuously tune role requirements from audit outcomes.',
      },
    },
    {
      key: 'diagnostics', name: 'Diagnostic coverage', description: 'Required checks actually run per ticket.',
      questions: [
        { id: 'diag1', text: 'Required diagnostics (security, architecture, tests) run on the relevant tickets.' },
        { id: 'diag2', text: 'A ticket cannot silently reach Done with unmet required checks.' },
      ],
      recommendations: {
        2: 'Attach required diagnostics to the lanes where they matter.',
        3: 'Turn on the per-ticket audit so gaps are visible.',
        4: 'Gate the Done lane on required diagnostics.',
        5: 'Drive the plan from flagged-ticket trends each week.',
      },
    },
  ],
  score(answers) { return scoreQuestionnaire(this, answers); },
};

// ─────────────────────────────────────────────────────────────────────────────

export const TOOLS: Tool[] = [
  agenticMaturity,
  ticketRoleCoverage,
  aiDevMaturity,
  doraQuickCheck,
  aiCostEstimator,
  cobitGovernance,
  deliveryRisk,
  incidentReadiness,
  securityPosture,
  techDebtEstimator,
  buildBuyAgent,
  aiResourcePlanner,
];

export function getTool(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}
