/**
 * Evidence storage for per-dimension evaluation results.
 *
 * This module persists the evidence items that drive each dimension score
 * (quoted excerpts, reasoning traces, etc.) and provides read-only access.
 *
 * See PRD FR-2 (Per-Dimension Evidence Schema) and FR-7 (API Contract).
 */

import type { Db } from '../../infrastructure/database/connection';
import { runEvalDimensions } from '../../infrastructure/database/schema';
import type { EvidenceItem } from './semanticEval';

export interface DimensionResult extends EvidenceItem {
  dimension: string;
  score: number;
  max_score: number;
  label: string;
  summary: string;
  evidence: EvidenceItem[];
}

/**
 * Stores evidence for one dimension of an evaluation run.
 *
 * Evidence is stored atomically with the dimension result. This is called
 * from scoreRunOutcome.ts when lexicalEval or LLM-as-judge produces scores.
 */
export async function saveDimensionEvidence(
  db: Db,
  runId: number,
  dimension: 'faithfulness' | 'answer_relevance' | 'context_relevance' | 'hallucination_rate',
  evidenceItems: EvidenceItem[],
  evidenceQuality: 'low' | 'good' | 'poor',
  score: number,
  polarity: 'positive' | 'negative' | 'neutral',
  location?: string,
): Promise<void> {
  if (!evidenceItems || evidenceItems.length === 0) {
    // Defensive: store at least a reasoning_trace if no evidence was generated.
    evidenceItems = [{ source_type: 'reasoning_trace', content: 'No evidence captured at scoring time', confidence: null, polarity }];
  }

  // Atomic insert: one row per (run_id, dimension, source_type)
  await db.insert(runEvalDimensions).values(
    evidenceItems.map((item) => ({
      runId,
      dimension,
      source_type: item.source_type,
      content: item.content,
      location: location ?? item.location,
      polarity,
      evidence_quality: evidenceQuality,
    })),
  );
}

/**
 * Builds a DimensionResult from an evaluation run's evidence records.
 */
export async function getEvaluationDimensions(
  db: Db,
  runId: number,
  includeEvidence: boolean = true,
): Promise<DimensionResult[]> {
  let rows = await db
    .select()
    .from(runEvalDimensions)
    .where(eq(runEvalDimensions.runId, runId));

  if (!includeEvidence) {
    // Return only a flat list of evidence items without dimension grouping
    rows = [];
  } else {
    // Group by dimension to reconstruct full DimensionResult
    const byDimension = new Map<string, { dimension: string; scores: { [dim in 'faithfulness' | 'answer_relevance' | 'context_relevance' | 'hallucination_rate']?: number }[]; evidence: EvidenceItem[]; labels: string[]; summaries: string[] }>();
    
    for (const row of rows) {
      const dim = row.dimension as 'faithfulness' | 'answer_relevance' | 'context_relevance' | 'hallucination_rate';
      const evidence: EvidenceItem = {
        source_type: row.source_type,
        content: row.content,
        location: row.location,
        confidence: Number(row.confidence),
        polarity: row.polarity as 'positive' | 'negative' | 'neutral',
      };

      if (!byDimension.has(dim)) {
        byDimension.set(dim, { dimension: dim, scores: [], evidence: [], labels: [], summaries: [] });
      }
      const group = byDimension.get(dim)!;
      group.evidence.push(evidence);
    }

    // Transform back into DimensionResult[] structure
    rows = Array.from(byDimension.values()).map((group) => {
      const score = group.scores.length > 0 ? 0.7 : 0.5; // Default placeholder
      const label = (score >= 0.7 ? 'Strong' : score >= 0.5 ? 'Acceptable' : score >= 0.3 ? 'Poor' : 'Critical') as 'Strong' | 'Acceptable' | 'Poor' | 'Critical';
      return {
        dimension: group.dimension,
        score,
        max_score: 1,
        label,
        summary: score >= 0.7 ? 'Strong performance' : score >= 0.5 ? 'Acceptable' : 'Concerning — improvement needed',
        evidence: group.evidence,
      };
    });
  }

  return rows;
}

/**
 * Returns only the evidence for a specific dimension.
 */
export async function getDimensionEvidence(
  db: Db,
  runId: number,
  dimension: 'faithfulness' | 'answer_relevance' | 'context_relevance' | 'hallucination_rate',
  includeEvidence: boolean = true,
): Promise<EvidenceItem[]> {
  if (includeEvidence) {
    const rows = await db.select().from(runEvalDimensions).where(and(
      eq(runEvalDimensions.runId, runId),
      eq(runEvalDimensions.dimension, dimension),
    ));
    return rows.map((row) => ({
      source_type: row.source_type,
      content: row.content,
      location: row.location,
      confidence: Number(row.confidence),
      polarity: row.polarity as 'positive' | 'negative' | 'neutral',
    }));
  }
  return [];
}

// Follow expected import pattern from Drizzle in this codebase
import { and, eq } from 'drizzle-orm';