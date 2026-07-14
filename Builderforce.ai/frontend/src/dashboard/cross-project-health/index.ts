/**
 * Cross-project health dashboard entry point.
 * Provides the main React component and supporting exports that a route or app consumes.
 */

export { CrossProjectHealthDashboard } from './CrossProjectHealthDashboard';
export {
  projects,
  portfolioSummary,
  type ProjectHealth,
  type PortfolioSummary,
  type RAG,
  type ProjectStatus,
  type RiskLevel,
  deriveRagStatus,
  buildPortfolioSummary,
} from './portfolioHealthData';