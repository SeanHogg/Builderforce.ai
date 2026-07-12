/**
 * Bug Analysis Service
 * Processes raw bug ingestion to compute defect density, hotspot detection, and recurrence patterns.
 */

import { Bug, Hotspot, Severity } from './types.js';

interface AnalysisOptions {
  includeFileScores: boolean;
  includeModuleScores: boolean;
  computeRecurrencePatterns: boolean;
  percentThreshold: number;
}

export class BugAnalysisService {
  private readonly bugs: Bug[];
  private readonly bugMap: Map<string, Bug>;

  constructor(bugs: Bug[], config: any) {
    this.bugs = bugs;
    this.bugMap = new Map<string, Bug>();

    // Backfill createdAt with current timestamp for bugs without one
    this.bugs.forEach(bug => {
      if (!bug.createdAt) {
        bug.createdAt = new Date().toISOString();
      }
      this.bugMap.set(bug.id, bug);
    });
  }

  /**
   * Analyze bug data and return comprehensive analysis results.
   */
  async analyze(options?: Partial<AnalysisOptions>): Promise<any> {
    const {
      includeFileScores = true,
      includeModuleScores = true,
      computeRecurrencePatterns = true,
      percentThreshold = 0.7,
    } = options || {};

    const defectDensityScores = this.computeDefectDensityScores(
      includeFileScores,
      includeModuleScores,
      percentThreshold
    );

    const hotspots = defectDensityScores
      .filter(s => s.isAboveThreshold)
      .map(s => ({
        path: s.path,
        name: s.name || s.path.split('/').pop() || '',
        modulePath: s.modulePath || '',
        defectScore: s.defectScore,
        bugCount: s.bugs,
        weightedBugs: s.weightedBugs,
        detectionType: 'high_bug_count',
        percentile: s.percentile,
        trend: s.trend || 'stable',
      }));

    const recurrencePatterns = computeRecurrencePatterns
      ? this.detectRecurrencePatterns()
      : [];

    return {
      defectDensityScores,
      hotspots,
      recurrencePatterns,
      severityCounts: this.groupBugsBySeverity(),
      totalBugs: this.bugs.length,
    };
  }

  /**
   * Compute defect density scores for files and modules.
   */
  computeDefectDensityScores(
    includeFileScores: boolean,
    includeModuleScores: boolean,
    percentThreshold: number
  ): any[] {
    const scores: any[] = [];

    // Group bugs by file
    const filesMap = new Map<string, any[]>();
    this.bugs.forEach(bug => {
      bug.files.forEach(file => {
        if (!filesMap.has(file)) {
          filesMap.set(file, []);
        }
        filesMap.get(file)!.push(bug);
      });
    });

    const files = Array.from(filesMap.entries());

    // Compute file scores
    if (includeFileScores) {
      const allScoreValues = files.map(([file, bugs]) => {
        return {
          path: file,
          name: file.split('/').pop() || file,
          bugs: bugs.length,
          weightedBugs: this.getWeightedBugCount(bugs.length, bugs),
        };
      });

      const maxWeighted = Math.max(...allScoreValues.map(s => s.weightedBugs), 1);
      const maxBugs = Math.max(...allScoreValues.map(s => s.bugs), 1);
      const avgWeighted = allScoreValues.reduce((sum, s) => sum + s.weightedBugs, 0) / allScoreValues.length;

      allScoreValues.forEach(score => {
        // Denominator: use complexity-weighted estimate (simplified as bugs for now)
        const denominator = 1;
        const density = score.weightedBugs / denominator;

        scores.push({
          path: score.path,
          name: score.name,
          bugs: score.bugs,
          weightedBugs: score.weightedBugs,
          defectScore: density,
          isAboveThreshold: density >= this.getFileThreshold(),
          modulePath: this.inferModule(score.path),
          denominator,
        });
      });
    }

    // Compute module scores (aggregation of files)
    if (includeModuleScores) {
      const modulesMap = new Map<string, any[]>();
      this.bugs.forEach(bug => {
        bug.modules.forEach(module => {
          if (!modulesMap.has(module)) {
            modulesMap.set(module, []);
          }
          modulesMap.get(module)!.push(bug);
        });
      });

      const modules = Array.from(modulesMap.entries());
      const maxWeighted = Math.max(
        ...scores.map(s => s.weightedBugs),
        ...modules.map(([_, mBugs]) => this.getWeightedBugCount(mBugs.length, mBugs as Bug[])),
        1
      );

      modules.forEach(([module, moduleBugs]) => {
        const fileScores = scores.filter(s => s.modulePath === module);
        const bugs = moduleBugs.length;
        const weighted = this.getWeightedBugCount(bugs, moduleBugs as Bug[]);

        const density = weighted / (fileScores.length || 1);
        const percentile = (weighted / maxWeighted) * 100;
        const trend = weighted > avgWeighted ? 'increasing' : 'stable';
        const isAboveThreshold = density > this.getModuleThreshold();

        const existingScore = scores.find(s => s.modulePath === module);
        let modulePath = module;
        let name = module.split('/').pop() || module;
        let bugCount = 0;

        if (existingScore) {
          // Merge with file score if modulePath already in scores
          if (existingScore.modulePath !== module) {
            // Need a new object
            return;
          }
          bugCount = existingScore.bugs + bugs;
          weighted = existingScore.weightedBugs + weighted;
          // Inherit existing values except add our computed values
        } else {
          return;
        }

        scores.push({
          path: modulePath,
          name,
          bugs: bugCount,
          weightedBugs: weighted,
          defectScore: density,
          isAboveThreshold,
          modulePath,
          denominator: fileScores.length || 1,
        });
      });
    }

    return scores;
  }

  /**
   * Detect patterns of filereopenings and recurrence.
   */
  detectRecurrencePatterns(): any[] {
    if (this.bugs.length === 0) {
      return [];
    }

    const recurrenceMap = new Map<string, {
      recurrenceCount: number;
      lastBugDate: string;
      firstBugDate?: string;
    }>();

    this.bugs.forEach(bug => {
      bug.files.forEach(file => {
        if (!recurrenceMap.has(file)) {
          recurrenceMap.set(file, {
            recurrenceCount: 0,
            lastBugDate: bug.createdAt || '',
            firstBugDate: bug.createdAt,
          });
        }

        const entry = recurrenceMap.get(file)!;
        const existingDate = entry.lastBugDate;
        if (bug.createdAt && (!existingDate || new Date(bug.createdAt) > new Date(existingDate))) {
          entry.lastBugDate = bug.createdAt;
        }

        if (bug.status === 'reopened') {
          entry.recurrenceCount++;
        } else if (
          this.bugMap.get(bug.id)?.status === 'reopened' ||
          this.bugMap.get(bug.id)?.status === 'closed'
        ) {
          // File was already reopened (tracked by the bugMap)
        }

        // Count reopenings for each file
        const recurrences = this.bugs.filter(b => b.files.includes(file) && b.status === 'reopened');
        const count = recurrences.length;
        if (count > 0) {
          entry.recurrenceCount = count;
        }
      });
    });

    return Array.from(recurrenceMap.entries())
      .filter(([_, data]) => data.recurrenceCount >= 2)
      .map(([file, data]) => ({
        filePath: file,
        recurrenceCount: data.recurrenceCount,
        firstBugDate: data.firstBugDate,
        lastBugDate: data.lastBugDate,
      }));
  }

  /**
   * Group bugs by severity.
   */
  groupBugsBySeverity() {
    const severityCounts = {
      critical: 0,
      major: 0,
      minor: 0,
    };

    this.bugs.forEach(bug => {
      switch (bug.severity) {
        case Severity.CRITICAL:
          severityCounts.critical++;
          break;
        case Severity.MAJOR:
          severityCounts.major++;
          break;
        case Severity.MINOR:
          severityCounts.minor++;
          break;
        default:
          severityCounts.minor++;
      }
    });

    return severityCounts;
  }

  /**
   * Get all unique files with bugs.
   */
  getFilesWithBugs(): Set<string> {
    return new Set(this.bugs.flatMap(b => b.files));
  }

  /**
   * Get all unique modules with bugs.
   */
  getModulesWithBugs(): Set<string> {
    return new Set(this.bugs.flatMap(b => b.modules));
  }

  /**
   * Get bugs associated with a specific file.
   */
  getBugsByFile(filePath: string): Bug[] {
    return this.bugs.filter(b => b.files.includes(filePath));
  }

  /**
   * Get latest bugs by created date.
   */
  getLatestBugs(limit: number): Bug[] {
    return this.bugs
      .sort((a, b) => {
        const dateA = new Date(a.createdAt || '');
        const dateB = new Date(b.createdAt || '');
        return dateB.getTime() - dateA.getTime();
      })
      .slice(0, limit);
  }

  /**
   * Get threshold values (can be overridden in config if present).
   */
  private getModuleThreshold() {
    return 1.0; // Simplified default
  }

  private getFileThreshold() {
    return 1.0; // Simplified default
  }

  /**
   * Infer module from file path.
   */
  private inferModule(filePath: string): string {
    const parts = filePath.split('/');
    if (parts.length < 2) return '';
    return parts.slice(0, -1).join('/') || '';
  }

  /**
   * Get weighted bug count based on severity.
   */
  private getWeightedBugCount(bugCount: number, bugs: Bug[]): number {
    if (bugs.length === bugCount) {
      return bugs.reduce((sum, bug) => sum + this.getSeverityWeight(bug.severity), 0);
    }
    return this.getSeverityWeight(Severity.MINOR) * bugCount;
  }

  /**
   * Get severity weight for scoring.
   */
  private getSeverityWeight(severity: Severity): number {
    switch (severity) {
      case Severity.CRITICAL:
        return 3;
      case Severity.MAJOR:
        return 2;
      case Severity.MINOR:
      default:
        return 1;
    }
  }
}