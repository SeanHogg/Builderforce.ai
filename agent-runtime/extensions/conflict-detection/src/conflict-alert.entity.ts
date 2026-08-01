/**
 * Conflict Alert Entity
 * Domain entity representation of a conflict alert
 */

import type { 
  ConflictAlert, 
  ConflictLabel, 
  ConflictStatus,
  StakeholderRequest 
} from './types.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * ConflictAlert Entity
 * Immutable domain entity for conflict alerts
 */
export class ConflictAlertEntity implements ConflictAlert {
  public readonly id: string;
  public status: ConflictStatus;
  public readonly ruleId: string;
  public readonly labels: ConflictLabel[];
  public readonly conflictingRequests: StakeholderRequest[];
  public readonly summary: string;
  public readonly detectedAt: string;
  public readonly detectedBy: string;
  public resolvedAt?: string;
  public resolvedBy?: string;
  public readonly priorityVersionIds: string[];

  constructor(data: ConflictAlert) {
    this.id = data.id;
    this.status = data.status;
    this.ruleId = data.ruleId;
    this.labels = [...data.labels];
    this.conflictingRequests = [...data.conflictingRequests];
    this.summary = data.summary;
    this.detectedAt = data.detectedAt;
    this.detectedBy = data.detectedBy;
    this.resolvedAt = data.resolvedAt;
    this.resolvedBy = data.resolvedBy;
    this.priorityVersionIds = [...data.priorityVersionIds];
  }

  /**
   * Check if the alert is still active
   */
  isActive(): boolean {
    return this.status === 'detected' || this.status === 'acknowledged';
  }

  /**
   * Check if the alert is resolved
   */
  isResolved(): boolean {
    return this.status === 'resolved' || this.status === 'dismissed';
  }

  /**
   * Get the team ID from labels
   */
  getTeamId(): string | undefined {
    return this.labels.find(l => l.type === 'team')?.value;
  }

  /**
   * Get the team display name from labels
   */
  getTeamName(): string | undefined {
    return this.labels.find(l => l.type === 'team')?.displayName;
  }

  /**
   * Get all stakeholder IDs from labels
   */
  getStakeholderIds(): string[] {
    return this.labels
      .filter(l => l.type === 'stakeholder')
      .map(l => l.value);
  }

  /**
   * Get the review window ID from labels
   */
  getReviewWindowId(): string | undefined {
    return this.labels.find(l => l.type === 'review-window')?.value;
  }

  /**
   * Create a new detected alert
   */
  static createDetected(
    ruleId: string,
    conflictingRequests: StakeholderRequest[],
    summary: string
  ): ConflictAlertEntity {
    const teamLabel = conflictingRequests[0];
    const teamId = teamLabel?.teamId || '';
    const teamName = teamLabel?.teamName || teamId;
    const reviewWindowId = teamLabel?.reviewWindowId || '';
    
    const stakeholderLabels: ConflictLabel[] = [];
    const seenStakeholders = new Set<string>();
    
    for (const request of conflictingRequests) {
      if (!seenStakeholders.has(request.stakeholderId)) {
        seenStakeholders.add(request.stakeholderId);
        stakeholderLabels.push({
          type: 'stakeholder',
          value: request.stakeholderId,
          displayName: request.stakeholderName
        });
      }
    }

    const alert: ConflictAlert = {
      id: uuidv4(),
      status: 'detected',
      ruleId,
      labels: [
        { type: 'team', value: teamId, displayName: teamName },
        { type: 'review-window', value: reviewWindowId, displayName: `Review Window ${reviewWindowId}` },
        ...stakeholderLabels
      ],
      conflictingRequests,
      summary,
      detectedAt: new Date().toISOString(),
      detectedBy: 'conflict-detection-engine',
      priorityVersionIds: [...new Set(conflictingRequests.map(r => r.versionId))]
    };

    return new ConflictAlertEntity(alert);
  }

  /**
   * Resolve the alert
   */
  resolve(resolution: 'acknowledged' | 'resolved' | 'dismissed', resolvedBy: string): ConflictAlertEntity {
    this.status = resolution;
    this.resolvedAt = new Date().toISOString();
    this.resolvedBy = resolvedBy;
    return this;
  }

  /**
   * Convert to plain object
   */
  toJSON(): ConflictAlert {
    return {
      id: this.id,
      status: this.status,
      ruleId: this.ruleId,
      labels: this.labels,
      conflictingRequests: this.conflictingRequests,
      summary: this.summary,
      detectedAt: this.detectedAt,
      detectedBy: this.detectedBy,
      resolvedAt: this.resolvedAt,
      resolvedBy: this.resolvedBy,
      priorityVersionIds: this.priorityVersionIds
    };
  }
}
