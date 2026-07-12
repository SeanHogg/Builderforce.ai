/**
 * Bug Analysis Service
 *
 * Computes defect density scores, identifies hotspots, and detects bug recurrence patterns.
 */

import { Bug, Severity, DefectDensityScore, Hotspot } from '../types.js';
import { QualityConfig } from '../types.js';

export interface RecurrencePattern {
  file: string;
  recurrenceCount: number;
  lastBugDate: string;
}

export class BugAnalysisService {
  private bugs: Bug[];
  private config: QualityConfig;
  private readonly DEFAULT_THRESHOLD_CONFIG = {
    weights: {
      [Severity.CRITICAL]: 3,
      [Severity.MAJOR]: 2,
      [Severity.MINOR]: 1,
    },
    percentileThreshold: 0.8, // 80th percentile as hotspot cutoff
    recurrenceWindowDays: 14,
  };

  constructor(bugs: Bug[], config: QualityConfig) {
    this.bugs = bugs;
    this.config = config;
  }

  /**
   * Run complete analysis on bug data
   */
  async analyze(): Promise<{
    defectsDensityScores: DefectDensityScore[];
    hotspots: Hotspot[];
    recurrencePatterns: RecurrencePattern[];
  }> {
    // Compute defect density scores per module
    const scores = this.computeDefectDensityScores();
    const hotspots = this.identifyHotspots(scores);
    const recurrences = this.detectRecurrencePatterns();

    return {
      defectsDensityScores: scores,
      hotspots,
      recurrencePatterns: recurrences,
    };
  }

  /**
   * Compute defect density scores per module
   *
   * Density = (weighted bug count) / (cyclomatic complexity or lines of code)
   */
  computeDefectDensityScores(): DefectDensityScore[] {
    // Group bugs by module and calculate stats
    const moduleBugs = this.groupBugsByModules();

    const scores: DefectDensityScore[] = [];

    for (const [modulePath, stats] of Object.entries(moduleBugs)) {
      // Determine denominator: use complexity if available, else LOC
      const denominator = stats.complexity || stats.linesOfCode || 1;

      // Compute weighted bug count
      const weights = this.config.weights || this.config.integrations?.weights || {};
      const weightedBugs = stats.bugCounts.critical * (weights[Severity.CRITICAL] || 3) +
                          stats.bugCounts.major * (weights[Severity.MAJOR] || 2) +
                          stats.bugCounts.minor * (weights[Severity.MINOR] || 1);

      // Compute density score
      const score = weightedBugs / denominator;

      scores.push({
        modulePath,
        score,
        bugs: stats.bugCounts.critical + stats.bugCounts.major + stats.bugCounts.minor,
        weightedBugs,
        denominator,
        isAboveThreshold: score > this.config.thresholds?.module || score > 3,
      });
    }

    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Group bugs by module
   */
  private groupBugsByModules(): Record<string, {
    bugs: Bug[];
    bugCounts: {
      critical: number;
      major: number;
      minor: number;
    };
    files: string[];
  }> {
    const modules: Record<string, {
      bugs: Bug[];
      bugCounts: {
        critical: number;
        major: number;
        minor: number;
      };
      files: string[];
    }> = {};

    this.bugs.forEach((bug) => {
      if (!bug.modules || bug.modules.length === 0) {
        // No explicit module mapping - default to file paths
        if (bug.files && bug.files.length > 0) {
          bug.modules = bug.files;
        } else {
          bug.modules = ['unknown'];
        }
      }

      bug.modules.forEach((modulePath) => {
        if (!modules[modulePath]) {
          modules[modulePath] = {
            bugs: [],
            bugCounts: { critical: 0, major: 0, minor: 0 },
            files: [],
          };
        }

        const module = modules[modulePath];
        module.bugs.push(bug);

        // Count by severity
        module.bugCounts[bug.severity]++;

        // Record unique files
        bug.files?.forEach(file => {
          if (!module.files.includes(file)) {
            module.files.push(file);
          }
        });
      });
    });

    return modules;
  }

  /**
   * Identify hotspots - modules with statistically elevated defect density
   */
  identifyHotspots(scores: DefectDensityScore[]): Hotspot[] {
    if (scores.length === 0) return [];

    // Find top 20% as hotspots
    const topCount = Math.max(1, Math.floor(scores.length * 0.2));
    const topScores = scores.slice(0, topCount);

    const hotspots: Hotspot[] = topScores
      .map((score) => {
        return {
          path: score.modulePath,
          name: this.extractModuleName(score.modulePath),
          modulePath: score.modulePath,
          defectScore: score.score,
          bugCount: score.bugs,
          weightedBugs: score.weightedBugs,
          detectionType: 'high_bug_count',
          percentile: 0.8, // baseline
          trend: 'stable',
        };
      })
      .sort((a, b) => b.score - a.score);

    return hotspots;
  }

  /**
   * Detect recurrence patterns - files reopened multiple times
   */
  detectRecurrencePatterns(): RecurrencePattern[] {
    const patterns: RecurrencePattern[] = [];
    const fileRecurrenceMap = new Map<string, { count: number; lastDate: string }>();

    this.bugs.forEach((bug) => {
      if (bug.status?.toLowerCase() === 'reopened' && bug.createdAt) {
        const file = bug.files?.[0] || bug.id;

        if (!fileRecurrenceMap.has(file)) {
          fileRecurrenceMap.set(file, { count: 0, lastDate: bug.createdAt });
        }

        const record = fileRecurrenceMap.get(file)!;
        record.count++;
        record.lastDate = bug.createdAt;
      }
    });

    return Array.from(fileRecurrenceMap.entries())
      .map(([file, data]) => ({ file, recurrenceCount: data.count, lastBugDate: data.lastDate }))
      .sort((a, b) => b.recurrenceCount - a.recurrenceCount)
      .filter(p => p.recurrenceCount > 1); // Only return files with 2+ reopenings
  }

  /**
   * Extract module name from path
   */
  private extractModuleName(modulePath: string): string {
    const segments = modulePath.split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] || modulePath;
  }

  /* --- Statistics & Utilities --- */

  /**
   * Group bugs by severity
   */
  groupBugsBySeverity(): { [key in Severity]?: number } {
    const counts: { [key in Severity]?: number } = {};
    Object.values(Severity).forEach((severity) => (counts[severity] = 0));

    this.bugs.forEach((bug) => {
      counts[bug.severity]++;
    });

    return counts;
  }

  /**
   * Get files with bugs to analyze
   */
  getFilesWithBugs(): Set<string> {
    return new Set(
      this.bugs
        .filter((bug) => bug.files && bug.files.length > 0)
        .flatMap((bug) => bug.files!)
    );
  }

  /**
   * Get modules with bugs
   */
  getModulesWithBugs(): Set<string> {
    return new Set(
      this.bugs
        .filter((bug) => bug.modules && bug.modules.length > 0)
        .flatMap((bug) => bug.modules)
    );
  }

  /**
   * Get bugs by file
   */
  getBugsByFile(file: string): Bug[] {
    return this.bugs.filter((bug) => bug.files?.includes(file));
  }

  /**
   * Get latest bugs (sorted by createdAt descending)
   */
  getLatestBugs(limit: number = 20): Bug[] {
    return this.bugs
      .filter(bug => bug.createdAt)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
      .slice(0, limit);
  }
}