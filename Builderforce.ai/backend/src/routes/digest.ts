/**
 * Weekly Digest API Routes
 *
 * REST API endpoints for generating, storing, and retrieving weekly digests.
 * Implements FR2.1, FR2.2, FR3.7 (Digest Storage & Paging)
 */

import { Router } from 'express';
import { WeeklyDigestWorker } from '../WeeklyDigestWorker';

const router = Router();
const worker = new WeeklyDigestWorker(getMockConfig(), getMockStorage());

/**
 * GET /api/digest/latest
 *
 * Gets the most recent weekly digest.
 * FR2.1 - Auto-Generation reference
 * FR3.7 - Digest storage for paging/distribution
 */
router.get('/api/digest/latest', async (req, res) => {
  try {
    const latestDigest = await getMockStorage().getLatestDigest();

    if (!latestDigest) {
      res.json(null);
      return;
    }

    res.json(latestDigest);
  } catch (error) {
    console.error('Error fetching latest digest:', error);
    res.status(500).json({ error: 'Failed to fetch digest' });
  }
});

/**
 * GET /api/digest/history
 *
 * Gets digest history with pagination support.
 * FR3.7 - Digest storage and paging capabilities
 *
 * Query Parameters:
 * - limit: Number of digests to return (default 10)
 * - offset: Number of digests to skip (default 0)
 */
router.get('/api/digest/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;

    const history = await getMockStorage().getDigestHistory(limit, offset);

    res.json(history);
  } catch (error) {
    console.error('Error fetching digest history:', error);
    res.status(500).json({ error: 'Failed to fetch digest history' });
  }
});

/**
 * POST /api/digest/generate
 *
 * Manually triggers a digest generation (useful for testing or on-demand).
 * FR2.1 - Auto-Generation reference
 */
router.post('/api/digest/generate', async (req, res) => {
  try {
    const result = await worker.run();

    if (result.success) {
      res.json({
        success: true,
        digest: result.digest,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('Error generating digest:', error);
    res.status(500).json({ error: 'Failed to generate digest' });
  }
});

/**
 * GET /api/digest/config
 *
 * Gets the current digest configuration.
 * FR3.4 - Digest Configuration
 */
router.get('/api/digest/config', (req, res) => {
  try {
    const config = getMockConfig();

    res.json(config);
  } catch (error) {
    console.error('Error fetching digest config:', error);
    res.status(500).json({ error: 'Failed to fetch digest config' });
  }
});

/**
 * POST /api/digest/config
 *
 * Updates the digest configuration.
 * FR3.4 - Digest Configuration
 */
router.post('/api/digest/config', (req, res) => {
  try {
    const newConfig = req.body;
    // In production, this would save to database
    // await saveDigestConfig(newConfig);
    res.json({ success: true, message: 'Configuration updated' });
  } catch (error) {
    console.error('Error updating digest config:', error);
    res.status(500).json({ error: 'Failed to update digest config' });
  }
});

// Mock configuration and storage for demo
interface MockDigestConfig {
  enabled: boolean;
  digestWindow: { start: string; end: string; windowName: string };
  distributionList: {
    requiredApprovers: string[];
    informedPartyEmails: string[];
    slackChannels: string[];
  };
  template: {
    subject: string;
    bodyFormat: 'markdown' | 'plain' | 'html';
    sections: { summary: string; topConflicts: string; urgentItems: string };
  };
  maxLength: number;
}

function getMockConfig(): MockDigestConfig {
  return {
    enabled: true,
    digestWindow: {
      start: 'monday',
      end: 'friday',
      windowName: 'weekly',
    },
    distributionList: {
      requiredApprovers: [],
      informedPartyEmails: [],
      slackChannels: ['#stakeholder-updates'],
    },
    template: {
      subject: 'Weekly Stakeholder Alignment Digest - {period}',
      bodyFormat: 'markdown',
      sections: {
        summary: 'Key metrics summary for {period}',
        topConflicts: 'Top 2 Conflicts and Overdue Items',
        urgentItems: 'Urgent Action Items',
      },
    },
    maxLength: 600,
  };
}

interface MockDigestStorage {
  saveDigest: (digest: any) => Promise<void>;
  getLatestDigest: () => Promise<any | null>;
  getDigestsByProject: (projectId: string) => Promise<any[]>;
  getDigestHistory: (limit: number, offset: number) => Promise<any[]>;
}

function getMockStorage(): MockDigestStorage {
  // In production, this would be an actual database or file store
  const storage: MockDigestStorage = {
    saveDigest: async (digest: any) => {
      console.log('[Mock Storage] Saving digest:', digest.digestId);
    },
    getLatestDigest: async (): Promise<any | null> => {
      // Mock latest digest
      return {
        digestId: 'digest_demo_001',
        generatedAt: new Date().toISOString(),
        recipients: [],
        content: 'Demo digest content',
        metrics: {},
      };
    },
    getDigestsByProject: async (projectId: string): Promise<any[]> => {
      return [];
    },
    getDigestHistory: async (limit: number, offset: number): Promise<any[]> => {
      return [];
    },
  };

  return storage;
}

export default router;

/**
 * Usage Example:
 * GET /api/digest/latest
 * GET /api/digest/history?limit=10&offset=0
 * POST /api/digest/generate
 * GET /api/digest/config
 * POST /api/digest/config
 */