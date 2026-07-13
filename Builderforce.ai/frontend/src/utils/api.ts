/**
 * API Utility Functions for Budget & Resources Module
 */

export interface BudgetPlanItem {
  category: string;
  lineItemName: string;
  plannedAmount: number;
  allocatedFte?: number;
  startDate: string;
  endDate: string;
}

export interface BudgetActual {
  category: string;
  lineItemName: string;
  actualAmount: number;
  actualDate: string;
  dataSource?: string;
  sourceReference?: string;
}

export interface HeadcountPlan {
  roleName: string;
  plannedFte: number;
  start_date: string;
  end_date: string;
  plannedRatePerFte: number;
}

export interface HeadcountAssignment {
  personId?: number;
  assignedFte: number;
  startDate: string;
  endDate?: string;
}

export interface AIUsageRecord {
  provider: string;
  model: string;
  requestType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costPer1kPrompt?: number;
  costPer1kCompletion?: number;
  totalCost: number;
}

export interface DailyKPIs {
  avgBurnRate: number;
  runwayMonths: number;
  projectedEAC: number;
  budgetVariance: number;
}

/**
 * Fetch budget dashboard data
 */
export async function fetchBudgetDashboard(projectId: string): Promise<any> {
  const response = await fetch(`/api/budget/resources/dashboard?projectId=${projectId}`);
  if (!response.ok) throw new Error('Failed to fetch dashboard');
  const data = await response.json();
  return data.data;
}

/**
 * Ingest budget baseline
 */
export async function ingestBudgetBaseline(
  projectId: string,
  budgetData: BudgetPlanItem[],
  dataSource: string = 'manual'
): Promise<void> {
  const response = await fetch('/api/budget/resources/baseline/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, budgetData, dataSource })
  });
  if (!response.ok) throw new Error('Failed to ingest baseline');
}

/**
 * Fetch budget actuals
 */
export async function fetchBudgetActuals(projectId: string): Promise<BudgetActual[]> {
  const response = await fetch(`/api/budget/resources/actuals/${projectId}`);
  if (!response.ok) throw new Error('Failed to fetch actuals');
  const data = await response.json();
  return data.data || [];
}

/**
 * Calculate EAC from burn rate
 */
export function calculateEAC(burnRate: number, plannedRemaining: number): number {
  return plannedRemaining * burnRate;
}

/**
 * Calculate burn rate using 2-week rolling average
 */
export function calculateBurnRate(actuals: BudgetActual[]): number {
  const last14Days = actuals
    .filter(a => new Date(a.actualDate) >= new Date(Date.now() - 14 * 24 * 60 * 60 * 1000))
    .reduce((sum, a) => sum + a.actualAmount, 0);

  return last14Days / 14; // Daily rate
}

/**
 * Get runway estimate
 */
export function estimateRunway(budget: number, avgDailyBurn: number): number {
  if (avgDailyBurn <= 0) return Infinity;
  return budget / avgDailyBurn;
}

/**
 * Get RAG status indicator
 */
export function getRagStatus(percentage: number): 'green' | 'amber' | 'red' {
  if (percentage >= 100) return 'red';
  if (percentage >= 80) return 'amber';
  return 'green';
}

/**
 * Get effectiveness score (0-100) based on efficiency ratios
 */
export function calculateEfficiencyScore(promptEfficiency: number, costEfficiency: number): number {
  return Math.round((promptEfficiency + costEfficiency) / 2);
}