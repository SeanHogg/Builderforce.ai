/**
 * AI-Powered Resolution Plan — deterministic analysis of diagnostic data.
 *
 * Rules-based recommendation generation:
 *   - Risk Mitigation: threat signals (low scores, high gaps, blocked tasks, overdue)
 *   - Schedule Acceleration: slippage indicators (negative variance, high in_review count, low done %)
 *   - Quality Improvement: defect density signals (low scores, high gap count, repeated issues)
 *   - Resource Optimization: overbuy/underbuy signals (agent count, task count, utilization hints)
 *   - Dependency Resolution: blocked downstream, critical-path blockers
 *
 * Each recommendation includes an estimated impact and confidence band (low/medium/high).
 * If rules don't surface enough issues, an LLM fallback can enrich recommendations.
 */

import type { ProjectScore, ProjectDiagnostic, ToolResult } from './tools';

// ----------------------------------------------------------------------
// Domain types mirroring the PRD
// ----------------------------------------------------------------------

export type RecommendationCategory = 'Risk Mitigation' | 'Schedule Acceleration' | 'Quality Improvement' | 'Resource Optimization' | 'Dependency Resolution';

export type Confidence = 'low' | 'medium' | 'high';

export interface LinkedDataItem {
  kind: 'task' | 'agent' | 'budget' | 'bug' | 'dependency' | 'project';
  id: string;
  label: string;
  tooltip?: string;
}

export interface EstimatedImpact {
  value: string; // plain-language projection
  confidence: Confidence;
}

export interface Recommendation {
  id: string;
  action: string;
  category: RecommendationCategory;
  linkedData: LinkedDataItem[];
  impact: EstimatedImpact;
  responsibleParty: 'PM' | 'Tech Lead' | 'Engineering' | 'Developer';
  suggestedDeadline: string; // ISO date
  reasonForSuggestion: string; // backlink to the diagnostic signal
}

export interface ResolutionPlan {
  version: string; // timestamp + trigger type
  generatedAt: string;
  triggerType: 'on_demand' | 'auto_trigger' | 'manual';
  diagnosticsSnapshot: ProjectScore; // complete snapshot used for generation
  recommendations: Recommendation[];
}

export interface ResolveAction {
  recommendationId: string;
  action: 'accept' | 'reject' | 'defer';
  reason?: string;
}

export interface DeferConfig {
  recommendationId: string;
  deferDate: string; // ISO date
}

// ----------------------------------------------------------------------
// Helper types for rule-based analysis
// ----------------------------------------------------------------------

interface IssueSignal {
  type: RecommendationCategory;
  severity: 'high' | 'medium' | 'low';
  signalSource: string; // human-readable
  hints: string[];
}

// ----------------------------------------------------------------------
// Rule engine: analyze a ProjectScore and surface signals
// ----------------------------------------------------------------------

/**
 * Apply heuristic rules to infer issues from diagnostics.
 * Returns a flat list of signals sorted by severity (descending).
 */
export function analyzeProjectHealthSignals(
  score: ProjectScore,
  insight?: 'full' | 'light'
): IssueSignal[] {
  const diagnostics = score.diagnostics;
  const issues: IssueSignal[] = [];

  // 1. Overall score risk
  const overallScore = score.result.score;
  if (overallScore != null) {
    const rank = overallScore >= 4 ? 'high' : overallScore >= 3 ? 'medium' : 'low';
    issues.push({
      type: 'Risk Mitigation',
      severity: rank,
      signalSource: `Overall project health score ${overallScore.toFixed(1)} / 5`,
      hints: ['Review all diagnostics for actionable gaps.'],
    });
  }

  // 2. Diagnostic-specific signals (top 3 low-scoring diagnostics)
  const sortedDiagnostics = diagnostics
    .filter((d) => d.score != null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 3);

  for (const diag of sortedDiagnostics) {
    const diagScore = diag.score ?? 0;
    if (diagScore < 3) {
      const severity = diagScore < 2 ? 'high' : 'medium';
      issues.push({
        type: 'Quality Improvement',
        severity,
        signalSource: `${diag.name}: score ${diagScore.toFixed(1)} / 5`,
        hints: [diag.headline || 'Review diagnostic requirements.'],
      });
    }
  }

  // 3. Gap/defect density signals
  const gapLabels: RecommendationCategory[] = [];
  for (const diag of diagnostics) {
    if (diag.gapCount > 12) {
      gapLabels.push('Quality Improvement');
    } else if (diag.gapCount > 6) {
      gapLabels.push('Quality Improvement');
    } else if (diag.gapCount > 0) {
      gapLabels.push('Risk Mitigation');
    }
  }
  for (const category of ['Quality Improvement', 'Risk Mitigation'] as RecommendationCategory[]) {
    const count = gapLabels.filter((l) => l === category).length;
    if (count >= 2) {
      const severity = count >= 4 ? 'high' : 'medium';
      issues.push({
        type: category,
        severity,
        signalSource: `Multiple diagnostics flagged gaps (${count} in sum)`,
        hints: ['Consolidate related gaps and pair them with concrete actions.'],
      });
    }
  }

  // 4. Deadline/urgency detection (look for overdue tasks in result.metrics)
  if (insight === 'full' || insight === undefined) {
    const overdueMetric = score.result.metrics.find((m) => m.label.toLowerCase().includes('overdue') || m.label.toLowerCase().includes('days behind'));
    if (overdueMetric) {
      const value = overdueMetric.value;
      // Very simplified heuristic: if value contains a number behind schedule
      const behindMatch = value.match(/(\d+)\s*(?:day|week)s?/i);
      if (behindMatch) {
        const daysBehind = parseInt(behindMatch[1], 10);
        issues.push({
          type: 'Schedule Acceleration',
          severity: daysBehind >= 14 ? 'high' : daysBehind >= 7 ? 'medium' : 'low',
          signalSource: `Schedule lag detected: ${value}`,
          hints: ['Schedule tasks to simplify, negotiate scope, or accelerate delivery.'],
        });
      }
    }
  }

  // 5. Defect density from metrics
  const defectMetric = score.result.metrics.find((m) => m.label.toLowerCase().includes('defect') || m.label.toLowerCase().includes('bug') || m.label.toLowerCase().includes('issue'));
  if (defectMetric) {
    issues.push({
      type: 'Quality Improvement',
      severity: 'medium',
      signalSource: `Defect density signal: ${defectMetric.value}`,
      hints: ['Target testing and code review to reduce bugs without halting.'],
    });
  }

  // 6. Resource-utilization signal (if available)
  const utilizationMetrics = score.result.metrics.filter((m) => m.label.toLowerCase().includes('utilization') || m.label.toLowerCase().includes('agent') || m.label.toLowerCase().includes('capacity'));
  for (const metric of utilizationMetrics) {
    if (metric.tier != null) {
      const severity = metric.tier >= 4 ? 'high' : metric.tier >= 2 ? 'medium' : 'low';
      issues.push({
        type: 'Resource Optimization',
        severity,
        signalSource: `${metric.label}: ${metric.value}`,
        hints: ['Adjust workload or onboard new agents if overloaded.'],
      });
    }
  }

  // 7. Dependency/chain signal
  const chainMetric = score.result.metrics.find((m) => m.label.toLowerCase().includes('critical path') || m.label.toLowerCase().includes('blocked') || m.label.toLowerCase().includes('blocker') || m.label.toLowerCase().includes('dependency'));
  if (chainMetric) {
    const value = chainMetric.value.toLowerCase();
    if (value.includes('blocked') || value.includes('blocker')) {
      issues.push({
        type: 'Dependency Resolution',
        severity: 'medium',
        signalSource: `Dependency chain: ${metricResultLabel(chainMetric)}`,
        hints: ['Identify unblocking actions to keep critical path clear.'],
      });
    }
  }

  return issues;
}

// ----------------------------------------------------------------------
// Suggestion generator: turn signals into concrete recommendations
// ----------------------------------------------------------------------

/**
 * Generate a prioritized set of recommendations from signals, constrained to at most 10.
 * Lower-severity signals are pruned if we exceed the limit.
 */
export function generateRecommendations(projectId: number, signals: IssueSignal[]): Recommendation[] {
  if (signals.length === 0) {
    return [
      {
        id: 'plan-0',
        action: 'Monitor project health — no immediate action required',
        category: 'Risk Mitigation',
        linkedData: [{ kind: 'project', id: String(projectId), label: `Project #${projectId}` }],
        impact: { value: 'Maintains stable project health', confidence: 'high' },
        responsibleParty: 'PM',
        suggestedDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        reasonForSuggestion: 'All health signals are healthy',
      },
    ];
  }

  const recs: Recommendation[] = [];
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  for (const signal of signals) {
    const id = `plan-${recs.length + 1}`;

    let action = '';
    let responsibleParty: Recommendation['responsibleParty'] = 'PM';
    let suggestedDeadline = nextWeek;
    let linkedData: LinkedDataItem[] = [{ kind: 'project', id: String(projectId), label: `Project #${projectId}` }];
    const confidence: Recommendation['impact']['confidence'] = signal.severity === 'high' ? 'low' : signal.severity === 'medium' ? 'medium' : 'high'; // hueristic: high severity = less confidence

    switch (signal.type) {
      case 'Risk Mitigation':
        action = 'Review and address highest-priority gaps immediately';
        responsibleParty = 'PM';
        suggestedDeadline = today;
        linkedData.push({ kind: 'security', id: `diag-${signal.signalSource}`, label: signal.signalSource });
        break;
      case 'Schedule Acceleration':
        action = 'Re-prioritize tasks to clear backlog, defer optional scope';
        responsibleParty = 'Tech Lead';
        suggestedDeadline = nextWeek;
        linkedData.push({ kind: 'deadline', id: `diag-${signal.signalSource}`, label: signal.signalSource });
        break;
      case 'Quality Improvement':
        action = 'Increase testing coverage and targeted code review for unstable areas';
        responsibleParty = 'Tech Lead';
        suggestedDeadline = nextMonth;
        linkedData.push({ kind: 'quality', id: `diag-${signal.signalSource}`, label: signal.signalSource });
        break;
      case 'Resource Optimization':
        action = 'Optimize agent/human workload and consider additional capacity if over-allocated';
        responsibleParty = 'Engineering';
        suggestedDeadline = nextWeek;
        linkedData.push({ kind: 'capacity', id: `diag-${signal.signalSource}`, label: signal.signalSource });
        break;
      case 'Dependency Resolution':
        action = 'Unblock critical path by resolving key dependencies or finding alternatives';
        responsibleParty = 'Engineering';
        suggestedDeadline = nextMonth;
        linkedData.push({ kind: 'dependency', id: `diag-${signal.signalSource}`, label: signal.signalSource });
        break;
    }

    recs.push({
      id,
      action,
      category: signal.type,
      linkedData,
      impact: { value: `Medium-impact action`, confidence },
      responsibleParty,
      suggestedDeadline,
      reasonForSuggestion: signal.signalSource,
    });

    // Botany robustness: cap at 10
    if (recs.length >= 10) break;
  }

  // Simple priority ordering: high severity first, then by category order
  const catOrder = new Map([
    ['Risk Mitigation', 0],
    ['Schedule Acceleration', 1],
    ['Quality Improvement', 2],
    ['Resource Optimization', 3],
    ['Dependency Resolution', 4],
  ]);
  return recs.sort((a, b) => {
    const aIdx = catOrder.get(a.category) ?? 99;
    const bIdx = catOrder.get(b.category) ?? 99;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.id.localeCompare(b.id);
  });
}

// ----------------------------------------------------------------------
// Plan snapshot
// ----------------------------------------------------------------------

/**
 * Create a complete ResolutionPlan snapshot from a ProjectScore.
 */
export function createResolutionPlan(
  projectId: number,
  projectScore: ProjectScore,
  triggerType: ResolutionPlan['triggerType'] = 'on_demand'
): ResolutionPlan {
  const signals = analyzeProjectHealthSignals(projectScore, triggerType === 'auto_trigger' ? 'full' : 'light');
  const recommendations = generateRecommendations(projectId, signals);

  const triggerName: Record<ResolutionPlan['triggerType'], string> = {
    on_demand: 'Manual request',
    auto_trigger: 'Health threshold breach',
    manual: 'Retrigger',
  };

  const now = new Date().toISOString();
  return {
    version: `${now}-${triggerType}`,
    generatedAt: now,
    triggerType,
    diagnosticsSnapshot: projectScore,
    recommendations,
  };
}

// ----------------------------------------------------------------------
// LLM fallback (optional, unused when rules suffice)
// ----------------------------------------------------------------------

/**
 * Enrich recommendations with LLM-generated insights if rule-based output
 * is under a threshold (e.g., fewer than 2 items).
 * This is a placeholder for an optional LLM call if the project opts in.
 */
export async function llmEnrichRecommendations(
  projectScore: ProjectScore,
  candidateRecs?: Recommendation[]
): Promise<Recommendation[]> {
  // Not implemented in this v1 — the rule-based engine is the default.
  // If the project迫切ly needs LLM enrichment, this function can be wired to
  // llmChat from builderforceApi.ts.
  return candidateRecs ?? [];
}

// ----------------------------------------------------------------------
// Helper utilities
// ----------------------------------------------------------------------

function metricResultLabel(metric: ToolResult['metrics'][0]): string {
  const label = metric.label || '';
  const value = metric.value || '';
  return value ? `${label}: ${value}` : label;
}

/**
 * Render confidence band as a textual description.
 */
export function confidenceLabel(confidence: Confidence): string {
  const map: Record<Confidence, string> = {
    low: 'Low confidence',
    medium: 'Medium confidence',
    high: 'High confidence',
  };
  return map[confidence];
}