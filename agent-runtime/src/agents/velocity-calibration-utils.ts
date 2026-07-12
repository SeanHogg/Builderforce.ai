/**
 * Velocity Calibration Utilities
 * 
 * Utilities for triggering velocity recalibration and refresh operations.
 * Provides a mechanism to execute the calibration process manually or
 * determine when it's due based on the established bi-weekly cadence.
 * 
 * Follow-up from task #144 (resource-estimation analysis) and task #482.
 */

/** An agent was not found in the roster when using live data. */
export class MISSING_ROSTER_DATA extends Error {
    constructor(agentId: string, roster?: string[]) {
        const baseMsg = `Agent ${agentId} was not found in the live roster (fallback in effect). Use taskId to reconcile or check roster ${JSON.stringify(roster)}`.trim();
        super(baseMsg);
        this.name = 'MISSING_ROSTER_DATA';
    }
}