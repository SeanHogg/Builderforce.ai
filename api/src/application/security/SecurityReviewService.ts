/**
 * SecurityReviewService — runs an LLM security review of supplied code/diff,
 * executing AS the agent assigned to security for the tenant (canonical
 * agent-assignment model, scope='security'). This is the run-path that makes a
 * security agent assignment actually do something: a workforce agent routes the
 * review to its own model; otherwise the gateway's default cascade is used.
 *
 * Mirrors ArchitectAnalysisService's gateway-JSON pattern (response_format
 * json_object) so even a weak model yields a clean, structured finding list.
 */
import { ideProxy } from '../llm/LlmProxyService';
import { AgentAssignmentService } from '../agent/AgentAssignmentService';
import { resolveAssignedAgent, type AgentKind } from '../swimlane/resolveAssignedAgent';
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

export class SecurityReviewService {
  private readonly assignments: AgentAssignmentService;
  constructor(private readonly db: Db, private readonly env: Env) {
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

    const result = await ideProxy(this.env).complete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
      temperature: 0.1,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
      useCase: 'security_review',
      ...(preferredModel ? { model: preferredModel } : {}),
    });

    const raw = await result.response.json().catch(() => null);
    const content = extractContent(raw);
    const parsed = content ? safeParse(content) : null;
    const findings = normalizeFindings(parsed?.findings);
    const summary =
      typeof parsed?.summary === 'string' && parsed.summary.trim()
        ? parsed.summary
        : `${findings.length} finding(s).`;

    return {
      findings,
      summary,
      model: result.resolvedModel ?? null,
      ranAsAssignedAgent: preferredModel != null,
    };
  }
}

function extractContent(raw: unknown): string | null {
  const choice = (raw as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0];
  const content = choice?.message?.content;
  return typeof content === 'string' ? content : null;
}

function safeParse(text: string): { summary?: unknown; findings?: unknown } | null {
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = fenced?.[1] ?? text;
    return JSON.parse(jsonText.trim());
  } catch {
    return null;
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
