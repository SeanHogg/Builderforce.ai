/**
 * `compile('diagnostic')` — closes the loop the diagnostic engine never closed: a
 * `tool_run`'s findings (a maturity score + recommendations) become an *executable
 * improvement process* rather than a dead-end report. Each recommendation lowers to
 * an ordered, chained {@link CompiledStep}; the result is an {@link AgentSpec} the
 * user can review and deploy as a workflow. Deterministic (no LLM needed) so it is
 * robust + unit-testable.
 *
 * When `deps.recallKnowledge` is supplied, the compiler grounds the improvement
 * agent in the tenant's OWN published SOPs/processes: relevant docs are recalled
 * and lowered into `memory.recalledContext`, and each step is annotated with the
 * SOP it should follow — so the compiled agent implements improvements against how
 * the organization actually works, not generic advice. `deps.llm` (when supplied)
 * only refines step descriptions.
 */
import type { AgentSpec } from '@builderforce/agent-tools';
import type { CompiledStep } from '../../domain/workflowGraph';
import type { CompileDeps, DiagnosticNeed, KnowledgeRecallHit } from './types';

/** Lowercase word tokens (len ≥ 4) for cheap overlap scoring. */
function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4),
  );
}

/** Pick the recalled SOP whose title/excerpt best overlaps a recommendation. */
function bestSopFor(recText: string, sops: KnowledgeRecallHit[]): KnowledgeRecallHit | null {
  if (sops.length === 0) return null;
  const recToks = tokens(recText);
  let best: KnowledgeRecallHit | null = null;
  let bestScore = 0;
  for (const sop of sops) {
    const sopToks = tokens(`${sop.title} ${sop.excerpt}`);
    let score = 0;
    for (const t of recToks) if (sopToks.has(t)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = sop;
    }
  }
  return bestScore > 0 ? best : null;
}

export async function compileFromDiagnostic(need: DiagnosticNeed, deps: CompileDeps = {}): Promise<AgentSpec> {
  const { findings } = need;
  const recs = findings.recommendations ?? [];
  const subject = need.subject?.trim() || findings.headline || 'process';

  // Recall the tenant's own SOPs/processes so improvements are grounded in
  // documented practice, not generic advice. Degrades to ungrounded on any error.
  let sops: KnowledgeRecallHit[] = [];
  if (deps.recallKnowledge) {
    const query = [subject, findings.headline, ...recs.map((r) => r.title)].filter(Boolean).join(' ');
    sops = await deps.recallKnowledge(query).catch(() => []);
  }

  const steps: CompiledStep[] = recs.map((rec, i) => {
    const recText = rec.detail ? `${rec.title} — ${rec.detail}` : rec.title;
    const sop = bestSopFor(recText, sops);
    return {
      nodeId: `diag-step-${i + 1}`,
      kind: 'agent' as const,
      role: 'orchestrator' as const,
      description: sop ? `${recText} (follow SOP: "${sop.title}")` : recText,
      config: {
        source: 'diagnostic',
        recommendation: rec.title,
        ...(sop ? { groundingDocId: sop.id, groundingDocTitle: sop.title } : {}),
      },
      dependsOnNodeIds: i === 0 ? [] : [`diag-step-${i}`],
    };
  });

  const recalledContext = sops.length
    ? `The organization's own published procedures relevant to ${subject} — implement improvements consistently with these:\n\n` +
      sops.map((s) => `## ${s.title} (${s.docType})\n${s.excerpt}`).join('\n\n')
    : '';

  const groundingNote = sops.length ? ` Grounded in ${sops.length} of the organization's documented SOP(s).` : '';

  return {
    identity: {
      name: `${subject} Improvement Agent`,
      title: 'Compiled from a diagnostic finding',
      bio: findings.summary
        ? `Implements the improvements a diagnostic proposed for ${subject}. ${findings.summary}${groundingNote}`
        : `Implements the improvements a diagnostic proposed for ${subject}.${groundingNote}`,
    },
    ...(steps.length ? { steps } : {}),
    ...(recalledContext ? { memory: { recalledContext } } : {}),
    surfaces: ['workflow-node', 'cloud-durable'],
  };
}
