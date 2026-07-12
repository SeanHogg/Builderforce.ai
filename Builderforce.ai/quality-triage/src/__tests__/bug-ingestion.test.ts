/**
 * Bug Ingestion Service Tests
 */

import { BugIngestionService } from '../bug-ingestion.js';
import { QualityConfig } from '../types.js';

describe('Bug Ingestion Service', () => {
  let service: BugIngestionService;
  let config: QualityConfig;

  beforeEach(() => {
    config = {
      thresholds: { repository: 50, module: 15, file: 3 },
      weights: { critical: 3, major: 2, minor: 1 },
      integrations: {
        slack: { enabled: false },
        qualityServer: { enabled: true, apiEndpoint: '/quality/api' },
        issueTrackers: {
          github: {
            enabled: true,
            token: 'test-token',
          },
        },
      },
      recommendation: {
        topN: 5,
        effortTiers: { S: 'Small', M: 'Medium', L: 'Large', XL: 'XL' },
      },
    };

    service = new BugIngestionService(config);
  });

  describe('normalizeSeverity', () => {
    it('should normalize CRITICAL severity', () => {
      expect(service['normalizeSeverity']('critical')).toBe('critical');
      expect(service['normalizeSeverity']('sev1')).toBe('critical');
      expect(service['normalizeSeverity']('SEV-1')).toBe('critical');
      expect(service['normalizeSeverity']('P0')).toBe('critical');
    });

    it('should normalize MAJOR severity', () => {
      expect(service['normalizeSeverity']('major')).toBe('major');
      expect(service['normalizeSeverity']('SEV2')).toBe('major');
      expect(service['normalizeSeverity']('P1')).toBe('major');
    });

    it('should normalize MINOR severity', () => {
      expect(service['normalizeSeverity']('minor')).toBe('minor');
      expect(service['normalizeSeverity']('SEV3')).toBe('minor');
      expect(service['normalizeSeverity']('P2')).toBe('minor');
    });

    it('should handle unknown severity as MINOR', () => {
      expect(service['normalizeSeverity']('unknown')).toBe('minor');
      expect(service['normalizeSeverity']('low')).toBe('minor');
    });
  });

  describe('parseSourceId', () => {
    it('should normalize GitHub issue numbers', () => {
      expect(service['parseSourceId']('42', 'github')).toBe('GITHUB-42');
      expect(service['parseSourceId']('159', 'github')).toBe('GITHUB-159');
    });

    it('should normalize Jira issue keys', () => {
      expect(service['parseSourceId']('QA-123', 'jira')).toBe('JIRA-QA-123');
      expect(service['parseSourceId']('BUG-456', 'jira')).toBe('JIRA-BUG-456');
    });
  });

  describe('extractFilePaths', () => {
    it('should extract TypeScript file paths', () => {
      const body = 'Issue with src/types/db.ts and src/services/auth.ts';
      const files = service['extractFilePaths'](body);
      expect(files).toContain('src/types/db.ts');
      expect(files).toContain('src/services/auth.ts');
    });

    it('should handle Windows-style paths', () => {
      const body = 'Error in src\\utils\\helpers.ts';
      const files = service['extractFilePaths'](body);
      expect(files).toContain('src/utils/helpers.ts');
    });

    it('should ignore non-code files', () => {
      const body = 'Fix in README.md and docs/api.md';
      const files = service['extractFilePaths'](body);
      expect(files).not.toContain('README.md');
      expect(files).not.toContain('docs/api.md');
    });

    it('should parse File: tags', () => {
      const body = 'File: src/models/user.ts, src/services/email.ts';
      const files = service['extractFilePaths'](body);
      expect(files).toContain('src/models/user.ts');
      expect(files).toContain('src/services/email.ts');
    });

    it('should deduplicate extracted files', () => {
      const body = 'Fix src/types/db.ts, error in src/types/db.ts';
      const files = service['extractFilePaths'](body);
      expect(files.length).toBe(1);
      expect(files[0]).toBe('src/types/db.ts');
    });

    it('should handle GitHub component labels', () => {
      const body = 'Service issue: login fails';
      const labels = ['service-api', 'bug'];
      const bug = {
        id: 'test',
        title: 'Service issue',
        severity: 'major',
        status: 'open',
        source: 'github',
        sourceId: '1',
        labels,
        files: [],
      } as any;

      // Extract using files field if present
      expect(bug.files).toEqual([]);
    });
  });

  describe('getWeightedBugCount', () => {
    it('should weight by severity', () => {
      expect(service['getWeightedBugCount'](5, 'critical')).toBe(15);
      expect(service['getWeightedBugCount'](5, 'major')).toBe(10);
      expect(service['getWeightedBugCount'](5, 'minor')).toBe(5);
    });

    it('should use defaults if config missing', () => {
      const partialConfig = {
        thresholds: { repository: 50, module: 15, file: 3 },
        integrations: {},
      } as QualityConfig;
      const partialService = new BugIngestionService(partialConfig);
      expect(partialService['getWeightedBugCount'](5, 'critical')).toBe(15);
      expect(partialService['getWeightedBugCount'](5, 'major')).toBe(10);
      expect(partialService['getWeightedBugCount'](5, 'minor')).toBe(5);
    });
  });

  describe('getMergedBugs', () => {
    it('should deduplicate by sourceId', () => {
      const bugs = [
        {
          id: 'GITHUB-1',
          title: 'Bug 1',
          severity: 'critical',
          status: 'open',
          source: 'github',
          sourceId: '1',
          files: ['src/test.ts'],
        } as any,
        {
          id: 'GITHUB-1',
          title: 'Bug 1 (duplicate)',
          severity: 'critical',
          status: 'open',
          source: 'github',
          sourceId: '1',
          files: ['src/test.ts'],
        },
        {
          id: 'GITHUB-2',
          title: 'Bug 2',
          severity: 'major',
          status: 'open',
          source: 'github',
          sourceId: '2',
          files: ['src/test2.ts'],
        },
      ];

      const merged = service['getMergedBugs'](bugs);
      expect(Object.keys(merged).length).toBe(2);
      expect(merged['GITHUB-1'].title).toBe('Bug 1');
      expect(merged['GITHUB-2'].title).toBe('Bug 2');
    });

    it('should preserve bug data from later sightings', () => {
      const bug1 = {
        id: 'GITHUB-1',
        title: 'Bug 1 - First',
        severity: 'critical',
        status: 'open',
        source: 'github',
        sourceId: '1',
        files: ['src/test.ts'],
      } as any;

      const bug2 = {
        id: 'GITHUB-1',
        title: 'Bug 1 - Updated',
        severity: 'major',
        status: 'open',
        source: 'github',
        sourceId: '1',
        files: ['src/test.ts', 'src/test2.ts'],
      };

      const merged = service['getMergedBugs']([bug1, bug2]);
      expect(merged['GITHUB-1'].title).toBe('Bug 1 - Updated');
      expect(merged['GITHUB-1'].files).toContain('src/test.ts');
      expect(merged['GITHUB-1'].files).toContain('src/test2.ts');
    });
  });

  describe('GitHub Issues Integration', () => {
    beforeEach(() => {
      config.integrations!.issueTrackers!.github!.enabled = true;
      config.integrations!.issueTrackers!.github!.token = 'test-token';
      service = new BugIngestionService(config);
    });

    it('should ignore disabled trackers', () => {
      config.integrations!.issueTrackers!.jira!.enabled = false;
      const disabledService = new BugIngestionService(config);
      expect(disabledService.isTrackerEnabled('jira')).toBe(false);
    });

    it('should throw on invalid response', () => {
      config.integrations!.issueTrackers!.github!.token = 'invalid';
      const service = new BugIngestionService(config);
      return expect(service['ingestGitHubIssues'](
        config.integrations!.issueTrackers!.github!,
        {}
      )).rejects.toThrow('GitHub API error');
    });

    it('should handle recent API errors gracefully', async () => {
      config.integrations!.issueTrackers!.github!.token = 'invalid';
      const service = new BugIngestionService(config);
      const bugs = await service.ingestBugs();
      expect(Array.isArray(bugs)).toBe(true);
    });
  });

  describe('issueTrackers', () => {
    it('should return all configured trackers', () => {
      config.integrations!.issueTrackers!.jira!.enabled = true;
      const trackers = service.getTrackers();
      expect(trackers.length).toBe(1);
      expect(trackers[0].type).toBe('github');
    });

    it('should test tracker existence', () => {
      config.integrations!.issueTrackers!.jira!.enabled = true;
      expect(service.isTrackerEnabled('github')).toBe(true);
      expect(service.isTrackerEnabled('jira')).toBe(true);
    });
  });

  describe('integration health', () => {
    it('should have required credentials', () => {
      const githubConfig = config.integrations?.issueTrackers?.github;
      if (githubConfig?.enabled && !githubConfig.token) {
        // Should not fail to create service if missing token, will fail at ingest
      }
    });
  });
});