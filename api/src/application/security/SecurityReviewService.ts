/**
 * SecurityReviewService — runs an LLM security review of supplied code/diff,
 * executing AS the agent assigned to security for the tenant (canonical
 * agent-assignment model, scope='security'). This is the run-path that makes a
 * security agent assignment actually do something: a workforce agent routes the
 * review to its own model; otherwise the gateway's default cascade is used.
 *
 * Structured output goes through `completeJson` (json_object) like every other
 * gateway-JSON call, so even a weak model yields a clean, structured finding list —
 * and a gateway failure is a failure, never "0 finding(s)".
 */
import { TenantAiService } from '../llm/tenantProxy';
import { completeJson, JSON_OBJECT_FORMAT } from '../llm/completeJson';
import { AgentAssignmentService } from '../agent/AgentAssignmentService';
import { resolveAssignedAgent, type AgentKind } from '../swimlane/resolveAssignedAgent';
import { ServiceUnavailableError } from '../../domain/shared/errors';
import { asJsonObject } from '../../domain/shared/json';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export interface SecurityFinding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
  location?: string;
  recommendation?: string;
}

export interface SecurityReviewResult {
  findings: SecurityFinding[];
  summary: string;
  /** The model that actually ran (the assigned agent's, or the default). */
  model: string | null;
  /** True when an assigned security agent's model was used. */
  ranAsAssignedAgent: boolean;
}

const SYSTEM_PROMPT =
  'You are a senior application security engineer. Review the provided code or diff for ' +
  'security vulnerabilities (injection, authz/authn flaws, secret exposure, SSRF, unsafe ' +
  'deserialization, path traversal, crypto misuse, etc.). Respond ONLY with a JSON object: ' +
  '{ "summary": string, "findings": [ { "severity": "critical|high|medium|low|info", "title": string, ' +
  '"detail": string, "location": string, "recommendation": string } ] }. If nothing is found, return an empty findings array.';

/** What the summary says when the model answered but not with a finding list. */
export const UNREADABLE_REVIEW_SUMMARY = 'The reviewer returned no readable finding list — treat this review as not run.';

export class SecurityReviewService extends TenantAiService {
  private readonly assignments: AgentAssignmentService;
  constructor(private readonly db: Db, env: Env) {
    super(env);
    this.assignments = new AgentAssignmentService(db, env);
  }

  /** Resolve the concrete model of the agent assigned to security via the shared
   *  resolveAssignedAgent (workforce → its base_model; registered → null → default). */
  private async resolveSecurityAgentModel(tenantId: number): Promise<string | undefined> {
    const [a] = await this.assignments.list(tenantId, 'security');
    if (!a) return undefined;
    try {
      const resolved = await resolveAssignedAgent(this.db, tenantId, {
        agentKind: a.agentKind as AgentKind,
        agentRef: a.agentRef,
      });
      return resolved.model ?? undefined;
    } catch {
      return undefined;
    }
  }

  async review(tenantId: number, input: { code: string; context?: string }): Promise<SecurityReviewResult> {
    if (!input.code?.trim()) {
      return { findings: [], summary: 'No code supplied for review.', model: null, ranAsAssignedAgent: false };
    }
    const preferredModel = await this.resolveSecurityAgentModel(tenantId);
    const user = input.context?.trim()
      ? `Context: ${input.context}\n\n----\n${input.code}`
      : input.code;

    // The security agent reviewing the tenant's code → the tenant dispatch runs it on the
    // tenant's connected BYO account when present; the agent's configured base model is
    // honored only when it preempts the BYO seed (its own account), else the connected
    // flagship leads. Metered under `security_review`.
    const out = await completeJson(
      { kind: 'tenant', env: this.aiEnv, tenantId, opts: { meterUseCase: 'security_review', explicitModel: preferredModel } },
      { system: SYSTEM_PROMPT, user, schema: JSON_OBJECT_FORMAT, temperature: 0.1, maxTokens: 2048, useCase: 'security_review' },
      asJsonObject,
    );
    // A review that never ran is not a clean review: answering "0 finding(s)" for a
    // gateway failure read, to whoever asked, as a clean bill of health.
    if (!out.ok && out.reason === 'gateway') {
      throw new ServiceUnavailableError('The security review model is unavailable right now.');
    }

    const parsed = out.ok ? out.value : null;
    const findings = normalizeFindings(parsed?.findings);
    const summary =
      typeof parsed?.summary === 'string' && parsed.summary.trim()
        ? parsed.summary
        : parsed ? `${findings.length} finding(s).` : UNREADABLE_REVIEW_SUMMARY;

    return {
      findings,
      summary,
      model: (out.ok ? out.model : out.result?.resolvedModel) ?? null,
      ranAsAssignedAgent: preferredModel != null,
    };
  }
}

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);

function normalizeFindings(input: unknown): SecurityFinding[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((f) => f as Record<string, unknown>)
    .filter((f) => typeof f.title === 'string')
    .map((f) => ({
      severity: SEVERITIES.has(String(f.severity)) ? (f.severity as SecurityFinding['severity']) : 'info',
      title: String(f.title),
      detail: typeof f.detail === 'string' ? f.detail : '',
      location: typeof f.location === 'string' ? f.location : undefined,
      recommendation: typeof f.recommendation === 'string' ? f.recommendation : undefined,
    }));
}
