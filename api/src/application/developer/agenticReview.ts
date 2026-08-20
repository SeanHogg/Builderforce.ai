/**
 * The AGENTIC review stage — PRD 24 §5.5 step 3, wired to the governance the
 * platform already has.
 *
 * The static stage checks the document. The dynamic stage checks the behaviour.
 * Neither can answer the question a human reviewer is actually for: does the
 * combination of what this package ASKS FOR and what it DOES make sense? A
 * connector that requests `write:tickets` and `notify:members` to expose a single
 * read-only "list currencies" action passes both earlier stages cleanly, and is
 * obviously wrong. That mismatch is judgement, and judgement is what the model is
 * here to supply.
 *
 * ── IT CAN BLOCK, OR IT IS DECORATION ───────────────────────────────────────
 * A `block` verdict emits a `fail` finding, and the pipeline's rule 2 makes a
 * `fail` from any stage refuse the submission. There is no weighting, no
 * "advisory" flag and no override — a reviewer that may only comment is a comment
 * box, and the reason a supply-chain review exists is to be able to say no.
 *
 * The counterweight is precision, not a softer verdict: the schema forces a
 * reason for every objection, the prompt is told that a refusal must name the
 * specific declaration it objects to, and a `block` with no reasons is
 * DOWNGRADED to a flag here rather than trusted. An unexplained refusal is not a
 * review, and it is also the shape a hallucinated one takes.
 *
 * ── WHAT "THE GOVERNANCE AGENT" MEANS CONCRETELY ────────────────────────────
 * Two things this platform already owns, joined:
 *
 *   • the SECURITY agent's persona — `BUILTIN_AGENTS`' `security` seed, whose bio
 *     is the standard of conduct every tenant's SOC 2 auditor already reviews to.
 *     Using it means this stage speaks with the same voice as the agent a
 *     workspace can already ask, instead of inventing a second reviewer with a
 *     second idea of what matters.
 *   • the POLICY PACKS (PRD 08 / migration 0348) resolved for the review sandbox
 *     workspace. That is what makes the stage's standard OPERATOR-EDITABLE: a
 *     rule about what a published package may request is authored as a policy
 *     gate on the sandbox tenant, in the surface policy packs are already managed
 *     in, and appears in this prompt on the next submission. Without it the
 *     stage's standard would be a string literal in this file, changeable only by
 *     a deploy — which is the same complaint PRD 24 makes about the category list.
 *
 * ── UNAVAILABLE IS NOT A REFUSAL ────────────────────────────────────────────
 * A gateway error, a kill switch, an unparsable answer: all `skipped`, per the
 * pipeline's rule 5. Refusing every submission on the platform because a model
 * pool is cold is a bottleneck wearing a gate's clothes, and G5 says review is a
 * gate. The cost is paid in the directory instead — a package this stage never
 * cleared cannot reach the `exercised` assurance tier, so the absence of the
 * review is visible to a buyer rather than laundered into an approval.
 */

import { ideProxy, readProxyChoice } from '../llm/LlmProxyService';
import { resolvePolicyGates } from '../governance/policyPackService';
import { BUILTIN_AGENTS } from '../agent/provisionBuiltinAgents';
import { SENSITIVE_SCOPES } from './extensionContract';
import {
  finding,
  skipped,
  verdictFor,
  type ReviewStage,
  type ReviewStageContext,
  type StageEvidence,
  type StageResult,
} from './reviewPipeline';
import { resolveSandboxTenantId } from './reviewSandbox';
import type { ReviewFinding } from './packageReview';

/** The reviewer's standard of conduct — the Security agent's own bio, not a copy. */
const SECURITY_PERSONA =
  BUILTIN_AGENTS.find((a) => a.kind === 'security')?.bio ??
  'You audit software against security and compliance criteria and report only what the evidence supports.';

const RESPONSE_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'extension_governance_verdict',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['verdict', 'reasons'],
      properties: {
        verdict: { type: 'string', enum: ['approve', 'flag', 'block'] },
        reasons: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['code', 'severity', 'message'],
            properties: {
              // A stable machine name, so a dashboard can group refusals and a
              // re-review can be compared against the last one — the same
              // property `ReviewFinding.check` has, for the same reason.
              code: { type: 'string' },
              severity: { type: 'string', enum: ['warn', 'fail'] },
              message: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = [
  SECURITY_PERSONA,
  '',
  'You are the final review stage for a third-party extension submitted to a marketplace. Two automated stages have already run and their findings are given to you: a STATIC stage that parsed and scanned the submitted specification, and a DYNAMIC stage that installed it into a sandbox workspace and exercised its declared surface against the live internet.',
  '',
  'Judge the submission as a whole. The specific question the earlier stages cannot answer is whether the permissions requested are PROPORTIONATE to what the package actually does, and whether the declared behaviour is consistent with how the package presents itself.',
  '',
  'Return one verdict:',
  '  approve — the request is proportionate and nothing in the evidence contradicts the listing.',
  '  flag    — something is questionable and a human should look, but it is not a refusal.',
  '  block   — the submission must not be published.',
  '',
  'Rules you must follow:',
  '  1. Every reason must name the SPECIFIC declaration you object to — a scope, an action key, a host, a described behaviour. A reason that could be written about any package is not a reason.',
  '  2. Do not object to something an earlier stage already refused; it is already blocked.',
  '  3. Do not object to a mutating action merely because it mutates. Writing is what an integration is for.',
  '  4. A skipped dynamic check is missing evidence, not a fault. Say so at most once, as a flag.',
  '  5. If you are not confident, flag. Blocking on a guess costs a legitimate publisher their launch.',
  'Respond with JSON only.',
].join('\n');

interface GovernanceVerdict {
  verdict?: unknown;
  reasons?: Array<{ code?: unknown; severity?: unknown; message?: unknown }>;
}

/** The submission, compacted into something worth spending a context window on. */
function describeSubmission(ctx: ReviewStageContext, policyDirectives: string[]): string {
  const spec = ctx.normalizedSpec;
  const lines: string[] = [
    `Package: ${ctx.packageSlug} (kind: ${ctx.kind}, version ${ctx.semver})`,
    `Publisher verification: ${ctx.verificationState}`,
    `Paid listing: ${ctx.paid ? 'yes' : 'no'}`,
    `Requested scopes: ${ctx.scopes.join(', ') || '(none)'}`,
    `Of those, scopes that change customer data: ${ctx.scopes.filter((s) => (SENSITIVE_SCOPES as readonly string[]).includes(s)).join(', ') || '(none)'}`,
  ];

  if (ctx.previousScopes && ctx.previousScopes.length > 0) {
    const added = ctx.scopes.filter((s) => !ctx.previousScopes!.includes(s));
    lines.push(`Scopes added since the previous approved version: ${added.join(', ') || '(none)'}`);
  }

  if (ctx.kind === 'connector') {
    lines.push(`Base URL: ${String(spec.baseUrl ?? '(none)')}`);
    lines.push(`Auth kind: ${String((spec.auth as { kind?: unknown } | undefined)?.kind ?? 'unknown')}`);
    const actions = Array.isArray(spec.actions) ? (spec.actions as Array<Record<string, unknown>>) : [];
    lines.push(`Declared actions (${actions.length}):`);
    for (const a of actions.slice(0, 40)) {
      lines.push(`  - ${String(a.key)} [${String(a.method)} ${String(a.path)}]${a.mutates ? ' MUTATES' : ''}: ${String(a.description ?? '').slice(0, 200)}`);
    }
  } else if (ctx.kind === 'mcp_server') {
    lines.push(`Server URL: ${String(spec.serverUrl ?? '(none)')}`);
    const tools = Array.isArray(spec.tools) ? (spec.tools as unknown[]) : [];
    lines.push(`Declared tools (${tools.length}): ${tools.map((t) => (typeof t === 'string' ? t : String((t as { name?: unknown })?.name ?? ''))).slice(0, 60).join(', ')}`);
  }

  for (const [key, stage] of ctx.priorStages) {
    lines.push(`\n${key.toUpperCase()} stage — ${stage.verdict}`);
    for (const f of stage.findings.slice(0, 30)) lines.push(`  [${f.severity}] ${f.check}: ${f.message}`);
    const exercised = stage.evidence.filter((e) => e.status !== undefined || e.outcome === 'skipped');
    for (const e of exercised.slice(0, 30)) {
      lines.push(`  evidence ${e.subject}: ${e.outcome}${e.status ? ` (HTTP ${e.status})` : ''} — ${e.detail}`);
    }
  }

  if (policyDirectives.length > 0) {
    lines.push('\nPlatform review policy in force (authored as governance policy gates):');
    for (const d of policyDirectives.slice(0, 20)) lines.push(`  - ${d}`);
  }

  return lines.join('\n');
}

/**
 * The policy the operator has authored, as sentences.
 *
 * Read from the REVIEW SANDBOX workspace's packs, because that workspace is the
 * platform's own reviewing identity — the same one the dynamic stage installs
 * into. A pack authored there governs every submission; a pack on a publisher's
 * own workspace governs their runs and has no business setting the bar they are
 * reviewed against.
 */
async function reviewPolicyDirectives(ctx: ReviewStageContext): Promise<string[]> {
  const sandboxTenantId = await resolveSandboxTenantId(ctx.db);
  if (sandboxTenantId === null) return [];
  const gates = await resolvePolicyGates(ctx.env, ctx.db, { tenantId: sandboxTenantId });
  return gates
    .map((g) => (g.directive ?? g.reason ?? '').trim())
    .filter((d) => d.length > 0);
}

export const agenticStage: ReviewStage = {
  key: 'agentic',
  order: 30,
  applies: () => true,

  async run(ctx: ReviewStageContext): Promise<StageResult> {
    const started = Date.now();

    let directives: string[] = [];
    try {
      directives = await reviewPolicyDirectives(ctx);
    } catch {
      // Policy is an INPUT to the judgement, not a precondition for it. A packs
      // read that fails degrades to "no operator policy in force", which is the
      // state of every deployment that has not authored one.
      directives = [];
    }

    const prompt = describeSubmission(ctx, directives);
    let content = '';
    try {
      const result = await ideProxy(ctx.env).complete({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        max_tokens: 900,
        response_format: RESPONSE_SCHEMA,
        useCase: 'extension_governance_review',
      });
      if (result.response.status >= 400) {
        return skipped('agentic', `the governance reviewer was unavailable (gateway ${result.response.status}) — this submission was not judged`, started);
      }
      content = (await readProxyChoice(result)).content;
    } catch (error) {
      return skipped('agentic', `the governance reviewer could not be reached: ${error instanceof Error ? error.message : 'unknown error'}`, started);
    }

    if (!content) return skipped('agentic', 'the governance reviewer returned nothing — this submission was not judged', started);

    let parsed: GovernanceVerdict;
    try {
      parsed = JSON.parse(content) as GovernanceVerdict;
    } catch {
      return skipped('agentic', 'the governance reviewer\'s answer was not valid JSON — this submission was not judged', started);
    }

    const reasons = (parsed.reasons ?? [])
      .map((r) => ({
        code: String(r?.code ?? 'governance').replace(/[^a-z0-9_]+/gi, '_').slice(0, 48).toLowerCase(),
        severity: r?.severity === 'fail' ? ('fail' as const) : ('warn' as const),
        message: String(r?.message ?? '').trim(),
      }))
      .filter((r) => r.message.length > 0);

    let verdictWord = parsed.verdict === 'block' ? 'block' : parsed.verdict === 'flag' ? 'flag' : 'approve';

    // A refusal with nothing behind it is not a review. Downgraded rather than
    // trusted, and the downgrade is recorded so the behaviour is visible if it
    // starts happening often.
    if (verdictWord === 'block' && !reasons.some((r) => r.severity === 'fail')) {
      verdictWord = 'flag';
      reasons.push({
        code: 'unexplained_block',
        severity: 'warn',
        message: 'the governance reviewer refused the submission without naming a specific objection, so the refusal was downgraded to a flag — a human should look at this package',
      });
    }

    const findings: ReviewFinding[] = reasons.map((r) => finding(r.code, r.severity, r.message));
    if (findings.length === 0) {
      findings.push(finding('governance_review', 'pass', 'the governance reviewer found the requested permissions proportionate to the declared behaviour'));
    }

    const evidence: StageEvidence[] = [
      {
        subject: 'governance_verdict',
        outcome: verdictWord === 'block' ? 'fail' : verdictWord === 'flag' ? 'warn' : 'pass',
        detail: `verdict "${verdictWord}" over ${ctx.scopes.length} requested scope(s), ${ctx.priorStages.size} prior stage(s) and ${directives.length} operator policy directive(s)`,
        durationMs: Date.now() - started,
      },
      ...reasons.map((r): StageEvidence => ({
        subject: r.code,
        outcome: r.severity === 'fail' ? 'fail' : 'warn',
        detail: r.message,
      })),
    ];

    return {
      stage: 'agentic',
      verdict: verdictFor(findings),
      findings,
      evidence,
      durationMs: Date.now() - started,
    };
  },
};
