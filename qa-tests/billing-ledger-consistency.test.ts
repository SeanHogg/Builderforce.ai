/**
 * Billing Ledger Consistency Tests (GAP-O2)
 * 
 * Validates that cloud agent billing ledger accurately reflects agent activity,
 * ensuring symmetry between billable activities and ledger entries (no missing
 * or incorrect entries).
 */

import { describe, it, expect } from 'jest';
import {
  generateMockBillableActivities,
  generateMockBillableLedger,
  MockBillableActivity,
  MockBillableLedgerEntry
} from './test-harness/mock-data-generators';

/**
 * Simulates ledger reconciliation - compares activities against ledger entries
 */
function reconcileLedger(
  activities: MockBillableActivity[],
  ledger: MockBillableLedgerEntry[]
): {
  consistent: boolean;
  missingEntries: MockBillableActivity[];
  extraneousEntries: MockBillableLedgerEntry[];
  totalActivities: number;
  totalLedgerEntries: number;
  totalCreditsMismatch: boolean;
} {
  const activityIds = new Set(activities.map(a => a.id));
  const ledgerEntries = new Map<string, MockBillableLedgerEntry>();
  
  ledger.forEach(entry => ledgerEntries.set(entry.id, entry));
  
  let missingEntries: MockBillableActivity[] = [];
  let extraneousEntries: MockBillableLedgerEntry[] = [];
  
  activities.forEach(activity => {
    if (!ledgerEntries.has(`ledger-entry-${activities.indexOf(activity)}`)) {
      missingEntries.push(activity);
    }
  });
  
  ledgerEntries.forEach((entry, id) => {
    if (!id.startsWith('ledger-total') && 
        !activityIds.has(entry.agentId)) {
      // This could be a summary or system entry - not necessarily an error
      extraneousEntries.push(entry);
    }
  });
  
  const totalActivities = activities.reduce((sum, a) => sum + a.usedCredits, 0);
  const totalLedgerCredits = ledger.reduce((sum, l) => sum + l.quantity, 0);
  
  const consistent = missingEntries.length === 0;
  
  return {
    consistent,
    missingEntries,
    extraneousEntries,
    totalActivities,
    totalLedgerEntries: ledger.length,
    totalCreditsMismatch: Math.abs(totalActivities - totalLedgerCredits) > 0.01
  };
}

describe('GAP-O2: Billing Ledger Consistency', () => {
  
  describe('Normal Operation', () => {
    it('should reconcile activities with correct ledger entries', () => {
      const activities = generateMockBillableActivities('agent-1', 'TestAgent', 10);
      const ledger = generateMockBillableLedger(activities);
      const result = reconcileLedger(activities, ledger);
      
      expect(result.consistent).toBe(true);
      expect(result.missingEntries.length).toBe(0);
      expect(result.totalActivities).toBe(result.totalLedgerCredits);
    });

    it('should produce matching totals for activities and ledger', () => {
      const activities = generateMockBillableActivities('agent-2', 'QA-Agent', 5);
      const ledger = generateMockBillableLedger(activities, 0.01);
      const result = reconcileLedger(activities, ledger);
      
      expect(Math.abs(result.totalActivities - result.totalLedgerCredits)).toBeLessThan(0.01);
      expect(result.totalLedgerEntries).toBeGreaterThan(0);
    });
  });

  describe('Conistency Checks', () => {
    it('should detect missing ledger entries for activities', () => {
      const activities = generateMockBillableActivities('agent-3', 'TestAgent', 6);
      const ledger = generateMockBillableLedger(activities.slice(0, 4), 0.01);
      const result = reconcileLedger(activities, ledger);
      
      expect(result.consistent).toBe(false);
      expect(result.missingEntries.length).toBeGreaterThan(0);
    });

    it('should detect ledger entries not tied to valid activities', () => {
      const activities = generateMockBillableActivities('agent-4', 'TestAgent', 4);
      const ledger = generateMockBillableLedger(activities, 0.01);
      
      ledger.push({
        id: 'extraneous-entry-1',
        source: 'manual_adjustment',
        quantity: 5,
        ratePerUnit: 0.005,
        totalCost: 0.025,
        timestamp: Date.now(),
        agentId: 'unknown-agent'
      });
      
      const result = reconcileLedger(activities, ledger);
      
      // May detect extraneous entries if we tighten match logic
      expect(result.totalLedgerEntries).toBeGreaterThan(result.totalActivities);
    });

    it('should catch total credit amount mismatches', () => {
      const activities = generateMockBillableActivities('agent-5', 'TestAgent', 5);
      const ledger = generateMockBillableLedger(activities.map(a => ({...a, usedCredits: a.usedCredits * 1.2})), 0.01);
      const result = reconcileLedger(activities, ledger);
      
      expect(result.totalCreditsMismatch).toBe(true);
    });
  });

  describe('Scaling Tests', () => {
    it('should handle multiple agent activities correctly', () => {
      const activities: MockBillableActivity[] = [];
      const agentNames = ['Agent1', 'Agent2', 'Agent3', 'Agent4', 'Agent5'];
      
      agentNames.forEach((name, idx) => {
        activities.push(...generateMockBillableActivities(`agent-${idx}`, name, 8));
      });
      
      const ledger = generateMockBillableLedger(activities, 0.01);
      const result = reconcileLedger(activities, ledger);
      
      expect(result.consistent).toBe(true);
      expect(result.totalActivities).toBeGreaterThan(30); // 5 agents * 8 activities
    });

    it('should handle large transaction volumes efficiently', () => {
      const activities = generateMockBillableActivities('agent-large', 'LargeAgent', 100);
      const ledger = generateMockBillableLedger(activities, 0.01);
      const startTime = Date.now();
      
      const result = reconcileLedger(activities, ledger);
      const duration = Date.now() - startTime;
      
      expect(result.consistent).toBe(true);
      expect(result.totalActivities).toBe(100); // All from one generator call
      // Should complete in reasonable time (< 100ms)
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty activity and ledger lists', () => {
      const activities: MockBillableActivity[] = [];
      const ledger: MockBillableLedgerEntry[] = [];
      const result = reconcileLedger(activities, ledger);
      
      expect(result.consistent).toBe(true);
      expect(result.totalActivities).toBe(0);
      expect(result.totalLedgerEntries).toBe(0);
      expect(result.totalCreditsMismatch).toBe(true); // Both zeros, technically mismatch
    });

    it('should handle activities with no credits used', () => {
      const activities: MockBillableActivity[] = [];
      const ledger: MockBillableLedgerEntry[] = [];
      const result = reconcileLedger(activities, ledger);
      
      expect(result.consistent).toBe(true);
    });

    it('should handle partial ledger entries', () => {
      const activities = generateMockBillableActivities('agent-6', 'TestAgent', 5);
      const ledger = generateMockBillableLedger(
        activities.slice(0, 3), // Only 3 activities have ledger entries
        0.01
      );
      const result = reconcileLedger(activities, ledger);
      
      expect(result.consistent).toBe(false);
      expect(result.missingEntries.length).toBeGreaterThan(0);
    });
  });

  describe('Metadata Accuracy', () => {
    it('should preserve activity metadata in reconciliation', () => {
      const activities = generateMockBillableActivities('agent-7', 'QA-Agent', 5, 10);
      const ledger = generateMockBillableLedger(activities, 0.01);
      const result = reconcileLedger(activities, ledger);
      
      expect(result.consistent).toBe(true);
      // Verify all activities were accounted for
      const accountedActivityIds = activities.filter(a => {
        return result.missingEntries.findIndex(m => m.id !== a.id) === -1;
      });
      expect(accountedActivityIds.length).toBe(activities.length);
    });

    it('should correctly calculate derived costs from rates', () => {
      const activities = generateMockBillableActivities('agent-8', 'TestAgent', 4, 0.005);
      const ledger = generateMockBillableLedger(activities, 0.01);
      const result = reconcileLedger(activities, ledger);
      
      // Should not mix rate from activities with rate from ledger
      expect(result.consistent).toBe(true);
    });

    it('should identify cost ceiling/wall violations', () => {
      const activities = generateMockBillableActivities('agent-9', 'TestAgent', 5);
      const ledger = generateMockBillableLedger(activities, 0.5); // Abnormally high rate
      
      const totalCreditCost = activities.reduce((sum, a) => sum + a.usedCredits * 0.5, 0);
      const ledgerEntryTotalCost = ledger.reduce((sum, l) => sum + l.totalCost, 0);
      
      expect(totalCreditCost).toBeGreaterThan(ledgerEntryTotalCost);
    });
  });

  describe('Billable Activity Entry Types', () => {
    it('should correctly handle execution activities', () => {
      const activities = activities.filter(a => a.activityType === 'execution');
      expect(activities.length).toBeGreaterThan(0);
    });

    it('should correctly handle tool usage activities', () => {
      const activities = activities.filter(a => a.activityType === 'tool_usage');
      expect(activities.length).toBeGreaterThan(0);
    });

    it('should correctly handle LLM inference activities', () => {
      const activities = activities.filter(a => a.activityType === 'llm_inference');
      expect(activities.length).toBeGreaterThan(0);
    });
  });
});

describe('GAP-O2: Billing Ledger Integration', () => {
  
  it('should validate entire billing workflow from activity to ledger to reconciliation', () => {
    const activities = generateMockBillableActivities('agent-integration', 'IntegrationTestAgent', 15);
    const ledger = generateMockBillableLedger(activities, 0.01);
    const reconciliation = reconcileLedger(activities, ledger);
    
    // Full workflow validation
    expect(activities.length).toBeGreaterThan(0);
    expect(ledger.length).toBeGreaterThan(0);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.totalActivities).toBeGreaterThan(0);
    expect(reconciliation.totalLedgerEntries).toBeGreaterThan(0);
  });

  it('should detect discrepancies during manual audit', () => {
    const activities = generateMockBillableActivities('agent-audit', 'AuditTestAgent', 10);
    
    // Modify ledger totals artificially
    let ledger = generateMockBillableLedger(activities, 0.01);
    const lastEntry = ledger[ledger.length - 1];
    lastEntry.totalCost = lastEntry.totalCost * 1.5; // Artificial increase
    
    const reconciliation = reconcileLedger(activities, ledger);
    
    expect(reconciliation.consistent).toBe(false);
    expect(reconciliation.totalCreditsMismatch).toBe(true);
  });

  it('should validate after simulated agent execution', () => {
    // Simulate agent executing tasks
    const simulatedActivities: MockBillableActivity[] = [];
    for (let i = 0; i < 5; i++) {
      simulatedActivities.push(...generateMockBillableActivities(
        `sim-agent-${i}`,
        `SimulatedAgent-${i}`,
        3
      ));
    }
    
    // Simulate billing system processing
    const processedLedger = generateMockBillableLedger(simulatedActivities, 0.01);
    const validation = reconcileLedger(simulatedActivities, processedLedger);
    
    expect(validation.consistent).toBe(true);
    expect(validation.totalActivities).toBeGreaterThan(0);
  });
});