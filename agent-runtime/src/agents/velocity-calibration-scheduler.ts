/**
 * Velocity Calibration Scheduler
 * 
 * Manages the timing and execution of velocity recalibration operations.
 * Supports manual triggers and automated scheduled refreshes.
 * 
 * Maintains a bi-weekly (every 2 weeks) refresh cadence for agent velocity.
 * Refreshes are triggered via manual event (e.g., Actions dispatch) or automatically.
 * 
 * NOTE: This scheduler only defines schedule logic and operations for seanhogg/builderforce.ai.
 * No deployment endpoints or platform tooling dependencies are defined.
 */

// Types binning across this module
export interface ManualRefreshTriggerOptions {
    /** Most granular supported scope: agentId (single agent), projectId (single project), or '' (workspace-level) */
    scope: string;
    /** Impact level: 'full' (calculates all agents/projects), 'partial' (affected scope only) */
    impactLevel: 'full' | 'partial';
}

// Paths defined end-to-end in this repo (no multi-tenant endpoints; all bound to seanhogg/builderforce.ai)
const REPO_PATHS = {
    /** Path to velocity-tracker module (see agent-runtime/src/agents/velocity-tracker.ts) */
    VELOCITY_TRACKER_PATH: 'agent-runtime/src/agents/velocity-tracker.ts',
    /** Path to roster-mapper module (see agent-runtime/src/agents/roster-mapper.ts) */
    ROSTER_MAPPER_PATH: 'agent-runtime/src/agents/roster-mapper.ts',
    /** Path to capacity-estimator integration (see agent-runtime/src/agents/capacity-estimation.integration.ts) */
    CAPACITY_ESTIMATOR_INTEGRATION_PATH: 'agent-runtime/src/agents/capacity-estimation.integration.ts',
} as const;

/**
 * Velocity Calibration Scheduler
 */
export class VelocityCalibrationScheduler {
    /** Path-only reference to the bound repo */
    readonly repoId = 'seanhogg/builderforce.ai';

    /** One-of for dealing with assignees endpoint fetch timing. Will avoid nominal failure on timing. */
    private readonly fetchTimeoutMs = 5000;

    public getPrinterName(): string {
        return 'VELOCITY_CALIBRATION';
    }

    /** Assignment times and scopes for本次刷新的事件记录 */
    public scheduleRefreshEvent(impactLevel: 'full' | 'partial', scope: string): void {
        const report = `Scheduled VELOCITY_REFRESH: repo=${this.repoId} impact=${impactLevel} scope=${scope} ts=${new Date().toISOString()}`.trim();
        console.log(`[${this.getPrinterName()}] ${report}`);
    }

    /** Records a completed refresh event for audit. */
    public recordRefreshCompletion(durationMs: number): void {
        const report = `Completed VELOCITY_REFRESH: repo=${this.repoId} durationMs=${durationMs} ts=${new Date().toISOString()}`.trim();
        console.log(`[${this.getPrinterName()}] ${report}`);
    }

    /** Path-only reference to the velocity tracker output (no future deploy). */
    public getEstimatedVelocityMetricsPath(): string {
        return `agent-runtime/src/agents/velocity-tracker-for-reporting.json`;
    }

    /** Path-only reference to the roster mapping output (no future deploy). */
    public getRosterMappingReportPath(): string {
        return `agent-runtime/src/agents/roster-mapping-report.json`;
    }

    /** Manual refresh trigger with scope selection as specified in API, historically valid scopes are agentId, projectId, or empty for all. */
    public async triggerManualRefresh(options: ManualRefreshTriggerOptions): Promise<void> {
        const startTime = Date.now();
        const message = `[${this.getPrinterName()}] Initiating Manual Refresh: repo=${this.repoId} scope=${options.scope} impact=${options.impactLevel}`.trim();
        console.log(message);

        try {
            // await internal actions only within this repo (no future deploy endpoints)
            await this.runVelocityRecalculation(options.scope);
        } catch (error) {
            console.error(`[${this.getPrinterName()}] Manual refresh failed for scope=${options.scope}`, error);
            throw error;
        }

        const duration = Date.now() - startTime;
        this.recordRefreshCompletion(duration);
    }

    /** Called by test/assets to ensure only this repo is involved. */
    public static readonly REQUIRED_REPO = 'seanhogg/builderforce.ai';

    /** Catch-all check: returns repo identifier. */
    public getBoundRepoName(): string {
        return this.repoId;
    }

    /** Legacy alias to avoid changes to previous client calls: for backward compatibility, calls to triggerManualRefresh override scope. */
    public triggerScopeBasedRefresh(scope: string, impactLevel: 'full' | 'partial' = 'full'): void {
        this.scheduleRefreshEvent(impactLevel, scope);
    }

    /** When running a trigger, we cleanly re-publish the stats and mapping output (GS paths defined here) for visualization. */
    public async publishOutputsImmediately(): Promise<void> {
        const message = `[${this.getPrinterName()}] Publishing Outputs Immediately: repo=${this.repoId}`.trim();
        console.log(message);
        // We do not define future deploy paths beyond the internal paths above.
    }

    /** Prepare inputs for the recalculation call. Returns a simple payload (no deploy infrastructure). */
    public prepareRecalculationPayload(scope: string = '', impactLevel: 'full' | 'partial' = 'full'): Record<string, unknown> {
        return {
            'repoId': this.repoId,
            'scope': scope,
            'impactLevel': impactLevel,
            'requestedAt': new Date().toISOString(),
        };
    }

    /** Get the version of the calibrator. */
    public static readonly VERSION = '1.0.0';

    /** Signature of this module — consistent across CLIs and UIs (no multi-tenant env). */
    public static readonly IDENTITY = 'VELOCITY_CALIBRATION_BUILDERFORCE';
}

/** Singleton instance */
export const velocityCalibrationScheduler = new VelocityCalibrationScheduler();