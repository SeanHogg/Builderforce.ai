/**
 * Backlog Scan API Handlers
 * HTTP endpoints for backlog scan operations
 */

import type { Request, Response, NextFunction } from 'express';
import type { GatewayRequestContext } from '../../gateway/server-methods/types.js';
import type { ScanConfig, IdentifiedWorkItem } from './scan-types.js';
import { ScanIdentifierService } from './scan-identifier.js';
import { ScanPersistenceService } from './scan-persistence.js';
import { ErrorCodes, errorShape } from '../../gateway/protocol/index.js';

/**
 * Rate limiter context for API calls
 */
interface RateLimitContext {
  limits: Map<string, number>;
  maxRequests: number;
  windowMs: number;
}

function setupRateLimiter(maxRequests = 60, windowMs = 60000): RateLimitContext {
  const limits = new Map<string, number>();
  const context: RateLimitContext = { limits, maxRequests, windowMs };
  return context;
}

const rateLimiters = {
  perUser: setupRateLimiter(10, 60000), // 10 requests per user per minute
  perIp: setupRateLimiter(50, 60000),   // 50 requests per IP per minute
};

/**
 * Scan API Service
 */
export class ScanApiService {
  private persistence: ScanPersistenceService;
  private identifier: ScanIdentifierService;

  constructor(config: { dataDir: string }) {
    this.persistence = new ScanPersistenceService(config.dataDir);
    this.identifier = new ScanIdentifierService();
  }

  /**
   * Initialize the scan API
   */
  async initialize(): Promise<void> {
    await this.persistence.initialize();
  }

  /**
   * Get scan result
   */
  async getScan(result: string): Promise<ScanResult | null> {
    return this.persistence.getScanResult(result);
  }

  /**
   * List scans
   */
  async listScans(limit?: number): Promise<ScanResult[]> {
    return this.persistence.listScans(limit);
  }

  /**
   * Get recent scans
   */
  async getRecentScans(limit = 10): Promise<ScanResult[]> {
    return this.persistence.getRecentScans(limit);
  }

  /**
   * Delete scan
   */
  async deleteScan(resultId: string): Promise<void> {
    await this.persistence.deleteScan(resultId);
  }

  /**
   * Get scan audit logs
   */
  async getAuditLogs(scanId?: string, limit = 100): Promise<unknown[]> {
    return this.persistence.getAuditLogs(scanId, undefined, limit);
  }

  /**
   * Rate limit check
   */
  async checkRateLimits(userId?: string, ip?: string): Promise<boolean> {
    const now = Date.now();
    
    // Check IP limits
    const ipKey = ip || 'unknown';
    const ipCount = rateLimiters.perIp.limits.get(ipKey) || 0;
    if (ipCount >= rateLimiters.perIp.maxRequests) {
      return false;
    }
    
    // Update IP counter
    rateLimiters.perIp.limits.set(ipKey, ipCount + 1);
    scheduleCleanup(rateLimiters.perIp, now);
    
    // Check user limits if userId provided
    if (userId) {
      const userKey = `user:${userId}`;
      const userCount = rateLimiters.perUser.limits.get(userKey) || 0;
      if (userCount >= rateLimiters.perUser.maxRequests) {
        return false;
      }
      
      rateLimiters.perUser.limits.set(userKey, userCount + 1);
      scheduleCleanup(rateLimiters.perUser, now);
    }
    
    return true;
  }

  /**
   * Internal method to combine raw items (will be replaced with real source integration)
   */
  async combineRawItems(items: Omit<IdentifiedWorkItem, 'confidence'>[]): Promise<{
    result: unknown;
    scanId: string;
  }> {
    const scanResult = this.identifier.identify(items, {
      maxItems: 100,
      minConfidence: 0.3,
    });
    
    await this.persistence.saveScanResult(scanResult);
    
    return {
      result: scanResult,
      scanId: scanResult.scanId,
    };
  }

  /**
   * Batch scan multiple result sets
   */
  async batchScan(scanResults: unknown[]): Promise<boolean> {
    // Aggregate raw items from all scans
    const combinedItems = scanResults.flatMap((r: unknown) => {
      const result = r as {
        rawItems: Omit<IdentifiedWorkItem, 'confidence'>[];
      };
      return result.rawItems.slice(0, 500);
    });
    
    const aggregatedResult = this.identifier.batchIdentify(
      scanResults.map(r => {
        const result = r as { newOrChangedItems: IdentifiedWorkItem[] };
        return {
          rawItems: [...result.rawItems, ...result.newOrChangedItems],
        };
      })
    );
    
    await this.persistence.saveScanResult(aggregatedResult);
    
    return true;
  }

  /**
   * Error response helper
   */
  errorResponse(code: number, message: string): Response {
    return Response.json(
      {
        success: false,
        error: message,
        code,
      },
      { status: code }
    ) as Response;
  }
}

/**
 * Route handlers for backlog scan API
 */
export function createScanRoutes(
  api: ScanApiService,
  gatewayContext: GatewayRequestContext
): Record<string, (req: Request, res: Response, next: NextFunction) => any> {
  return {
    /**
     * GET /api/backlog-scan/results/:scanId
     * Retrieve a specific scan result
     */
    'GET /api/backlog-scan/results/:scanId': async (req, res) => {
      const scanId = req.params.scanId;
      
      const scan = await api.getScan(scanId);
      
      if (!scan) {
        return api.errorResponse(404, `Scan not found: ${scanId}`);
      }
      
      return res.json({
        success: true,
        data: scan,
      });
    },

    /**
     * GET /api/backlog-scan/results
     * List scans (paginated)
     */
    'GET /api/backlog-scan/results': async (req, res) => {
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = parseInt(req.query.skip as string) || 0;
      
      const scans = await api.listScans(Math.min(limit, 100));
      const paginated = scans.slice(skip, skip + limit);
      
      return res.json({
        success: true,
        data: {
          scans: paginated,
          total: scans.length,
          skip,
          limit,
        },
      });
    },

    /**
     * GET /api/backlog-scan/recent
     * Get recent scans
     */
    'GET /api/backlog-scan/recent': async (req, res) => {
      const limit = parseInt(req.query.limit as string) || 10;
      const scans = await api.getRecentScans(limit);
      
      return res.json({
        success: true,
        data: {
          scans,
          total: scans.length,
        },
      });
    },

    /**
     * DELETE /api/backlog-scan/results/:scanId
     * Delete a scan result
     */
    'DELETE /api/backlog-scan/results/:scanId': async (req, res) => {
      const scanId = req.params.scanId;
      
      await api.deleteScan(scanId);
      
      return res.json({
        success: true,
        message: `Scan ${scanId} deleted successfully`,
      });
    },

    /**
     * GET /api/backlog-scan/audit/logs
     * Get audit logs
     */
    'GET /api/backlog-scan/audit/logs': async (req, res) => {
      const scanId = req.query.scanId as string | undefined;
      const limit = parseInt(req.query.limit as string) || 100;
      
      const logs = await api.getAuditLogs(scanId, limit);
      
      return res.json({
        success: true,
        data: logs,
      });
    },

    /**
     * PUT /api/backlog-scan/config
     * Create or update scan configuration
     */
    'PUT /api/backlog-scan/config': async (req, res) => {
      // TODO: Implement schedule creation/update
      return res.json({
        success: true,
        message: 'Configuration endpoint coming soon',
      });
    },

    /**
     * POST /api/backlog-scan/scan
     * Execute a manual scan (placeholder - requires ETL integration)
     */
    'POST /api/backlog-scan/scan': async (req, res) => {
      // This endpoint will need to be integrated with ETL adapters
      // For now, return a placeholder response
      return res.json({
        success: false,
        message: 'ETL integration required. See Package #345-EI-JIRA and #345-EI-TRELLO',
      });
    },

    /**
     * POST /api/backlog-scan/batch
     * Batch combine multiple scan results
     */
    'POST /api/backlog-scan/batch': async (req, res) => {
      try {
        const scanResults = req.body.results || [];
        
        if (!Array.isArray(scanResults)) {
          return res.status(400).json({
            success: false,
            message: 'results must be an array',
          });
        }
        
        const success = await api.batchScan(scanResults);
        
        if (!success) {
          return api.errorResponse(500, 'Batch scan failed');
        }
        
        // TODO: Get the new aggregated scan ID and log it
        
        return res.json({
          success: true,
          message: 'Batch scan completed successfully',
          count: scanResults.length,
        });
      } catch (err) {
        return api.errorResponse(500, (err as Error).message);
      }
    },
  };
}

/**
 * Background cleanup for rate limiters
 */
function scheduleCleanup(context: RateLimitContext, now: number): void {
  setInterval(() => {
    const newNow = Date.now();
    
    // Remove stale entries
    for (const [key, timestamp] of context.limits.entries()) {
      if (newNow - timestamp > context.windowMs) {
        context.limits.delete(key);
      }
    }
  }, context.windowMs);
}

/**
 * Health check handler
 */
export function healthCheck(): Response {
  return Response.json({
    success: true,
    service: 'backlog-scan',
    version: '1.0.0',
    status: 'operational',
  });
}