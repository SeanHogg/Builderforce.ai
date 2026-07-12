/**
 * Bug Debt Overview Components - Index File
 * 
 * Export all bug debt related components for easy importing.
 */

export { BugDebtOverview, default as BugDebtOverviewPage } from './BugDebtOverviewPage';
export { SeverityBadge, AgeBadge, TrendBadge } from './Badge';
export type { BugDebtOverviewProps } from './BugDebtOverview';

// Export service for advanced usage
export { bugDebtService, BugDebtService } from '../../../api/bugDebt.service';
export type { Bug, BugsBySeverity, BugsByAge, BugTrend, BugDebtOverview as BugDebtDataInterface } from '../../../api/bugDebt.service';