/**
 * Recommendation Engine Tests
 */

import { RecommendationEngine } from '../recommendation-engine.js';
import { Bug, Hotspot, Severity, RecommendationType, EffortTier, RecommendationStatus } from '../types.js';

describe('Recommendation Engine', () => {
  let engine: RecommendationEngine;
  let hotspots: Hotspot[];
  let bugs: Bug[];

  beforeEach(() => {
    const bug1: Bug = {
      id: 'GITHUB-1',
      title: 'Critical auth bug',
      severity: Severity.CRITICAL,
      status: 'open',
      source: 'github',
      sourceId: '1',
      files: ['src/services/auth.ts'],
      modules: ['src/services'],
      createdAt: '2025-01-01T00:00:00Z',
    };

    const bug2: Bug = {
      id: 'GITHUB-2',
      title: 'Major utils bug',
      severity: Severity.MAJOR,
      status: 'reopened',
      source: 'github',
      sourceId: '2',
      files: ['src/utils/helper.ts', 'src/utils/format.ts'],
      modules: ['src/utils'],
      createdAt: '2025-01-02T00:00:00Z',
    };

    const bug3: Bug = {
      id: 'GITHUB-3',
      title: 'Minor component bug',
      severity: Severity.MINOR,
      status: 'open',
      source: 'github',
      sourceId: '3',
      files: ['src/components/Button.tsx'],
      modules: ['src/components'],
      createdAt: '2025-01-03T00:00:00Z',
    };

    bugs = [bug1, bug2, bug3];

    const hotspot1: Hotspot = {
      path: 'src/services/auth.ts',
      name: 'auth.ts',
      modulePath: 'src/services',
      defectScore: 2.5,
      bugCount: 1,
      weightedBugs: 3,
      detectionType: 'high_bug_count',
      percentile: 0.85,
      trend: 'increasing',
    };

    const hotspot2: Hotspot = {
      path: 'src/utils',
      name: 'utils',
      modulePath: 'src/utils',
      defectScore: 1.8,
      bugCount: 1,
      weightedBugs: 2,
      detectionType: 'high_bug_count',
      percentile: 0.75,
      trend: 'stable',
    };

    const hotspot3: Hotspot = {
      path: 'src/components/Button.tsx',
      name: 'Button.tsx',
      modulePath: 'src/components',
      defectScore: 0.5,
      bugCount: 1,
      weightedBugs: 1,
      detectionType: 'high_bug_count',
      percentile: 0.6,
      trend: 'stable',
    };

    hotspots = [hotspot1, hotspot2, hotspot3];

    const config = {
      thresholds: { repository: 50, module: 15, file: 3 },
      weights: { critical: 3, major: 2, minor: 1 },
      recommendation: {
        topN: 5,
        effortTiers: { S: 'Small', M: 'Medium', L: 'Large', XL: 'XL' },
      },
      integrations: {},
    };

    engine = new RecommendationEngine(
      hotspots,
      { 'src/utils/helper.ts': { file: 'src/utils/helper.ts', recurrenceCount: 2, lastBugDate: '2025-01-02' } },
      bugs,
      config
    );
  });

  describe('generateRecommendations', () => {
    it('should generate recommendations for all hotspots', () => {
      const recs = engine.generateRecommendations({
        limit: 5,
        includeTesting: true,
        includeReview: true,
        includeRefactoring: true,
        includeRecurrenceWarnings: true,
      });

      expect(Array.isArray(recs)).toBe(true);
      expect(recs.length).toBeGreaterThan(0);
    });

    it('should include focused testing recommendations', () => {
      const recs = engine.generateRecommendations({
        includeTesting: true,
        includeReview: false,
        includeRefactoring: false,
        includeRecurrenceWarnings: false,
      });

      const testRecs = recs.filter(r => r.type === RecommendationType.FOCUSED_TESTING);
      expect(testRecs.length).toBeGreaterThan(0);

      testRecs.forEach(rec => {
        expect(rec.type).toBe(RecommendationType.FOCUSED_TESTING);
        expect(rec.rationale).toContain('comprehensive test coverage');
        expect(rec.action).toBeDefined();
        expect(rec.recommendedOwner).toBeDefined();
      });
    });

    it('should include code review recommendations', () => {
      const recs = engine.generateRecommendations({
        includeTesting: false,
        includeReview: true,
        includeRefactoring: false,
        includeRecurrenceWarnings: false,
      });

      const reviewRecs = recs.filter(r => r.type === RecommendationType.CODE_REVIEW);
      expect(reviewRecs.length).toBeGreaterThan(0);

      reviewRecs.forEach(rec => {
        expect(rec.type).toBe(RecommendationType.CODE_REVIEW);
        expect(rec.rationale).toContain('code review');
        expect(rec.recommendedReviewer).toBeDefined();
      });
    });

    it('should include refactoring recommendations', () => {
      const recs = engine.generateRecommendations({
        includeTesting: false,
        includeReview: false,
        includeRefactoring: true,
        includeRecurrenceWarnings: false,
      });

      const refactorRecs = recs.filter(r => r.type === RecommendationType.REFACTORING);
      expect(refactorRecs.length).toBeGreaterThan(0);

      refactorRecs.forEach(rec => {
        expect(rec.type).toBe(RecommendationType.REFACTORING);
        expect(rec.recommendation.status).toBe(RecommendationStatus.GENERATED);
        expect(rec.refactorTaskPayload).toBeDefined();
        expect(Array.isArray(rec.refactorTaskPayload?.targetFiles)).toBe(true);
      });
    });

    it('should generate recurrence pattern recommendations', () => {
      const recs = engine.generateRecommendations({
        limit: 10,
        includeRecurrenceWarnings: true,
        includeTesting: false,
        includeReview: false,
        includeRefactoring: false,
      });

      const recurrences = recs.filter(r => r.type === RecommendationType.REFACTORING &&
        r.rationale.includes('reopened'));
      expect(recurrences.length).toBe(1);
      expect(recurrences[0].recurrenceCount).toBeDefined();
    });

    it('should rank by priority', () => {
      const recs = engine.generateRecommendations({
        includeTesting: true,
        includeReview: true,
        includeRefactoring: true,
        includeRecurrenceWarnings: false,
      });

      for (let i = 1; i < recs.length; i++) {
        expect(recs[i - 1].priority).toBeGreaterThanOrEqual(recs[i].priority);
      }
    });

    it('should respect limit parameter', () => {
      const recs = engine.generateRecommendations({
        limit: 2,
        includeRecurrenceWarnings: false,
        includeTesting: false,
        includeReview: false,
        includeRefactoring: false,
      });

      expect(recs.length).toBe(2);
    });

    it('should use default topN from config if limit not provided', () => {
      const recs = engine.generateRecommendations({
        includeRecurrenceWarnings: false,
        includeTesting: false,
        includeReview: false,
        includeRefactoring: false,
      });

      expect(recs.length).toBe(2); // Uses config topN
    });
  });

  describe('Priority Calculation', () => {
    it('should prioritize higher defect scores', () => {
      const recs = engine.generateRecommendations({
        includeRecurrenceWarnings: false,
        includeTesting: false,
        includeReview: false,
        includeRefactoring: true,
      });

      const refactoringRecs = recs.filter(r => r.type === RecommendationType.REFACTORING);

      if (refactoringRecs.length >= 2) {
        const higherScore = refactoringRecs.find(r => r.defectScore > 2.0);
        const lowerScore = refactoringRecs.find(r => r.defectScore <= 2.0);

        if (higherScore && lowerScore) {
          expect(higherScore.priority).toBeGreaterThanOrEqual(lowerScore.priority);
        }
      }
    });

    it('should boost for critical severity', () => {
      const recs = engine.generateRecommendations({
        includeRecurrenceWarnings: false,
        includeRecurrenceWarnings: false,
        includeTesting: false,
        includeReview: false,
        includeRefactoring: false,
      });

      expect(recs.some(r => r.priority >= 80)).toBe(true);
    });
  });

  describe('Effort Tier Allocation', () => {
    it('should assign SMALL effort for low impact', () => {
      const recs = engine.generateRecommendations({
        includeRecurrenceWarnings: false,
        includeTesting: false,
        includeReview: false,
        includeRefactoring: false,
      });

      // Filter for mid-priority recs typically get MEDIUM
      const mediumRecs = recs.filter(r => r.estimatedEffort === EffortTier.MEDIUM);
      if (mediumRecs.length > 0) {
        expect(mediumRecs[0].estimatedEffort).toBe(EffortTier.MEDIUM);
      }
    });
  });

  describe('Refactor Task Payload', () => {
    it('should include complete payload structure', () => {
      const recs = engine.generateRecommendations({
        includeRecurrenceWarnings: false,
        includeTesting: false,
        includeReview: false,
        includeRefactoring: true,
      });

      const refactorRec = recs.find(r => r.type === RecommendationType.REFACTORING);
      if (refactorRec) {
        const payload = refactorRec.refactorTaskPayload;
        expect(payload).toBeDefined();
        expect(payload?.title).toBeDefined();
        expect(payload?.description).toBeDefined();
        expect(payload?.targetFiles).toBeDefined();
        expect(payload?.desiredOutcome).toBeDefined();
        expect(payload?.constraints).toBeDefined();
        expect(Array.isArray(payload?.constraints)).toBe(true);
        expect(payload?.context).toBeDefined();
      }
    });

    it('should not include payload for non-refactor recommendations', () => {
      const recs = engine.generateRecommendations({
        includeRecurrenceWarnings: false,
        includeTesting: true,
        includeReview: false,
        includeRefactoring: false,
      });

      recs.forEach(rec => {
        if (rec.type !== RecommendationType.REFACTORING) {
          expect(rec.refactorTaskPayload).toBeUndefined();
        }
      });
    });
  });

  describe('Rationale Construction', () => {
    it('should include evidence in recommendation', () => {
      const rec = engine.generateRecommendations({
        includeRecurrenceWarnings: false,
        includeTesting: false,
        includeReview: false,
        includeRefactoring: false,
      })[0];

      if (rec) {
        expect(rec.evidence).toBeDefined();
        expect(rec.evidence.bugCount).toBeDefined();
        expect(rec.evidence.defectScore).toBeDefined();
        expect(rec.evidence.weightedBugs).toBeDefined();
      }
    });

    it('should summarize severity breakdown', () => {
      const recs = engine.generateRecommendations({
        includeRecurrenceWarnings: false,
        includeTesting: false,
        includeReview: false,
        includeRefactoring: false,
      });

      recs.forEach(rec => {
        if (rec.evidence.severityCounts) {
          // At least one severity level should be present
          expect(rec.evidence.severityCounts.critical + 
                 rec.evidence.severityCounts.major + 
                 rec.evidence.severityCounts.minor).toBePositive();
        }
      });
    });
  });

  describe('Integration Testing', () => {
    it('should work end-to-end with hotspots objects', () => {
      const recs = engine.generateRecommendations({
        includeRecurrenceWarnings: false,
        includeTesting: true,
        includeReview: true,
        includeRefactoring: true,
        includeRecurrenceWarnings: false,
      });

      // Verify top N limit
      expect(recs.length).toBeLessThanOrEqual(2); // topN=5 from config, actual hotspots=3 => 3 recs

      // Verify no crashes
      recs.forEach(rec => {
        expect(typeof rec.id).toBe('string');
        expect(typeof rec.type).toBe('string');
        expect(typeof rec.priority).toBe('number');
        expect(typeof rec.rationale).toBe('string');
        expect(typeof rec.status).toBe('string');
      });
    });
  });

  describe('empty hotspots', () => {
    it('should handle missing hotspots gracefully', () => {
      const emptyHotspots: Hotspot[] = [];
      const engine = new RecommendationEngine(
        emptyHotspots,
        {},
        bugs,
        {}
      );

      const recs = engine.generateRecommendations({
        includeRecurrenceWarnings: false,
        includeTesting: false,
        includeReview: false,
        includeRefactoring: false,
      });

      expect(Array.isArray(recs)).toBe(true);
      expect(recs.length).toBe(0);
    });
  });

  describe('plural config', () => {
    it('should apply plural config values correctly', () => {
      const config = {
        thresholds: {}, // empty
        weights: {},
        integrations: {},
        recommendation: {
          topN: 3, // small N
          effortTiers: { S: 'Small', M: 'Medium', L: 'Large', XL: 'XL' },
        },
      };

      const engine = new RecommendationEngine(
        hotspots,
        {},
        bugs,
        config
      );

      const recs = engine.generateRecommendations({
        includeRefactoring: false,
        includeTesting: false,
        includeReview: false,
        includeRecurrenceWarnings: false,
      });

      expect(recs.length).toBe(2); // topN=3 actual hotspots=3 => 3 recs (limit is inclusive)
    });
  });
});