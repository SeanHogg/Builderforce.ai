/**
 * Mock Data Generators for QA Tests
 * 
 * These generators create synthetic telemetry and billing data for testing
 * gauge-O1 (telemetry reconstruction) and gauge-O2 (billing ledger consistency).
 */

export interface MockTelemetryEvent {
  id: string;
  agentId: string;
  eventType: 'execution_start' | 'execution_end' | 'tool_call' | 'tool_result' | 'llm_request' | 'llm_response';
  timestamp: number;
  duration?: number;
  agentName: string;
}

export interface MockBillableActivity {
  id: string;
  agentId: string;
  agentName: string;
  activityType: 'execution' | 'tool_usage' | 'llm_inference';
  startTime: number;
  endTime?: number;
  usedCredits: number;
  metadata?: Record<string, any>;
}

export interface MockBillableLedgerEntry {
  id: string;
  source: 'agent_execution' | 'tool_usage' | 'llm_inference';
  quantity: number;
  ratePerUnit: number;
  totalCost: number;
  timestamp: number;
  agentId?: string;
}

/**
 * Generates mock telemetry events with embedded in an out-of-order pattern
 * to test out-of-order event handling in telemetry reconstruction
 */
export function generateMockTelemetryEvents(
  agentId: string,
  agentName: string,
  count: number = 20,
  addOutOfOrder: boolean = true
): MockTelemetryEvent[] {
  const events: MockTelemetryEvent[] = [];
  const now = Date.now();

  // Create a base timeline of events
  const baseEvents: MockTelemetryEvent[] = [];
  for (let i = 0; i < count; i++) {
    const eventType = i % 3 === 0 ? 'execution_start' :
                     i % 3 === 1 ? 'execution_end' :
                     'tool_call';
    
    baseEvents.push({
      id: `tev-${i}-${agentId.substring(0, 8)}`,
      agentId,
      agentName,
      eventType,
      timestamp: now - (count - i) * 1000 + (i % 1000),
      duration: eventType === 'execution_end' ? 500 + (i % 3000) : undefined
    });
  }

  // Add out-of-order events if requested
  const result = [...baseEvents];
  if (addOutOfOrder) {
    const outOfOrderEvents: MockTelemetryEvent[] = [];
    const numOutOfOrder = Math.floor(count * 0.3); // 30% out of order
    for (let i = 0; i < numOutOfOrder; i++) {
      const originalIndex = Math.floor(Math.random() * (count / 2)); // Only move from first half
      if (originalIndex === 0) continue;
      
      const event = result[originalIndex];
      result.splice(originalIndex, 1);
      result.splice(0, 0, { ...event, id: `tev-oo-${i}` });
    }
  }

  return result;
}

/**
 * Generates billable activities that accurately reflect agent execution
 */
export function generateMockBillableActivities(
  agentId: string,
  agentName: string,
  count: number = 10
): MockBillableActivity[] {
  const activities: MockBillableActivity[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const activityType = i % 3 === 0 ? 'execution' :
                        i % 3 === 1 ? 'tool_usage' :
                        'llm_inference';
    
    const duration = activityType === 'execution' ? 
      1000 + Math.floor(Math.random() * 5000) :
      100 + Math.floor(Math.random() * 400);
    
    activities.push({
      id: `bact-${i}-${agentId.substring(0, 8)}`,
      agentId,
      agentName,
      activityType,
      startTime: now - duration,
      endTime: now,
      usedCredits: activityType === 'execution' ? 10 :
                 activityType === 'tool_usage' ? 2 + Math.random() * 3 :
                 1 + Math.random() * 2,
      metadata: {
        toolName: activityType === 'tool_usage' ? `tool-${Math.floor(Math.random() * 5)}` : undefined,
        modelName: activityType === 'llm_inference' ? `model-${Math.floor(Math.random() * 3)}` : undefined,
        promptTokens: activityType === 'llm_inference' ? Math.floor(Math.random() * 1000) : undefined,
        completionTokens: activityType === 'llm_inference' ? Math.floor(Math.random() * 500) : undefined
      }
    });
  }

  return activities;
}

/**
 * Generates a billing ledger that should be consistent with activities
 */
export function generateMockBillableLedger(
  activities: MockBillableActivity[],
  ratePerUnit: number = 0.01 // per credit unit
): MockBillableLedgerEntry[] {
  const ledger: MockBillableLedgerEntry[] = [];
  
  activities.forEach((activity, index) => {
    const entry: MockBillableLedgerEntry = {
      id: `ledger-entry-${index}`,
      source: activity.activityType,
      quantity: activity.usedCredits,
      ratePerUnit,
      totalCost: activity.usedCredits * ratePerUnit,
      timestamp: activity.endTime || activity.startTime,
      agentId: activity.agentId
    };
    
    ledger.push(entry);
  });

  // Add some summary entries that may be added by billing system
  const totalCredits = activities.reduce((sum, a) => sum + a.usedCredits, 0);
  const totalCost = totalCredits * ratePerUnit;
  
  ledger.push({
    id: 'ledger-total',
    source: 'summary',
    quantity: totalCredits,
    ratePerUnit,
    totalCost,
    timestamp: activities[activities.length - 1].endTime || Date.now(),
    agentId: activities[0]?.agentId
  });

  return ledger;
}

/**
 * Generates partial/mock telemetry data (simulates data loss scenarios)
 */
export function generatePartialMockTelemetryEvents(
  fullEvents: MockTelemetryEvent[],
  missingPercentage: number = 0.1
): MockTelemetryEvent[] {
  const result = [...fullEvents];
  const numToRemove = Math.floor(fullEvents.length * missingPercentage);
  
  for (let i = 0; i < numToRemove; i++) {
    const index = Math.floor(Math.random() * result.length);
    result.splice(index, 1);
  }
  
  return result;
}

/**
 * Generates telemetry with incomplete timestamps
 */
export function generateIncompleteTimestampEvents(
  events: MockTelemetryEvent[]
): MockTelemetryEvent[] {
  return events.map(event => ({
    ...event,
    timestamp: Math.random() > 0.5 ? event.timestamp : undefined
  }));
}

/**
 * Creates edge case scenarios for testing
 */
export function createEdgeCaseScenarios() {
  return {
    noEvents: [],
    
    singleEvent: [{
      id: 'tev-1',
      agentId: 'agent-1',
      agentName: 'TestAgent',
      eventType: 'execution_start',
      timestamp: Date.now()
    }],
    
    duplicateIds: Array.from({ length: 3 }, (_, i) => ({
      id: 'duplicate-id',
      agentId: 'agent-1',
      agentName: 'TestAgent',
      eventType: 'execution_start',
      timestamp: Date.now() - 1000 * i
    })),

    invalidTimestamps: Array.from({ length: 3 }, (_, i) => ({
      id: `tev-invalid-${i}`,
      agentId: 'agent-1',
      agentName: 'TestAgent',
      eventType: 'execution_start',
      timestamp: -1 * (Date.now() - 1000 * i) // Future timestamp
    }))
  };
}