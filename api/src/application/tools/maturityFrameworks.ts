/**
 * Maturity FRAMEWORKS — the same measurement, reported in the vocabulary the
 * reader's organization is audited against.
 *
 * ── WHY A LENS AND NOT THREE DIAGNOSTICS ────────────────────────────────────
 * The Agentic Maturity Diagnostic measures six practices from real telemetry.
 * A CIO who reports to an audit committee does not present six practices — they
 * present COBIT's five governance/management domains, or ITIL's service value
 * chain, because that is the taxonomy their auditors, their board pack and their
 * last external assessment already use. Handing them a sixth taxonomy means they
 * re-map it by hand into a slide, every quarter, and the mapping they invent is
 * the one nobody can reproduce.
 *
 * So a framework is a LENS over one measurement, never a second questionnaire.
 * That distinction is the whole design:
 *
 *   - the SIGNALS do not change. Cycle time is cycle time whether it is reported
 *     under "Software Delivery", COBIT's `BAI` or ITIL's "Obtain/Build". Three
 *     questionnaires would produce three numbers for one organization, and the
 *     first person to notice they disagree would be right to stop trusting all
 *     three;
 *   - the PLAN does not change. Remediation is per practice, because that is the
 *     grain at which somebody actually does something. A framework changes how
 *     the scorecard is grouped and named, not what to go and fix;
 *   - a domain scores as the mean of the practices mapped into it, and a domain
 *     with no assessed practice reports as unassessed rather than as zero. A
 *     governance domain scored 0 because nothing fed it is a far worse answer
 *     than one that says it was not measured.
 *
 * ── OPEN/CLOSED ─────────────────────────────────────────────────────────────
 * Adding ISO/IEC 20000, NIST CSF or a customer's in-house model is an entry in
 * {@link MATURITY_FRAMEWORKS} — data — not a branch anywhere. The lens function
 * below reads the registry and nothing else.
 */

import type { Tool, ToolMetric, ToolResult } from './toolTypes';

export const MATURITY_FRAMEWORK_IDS = ['cmmi', 'cobit', 'itil'] as const;
export type MaturityFrameworkId = (typeof MATURITY_FRAMEWORK_IDS)[number];

/** The default lens: the six practices as the diagnostic itself names them. */
export const DEFAULT_MATURITY_FRAMEWORK: MaturityFrameworkId = 'cmmi';

export interface MaturityDomain {
  /** Stable key — the i18n key and the API contract. Never displayed raw. */
  key: string;
  /** The framework's own name for this domain, in English (the source copy). */
  name: string;
  /** Why this domain exists, in the framework's terms. */
  description: string;
  /**
   * The `agentic-maturity` practice keys that roll into it.
   *
   * A practice may appear in more than one domain — COBIT's `MEA` (Monitor,
   * Evaluate, Assess) is genuinely measured by BOTH quality assurance and
   * governance evidence, and forcing a partition would mean choosing which of
   * those two truths to drop.
   */
  practices: string[];
}

export interface MaturityFramework {
  id: MaturityFrameworkId;
  name: string;
  /** One line on what the framework is, for the toggle's help text. */
  tagline: string;
  domains: MaturityDomain[];
}

/**
 * The registry. Practice keys are `agentic-maturity`'s section keys — `delivery`,
 * `devops`, `quality`, `project_management`, `agentic_ops`, `governance` — and a
 * key naming no section is simply skipped, so a renamed section degrades to a
 * thinner domain rather than to a crash.
 */
export const MATURITY_FRAMEWORKS: MaturityFramework[] = [
  {
    id: 'cmmi',
    name: 'CMMI practices',
    tagline: 'The six operating practices the diagnostic measures, reported as measured.',
    domains: [
      { key: 'delivery', name: 'Software Delivery', description: 'How predictably work flows from start to done.', practices: ['delivery'] },
      { key: 'devops', name: 'Release & Operations', description: 'Deployment frequency, change-failure rate and time to restore.', practices: ['devops'] },
      { key: 'quality', name: 'Quality Assurance', description: 'How well work is verified before and after it ships.', practices: ['quality'] },
      { key: 'project_management', name: 'Project Management', description: 'Planning, board hygiene and throughput.', practices: ['project_management'] },
      { key: 'agentic_ops', name: 'Agentic AI Operations', description: 'Agent adoption, model choice and AI cost control.', practices: ['agentic_ops'] },
      { key: 'governance', name: 'Governance & Security', description: 'Roles, approvals, auditability and risk control.', practices: ['governance'] },
    ],
  },
  {
    id: 'cobit',
    name: 'COBIT domains',
    tagline: 'ISACA’s governance and management domains — the taxonomy an IT audit is written against.',
    domains: [
      {
        key: 'edm', name: 'Evaluate, Direct and Monitor',
        description: 'Governance: whether decision rights, direction and oversight of technology investment actually exist.',
        practices: ['governance'],
      },
      {
        key: 'apo', name: 'Align, Plan and Organise',
        description: 'How work is prioritised, planned and resourced against the organisation’s goals.',
        practices: ['project_management', 'agentic_ops'],
      },
      {
        key: 'bai', name: 'Build, Acquire and Implement',
        description: 'Turning a plan into a delivered change — flow, cycle time and the discipline around it.',
        practices: ['delivery'],
      },
      {
        key: 'dss', name: 'Deliver, Service and Support',
        description: 'Running what was built: release, availability and restoring service when it breaks.',
        practices: ['devops'],
      },
      {
        key: 'mea', name: 'Monitor, Evaluate and Assess',
        description: 'Whether performance and controls are measured, reviewed and evidenced on demand.',
        practices: ['quality', 'governance'],
      },
    ],
  },
  {
    id: 'itil',
    name: 'ITIL service value chain',
    tagline: 'The ITIL 4 value-chain activities — how a service organisation describes its own work.',
    domains: [
      {
        key: 'plan', name: 'Plan',
        description: 'A shared understanding of direction and priorities across the products in scope.',
        practices: ['project_management'],
      },
      {
        key: 'improve', name: 'Improve',
        description: 'Continual improvement of practices, products and services — measured, not asserted.',
        practices: ['quality', 'agentic_ops'],
      },
      {
        key: 'design_transition', name: 'Design & Transition',
        description: 'That what is built meets expectations for quality, cost and time to market.',
        practices: ['delivery', 'quality'],
      },
      {
        key: 'obtain_build', name: 'Obtain / Build',
        description: 'Components and services are available when and where they are needed.',
        practices: ['delivery', 'agentic_ops'],
      },
      {
        key: 'deliver_support', name: 'Deliver & Support',
        description: 'Service delivery and support to agreed specifications — release, restore, respond.',
        practices: ['devops'],
      },
      {
        key: 'govern', name: 'Govern',
        description: 'Direction, policies and controls over both human and agent work.',
        practices: ['governance'],
      },
    ],
  },
];

export function isMaturityFrameworkId(value: unknown): value is MaturityFrameworkId {
  return typeof value === 'string' && (MATURITY_FRAMEWORK_IDS as readonly string[]).includes(value);
}

/** The framework by id, falling back to the default rather than throwing — a bad
 *  query parameter must degrade the LENS, never fail the diagnostic. */
export function maturityFramework(id: unknown): MaturityFramework {
  return MATURITY_FRAMEWORKS.find((f) => f.id === (isMaturityFrameworkId(id) ? id : DEFAULT_MATURITY_FRAMEWORK))!;
}

/**
 * Whether a framework lens means anything for this tool.
 *
 * Derived from the registry rather than from a hardcoded tool id, so adding a
 * framework that maps a DIFFERENT questionnaire's sections lights the toggle up
 * on that tool with no code change here or at the call site. A tool none of the
 * frameworks reference gets no toggle at all — which is correct: a lens over a
 * taxonomy it does not describe would be an empty scorecard.
 */
export function supportsMaturityFrameworks(tool: Tool): boolean {
  if (tool.kind !== 'questionnaire') return false;
  const sections = new Set(tool.sections.map((s) => s.key));
  return MATURITY_FRAMEWORKS.some((f) =>
    f.id !== DEFAULT_MATURITY_FRAMEWORK && f.domains.some((d) => d.practices.some((p) => sections.has(p))));
}

/** Public, client-safe shape of the registry (drives the toggle). */
export interface MaturityFrameworkSummary {
  id: MaturityFrameworkId;
  name: string;
  tagline: string;
  domains: Array<{ key: string; name: string; description: string; practices: string[] }>;
}

export function listMaturityFrameworks(): MaturityFrameworkSummary[] {
  return MATURITY_FRAMEWORKS.map((f) => ({
    id: f.id,
    name: f.name,
    tagline: f.tagline,
    domains: f.domains.map((d) => ({ key: d.key, name: d.name, description: d.description, practices: [...d.practices] })),
  }));
}

/**
 * Re-lens a scored maturity result into a framework's domains.
 *
 * PURE, and deliberately a projection of a finished {@link ToolResult} rather
 * than a second scorer. Both the self-assessment (`scoreQuestionnaire`) and the
 * telemetry provider (`scoreAgenticMaturityData`) already stamp each metric with
 * the practice `key` it came from, so this one function serves both — which is
 * the only way the two modes can be guaranteed to agree under a lens.
 *
 * The overall score, the headline and the whole plan pass through untouched:
 * grouping practices differently must not move the number, and the actions are
 * per practice because that is the grain at which somebody does something.
 *
 * `cmmi` returns the result unchanged — its domains are the practices — so the
 * default path costs nothing and cannot drift from the unlensed view.
 */
export function applyMaturityFramework(result: ToolResult, framework: MaturityFramework): ToolResult {
  if (framework.id === DEFAULT_MATURITY_FRAMEWORK) return result;

  const byPractice = new Map<string, ToolMetric>();
  for (const m of result.metrics) if (m.key) byPractice.set(m.key, m);

  const metrics: ToolMetric[] = framework.domains.map((domain) => {
    const scored = domain.practices
      .map((p) => byPractice.get(p))
      .filter((m): m is ToolMetric => m != null && typeof m.tier === 'number');

    if (scored.length === 0) {
      // Unassessed, not zero. A domain fed by nothing is a gap in COVERAGE, and
      // reporting it as Level 0 would be a claim about the organization.
      return { key: domain.key, label: domain.name, value: 'Not assessed', hint: domain.description };
    }
    const tier = Math.round(scored.reduce((sum, m) => sum + (m.tier ?? 0), 0) / scored.length);
    return {
      key: domain.key,
      label: domain.name,
      value: `Level ${tier}`,
      // The practices behind the domain, named — so a reader can see WHY a domain
      // scored what it did without leaving the framework they asked for.
      hint: scored.map((m) => m.label).join(' · '),
      tier,
    };
  });

  return { ...result, metrics };
}
