/**
 * Conflict Alert Entity
 * 
 * Represents a detected conflict alert with full labeling, deduplication support,
 * and resolution tracking.
 */

import type {
  ConflictAlert,
  ConflictKey,
  ConflictingPriorities,
  Stakeholder,
  Team,
  PriorityLevel
} from './types.js';
import { CONFLICT_RULE_SPEC } from './conflict-rule.spec.js';

/**
 * Helper to generate conflict keys
 */
export function generateConflictKey(
  stakeholderId1: string,
  stakeholderId2: string,
  teamId: string,
  versionId?: string
): string {
  // Sort stakeholder IDs to ensure consistent ordering
  const sortedStakeholders = [stakeholderId1, stakeholderId2].sort();
  const keyParts = [
    sortedStakeholders[0],
    sortedStakeholders[1],
    teamId
  ];
  if (versionId) {
    keyParts.push(versionId);
  }
  return keyParts.join('__');
}

/**
 * Create a conflict key object from generated string
 */
export function parseConflictKey(keyString: string): ConflictKey {
  const parts = keyString.split('__');
  if (parts.length < 3) {
    throw new Error(`Invalid conflict key format: ${keyString}`);
  }
  
  const stakeholderId1 = parts[0];
  const stakeholderId2 = parts[1];
  const teamId = parts[2];
  const versionId = parts[3] || undefined;
  
  return {
    stakeholderId1,
    stakeholderId2,
    teamId,
    versionId
  };
}

/**
 * Conflicting Priorities Builder
 */
export function buildConflictingPriorities(
  stakeholder1: Stakeholder | Partial<Stakeholder>,
  stakeholder2: Stakeholder | Partial<Stakeholder>,
  team: Team | Partial<Team>,
  priority1: PriorityLevel,
  priority2: PriorityLevel,
  teamId: string
): ConflictingPriorities {
  return {
    stakeholder1: {
      stakeholderId: stakeholder1.id || stakeholder1.userId || 'unknown',
      stakeholderName: stakeholder1.name || `Stakeholder ${stakeholder1.id || 'unknown'}`,
      role: stakeholder1.role
    },
    team: {
      teamId: teamId,
      teamName: team.name || `Team ${team.id || 'unknown'}`
    },
    priority1,
    priority2
  };
}

/**
 * Conflict Alert Factory
 */
export class ConflictAlertFactory {
  /**
   * Create a new ConflictAlert
   */
  static createAlert(
    stakeholder1: Stakeholder | Partial<Stakeholder>,
    stakeholder2: Stakeholder | Partial<Stakeholder>,
    team: Team | Partial<Team>,
    teamId: string,
    priority1: PriorityLevel,
    priority2: PriorityLevel,
    sourceRequestIds: string[],
    versionId?: string
  ): ConflictAlert {
    const conflictKey = generateConflictKey(
      stakeholder1.id || stakeholder1.userId || 'unknown',
      stakeholder2.id || stakeholder2.userId || 'unknown',
      teamId,
      versionId
    );
    
    // Generate summary
    const summary = this.buildSummary(
      stakeholder1.name || stakeholder1.id || 'unknown',
      stakeholder2.name || stakeholder2.id || 'unknown',
      (team.name || `Team ${team.id}`),
      priority1,
      priority2
    );
    
    // Determine severity
    const severity = this.determineSeverity(priority1, priority2);
    
    const now = new Date();
    
    return {
      id: conflictKey,
      key: parseConflictKey(conflictKey),
      title: this.buildTitle(teamId, team.name, priority1, priority2),
      description: this.buildDescription(
        stakeholder1.id || stakeholder1.userId,
        stakeholder2.id || stakeholder2.userId,
        stakeholder1.name || stakeholder1.id,
        stakeholder2.name || stakeholder2.id,
        (team.name || `Team ${team.id}`),
        priority1,
        priority2,
        now
      ),
      summary,
      severity,
      detectedAt: now.toISOString(),
      status: 'open',
      conflictingPriorities: buildConflictingPriorities(
        stakeholder1,
        stakeholder2,
        team,
        priority1,
        priority2,
        teamId
      ),
      stakeholders: [
        {
          stakeholderId: stakeholder1.id || stakeholder1.userId || 'unknown',
          stakeholderName: stakeholder1.name || stakeholder1.id || 'unknown',
          role: stakeholder1.role
        },
        {
          stakeholderId: stakeholder2.id || stakeholder2.userId || 'unknown',
          stakeholderName: stakeholder2.name || stakeholder2.id || 'unknown',
          role: stakeholder2.role
        }
      ],
      versionIds: versionId ? [versionId] : [],
      sourceRequestIds,
      conflictCount: 1
    };
  }
  
  /**
   * Build alert title
   */
  private static buildTitle(
    teamId: string,
    teamName: string | undefined,
    priority1: PriorityLevel,
    priority2: PriorityLevel
  ): string {
    const teamLabel = teamName || `Team ${teamId}`;
    return `${teamLabel} — P0 Priority Conflict`;
  }
  
  /**
   * Build alert description
   */
  private static buildDescription(
    stakeholderId1: string,
    stakeholderId2: string,
    stakeholderName1: string,
    stakeholderName2: string,
    teamName: string,
    priority1: PriorityLevel,
    priority2: PriorityLevel,
    detectedAt: Date
  ): string {
    return `Discovered on ${detectedAt.toISOString()}. Two stakeholders assigned P0 priorities to ${teamName}. 
Stakeholder ${stakeholderName1} (ID: ${stakeholderId1}) set priority ${priority1}. 
Stakeholder ${stakeholderName2} (ID: ${stakeholderId2}) set priority ${priority2}. 
This conflict must be resolved manually to prevent resource allocation issues.`;
  }
  
  /**
   * Build concise summary
   */
  private static buildSummary(
    stakeholderName1: string,
    stakeholderName2: string,
    teamName: string,
    priority1: PriorityLevel,
    priority2: PriorityLevel
  ): string {
    return `${priority1} (stakeholder ${stakeholderName1}, ${teamName}) vs ${priority2} (stakeholder ${stakeholderName2}, ${teamName})`;
  }
  
  /**
   * Determine severity from priorities
   */
  private static determineSeverity(priority1: PriorityLevel, priority2: PriorityLevel): 'critical' | 'high' | 'medium' | 'low' {
    // P0 to P0 -> Critical
    if (priority1 === 'P0' && priority2 === 'P0') {
      return 'critical';
    }
    
    // P0 to P1 -> High
    if (priority1 === 'P0' || priority2 === 'P0') {
      return 'high';
    }
    
    // P1 to P1 -> Medium
    if (priority1 === 'P1' && priority2 === 'P1') {
      return 'medium';
    }
    
    // P1 to P2 or P0 to P2 etc -> Low
    return 'low';
  }
  
  /**
   * Determine conflict count from source requests
   */
  static getConflictCount(sourceRequestIds: string[]): number {
    // For detection, we count unique sources
    return new Set(sourceRequestIds).size;
  }
  
  /**
   * Calculate severity from conflict count
   * (More conflicts of same type = higher urgency)
   */
  static getSeverityByCount(count: number): 'critical' | 'high' | 'medium' | 'low' {
    if (count >= 3) return 'critical';
    if (count >= 2) return 'high';
    return 'medium';
  }
}