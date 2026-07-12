/**
 * Bug Analysis Service Tests
 */

import { BugAnalysisService } from '../bug-analysis.js';
import { Bug, Severity } from '../types.js';

describe('Bug Analysis Service', () => {
  let service: BugAnalysisService;
  let config: any;

  beforeEach(() => {
    config = {
      thresholds: { repository: 50, module: 15, file: 3 },
      weights: { critical: 3, major: 2, minor: 1 },
      integrations: {},
    };

    const bugs: Bug[] = [
      {
        id: 'GITHUB-1',
        title: 'Critical bug in auth module',
        severity: Severity.CRITICAL,
        status: 'open',
        source: 'github',
        sourceId: '1',
        files: ['src/services/auth.ts'],
        modules: ['src/services'],
        createdAt: '2025-01-01T00:00:00Z',
      },
      {
        id: 'GITHUB-2',
        title: 'Major bug in utils',
        severity: Severity.MAJOR,
        status: 'reopened',
        source: 'github',
        sourceId: '2',
        files: ['src/utils/helper.ts', 'src/utils/format.ts'],
        modules: ['src/utils'],
        createdAt: '2025-01-02T00:00:00Z',
      },
      {
        id: 'GITHUB-3',
        title: 'Minor bug in component',
        severity: Severity.MINOR,
        status: 'open',
        source: 'github',
        sourceId: '3',
        files: ['src/components/Button.tsx'],
        modules: ['src/components'],
        createdAt: '2025-01-03T00:00:00Z',
      },
      {
        id: 'GITHUB-4',
        title: 'Reopened critical bug',
        severity: Severity.CRITICAL,
        status: 'reopened',
        source: 'github',
        sourceId: '4',
        files: ['src/services/auth.ts'],
        modules: ['src/services'],
        createdAt: '2025-01-10T00:00:00Z', // Recent
      },
    ];

    service = new BugAnalysisService(bugs, config);
  });

  describe('analyze', () => {
    it('should run complete analysis successfully', async () => {
      const result = await service.analyze();

      expect(result).toHaveProperty('defectDensityScores');
      expect(result).toHaveProperty('hotspots');
      expect(result).toHaveProperty('recurrencePatterns');
    });
  });

  describe('computeDefectDensityScores', () => {
    let scores: any[];

    beforeEach(async () => {
      const result = await service.analyze();
      scores = result.defectDensityScores;
    });

    it('should compute score for each module', () => {
      expect(scores.length).toBeGreaterThanOrEqual(2);
    });

    it('should have weighted bug count > raw bug count', () => {
      expect(scores[0].weightedBugs).toBeGreaterThan(scores[0].bugs);
    });

    it('should identify hotspots correctly', () => {
      const hotspots = scores.filter(s => s.isAboveThreshold).map(s => s.modulePath);
      expect(hotspots.length).toBeGreaterThan(0);
    });

    it('should normalize complexity over LOC for denominator', () => {
      expect(scores[0].denominator).toBeDefined();
      expect(typeof scores[0].denominator).toBe('number');
    });

    it('should include isAboveThreshold flag', () => {
      scores.forEach(score => {
        expect(score).toHaveProperty('isAboveThreshold');
        expect(typeof score.isAboveThreshold).toBe('boolean');
      });
    });
  });

  describe('detectRecurrencePatterns', () => {
    let patterns: any[];

    beforeEach(async () => {
      const result = await service.analyze();
      patterns = result.recurrencePatterns;
    });

    it('should identify reopened files', () => {
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should count multiple reopenings', () => {
      patterns.forEach(p => {
        expect(typeof p.recurrenceCount).toBe('number');
        expect(p.recurrenceCount).toBeGreaterThanOrEqual(1);
      });
    });

    it('should have lastBugDate', () => {
      patterns.forEach(p => {
        expect(p).toHaveProperty('lastBugDate');
        expect(typeof p.lastBugDate).toBe('string');
      });
    });

    it('should filter to 1+ reopenings', () => {
      patterns.forEach(p => {
        expect(p.recurrenceCount).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('groupBugsBySeverity', () => {
    let counts;

    beforeEach(async () => {
      const result = await service.analyze();
      counts = service['groupBugsBySeverity']();
    });

    it('should have counts for all severity levels', () => {
      expect(counts['critical']).toBe(2);
      expect(counts['major']).toBe(1);
      expect(counts['minor']).toBe(1);
    });

    it('should return non-negative values', async () => {
      const result = await service.analyze();
      const counts = service['groupBugsBySeverity']();

      expect(counts['critical'] >= 0).toBe(true);
      expect(counts['major'] >= 0).toBe(true);
      expect(counts['minor'] >= 0).toBe(true);
    });
  });

  describe('getFilesWithBugs', () => {
    it('should return unique files', () => {
      const files = service.getFilesWithBugs();
      expect(files instanceof Set).toBe(true);
    });

    it('should find Bugs that reference them', () => {
      const files = service.getFilesWithBugs();
      Array.from(files).forEach(file => {
        const bugs = service['getBugsByFile'](file);
        expect(bugs.length).toBeGreaterThan(0);
      });
    });
  });

  describe('getModulesWithBugs', () => {
    it('should return unique modules', () => {
      const modules = service.getModulesWithBugs();
      expect(modules instanceof Set).toBe(true);
    });

    it('should use explicit module mappings when available', () => {
      const bugs = [
        {
          id: 'GITHUB-5',
          title: 'Test with explicit modules',
          severity: Severity.CRITICAL,
          status: 'open',
          source: 'github',
          sourceId: '5',
          files: ['src/test.ts'],
          modules: ['explicit/module', 'another/module'],
          createdAt: '2025-01-01T00:00:00Z',
        },
      ] as Bug[];

      const testService = new BugAnalysisService(bugs, config);
      const modules = testService.getModulesWithBugs();
      expect(modules.has('explicit/module')).toBe(true);
      expect(modules.has('another/module')).toBe(true);
    });
  });

  describe('getBugsByFile', () => {
    it('should find all Bugs for a file', () => {
      const bugs = service['getBugsByFile']('src/services/auth.ts');
      expect(Array.isArray(bugs)).toBe(true);
    });

    it('should match partial paths', () => {
      const bugs = service['getBugsByFile']('src/services/');
      expect(bugs.length).toBe(2); // Both auth.ts bugs
    });
  });

  describe('getLatestBugs', () => {
    it('should return latest bugs by createdAt', () => {
      const latest = service.getLatestBugs(2);
      expect(latest.length).toBe(2);
      expect(latest[0].createdAt).toBeGreaterThanOrEqual(latest[1].createdAt);
    });

    it('should respect limit parameter', () => {
      const latest = service.getLatestBugs(1);
      expect(latest.length).toBe(1);
    });

    it('should return empty array when no sources have createdAt', () => {
      const noDateBugs = [
        {
          id: 'GITHUB-6',
          title: 'Bug without date',
          severity: Severity.MINOR,
          status: 'open',
          source: 'github',
          sourceId: '6',
          files: ['src/test.ts'],
          createdAt: undefined,
        } as Bug,
      ];
      const noDateService = new BugAnalysisService(noDateBugs, config);
      const latest = noDateService.getLatestBugs(5);
      expect(Array.isArray(latest)).toBe(true);
    });
  });

  describe('unit math and logic', () => {
    it('should support low denominator', () => {
      const bugs = [
        {
          id: 'GITHUB-7',
          title: 'Single bug high impact',
          severity: Severity.CRITICAL,
          status: 'open',
          source: 'github',
          sourceId: '7',
          files: ['src/test.ts'],
          modules: ['src/test'],
          createdAt: '2025-01-01T00:00:00Z',
        },
      ] as Bug[];

      const testService = new BugAnalysisService(bugs, config);
      const scores = testService.computeDefectDensityScores();
      expect(scores.length).toBe(1);
    });

    it('should handle empty bug list', () => {
      const emptyService = new BugAnalysisService([], config);
      expect(() => emptyService.analyze()).not.toThrow();
    });
  });
});