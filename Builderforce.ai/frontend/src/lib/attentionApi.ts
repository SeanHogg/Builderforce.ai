import { type ProjectEvermindContributions, type ProjectEvermindRecentEntry } from './projectEvermindApi';

/**
 * Available attention item types and their details.
 */
export type AttentionItemType = 'task' | 'ticket' | 'message' | 'alert' | 'issue';

/**
 * Each attention-worthy item in the Top 10 list.
 */
export interface AttentionItem {
  id: string;
  title: string;
  type: AttentionItemType;
  metric: string; // e.g., "Overdue by 3 days", "5 New Comments", "High Urgency"
  url: string;
  score: number; // The ranking score from the attention algorithm
  urgency: 'low' | 'medium' | 'high' | 'urgent';
  timestamp: number;
}

/**
 * Mock attention data service.
 * In production, this would call backend APIs for tasks, tickets, messages, alerts, etc.
 */
export async function getTop10AttentionItems(projectId: number): Promise<AttentionItem[]> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Generate mock attention items based on common patterns.
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const items: AttentionItem[] = [
    {
      id: 'task-urgent-1',
      title: 'Critical deployment approval required',
      type: 'task',
      metric: 'Overdue by 2 days',
      url: '/tasks/task-1',
      score: 100,
      urgency: 'urgent',
      timestamp: oneDayAgo,
    },
    {
      id: 'ticket-high-1',
      title: 'System downtime incident -adra HQ',
      type: 'ticket',
      metric: 'SEV1 - Immediate attention required',
      url: '/tickets/ticket-1',
      score: 98,
      urgency: 'urgent',
      timestamp: oneHourAgo,
    },
    {
      id: 'message-new-1',
      title: 'Sarah commented on "API Gateway Setup"',
      type: 'message',
      metric: '2 new messages',
      url: '/messages/chat-1',
      score: 95,
      urgency: 'high',
      timestamp: oneHourAgo,
    },
    {
      id: 'alert-v1-1',
      title: 'Memory usage exceeding 80% threshold',
      type: 'alert',
      metric: 'At 82% CPU usage',
      url: '/monitoring/alert-1',
      score: 92,
      urgency: 'high',
      timestamp: threeDaysAgo,
    },
    {
      id: 'issue-1',
      title: 'Failed test in CI pipeline',
      type: 'issue',
      metric: '3 tests failing',
      url: '/ci/issues/1',
      score: 85,
      urgency: 'medium',
      timestamp: oneDayAgo,
    },
    {
      id: 'task-normal-1',
      title: 'Code review required for PR #42',
      type: 'task',
      metric: 'Needs review',
      url: '/pull-requests/42',
      score: 82,
      urgency: 'medium',
      timestamp: threeDaysAgo,
    },
    {
      id: 'message-reply-1',
      title: 'Team lead mentioned you in channel',
      type: 'message',
      metric: '1 message',
      url: '/messages/channel-1',
      score: 78,
      urgency: 'low',
      timestamp: oneWeekAgo,
    },
    {
      id: 'task-low-1',
      title: 'Next sprint planning meeting',
      type: 'task',
      metric: 'In 4 hours',
      url: '/calendar/sprint-planning',
      score: 75,
      urgency: 'low',
      timestamp: oneDayAgo,
    },
    {
      id: 'ticket-low-1',
      title: 'Feature request: Dark mode improvements',
      type: 'ticket',
      metric: 'Open since 14 days',
      url: '/tickets/feature-1',
      score: 72,
      urgency: 'low',
      timestamp: oneWeekAgo,
    },
    {
      id: 'alert-v2-1',
      title: 'Database backup completed successfully',
      type: 'alert',
      metric: 'Daily backup successful',
      url: '/monitoring/backups',
      score: 68,
      urgency: 'low',
      timestamp: oneDayAgo,
    },
  ];

  // Sort by score (desc) and take top 10
  return items.sort((a, b) => b.score - a.score).slice(0, 10);
}

/**
 * Configurable attention algorithm parameters.
 */
export interface AttentionAlgorithmConfig {
  urgencyWeight: number; // 0-1
  recencyWeight: number; // 0-1
  impactWeight: number; // 0-1
  engagementWeight: number; // 0-1
  penaltyDays: number; // days after which items age out
}

const DEFAULT_CONFIG: AttentionAlgorithmConfig = {
  urgencyWeight: 0.4,
  recencyWeight: 0.3,
  impactWeight: 0.2,
  engagementWeight: 0.1,
  penaltyDays: 7,
};

/**
 * Calculate attention score based on configurable algorithm.
 */
export function calculateScore(
  item: AttentionItem,
  config: AttentionAlgorithmConfig = DEFAULT_CONFIG
): number {
  const now = Date.now();
  const daysSinceCreated = (now - item.timestamp) / (24 * 60 * 60 * 1000);
  
  // Recency component (more recent = higher score, with minimum decay after penaltyDays)
  let recencyFactor = 1.0;
  if (daysSinceCreated > 0) {
    recencyFactor = Math.max(0, 1.0 - daysSinceCreated / config.penaltyDays);
  }

  // Urgency component mapped to 0-1 scale
  const urgencyMap: Record<AttentionItem['urgency'], number> = {
    low: 0.3,
    medium: 0.6,
    high: 0.8,
    urgent: 1.0,
  };
  const urgencyFactor = urgencyMap[item.urgency];

  // Impact component mock - based on type
  const impactFactors: Record<AttentionItemType, number> = {
    task: 0.8,
    ticket: 1.0,
    message: 0.4,
    alert: 0.9,
    issue: 0.7,
  };
  const impactFactor = impactFactors[item.type];

  // Engagement component mock - based on implicit engagement counters we'd fetch
  const engagementFactor = 0.5; // Placeholder

  return (
    urgencyFactor * config.urgencyWeight +
    recencyFactor * config.recencyWeight +
    impactFactor * config.impactWeight +
    engagementFactor * config.engagementWeight
  );
}

/**
 * Refresh attention items with optional on-change callback.
 */
export async function refreshAttentionItems(
  projectId: number,
  callback?: (items: AttentionItem[]) => void
): Promise<AttentionItem[]> {
  const items = await getTop10AttentionItems(projectId);
  callback?.(items);
  return items;
}