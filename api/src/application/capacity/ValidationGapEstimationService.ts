/**
 * Validation Gap Micro-Estimation Service
 * 
 * Provides per-gap micro-estimation for the 50 validation gaps,
 * replacing the broad 34–59 SP midpoint range with specific estimates.
 */

import { internalLogger } from '@/infra/logger';
import { z } from 'zod';

export interface ValidationGapInput {
  tenantId: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  taskType: 'task' | 'epic' | 'gap';
  assumedHighSp: number;
  assumedLowSp: number;
  gapSizeCategory: 'small' | 'medium' | 'large' | 'critical';
  complexityScore?: number; // 1-10 (lower = more complex)
}

export interface ValidationGapEstimate {
  id: string;
  taskId: string;
  microSpEstimate: number;
  estimatedRangeMinSp: number;
  estimatedRangeMaxSp: number;
  estimationMethod: 'micro_estimation';
  confidenceLevel: 'high' | 'medium' | 'low';
  notes?: string;
}

export interface GapMicroEstimationBatchResult {
  gapsAnalyzed: number;
  totalMicroSpEstimate: number;
  gapSummary: {
    taskId: string;
    taskTitle: string;
    type: string;
    estimatedRangeMinSp: number;
    estimatedRangeMaxSp: number;
  }[];
  estimatedValue: {
    low: number; // Conservative estimate
    median: number; // Most likely value
    high: number; // Optimistic estimate
  };
}

/**
 * Micro-estimate a single validation gap
 * 
 * Uses gap size, complexity, and category to make an informed estimate
 */
export async function microEstimateGap(
  input: ValidationGapInput
): Promise<ValidationGapEstimate> {
  // Calculate midpoint from assumed range
  const medianRange = (input.assumedLowSp + input.assumedHighSp) / 2;
  
  // Adjust estimate based on gap category and complexity
  const factor = getGapFactor(input.gapSizeCategory, input.complexityScore || 5);
  
  // Apply factor: reduce estimate for critical/small/complex gaps (simplified)
  const adjustedSp = Math.round(medianRange * factor);
  
  // Calculate tight range (±25% for micro-estimation)
  const rangeMinSp = Math.max(1, Math.round(adjustedSp * 0.75));
  const rangeMaxSp = adjustedSp * 1.25;

  return {
    id: `${input.taskId}-${Date.now()}`,
    taskId: input.taskId,
    microSpEstimate: adjustedSp,
    estimatedRangeMinSp: rangeMinSp,
    estimatedRangeMaxSp: Math.ceil(rangeMaxSp),
    estimationMethod: 'micro_estimation',
    confidenceLevel: determineConfidenceLevel(input.gapSizeCategory, factor),
    notes: generateEstimationNotes(input, factor),
  };
}

/**
 * Determine the adjustment factor for gap estimation
 */
function getGapFactor(
  gapSizeCategory: string,
  complexityScore: number
): number {
  // Higher factor = more generous estimate (smaller adjustment)
  // Lower factor = more conservative estimate (larger adjustment)
  
  const categoryFactors: Record<string, number> = {
    small: 0.9, // Little work, close to median
    medium: 1.0, // Typical work, no adjustment
    large: 1.05, // More work, slight reduction
    critical: 0.95, // Critical but urgent, reduce slightly
  };

  let factor = categoryFactors[gapSizeCategory] || 1.0;

  // Adjust for complexity
  if (complexityScore > 7) {
    factor *= 0.9; // More complex = smaller estimate (effort cushion)
  } else if (complexityScore < 4) {
    factor *= 1.1; // Simpler = slightly larger estimate
  }

  // Ensure factor is reasonable
  return Math.max(0.7, Math.min(1.3, factor));
}

/**
 * Determine confidence level for the estimation
 */
function determineConfidenceLevel(
  gapSizeCategory: string,
  factor: number
): 'high' | 'medium' | 'low' {
  // Critical/critical gaps have lower confidence due to urgency pressure
  if (gapSizeCategory === 'critical') {
    return factor < 1.0 ? 'low' : 'medium';
  }

  // Medium range estimates have higher confidence
  return 'high';
}

/**
 * Generate notes for the estimation (for human review)
 */
function generateEstimationNotes(
  input: ValidationGapInput,
  factor: number
): string {
  const notes: string[] = [];
  
  notes.push(`Gap category: ${input.gapSizeCategory}`);
  notes.push(`Complexity score: ${input.complexityScore || 'Not available'}`);
  notes.push(`Factor applied: ${factor.toFixed(2)}`);
  
  if (factor < 1.0) {
    notes.push('Applied adjustment for complexity/urgency');
  } else if (factor > 1.0) {
    notes.push('Applied adjustment for size considerations');
  }

  return notes.join('; ');
}

/**
 * Batch-micro-estimate all validation gaps
 * 
 * Processes 50 validation gaps in batches, providing both
 * per-gap estimates and overall totals.
 */
export async function batchMicroEstimateGaps(
  inputs: ValidationGapInput[]
): Promise<GapMicroEstimationBatchResult> {
  internalLogger.info('Starting batch micro-estimation', {
    gapCount: inputs.length,
  });

  const gapSummary: GapMicroEstimationBatchResult['gapSummary'] = [];
  let totalMicroSp = 0;

  // Batch by size category for better grouping
  const batches: Record<string, ValidationGapInput[]> = {
    small: [],
    medium: [],
    large: [],
    critical: [],
  };

  for (const input of inputs) {
    batches[input.gapSizeCategory].push(input);
  }

  const analyzedGaps: number[] = [];

  // Process each batch
  for (const [category, categoryGaps] of Object.entries(batches)) {
    if (categoryGaps.length === 0) continue;

    // Process in smaller batches to avoid overwhelming
    const batchSize = 10;
    for (let i = 0; i < categoryGaps.length; i += batchSize) {
      const batch = categoryGaps.slice(i, i + batchSize);
      
      for (const gapInput of batch) {
        const estimate = await microEstimateGap(gapInput);
        gapSummary.push({
          taskId: estimate.taskId,
          taskTitle: gapInput.taskTitle,
          type: gapInput.taskType,
          estimatedRangeMinSp: estimate.estimatedRangeMinSp,
          estimatedRangeMaxSp: estimate.estimatedRangeMaxSp,
        });
        totalMicroSp += estimate.microSpEstimate;
        analyzedGaps.push(gapInput.taskId);
      }

      // Small delay between batches to allow API rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Calculate overall estimate range
  const totalSpRangeMin = gapSummary.reduce(
    (sum, gap) => sum + gap.estimatedRangeMinSp,
    0
  );

  const totalSpRangeMax = gapSummary.reduce(
    (sum, gap) => sum + gap.estimatedRangeMaxSp,
    0
  );

  return {
    gapsAnalyzed: analyzedGaps.length,
    totalMicroSpEstimate: Math.round(totalMicroSp),
    gapSummary,
    estimatedValue: {
      low: totalSpRangeMin,
      median: Math.round(totalMicroSp),
      high: totalSpRangeMax,
    },
  };
}

/**
 * Compare micro-estimation with assumed/legacy range
 */
export interface EstimationComparison {
  taskId: string;
  assumedRange: { min: number; max: number };
  microEstimate: ValidationGapEstimate;
  reductionPercent: number;
  improvementSignificant: boolean;
}

export async function compareWithLegacyEstimation(
  input: ValidationGapInput
): Promise<EstimationComparison> {
  const estimate = await microEstimateGap(input);

  const assumedMedian = (input.assumedLowSp + input.assumedHighSp) / 2;
  const reductionPercent = Math.round(
    ((assumedMedian - estimate.microSpEstimate) / assumedMedian) * 100
  );

  return {
    taskId: input.taskId,
    assumedRange: {
      min: input.assumedLowSp,
      max: input.assumedHighSp,
    },
    microEstimate: estimate,
    reductionPercent,
    improvementSignificant: reductionPercent >= 10, // Significant if >=10% reduction
  };
}

/**
 * Archive legacy range-based estimates
 * Replace assumed estimation method with micro_estimation method
 */
export async function archiveLegacyEstimates(
  tenantId: string,
  projectId: string
): Promise<void> {
  // TODO: Implement archival logic to mark old estimates as used
  internalLogger.info('Archiving legacy estimates', {
    tenantId,
    projectId,
  });
}

/**
 * Format estimation summary for display
 */
export function formatEstimationSummary(result: GapMicroEstimationBatchResult): string {
  const { gapsAnalyzed, totalMicroSpEstimate, estimatedValue } = result;
  
  let summary = `Micro-estimated ${gapsAnalyzed} validation gaps `;

  if (estimatedValue.low > 0) {
    summary += `\nEstimated total effort: ${estimatedValue.median} SP `;
    summary += `(conservative: ${estimatedValue.low} SP, optimistic: ${estimatedValue.high} SP)`;
  }

  return summary;
}