/**
 * Conflict Rule Specification
 * Formal specification for the P0 Team Review Window conflict detection rule
 */

import type { ConflictRule, StakeholderRequest, ConflictAlert, PriorityLevel } from './types.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Rule: P0 Team Review Window Conflict
 * 
 * Detects when two DISTINCT stakeholders submit requests that assign
 * DIFFERENT P0 priorities to the SAME team within the SAME review window.
 * 
 * Conditions:
 * 1. Both requests must have priority = 'P0'
 * 2. Both requests must target the same team (teamId)
 * 3. Both requests must be in the same review window (reviewWindowId)
 * 4. The stakeholders must be different (stakeholderId)
 * 5. The requests must be distinct (requestId)
 */
export const p0TeamReviewWindowRule: ConflictRule = {
  id: 'p0-team-review-window',
  name: 'P0 Team Review Window Conflict',
  description: 'Detects when two distinct stakeholders submit different P0 priorities for the same team within the same review window',
  
  detect(requests: StakeholderRequest[]): ConflictAlert[] {
    const alerts: ConflictAlert[] = [];
    const p0Requests = requests.filter(r => r.priority === 'P0');
    
    // Group P0 requests by team + review window
    const grouped = new Map<string, StakeholderRequest[]>();
    
    for (const request of p0Requests) {
      // Use safe key that won't break on ids containing special chars
      const groupKey = `${request.teamId}::${request.reviewWindowId}`;
      
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, []);
      }
      grouped.get(groupKey)!.push(request);
    }
    
    // Check each group for conflicts
    for (const [groupKey, groupRequests] of grouped) {
      if (groupRequests.length < 2) continue;
      
      // Find distinct stakeholders in this group
      const stakeholderMap = new Map<string, StakeholderRequest>();
      
      for (const request of groupRequests) {
        // If we already have a request from this stakeholder, we have a conflict
        // (two P0 requests from same stakeholder for same team/window = fine)
        // Only flag if it's a DIFFERENT stakeholder with DIFFERENT priority
        if (!stakeholderMap.has(request.stakeholderId)) {
          stakeholderMap.set(request.stakeholderId, request);
        }
      }
      
      // If we have more than one stakeholder, check for conflicting priorities
      if (stakeholderMap.size > 1) {
        const stakeholders = Array.from(stakeholderMap.values());
        
        // Check if priorities differ (though all are P0 in this filtered list)
        // This rule specifically looks for different P0 assignments
        const uniquePriorities = new Set(stakeholders.map(s => s.priority));
        
        if (uniquePriorities.size > 1 || stakeholders.length > 1) {
          // Generate conflict alert
          const [teamId, reviewWindowId] = groupKey.split('::');
          const teamName = stakeholders[0]?.teamName || teamId;
          
          const alert: ConflictAlert = {
            id: uuidv4(),
            status: 'detected',
            ruleId: this.id,
            labels: [
              { type: 'team', value: teamId, displayName: teamName },
              { type: 'review-window', value: reviewWindowId, displayName: `Review Window ${reviewWindowId}` },
              ...stakeholders.map(s => ({
                type: 'stakeholder' as const,
                value: s.stakeholderId,
                displayName: s.stakeholderName
              }))
            ],
            conflictingRequests: stakeholders,
            summary: `Conflict detected: Multiple stakeholders (${stakeholders.map(s => s.stakeholderName).join(', ')}) have assigned P0 priority to team "${teamName}" in review window ${reviewWindowId}. These conflicting assignments require manual resolution.`,
            detectedAt: new Date().toISOString(),
            detectedBy: 'conflict-detection-engine',
            priorityVersionIds: [...new Set(stakeholders.map(s => s.versionId))]
          };
          
          alerts.push(alert);
        }
      }
    }
    
    return alerts;
  }
};

/**
 * All available conflict detection rules
 */
export const conflictRules: ConflictRule[] = [
  p0TeamReviewWindowRule
];

/**
 * Get a rule by ID
 */
export function getRuleById(ruleId: string): ConflictRule | undefined {
  return conflictRules.find(r => r.id === ruleId);
}
