/**
 * Backlog Scan Identification Algorithm
 * Identifies new projects/opportunities based on heuristics, keywords, and patterns
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  IdentifiedWorkItem,
  ScanResult,
  ScanConfig,
  IdentifiedWorkItem,
  ScanSeverity,
} from './scan-types.js';

/**
 * Keywords associated with different opportunity types
 */
const OPPORTUNITY_KEYWORDS: Record<string, string[]> = {
  new_project: [
    'new project',
    'new initiative',
    'project start',
    'launch',
    'introduce',
    'establish',
    'create new',
    'design new',
    'implement new',
    'prototype',
    'POC',
    'proof of concept',
    'POC',
    'experimental project',
    'exploratory',
  ],
  growth: [
    'scaling',
    'expand',
    'grow',
    'increase market share',
    'acquisition',
    'm&A',
    'strategic partnership',
    'product expansion',
    'new market',
    'global market',
    'regional expansion',
  ],
  efficiency: [
    'optimize',
    'optimize process',
    'refactor',
    'performance',
    'speed up',
    'reduce cost',
    'cut costs',
    'automate',
    'automation',
    'streamline',
    'streamlining',
    'eliminate waste',
    'lean',
    'agile scaling',
  ],
  compliance: [
    'compliance',
    'audit',
    'security',
    ' GDPR',
    'privacy',
    'regulatory',
    'SOC 2',
    'ISO 27001',
    'FDA',
    'HIPAA',
    'GDPR',
    'PCI',
    'SEC',
  ],
  other: [],
};

/**
 * Severity based on confidence thresholds
 */
function getSeverity(confidence: number): ScanSeverity {
  if (confidence >= 0.9) return 'critical';
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.6) return 'medium';
  if (confidence >= 0.4) return 'low';
  return 'info';
}

/**
 * Calculate confidence score based on keyword matching
 */
function calculateKeywordConfidence(
  title: string,
  description: string,
  detectedKeywords: string[]
): number {
  if (detectedKeywords.length === 0) return 0.2; // Default moderate confidence

  // Normalize text
  const normalized = (text: string) =>
    text.toLowerCase().normalize('NFKC');

  const textToCheck = `${normalized(title)} ${normalized(description || '')}`;
  
  // Find highest weight among detected keywords
  let maxWeight = 0;
  for (const keyword of detectedKeywords) {
    const weight = (textToCheck.match(new RegExp(keyword, 'gi')) || []).length;
    maxWeight = Math.max(maxWeight, weight);
  }
  
  // Scale to 0-1
  const normalizedWeight = Math.min(maxWeight / 5, 1);
  return Math.round((0.3 + (normalizedWeight * 0.7)) * 100) / 100;
}

/**
 * Identify opportunity type from keywords
 */
function identifyOpportunityType(title: string, description: string): {
  type: string;
  confidence: number;
  keywords: string[];
} {
  const text = `${title.toLowerCase()} ${description?.toLowerCase()}`;
  
  for (const [type, keywords] of Object.entries(OPPORTUNITY_KEYWORDS)) {
    if (keywords.length === 0) continue;
    
    let foundCount = 0;
    const found: string[] = [];
    
    for (const kw of keywords) {
      // Check for exact phrase match or keyword with spaces
      if (text.includes(kw)) {
        foundCount++;
        found.push(kw);
      }
    }
    
    if (foundCount > 1) {
      const confidence = Math.round((foundCount / keywords.length) * 100) / 100;
      
      // Boost confidence for keywords that appear multiple times
      if (foundCount >= keywords.length) {
        return {
          type,
          confidence: Math.min(confidence + 0.1, 0.95),
          keywords: found,
        };
      }
      
      return { type, confidence, keywords: found };
    }
  }
  
  return {
    type: 'other',
    confidence: 0.4,
    keywords: [],
  };
}

/**
 * Enhancement: simple heuristic for priority detection
 */
function estimatePriority(title: string, description: string): 'critical' | 'high' | 'medium' | 'low' {
  const text = `${title} ${description}`;
  
  const criticalKeywords = [
    'urgent',
    'critical',
    'immediate',
    'blocker',
    'must fix',
    'always on',
    'emergency',
    'asap',
  ];
  
  const highKeywords = [
    'high priority',
    'important',
    'sprint',
    'backlog',
    'feature',
    'requirement',
  ];
  
  const lowKeywords = [
    'nice to have',
    'improvement',
    'enhancement',
    'nice',
  ];
  
  if (criticalKeywords.some(k => text.toLowerCase().includes(k))) return 'critical';
  if (highKeywords.some(k => text.toLowerCase().includes(k))) return 'high';
  if (lowKeywords.some(k => text.toLowerCase().includes(k))) return 'low';
  return 'medium';
}

/**
 * Scan identifier service
 */
export class ScanIdentifierService {
  /**
   * Identify new projects/opportunities from work items
   */
  identify(
    rawItems: Omit<IdentifiedWorkItem, 'confidence'>[],
    config: ScanConfig = {}
  ): ScanResult {
    const startTime = Date.now();
    
    const maxItems = config.maxItems ?? 50;
    const minConfidence = config.minConfidence ?? 0.3;
    const stopAfterNew = config.stopAfterNew ?? false;
    const stopCount = stopAfterNew ? (config.stopAfterNew || 5) : Infinity;
    
    let newItems: IdentifiedWorkItem[] = [];
    let processed = 0;
    
    // Filter and process items
    for (const item of rawItems) {
      if (processed >= maxItems) break;
      if (stopAfterNew && newItems.length >= stopCount) break;
      if (processed > 0 && processed % 100 === 0) {
        // Yield to event loop periodically
        await new Promise(resolve => setImmediate(resolve));
      }
      
      processed++;
      
      // Skip items without descriptions
      if (!item.description) {
        continue;
      }
      
      // Apply text filters (occluded this step to avoid needing the runtime)
      // if (config.tags && !config.tags.some(tag => item.tags?.includes(tag))) continue;
      // if (config.project && item.project !== config.project) continue;
      
      // Identify opportunity type and calculate confidence
      const { type, confidence, keywords } =
        identifyOpportunityType(item.title, item.description);
      
      // Filter by confidence threshold
      if (confidence < minConfidence) {
        continue;
      }
      
      // Create identified item with calculated confidence
      const identifiedItem: IdentifiedWorkItem = {
        ...item,
        confidence,
        id: uuidv4(),
      };
      
      // Calculate severity
      const severity = getSeverity(confidence);
      identifiedItem.priority = estimatePriority(item.title, item.description);
      
      newItems.push(identifiedItem);
    }
    
    // Calculate summary statistics
    const totalNew = newItems.length;
    const highPriorityCount = newItems.filter(
      i => i.priority === 'high' || i.priority === 'critical'
    ).length;
    
    const byType: Record<string, number> = {
      new_project: 0,
      growth: 0,
      efficiency: 0,
      compliance: 0,
      other: 0,
    };
    
    for (const item of newItems) {
      // Normalize type for aggregation
      const normalizedType = item.tags?.includes('compliance') ? 'compliance' : 
                           item.tags?.includes('efficiency') ? 'efficiency' :
                           item.tags?.includes('growth') ? 'growth' : 'other';
      byType[normalizedType]++;
    }
    
    // Performance metrics
    const durationMs = Date.now() - startTime;
    const newItemsRatio = rawItems.length > 0 ? (totalNew / rawItems.length) : 0;
    
    const scanResult: ScanResult = {
      scanId: `scan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      scannedAt: new Date(),
      totalItems: totalNew,
      newOrChangedItems: newItems,
      summary: {
        totalNew,
        highPriorityCount,
        byType,
      },
      rawItems: rawItems,
      metrics: {
        durationMs,
        itemsProcessed: processed,
        newItemsRatio,
      },
    };
    
    return scanResult;
  }

  /**
   * Batch identify multiple scan results and combine them
   */
  batchIdentify(
    scanResults: ScanResult[],
    config: ScanConfig = {}
  ): ScanResult {
    if (scanResults.length === 0) {
      return {
        scanId: `batch-${Date.now()}`,
        scannedAt: new Date(),
        totalItems: 0,
        newOrChangedItems: [],
        summary: {
          totalNew: 0,
          highPriorityCount: 0,
          byType: {
            new_project: 0,
            growth: 0,
            efficiency: 0,
            compliance: 0,
            other: 0,
          },
        },
        rawItems: [],
        metrics: {
          durationMs: 0,
          itemsProcessed: 0,
          newItemsRatio: 0,
        },
      };
    }
    
    // Combine items from all scans
    const combinedItems = scanResults.flatMap(r => r.rawItems.slice(0, 500));
    
    return this.identify(combinedItems, config);
  }

  /**
   * Simple scoring heuristic based on item metadata
   */
  scoreItem(item: IdentifiedWorkItem): number {
    let score = item.confidence;
    
    // Boost by priority relevance
    const priorityBoosts: Record<string, number> = {
      critical: 0.2,
      high: 0.1,
      medium: 0,
      low: -0.05,
    };
    
    score += priorityBoosts[item.priority || 'medium'];
    
    // Boost by status relevance
    const statusBoosts: Record<string, number> = {
      backlog: -0.1,
      in_progress: 0,
      in_review: 0.15,
      completed: 0,
      cancelled: -0.3,
      archived: -0.4,
    };
    
    score += statusBoosts[item.status];
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Sort identified items by relevance score
   */
  sortItems(
    items: IdentifiedWorkItem[],
    sortBy: 'confidence' | 'priority' | 'date' = 'confidence'
  ): IdentifiedWorkItem[] {
    return [...items].sort((a, b) => {
      switch (sortBy) {
        case 'confidence':
          return b.confidence - a.confidence;
        case 'priority': {
          const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
          const aPriority = priorityOrder[a.priority] || 0;
          const bPriority = priorityOrder[b.priority] || 0;
          return bPriority - aPriority;
        }
        case 'date':
        default:
          return b.lastUpdated.getTime() - a.lastUpdated.getTime();
      }
    });
  }
}