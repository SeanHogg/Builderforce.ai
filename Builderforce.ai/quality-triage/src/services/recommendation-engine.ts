/**
 * Recommendation Engine
 *
 * Generates prioritized recommendations for focused testing, code review, or
 * agent-assisted refactoring based on bug analysis.
 */

import { Bug, DefectDensityScore, Hotspot, Recommendation,
  RecommendationType, RecommendationStatus, EffortTier,
  RecommendationOptions } from '../types.js';
import { QualityConfig } from '../types.js';

export interface RecommendationGenerationOptions {
  limit?: number;
  includeTesting: boolean;
  includeReview: boolean;
  includeRefactoring: boolean;
  includeRecurrenceWarnings: boolean;
}

export class RecommendationEngine {
  private hotspots: Hotspot[];
  private recurrencePatterns: { [key: string]: import('../types.js').RecurrencePattern };
  private bugs: Bug[];
  private config: QualityConfig;

  constructor(
    hotspots: Hotspot[],
    recurrencePatterns: Record<string, { file: string; recurrenceCount: number; lastBugDate: string }>,
    bugs: Bug[],
    config: QualityConfig
  ) {
    this.hotspots = hotspots;
    this.bugs = bugs;
    this.config = config;

    // Convert recurrence patterns array to map for easier lookup
    this.recurrencePatterns = {};
    Object.values(recurrencePatterns).forEach((pattern) => {
      this.recurrencePatterns[pattern.file] = pattern;
    });
  }

  /**
   * Generate recommendations for all hotspots
   */
  generateRecommendations(options: RecommendationGenerationOptions = {}): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Generate for each hotspot
    this.hotspots.forEach((hotspot) => {
      const hotspotRecs = this.generateForHotspot(hotspot, options);
      recommendations.push(...hotspotRecs);
    });

    // Recurrence reports as low-priority recommendations
    if (options.includeRecurrenceWarnings) {
      const recurrenceRecs = this.generateRecurrenceRecommendations(options);
      recommendations.push(...recurrenceRecs);
    }

    // Rank by priority (higher score = higher priority)
    recommendations.sort((a, b) => b.priority - a.priority);

    // Limit by config or options
    const limit = options.limit ?? this.config.recommendation?.topN ?? 5;
    return recommendations.slice(0, limit);
  }

  /**
   * Generate recommendations for a specific hotspot
   */
  private generateForHotspot(
    hotspot: Hotspot,
    options: RecommendationGenerationOptions
  ): Recommendation[] {
    const recs: Recommendation[] = [];
    const typeCounts = this.getHotspotSeverityCounts(hotspot);

    // Focused Testing recommendation
    if (options.includeTesting) {
      const rec = this.createFocusedTestingRecommendation(hotspot, typeCounts);
      recs.push(rec);
    }

    // Code Review recommendation
    if (options.includeReview) {
      const rec = this.createCodeReviewRecommendation(hotspot);
      recs.push(rec);
    }

    // Agent-Assisted Refactoring recommendation
    if (options.includeRefactoring) {
      const rec = this.createRefactoringRecommendation(hotspot, typeCounts);
      recs.push(rec);
    }

    return recs;
  }

  /**
   * Create focused testing recommendation
   */
  private createFocusedTestingRecommendation(
    hotspot: Hotspot,
    typeCounts: { critical: number; major: number; minor: number }
  ): Recommendation {
    const bugCount = hotspot.bugCount;
    const severityInfo = typeCounts.critical > 0 ? `${typeCounts.critical} critical` :
                        typeCounts.major > 0 ? `${typeCounts.major} major` :
                        `${typeCounts.minor} minor`;

    return {
      id: this.generateId('testing', hotspot.modulePath),
      type: RecommendationType.FOCUSED_TESTING,
      priority: this.calculatePriority(bugCount, hotspot.score),
      estimatedImpact: this.generateImpact('testing', bugCount),
      estimatedEffort: EffortTier.MEDIUM,

      targetPath: hotspot.modulePath,
      moduleName: hotspot.name,

      rationale: `${bugCount} bugs detected (${severityInfo}) - Focus on comprehensive test coverage for edge cases, error paths, and integration points.`,
      evidence: {
        severityCounts: typeCounts,
        bugCount,
        weightedBugs: hotspot.weightedBugs,
        defectScore: hotspot.score,
      },

      action: `Implement property-based tests to catch edge cases not covered by unit tests. Design integration tests for critical data flows. Add code coverage regression suite.`,

      recommendedOwner: 'QA / SDET',
      recommendedReviewer: 'Technical Lead',

      status: RecommendationStatus.GENERATED,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Create code review recommendation
   */
  private createCodeReviewRecommendation(hotspot: Hotspot): Recommendation {
    const files = this.getFilesForModule(hotspot.modulePath);
    const filesCount = files.length;

    return {
      id: this.generateId('review', hotspot.modulePath),
      type: RecommendationType.CODE_REVIEW,
      priority: hotspot.bugCount > 5 ? 90 : 75,
      estimatedImpact: `High - ${hotspot.bugCount} files require attention`,
      estimatedEffort: EffortTier.MEDIUM,

      targetPath: hotspot.modulePath,
      moduleName: hotspot.name,

      rationale: `${hotspot.bugCount} bugs across ${filesCount} file(s) with elevated defect density (score=${hotspot.score.toFixed(2)}). Review strengthens code quality and prevents similar bugs.`,
      evidence: {
        severityCounts: this.getHotspotSeverityCounts(hotspot),
        bugCount: hotspot.bugCount,
        weightedBugs: hotspot.weightedBugs,
        defectScore: hotspot.score,
      },

      action: `Assign senior engineers with historical ownership of these files for optional mandatory code review. Use ADR-style discussion for patterns flagged in bugs.`,

      recommendedOwner: 'Senior/Staff Engineer',
      recommendedReviewer: 'Subject Matter Expert',

      status: RecommendationStatus.GENERATED,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Create agent-assisted refactoring recommendation
   */
  private createRefactoringRecommendation(
    hotspot: Hotspot,
    typeCounts: { critical: number; major: number; minor: number }
  ): Recommendation {
    const bugCount = hotspot.bugCount;
    const isCriticallyHigh = typeCounts.critical > 0 || hotspot.score > 5;

    return {
      id: this.generateId('refactor', hotspot.modulePath),
      type: RecommendationType.REFACTORING,
      priority: this.calculatePriority(bugCount, hotspot.score, isCriticallyHigh),
      estimatedImpact: this.generateImpact('refactor', bugCount, hotspot.score),
      estimatedEffort: this.calculateEffortTier(bugCount, hotspot.score),

      targetPath: hotspot.modulePath,
      moduleName: hotspot.name,

      rationale: `${bugCount} bugs (score=${hotspot.score.toFixed(2)}) indicate architectural or design issues requiring substantial refactoring. Agent-assisted approach recommended.`,
      evidence: {
        severityCounts: typeCounts,
        bugCount,
        weightedBugs: hotspot.weightedBugs,
        defectScore: hotspot.score,
      },

      action: `Create agent tasks to: (1) decompose large functions above cyclomatic complexity threshold, (2) eliminate duplicated logic paths, (3) improve error handling and input validation. Ensure test suite runs after each refactor.`,

      recommendedOwner: 'Engineering Team - Agent Assistance',
      recommendedReviewer: 'Technical Architect',

      contextSnippets: this.extractContextSnippets(hotspot.modulePath),

      estimatedLinesAffected: Math.floor(hotspot.weightedBugs * 50), // Rough estimate
      estimatedComplexityDelta: Math.floor(hotspot.score * 0.1),

      status: RecommendationStatus.GENERATED,
      generatedAt: new Date().toISOString(),

      refactorTaskPayload: this.createRefactorPayload(hotspot, typeCounts),
    };
  }

  /**
   * Create recurrence pattern recommendations
   */
  private generateRecurrenceRecommendations(
    options: RecommendationGenerationOptions
  ): Recommendation[] {
    const recs: Recommendation[] = [];

    for (const [file, pattern] of Object.entries(this.recurrencePatterns)) {
      recs.push({
        id: this.generateId('recurrence', file),
        type: RecommendationType.REFACTORING,
        priority: pattern.recurrenceCount > 3 ? 85 : 70,
        estimatedImpact: `${pattern.recurrenceCount} file reopenings detected - HIGH RISK`,
        estimatedEffort: EffortTier.LARGE,

        targetPath: file,
        moduleName: this.extractModuleName(file),

        rationale: `File ${file} has been reopened ${pattern.recurrenceCount} times in the last 14 days. Root cause not addressed between reopening cycles.`,
        evidence: {
          severityCounts: this.getDefaultCount(),
          bugCount: pattern.recurrenceCount,
          weightedBugs: pattern.recurrenceCount * 2,
          defectScore: pattern.recurrenceCount * 0.5,
        },

        action: `Perform deep analysis to identify root cause pattern. Implement regression test suite preventing re-introduction. Consider structural change if root cause is architectural.`,

        recommendedOwner: 'Engineering Team',
        recommendedReviewer: 'Senior Engineer',

        status: RecommendationStatus.GENERATED,
        generatedAt: new Date().toISOString(),
      });
    }

    return recs;
  }

  /* --- Helper Methods --- */

  /**
   * Generate unique recommendation ID
   */
  private generateId(type: string, target: string): string {
    return `${type}-${target.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
  }

  /**
   * Extract module name from path
   */
  private extractModuleName(path: string): string {
    const segments = path.split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] || path;
  }

  /**
   * Calculate priority based on bug count and defect score
   */
  private calculatePriority(bugCount: number, score: number, isCriticallyHigh: boolean = false): number {
    let priority = 50;

    // Base priority on defect score
    priority = Math.max(priority, Math.floor(score * 10));

    // Boost for high bug count
    priority = Math.max(priority, bugCount * 7);

    // Critical boost
    if (isCriticallyHigh) priority += 30;

    return Math.min(priority, 100);
  }

  /**
   * Generate qualitative impact description
   */
  private generateImpact(
    type: string,
    bugCount: number,
    score?: number
  ): string {
    const severity = score ?? bugCount / 10;

    switch (type) {
      case 'testing':
        return bugCount > 5 ? `High - ${bugCount} bugs need focused test coverage` :
              bugCount > 2 ? `Medium - Emerging test gaps identified` :
              `Low - Minor test improvements needed`;
      case 'refactor':
        return score > 5 ? `High - Defects-core architecture requires restructuring` :
              score > 3 ? `Medium - Code maintainability and quality issues` :
              `Low - Minor refactor opportunities`;
      default:
        return 'Medium impact potential';
    }
  }

  /**
   * Calculate effort tier based on complexity
   */
  private calculateEffortTier(bugCount: number, score: number): EffortTier {
    if (score > 8) return EffortTier.XP_LARGE;
    if (score > 5) return EffortTier.LARGE;
    if (bugCount > 8) return EffortTier.LARGE;
    if (bugCount > 4) return EffortTier.MEDIUM;
    return EffortTier.SMALL;
  }

  /**
   * Get severity counts for a hotspot
   */
  private getHotspotSeverityCounts(hotspot: Hotspot): { critical: number; major: number; minor: number } {
    const counts = this.getBugsByPath(hotspot.modulePath)
      .reduce((acc, bug) => {
        acc[bug.severity] = (acc[bug.severity] || 0) + 1;
        return acc;
      }, { critical: 0, major: 0, minor: 0 });
    return counts;
  }

  /**
   * Get bugs for a specific path
   */
  private getBugsByPath(path: string): Bug[] {
    return this.bugs.filter(bug =>
      bug.files?.includes(path) || bug.modules?.includes(path)
    );
  }

  /**
   * Get files in a module
   */
  private getFilesForModule(modulePath: string): string[] {
    const bugs = this.getBugsByPath(modulePath);
    const files = new Set<string>();

    bugs.forEach(bug => {
      bug.files?.forEach(f => files.add(f));
    });

    return Array.from(files);
  }

  /**
   * Extract context snippets (simplified - in production, use semantic analysis)
   */
  private extractContextSnippets(modulePath: string) {
    // Placeholder for snippet extraction
    return [];
  }

  /**
   * Create refactor task payload for AI agents
   */
  private createRefactorPayload(hotspot: Hotspot, typeCounts: { critical: number; major: number; minor: number }) {
    const files = this.getFilesForModule(hotspot.modulePath);
    
    return {
      id: hotspot.id || hotspot.modulePath,
      title: `Refactor ${hotspot.name}: High Defect Density (${hotspot.bugCount} bugs, score=${hotspot.score.toFixed(2)})`,
      description: `This module has ${hotspot.bugCount} bugs with elevated defect density (score=${hotspot.score.toFixed(2)}). The analysis identified ${Object.keys(typeCounts).filter(k => typeCounts[k as any] > 0).length} severity levels affected.`,
      targetFiles: files,
      desiredOutcome: `Reduce defect density below threshold. Improve code quality, maintainability, and reliability. Add regression tests to prevent recurrence.`,
      constraints: [
        `Do not break existing tests - all tests must pass`,
        `Maintain backward compatibility`,
        `Do not change external APIs`,
        `Add proper error logging and handling`,
      ],
      context: [
        `Current defect score: ${hotspot.score.toFixed(2)}`,
        `Weighted bug count: ${hotspot.weightedBugs}`,
        `Severity breakdown: ${JSON.stringify(typeCounts)}`,
        `Files requiring attention: ${files.length}`,
      ],
    };
  }

  /**
   * Default severity counts (not all hotspots have detailed breakdown)
   */
  private getDefaultCount(): { critical: number; major: number; minor: number } {
    return { critical: 0, major: 0, minor: 0 };
  }
}