/**
 * Conflict Rule Specification
 * 
 * Rule Name: Priority Mismatch in Same Review Window
 * 
 * Problem Statement:
 * During the prioritization process, stakeholders frequently submit requests 
 * that implicitly conflict. For example, assigning different P0 priorities to 
 * the same team within the same review window. These conflicts go undetected 
 * until late in the process, leading to reactive manual resolution, delays, 
 * and misaligned priorities.
 * 
 * Detection Logic:
 * Two distinct stakeholders submit requests assigning different P0 priorities 
 * to the same team within the same review window.
 * 
 * Rule Expression:
 * INTERSECTION(
 *   AND(
 *     stakeholder1 != stakeholder2,  // Distinct stakeholders
 *     team1 == team2,                  // Same team
 *     priority1 == 'P0' && priority2 == 'P0', // Both P0
 *     priority1 != priority2,          // Different priorities – but for P0 this is always true
 *     window1.Start <= window2.End,     // Overlapping windows (considering optional ranges)
 *     window2.Start <= window1.End
 *   ),
 *   requests
 * )
 * 
 * Simplified Expression:
 * For a given version, find all PriorityRequests where:
 * 1. stakeholderId1 ≠ stakeholderId2
 * 2. teamId1 == teamId2 == teamId
 * 3. priority1 == priority2 == 'P0'
 * 4. reviewWindowStart && reviewWindowEnd: windows overlap
 * 
 * Edge Cases:
 * - If reviewWindowStart/Delete is missing, skip window check (no boundary)
 * - If multiple stakeholders assign P0 to same team in same window, group by stakeholder pair
 * - If same stakeholder submits multiple P0 requests to same team, no conflict
 * 
 * Deduplication Strategy:
 * - Create a composite key: {stakeholderId1, stakeholderId2, teamId, versionId}
 * - Only one alert per unique combination
 * - Alert tracks count of how many times this specific conflict occurred
 * 
 * Severity Determination:
 * - Critical: P0 to P0 mismatch (two conflicting P0 priorities)
 * - High: P0 to P1 (one critical impact, one important)
 * - Medium: P1 to P1 (important conflicts)
 * - Low: P1 to P2 or similar (less critical)
 * 
 * Note on P0 → P0 conflict: While logically impossible to have two valid P0s, 
 * this scenario represents a need for negotiation or higher authorisation 
 * (e.g., different stakeholders claiming resource for their priority).
 * 
 * Timeline:
 * Alert is generated as soon as the second request is detected.
 * Alert persists until manually resolved, dismissed, or manually closed.
 * 
 * Decision Boundaries:
 * - Manual resolution is REQUIRED. System does not auto-resolve.
 * - Conflict re-detected after resolution: create a NEW alert with updated count.
 * 
 * Dependencies:
 * - PriorityRequest: Must have stakeholderId, teamId, priority, reviewWindowStart, reviewWindowEnd
 * - Version: Enforces review windows are scoped to specific priority versions
 * - Stakeholder: Required for attribution
 * - Team: Required for grouping
 */

/**
 * Rule Specification Document
 */
export const CONFLICT_RULE_SPEC = {
  ruleId: 'PRIORITY_MISMATCH_IN_SAME_WINDOW_alt',
  ruleName: 'Priority Mismatch in Same Review Window',
  version: '1.0.0',
  lastUpdated: '2025-06-23',
  
  description: 'Detect when two distinct stakeholders submit requests assigning different P0 priorities to the same team within the same review window.',
  
  active: true,
  
  business_value: {
    driving_problem: 'Stakeholders assign conflicting P0 priorities to the same team in the same review window, causing chaos in resource allocation and decisions.',
    business_outcome: 'Proactive detection allows timely, informed conflict resolution before prioritization locks.',
    success_metric: 'Reduced time-to-resolution for prioritization conflicts by X%',
    target_kpi: 'Detect conflicts within Y hours of second request',
    cost_of_not_implementing: 'Reactive fixes, burned out project managers, misallocated team capacity'
  },
  
  detection_logic: {
    primary_condition: {
      operator: 'AND',
      conditions: [
        { field: 'stakeholderId1', operator: '!=', value: 'stakeholderId2' },
        { field: 'teamId1', operator: '==', value: 'teamId2' },
        { field: 'priority1', operator: '==', value: 'P0' },
        { field: 'priority2', operator: '==', value: 'P0' },
        { 
          field: 'reviewWindowOverlap', 
          operator: 'true',
          derived: 'windows overlap within version'
        }
      ]
    },
    alternative_methods: [
      {
        name: 'Similarity Search',
        description: 'Compare requests by title, description, team context',
        applicability: 'Fallback when stakeholder/team identifiers are missing'
      }
    ]
  },
  
  data_requirements: {
    required_fields: [
      {
        field: 'stakeholderId',
        description: 'Unique identifier of the stakeholder',
        source: 'User profile / organization records'
      },
      {
        field: 'teamId',
        description: 'Unique identifier of the team',
        source: 'Team registry / org structure'
      },
      {
        field: 'priority',
        description: 'Priority level assigned',
        source: 'Priority field in request form'
      },
      {
        field: 'reviewWindowStart',
        description: 'Start date/time of review window',
        source: 'Priority version configuration'
      },
      {
        field: 'reviewWindowEnd',
        description: 'End date/time of review window',
        source: 'Priority version configuration'
      },
      {
        field: 'versionId',
        description: 'Priority version identifier',
        source: 'Priority version registry'
      }
    ]
  },
  
  severities: {
    critical: {
      priority_match: 'P0 ⇋ P0',
      description: 'Two P0 priorities compete for same team, representing critical resource clash',
      impact: 'Blocks delivery, grave risk to strategic goals',
      resolution_priority: 'Immediate',
      recommended_action: 'Invite senior leadership to oversight & negotiation'
    },
    high: {
      priority_match: 'P0 ⇋ P1',
      description: 'Critical priority conflicts with important priority',
      impact: 'High risk of resource misallocation expertise',
      resolution_priority: 'High',
      recommended_action: 'Escalate to program lead; impact need vs. impact desire Trade-off negotiation'
    },
    medium: {
      priority_match: 'P1 ⇋ P1',
      description: 'Two important priorities compete for same team',
      impact: 'Resource constraints between important items',
      resolution_priority: 'Medium',
      recommended_action: 'Review overall plan; prioritize by business strategic weight & dependency'
    },
    low: {
      priority_match: 'P1 ⇋ P2 or lower',
      description: 'Less critical priority conflicts with higher-priority item',
      impact: 'Minor resource delays',
      resolution_priority: 'Low',
      recommended_action: 'Local negotiation; adjust plan based on business priority views'
    }
  },
  
  deduplication: {
    key_components: [
      'stakeholderId1',
      'stakeholderId2',
      'teamId',
      'versionId'
    ],
    storage_strategy: 'Composite key in database (unique index)',
    alert_lifetime: 'Auto-close after Y months of no activity (configurable)',
    manual_close: 'Allowed via UI or API'
  },
  
  alert_template: {
    title_format: '{conflictingPriorities.team.teamName} — P0 Priority Conflict',
    description_format: 'Discovered on {detectedAt}. Two stakeholders assigned P0 priorities to {teamName}. Stakeholder {name1} set priority {priority1}. Stakeholder {name2} set priority {priority2}.',
    summary_format: '{priority1} (stakeholder {name1}, {team}) vs {priority2} (stakeholder {name2}, {team})',
    stakeholder_details: ['name', 'role', 'email'],
    version_references: ['Attach to version IDs']
  },
  
  api_integration: {
    endpoints: {
      detect: {
        method: 'POST',
        path: '/conflicts/detect',
        request_body: 'DetectConflictsRequest',
        response: 'DetectConflictsResponse',
        notes: 'Trigger by request submission or scheduled batch job'
      },
      list: {
        method: 'GET',
        path: '/conflicts',
        query_params: 'ListConflictsRequest',
        response: 'ListConflictsResponse',
        notes: 'Retrieve conflicts, support filtering and pagination'
      },
      resolve: {
        method: 'POST',
        path: '/conflicts/:id/resolve',
        request_body: 'ResolveConflictRequest',
        response: 'ResolveConflictResponse',
        notes: 'Manual resolution by conflict resolver'
      },
      by_version: {
        method: 'GET',
        path: '/conflicts/version/:versionId',
        response: 'ListConflictsResponse',
        notes: 'Efficient version-scoped queries'
      },
      by_team: {
        method: 'GET',
        path: '/conflicts/team/:teamId',
        response: 'ListConflictsResponse',
        notes: 'Efficient team-scoped queries'
      },
      by_stakeholder: {
        method: 'GET',
        path: '/conflicts/stakeholder/:stakeholderId',
        response: 'ListConflictsResponse',
        notes: 'Efficient stakeholder-scoped queries'
      }
    }
  },
  
  monitoring_and_alerting: {
    metrics: [
      'conflicts_detected_total',
      'conflicts_resolved_total',
      'conflicts_by_severity',
      'average_conflict_resolution_time',
      'duplicates_filtered'
    ],
    error_cases: [
      'Missing stakeholder or team identifier',
      'Validation errors in input requests'
    ],
    custom_dimensions: [
      'versionId',
      'teamId',
      'stakeholderId',
      'sourceSystem'
    ]
  },
  
  performance: {
    time_to_detect: '< 100ms for batch of 1000 requests',
    scalability: 'Horizontal scaling of deteter daemon works',
    resource_limits: 'Memory ~50MB, CPU ~5% steady',
    batch_processing: 'Support 1000+ requests per batch',
    incremental_processing: 'Support incremental updates via incremental API'
  }
} as const;

export type ConflictRuleSpec = typeof CONFLICT_RULE_SPEC;

/**
 * Validation utility for rule checks
 */
export function validateRequestsForConflictDetection(
  requests: PriorityRequest[],
  windowThresholdDays?: number
): PriorityRequest[] {
  const now = new Date();
  const threshold = windowThresholdDays ? windowThresholdDays : 30; // Default 30 days window

  // A rough sanity filter: if new requests aren't within a reasonable window relative to each other
  const validRequests = requests.filter(req => {
    const requestDate = new Date(req.createdAt);
    const timeDiff = Math.abs(now.getTime() - requestDate.getTime());
    const daysDiff = timeDiff / (1000 * 60 * 60 * 24);
    // Include requests from the last threshold days
    return daysDiff <= threshold;
  });

  return validRequests;
}