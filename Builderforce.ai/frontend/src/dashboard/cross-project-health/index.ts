/**
 * Cross-project health dashboard entry point.
 *
 * Default export: the CrossProjectHealthDashboard component (PRD §1).
 * Named exports: ProjectHealth interface + supporting data types.
 */

export { default as CrossProjectHealthDashboard } from './CrossProjectHealthDashboard';
export type { ProjectHealth, CrossProjectHealthDashboardProps } from './CrossProjectHealthDashboard';

export {
  projects,
  portfolioSummary,
  type PortfolioSummary,
  type RAG,
  type ProjectStatus,
  type RiskLevel,
  deriveRagStatus,
  buildPortfolioSummary,
} from './portfolioHealthData';
