/**
 * Conflict Alert Entity
 *
 * Represents a detected conflict alert with full labeling, deduplication support,
 * and resolution tracking. Implements PRD requirements:
 * - Labeling: conflicting items, stakeholders, detection date
 * - Summarization: reasoning behind conflict
 * - Attachment: to priority version(s)
 */

import type {
  ConflictAlert,
  ConflictKey,
  ConflictingPriorities,
  Stakeholder,
  Team,
  PriorityLevel,
} from './types.js';

export type { ConflictAlert, ConflictKey, PriorityLevel };

/**
 * Generate stable conflict key for deduplication
 * Format: stakeholderId1__stakeholderId2__teamId[__versionId]
 * Stakeholders sorted lexicographically to ensure stable keys
 */
export function generateConflictKey(
  stakeholderId1: string,
  stakeholderId2: string,
  teamId: string,
  versionId?: string
): string {
  const sortedStakeholders = [stakeholderId1, stakeholderId2].sort((a, b) =>
    a.localeCompare(b)
  );
  const keyParts = [sortedStakeholders[0], sortedStakeholders[1], teamId];
  if (versionId) {
    keyParts.push(versionId);
  }
  return keyParts.join('__');
}

/**
 * Parse conflict key string into structured object
 */
export function parseConflictKey(keyString: string): ConflictKey {
  const parts = keyString.split('__');
  if (parts.length < 3) {
    throw new Error(`Invalid conflict key format: ${keyString}. Expected at least 3 parts separated by '__'`);
  }

  const stakeholderId1 = parts[0];
  const stakeholderId2 = parts[1];
  const teamId = parts[2];
  const versionId = parts[3] || undefined;

  return {
    stakeholderId1,
    stakeholderId2,
    teamId,
    versionId,
  };
}

/**
 * Build conflicting priorities structure
 */
export function buildConflictingPriorities(
  stakeholder1: Partial<Stakeholder & { id?: string; userId?: string; name?: string }>,
  stakeholder2: Partial<Stakeholder & { id?: string; userId?: string; name?: string }>,
  team: Partial<Team & { id?: string; name?: string }>,
  priority1: PriorityLevel,
  priority2: PriorityLevel,
  teamId: string
): ConflictingPriorities {
  return {
    stakeholder1: {
      stakeholderId: (stakeholder1 as any).stakeholderId || (stakeholder1 as any).id || (stakeholder1 as any).userId || 'unknown',
      stakeholderName: (stakeholder1 as any).stakeholderName || (stakeholder1 as any).name || `Stakeholder ${(stakeholder1 as any).id || 'unknown'}`,
      role: (stakeholder1 as any).role,
      email: (stakeholder1 as any).email,
    },
    stakeholder2: {
      stakeholderId: (stakeholder2 as any).stakeholderId || (stakeholder2 as any).id || (stakeholder2 as any).userId || 'unknown',
      stakeholderName: (stakeholder2 as any).stakeholderName || (stakeholder2 as any).name || `Stakeholder ${(stakeholder2 as any).id || 'unknown'}`,
      role: (stakeholder2 as any).role,
      email: (stakeholder2 as any).email,
    },
    team: {
      teamId: teamId,
      teamName: (team as any).teamName || (team as any).name || `Team ${teamId}`,
      organization: (team as any).organization,
    },
    priority1,
    priority2,
  };
}

/**
 * Conflict Alert Factory - creates properly labeled alerts per PRD
 */
export class ConflictAlertFactory {
  /**
   * Create a new ConflictAlert with full labeling, summarization, attachment
   */
  static createAlert(
    stakeholder1: Partial<Stakeholder & { id?: string; userId?: string; name?: string }>,
    stakeholder2: Partial<Stakeholder & { id?: string; userId?: string; name?: string }>,
    team: Partial<Team & { id?: string; name?: string }>,
    teamId: string,
    priority1: PriorityLevel,
    priority2: PriorityLevel,
    sourceRequestIds: string[],
    versionId?: string
  ): ConflictAlert {
    const sid1 = (stakeholder1 as any).stakeholderId || (stakeholder1 as any).id || (stakeholder1 as any).userId || 'unknown';
    const sid2 = (stakeholder2 as any).stakeholderId || (stakeholder2 as any).id || (stakeholder2 as any).userId || 'unknown';

    const conflictKey = generateConflictKey(sid1, sid2, teamId, versionId);
    const keyObj = parseConflictKey(conflictKey);

    const sName1 = (stakeholder1 as any).stakeholderName || (stakeholder1 as any).name || sid1;
    const sName2 = (stakeholder2 as any).stakeholderName || (stakeholder2 as any).name || sid2;
    const tName = (team as any).teamName || (team as any).name || teamId;

    const now = new Date();

    return {
      id: conflictKey,
      key: keyObj,
      title: this.buildTitle(tName, priority1, priority2),
      description: this.buildDescription(sid1, sid2, sName1, sName2, tName, priority1, priority2, now, versionId),
      summary: this.buildSummary(sName1, sName2, tName, priority1, priority2, versionId),
      severity: this.determineSeverity(priority1, priority2),
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
          stakeholderId: sid1,
          stakeholderName: sName1,
          role: (stakeholder1 as any).role,
          email: (stakeholder1 as any).email,
        },
        {
          stakeholderId: sid2,
          stakeholderName: sName2,
          role: (stakeholder2 as any).role,
          email: (stakeholder2 as any).email,
        },
      ],
      versionIds: versionId ? [versionId] : [],
      sourceRequestIds,
      conflictCount: new Set(sourceRequestIds).size,
    };
  }

  /**
   * Build alert title with clear team and rule violation labeling
   */
  private static buildTitle(
    teamName: string,
    priority1: PriorityLevel,
    priority2: PriorityLevel
  ): string {
    // Per PRD: labeling conflicting items clearly
    if (priority1 === 'P0' && priority2 === 'P0') {
      return `${teamName} — P0 Priority Conflict: Competing P0 requests`;
    }
    return `${teamName} — Priority Conflict: ${priority1} vs ${priority2}`;
  }

  /**
   * Build detailed description with all PRD labeling requirements:
   * conflicting items, stakeholders, detection date
   */
  private static buildDescription(
    stakeholderId1: string,
    stakeholderId2: string,
    stakeholderName1: string,
    stakeholderName2: string,
    teamName: string,
    priority1: PriorityLevel,
    priority2: PriorityLevel,
    detectedAt: Date,
    versionId?: string
  ): string {
    const versionLabel = versionId ? ` in version ${versionId}` : '';
    return [
      `Conflict detected on ${detectedAt.toISOString()}${versionLabel}.`,
      `Rule: Two distinct stakeholders assigned conflicting P0 priorities to the same team within the same review window.`,
      ``,
      `Details:`,
      `- Stakeholder "${stakeholderName1}" (ID: ${stakeholderId1}) assigned priority ${priority1} to team "${teamName}".`,
      `- Stakeholder "${stakeholderName2}" (ID: ${stakeholderId2}) assigned priority ${priority2} to the same team "${teamName}".`,
      `- Both requests target the same team within the same review window, triggering rule ${priority1} vs ${priority2} conflict.`,
      ``,
      `Impact: Resource allocation conflict — team "${teamName}" cannot satisfy two competing P0 priorities simultaneously. Requires manual resolution by conflict resolver.`,
      versionId ? `Attached to priority version(s): ${versionId}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Build concise summary explaining reasoning (PRD requirement)
   */
  private static buildSummary(
    stakeholderName1: string,
    stakeholderName2: string,
    teamName: string,
    priority1: PriorityLevel,
    priority2: PriorityLevel,
    versionId?: string
  ): string {
    const base = `Conflict: Stakeholder "${stakeholderName1}" assigned ${priority1} and stakeholder "${stakeholderName2}" assigned ${priority2} to team "${teamName}" within same review window. Rule violation: distinct stakeholders cannot both set P0 for same team in same window; requires manual resolution.`;
    return versionId ? `${base} [Version: ${versionId}]` : base;
  }

  /**
   * Determine severity from priorities
   */
  private static determineSeverity(
    priority1: PriorityLevel,
    priority2: PriorityLevel
  ): 'critical' | 'high' | 'medium' | 'low' {
    if (priority1 === 'P0' && priority2 === 'P0') {
      return 'critical';
    }
    if (priority1 === 'P0' || priority2 === 'P0') {
      return 'high';
    }
    if (priority1 === 'P1' && priority2 === 'P1') {
      return 'medium';
    }
    return 'low';
  }
}

/**
 * Re-export common types/enums for convenience
 */
export const ConflictSeverity = {
  CRITICAL: 'critical' as const,
  HIGH: 'high' as const,
  MEDIUM: 'medium' as const,
  LOW: 'low' as const,
};

export const ConflictStatus = {
  OPEN: 'open' as const,
  ACKNOWLEDGED: 'acknowledged' as const,
  RESOLVED: 'resolved' as const,
  DISMISSED: 'dismissed' as const,
};

export const PriorityLevel = {
  P0: 'P0' as const,
  P1: 'P1' as const,
  P2: 'P2' as const,
  P3: 'P3' as const,
};

export type ListConflictsQuery = {
  status?: 'open' | 'acknowledged' | 'resolved' | 'dismissed' | 'all';
  versionId?: string;
  teamId?: string;
  stakeholderId?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  page?: number;
  limit?: number;
};

export type ResolveConflictRequest = {
  action: 'acknowledge' | 'resolve' | 'dismiss';
  note?: string;
  resolverUserId?: string;
};
