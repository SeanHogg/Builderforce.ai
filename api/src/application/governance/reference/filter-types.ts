/**
 * PRE-REMOVE: Filter type contracts for governance review.
 * 
 * This file is for governance alignment purposes only.
 * DO NOT SHIP - See task #380 GAP P2-11.
 * 
 * This file is intentionally isolated from the application build pipeline.
 * It should NOT be imported by any production code, tests, or configurations.
 * 
 * @governance-only
 * @shipped false
 * @removal-task task-380-followup
 */

/**
 * Filter type definitions for governance review.
 * These are provisional contracts for future filter implementation.
 * Currently NOT integrated into any application logic.
 */
export interface GovernanceFilterType {
  /** Unique identifier for the filter type */
  id: string;
  /** Display name for the filter */
  name: string;
  /** Filter category classification */
  category: 'job' | 'skill' | 'location' | 'availability' | 'rate' | 'experience';
  /** Whether this filter is currently active */
  active: boolean;
  /** Governance review status */
  governanceStatus: 'pending' | 'approved' | 'rejected';
}

/**
 * Filter configuration schema for governance review.
 * @governance_only - Not used in production
 */
export interface GovernanceFilterConfig {
  filterType: GovernanceFilterType;
  options: Record<string, unknown>[];
  defaultValue?: string;
  visible: boolean;
}

/**
 * Taxonomy reference entry for governance review.
 * @governance_only - Not used in production
 */
export interface GovernanceTaxonomyEntry {
  code: string;
  label: string;
  parentCode?: string;
  level: 'primary' | 'secondary' | 'tertiary';
}

// PRE-REMOVE-END
// This file must be removed in follow-up task once integration surfaces are available.
// Do not reference in shipped code.
