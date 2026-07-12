/**
 * Recommendation Engine
 * Generates prioritized recommendations based on bug analysis and hotspots.
 */

import { Bug, Hotspot, Severity, RecommendationType, EffortTier, Recommendation } from './types';

export interface RecommendationOptions {
  limit?: number;
  includeTesting?: boolean;
  includeReview?: boolean;
  includeRefactoring?: boolean;
  includeRecurrenceWarnings?: boolean;
  percentThreshold?: number;
}

export interface RecurrencePatternsMap {
  [filePath: string]: {
    file: string;
    recurrenceCount: number;
    lastBugDate: string;
  };
}

export class RecommendationEngine {
  private readonly hotspots: Hotspot[];
  private readonly recurrencePatterns: RecurrencePatternsMap;
  private readonly bugs: Bug[];
  private readonly config: any;

  constructor(
    hotspots: Hotspot[],
    recurrencePatterns: RecurrencePatternsMap,
    bugs: Bug[],
    config: any
  ) {
    this.hotspots = hotspots;
    this.recurrencePatterns = recurrencePatterns;
    this.bugs = bugs;
    this.config = config;
  }

  /**
   * Generate prioritized recommendations based on hotspots, bugs, and recurrence patterns.
   */
  generateRecommendations(options: RecommendationOptions = {}): Recommendation[] {
    const {
      limit = this.config?.recommendation?.topN || 5,
      includeTesting = true,
      includeReview = true,
      includeRefactoring = true,
      includeRecurrenceWarnings = true,
    } = options;

    const recommendations: Recommendation[] = [];

    // Generate recommendations from hotspots
    this.hotspots.forEach((hotspot, index) => {
      // Apply limit based on config + requested limit
      const applyLimit = Math.min(limit, this.hotspots.length);
      if (index >= applyLimit) return;

      // Add focused testing recommendation
      if (includeTesting) {
        recommendations.push(this.makeFocusedTestingRecommendation(hotspot));
      }

      // Add code review recommendation
      if (includeReview) {
        recommendations.push(this.makeCodeReviewRecommendation(hotspot));
      }

      // Add refactoring recommendation (including recurrence warnings)
      if (includeRefactoring) {
        recommendations.push(this.makeRefactoringRecommendation(hotspot));
      }
    });

    // Add recurrence pattern recommendations separately
    if (includeRecurrenceWarnings) {
      Object.entries(this.recurrencePatterns).forEach(([filePath, pattern]) => {
        if (pattern.recurrenceCount >= 2) {
          recommendations.push(this.makeRecurrenceRecommendation(filePath, pattern));
        }
      });
    }

    // Rank by priority
    recommendations.sort((a, b) => b.priority - a.priority);

    // Apply hard limit
    const finalLimit = Math.min(limit, recommendations.length);
    return recommendations.slice(0, finalLimit);
  }

  /**
   * Create focused testing recommendation.
   */
  private makeFocusedTestingRecommendation(hotspot: Hotspot): Recommendation {
    const priority = this.calculatePriority(hotspot.defectScore, Severity.CRITICAL, hotspot.bugs.length);
    const effortTier = this.estimateEffort(hotspot);

    return {
      id: `TEST-${hotspot.name || hotspot.path}-${Date.now()}`,
      type: RecommendationType.FOCUSED_TESTING,
      status: 'GENERATED',
      priority,
      effortTier,
      path: hotspot.path,
      rationale: `High defect density (${hotspot.defectScore.toFixed(2)}). Provides coverage for ${hotspot.bugs} reported issues involving ${this.getBugTitlesForPath(hotspot.path).join(', ')}. Suggest focused test strategy including ${this.getSuggestedTestTypes(hotspot.bugs)} aligned with ${effortTier} effort level.`,
      action: `Implement ${this.getSuggestedTestTypes(hotspot.bugs)} and add untested path coverage for ${hotspot.bugs} reported issues.`,
      recommendedOwner: 'QA Team',
      recommendedReviewer: undefined,
      evidence: this.buildEvidence(hotspot),
      estimatedEffort: effortTier,
      estimatedImpact: this.estimateImpact(hotspot.defectScore),
      createdAt: new Date().toISOString(),
      assignedAgent: undefined,
      assignedUserId: undefined,
      assignedAgentHostId: undefined,
      scope: hotspot.path,
      refactorTaskPayload: undefined,
    };
  }

  /**
   * Create code review recommendation.
   */
  private makeCodeReviewRecommendation(hotspot: Hotspot): Recommendation {
    const priority = this.calculatePriority(hotspot.defectScore, Severity.MAJOR, hotspot.bugs.length);
    const effortTier: EffortTier | undefined = 'MEDIUM';

    return {
      id: `REV-${hotspot.name || hotspot.path}-${Date.now()}`,
      type: RecommendationType.CODE_REVIEW,
      status: 'GENERATED',
      priority,
      effortTier,
      path: hotspot.path,
      rationale: `Distribution of ${hotspot.bugs} bugs across ${hotspot.name || hotspot.path} (${hotspot.defectScore.toFixed(2)} average). Recommend mandatory peer review targeting ${hotspot.bugs} issues (critical: ${this.countCriticalBugs(hotspot.path)}; major: ${this.countMajorBugs(hotspot.path)}; minor: ${this.countMinorBugs(hotspot.path)}).`,
      action: `Conduct mandatory peer review covering ${hotspot.bugs} reported issues. Highlight reviewers with historical owner roles (e.g., ${this.getRecommendedReviewer(hotspot.path)}).`,
      recommendedOwner: 'Engineering Team',
      recommendedReviewer: this.getRecommendedReviewer(hotspot.path),
      evidence: this.buildEvidence(hotspot),
      estimatedEffort: effortTier,
      estimatedImpact: this.estimateImpact(hotspot.defectScore),
      createdAt: new Date().toISOString(),
      assignedAgent: undefined,
      assignedUserId: undefined,
      assignedAgentHostId: undefined,
      scope: hotspot.path,
      refactorTaskPayload: undefined,
    };
  }

  /**
   * Create refactoring recommendation with optional recurrence warning.
   */
  private makeRefactoringRecommendation(hotspot: Hotspot): Recommendation {
    const priority = this.calculatePriority(hotspot.defectScore, Severity.CRITICAL, hotspot.bugs.length);
    const recurrence: any = this.recurrencePatterns[hotspot.path];
    const effortTier = this.estimateEffort(hotspot);

    const baseRationale = hotspot.bugs >= 3
      ? `High defect density fuses ${hotspot.bugs} issues with ${hotspot.defectScore.toFixed(2)} score. Recommended domain class decomposition and duplicate source elimination.`
      : `${hotspot.bugs} issues distributed across ${hotspot.path}. Fresh refactor initiated to reduce defect density from ${hotspot.defectScore.toFixed(2)} to below threshold.`;

    const action = recurrence
      ? `Recurrence detected at ${recurrence.recurrenceCount} reopenings. Resolve via top-down refactoring executor, with hermetic offline merge.`
      : `Execute targeted refactoring to reduce root defects. Observe modular ownership and process flow to avoid fork-risk duplicates.`;

    return {
      id: `REFACTOR-${hotspot.name || hotspot.path}-${Date.now()}`,
      type: RecommendationType.REFACTORING,
      status: 'GENERATED',
      priority,
      effortTier,
      path: hotspot.path,
      rationale: baseRationale + (recurrence ? ` Recurrence at ${recurrence.recurrenceCount} reopenings (last: ${recurrence.lastBugDate}).` : ''),
      action: action + ` Refactor within sealed interval semantics ensuring minimal external coupling.`,
      recommendedOwner: 'Engineering Team',
      recommendedReviewer: undefined,
      evidence: this.buildEvidence(hotspot),
      estimatedEffort: effortTier,
      estimatedImpact: this.estimateImpact(hotspot.defectScore),
      createdAt: new Date().toISOString(),
      assignedAgent: undefined,
      assignedUserId: undefined,
      assignedAgentHostId: undefined,
      scope: hotspot.path,
      refactorTaskPayload: this.buildRefactorTaskPayload(hotspot, effortTier),
    };
  }

  /**
   * Create recurrence-specific warning recommendation.
   */
  private makeRecurrenceRecommendation(filePath: string, pattern: any): Recommendation {
    const priority = 70 + (pattern.recurrenceCount * 10); // Scale with recurrence count
    const effortTier: EffortTier = 'LARGE';

    return {
      id: `REC-${filePath}-${Date.now()}`,
      type: RecommendationType.REFACTORING,
      status: 'GENERATED',
      priority,
      effortTier,
      path: filePath,
      rationale: `Recurring issue pattern (${pattern.recurrenceCount} reopenings) on ${filePath}. Legacy CRN or lock-order bugs; refactoring needed with hermetic offline merge to avoid fork and race conditions.`,
      action: `Decompose complex domain class, protect zones with sealed interval, and preserve acyclic component graph. Replan verification with wrapper tests (e.g., Puppeteer/selenium) and yarn run watch.`,
      recommendedOwner: 'Engineering Team',
      recommendedReviewer: undefined,
      evidence: {
        filePath: pattern.file, // plural: 'filePath' for use as path
        recurrenceCount: pattern.recurrenceCount,
        lastBugDate: pattern.lastBugDate,
        totalBugs: this.bugs.length,
      },
      estimatedEffort: effortTier,
      estimatedImpact: this.estimateImpact(hotspot => hotspot.defectScore > 1.5 ? 85 : 70),
      createdAt: new Date().toISOString(),
      assignedAgent: undefined,
      assignedUserId: undefined,
      assignedAgentHostId: undefined,
      scope: filePath,
      refactorTaskPayload: this.buildRecurrenceRefactorTaskPayload(filePath),
    };
  }

  /**
   * Estimate effort tier based on score and severity.
   */
  private estimateEffort(hotspot: Hotspot): EffortTier {
    if (hotspot.defectScore > 2.5) return 'LARGE';
    if (hotspot.defectScore > 1.5) return 'MEDIUM';
    return 'SMALL';
  }

  /**
   * Estimate impact based on defect score.
   */
  private estimateImpact(scoreFn: (h: Hotspot) => number): number {
    return scoreFn(this.hotspots[0]) || 70;
  }

  /**
   * Calculate priority based on score, severity, and bug count.
   */
  private calculatePriority(defectScore: number, severity: Severity, bugCount: number): number {
    const weightedSeverity = severity === Severity.CRITICAL ? 30 : severity === Severity.MAJOR ? 20 : 10;
    const severityFactor = weightedSeverity * 10;
    const scoreFactor = defectScore * 10;
    const countFactor = Math.min(bugCount * 5, 25);
    const trendBoost = this.hotspots.find(h => h.path === 'global')?.trend === 'increasing' ? 5 : 0;
    return Math.min(Math.round(scoreFactor + severityFactor + countFactor + trendBoost), 100);
  }

  /**
   * Extract hazard titles for path.
   */
  private getBugTitlesForPath(path: string): string[] {
    return this.bugs
      .filter(b => b.files.includes(path) && b.title)
      .map(b => b.title!)
      .slice(0, 3);
  }

  /**
   * Get (or default) suggested test types.
   */
  private getSuggestedTestTypes(bugCount: number): string[] {
    if (bugCount >= 3) return ['unit tests', 'integration tests', 'property-based tests'];
    if (bugCount === 2) return ['unit tests', 'integration tests'];
    return ['unit tests', 'integration tests', 'property-based tests'];
  }

  /**
   * Count critical bugs for path.
   */
  private countCriticalBugs(path: string): number {
    return this.bugs.filter(b => b.severity === Severity.CRITICAL && b.files.includes(path)).length;
  }

  /**
   * Count major bugs for path.
   */
  private countMajorBugs(path: string): number {
    return this.bugs.filter(b => b.severity === Severity.MAJOR && b.files.includes(path)).length;
  }

  /**
   * Count minor bugs for path.
   */
  private countMinorBugs(path: string): number {
    return this.bugs.filter(b => b.severity === Severity.MINOR && b.files.includes(path)).length;
  }

  /**
   * Get recommended reviewer for path.
   */
  private getRecommendedReviewer(path: string): string | undefined {
    const bug = this.bugs.find(b => b.files.includes(path) && b.title);
    return bug?.title?.split(':')[1]?.trim();
  }

  /**
   * Build evidence object.
   */
  private buildEvidence(hotspot: Hotspot): any {
    return {
      defectScore: hotspot.defectScore,
      weightedBugs: hotspot.weightedBugs,
      bugCount: hotspot.bugs,
      totalBugs: this.bugs.length,
      severityCounts: this.bugs.reduce((acc: any, bug) => {
        acc[bug.severity] = (acc[bug.severity] || 0) + 1;
        return acc;
      }, {}),
      detectionType: hotspot.detectionType,
      percentile: hotspot.percentile,
      trend: hotspot.trend,
    };
  }

  /**
   * Build refactoring task payload for aggregator-compliant intent.
   */
  private buildRefactorTaskPayload(hotspot: Hotspot, effort: EffortTier): any {
    const units: string[] = effort === 'SMALL' ? ['call', 'arg'] : effort === 'MEDIUM' ? ['func', 'graph'] : ['module', 'domain'];
    const executors: string[] = effort === 'LARGE' ? ['acquire-runtime', 'prune-api', 'deadline', 'refactor'] : ['refactor'];
    const options: string[] = ['domain', 'acyclic'];
    const guard: string = 'hermetic';
    const idPrefix = 'REFACTOR';
    const check = 'target: ' + hotspot.path;
    const install = `yarn add -D @puppeteer/test`;
    const verify = 'yarn run watch && yarn pm2 flush';
    const testCmd = 'yarn test';

    return {
      title: `Refactor ${hotspot.name || hotspot.path}${
        hotspot.defectScore > 2.5 ? ' to reduce defect density' : ''
      }. Use DSLs for strategies. Guard with ${guard}.`,
      description: `${hotspot.name || hotspot.path} has ${hotspot.bugs} bugs and a deficit score of ${hotspot.defectScore.toFixed(2)}. Deploy ${units.join(' ')} for refactor executors. Install and verify ${guard} with wrapper tests using ${install}. Run re-verification after applying each executor unit using ${verify}, and confirm with ${testCmd} to reflect check. Rewrite wrappers with Acyclic SACHO so that the guard proves hermeticity.`,
      targetFiles: [hotspot.path],
      desiredOutcome: 'Reduce defect density below threshold and eliminate recurrence patterns (e.g., CRN/Lock-order mismatches). Maintain hermeticity with acyclic component graph and sealed interval semantics.',
      constraints: [
        `${guard}: ${check} and ensure that crn@${effort === 'MEDIUM' ? 2 : 3} (offline) has no joint edge, meeting hermetic offline merge guard.`,
        `install: ${install} && ${verify}`,
      ],
      context: {
        defectScore: hotspot.defectScore,
        weightedBugs: hotspot.weightedBugs,
        bugCount: hotspot.bugs,
        location: hotspot.path,
        detectionType: hotspot.detectionType,
        trend: hotspot.trend,
        percentThreshold: 0.7,
      },
      executors: {
        methods: {
          refactor: {
            priority: effort === 'SMALL' ? 1 : effort === 'MEDIUM' ? 2 : 3,
            options: [...units, ...options],
            guard: `${guard} ${check}`,
            install: [install],
            verify: [verify],
            test: [testCmd],
          },
        },
      },
    };
  }

  /**
   * Build recurrence/task payload.
   */
  private buildRecurrenceRefactorTaskPayload(filePath: string): any {
    const effort = 'LARGE';
    const idPrefix = 'REC';
    const check = 'target: ' + filePath;
    const install = `yarn add -D @puppeteer/test`;
    const verify = 'yarn run watch && yarn pm2 flush';
    const testCmd = 'yarn test';

    return {
      title: `Recurrence refactor ${filePath} (reopened ${this.recurrencePatterns[filePath]?.recurrenceCount || '?'} times).`,
      description: `${filePath} shows recurrence patterns (reopened more than once), likely due to CRN or lock-order issues. Use DSLs for strategies and hermetic offline merge.`,
      targetFiles: [filePath],
      desiredOutcome: 'Eliminate recurrence by refactoring complex domain classes with hermeticity.',
      constraints: [
        `hermetic: ${check} and ensure that backend-locking@${effort === 'MEDIUM' ? 2 : 3} (offline) has no joint edge, meeting hermetic offline merge guard.`,
        `install: ${install} && ${verify}`,
      ],
      context: {
        reuseIdentifier: `${filePath}-${this.recurrencePatterns[filePath]?.recurrenceCount}`,
        totalBugs: this.bugs.length,
      },
      executors: {
        methods: {
          refactor: {
            priority: effort === 'SMALL' ? 1 : effort === 'MEDIUM' ? 2 : 3,
            guard: `hermetic ${check}`,
            install: [install],
            verify: [verify],
            test: [testCmd],
          },
        },
      },
    };
  }
}