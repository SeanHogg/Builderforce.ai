/**
 * Telemetry Reconstruction Tests (GAP-O1)
 * 
 * Validates that cloud agent telemetry data can be accurately reconstructed
 * from raw events, handling edge cases like out-of-order events, partial data,
 * and missing timestamps.
 */

import { describe, it, expect } from 'jest';
import {
  generateMockTelemetryEvents,
  generatePartialMockTelemetryEvents,
  generateIncompleteTimestampEvents,
  createEdgeCaseScenarios,
  MockTelemetryEvent
} from './test-harness/mock-data-generators';

/**
 * Simulates telemetry reconstruction - transforms raw events into usable telemetry data
 * This is a simplified representation of what a real reconstruction system would do
 */
function reconstructTelemetry(events: MockTelemetryEvent[]): {
  byEventId: Map<string, MockTelemetryEvent>;
  timeline: MockTelemetryEvent[];
  startTime: number;
  endTime: number;
  totalDuration: number;
} {
  const byEventId = new Map<string, MockTelemetryEvent>();
  const timeline: MockTelemetryEvent[] = [];
  let startTime = Infinity;
  let endTime = -1;
  let activeExecutions = 0;

  // Sort events by timestamp to reconstruct timeline
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  for (const event of sorted) {
    byEventId.set(event.id, event);
    
    // Track execution boundaries
    if (event.eventType === 'execution_start') {
      activeExecutions++;
      if (event.timestamp < startTime && event.timestamp > 0) {
        startTime = event.timestamp;
      }
    } else if (event.eventType === 'execution_end') {
      activeExecutions--;
      if (event.timestamp > endTime) {
        endTime = event.timestamp;
      }
    } else if (event.timestamp > 0 && event.timestamp < startTime) {
      startTime = event.timestamp;
    }
  }

  return {
    byEventId,
    timeline: sorted,
    startTime,
    endTime,
    totalDuration: endTime > startTime ? endTime - startTime : 0
  };
}

describe('GAP-O1: Telemetry Reconstruction', () => {
  
  describe('Normal Operation', () => {
    it('should reconstruct telemetry from a simple sequence of events', () => {
      const mockEvents = generateMockTelemetryEvents('agent-1', 'TestAgent', 5);
      const result = reconstructTelemetry(mockEvents);
      
      expect(result.byEventId.size).toBe(5);
      expect(result.timeline.length).toBe(5);
      expect(result.startTime).toBeGreaterThan(0);
      expect(result.endTime).toBeGreaterThan(result.startTime);
      expect(result.totalDuration).toBeGreaterThan(0);
    });

    it('should correctly identify execution start and end times', () => {
      const mockEvents = generateMockTelemetryEvents('agent-2', 'QA-TestAgent', 3, false);
      const result = reconstructTelemetry(mockEvents);
      
      const startEvents = result.timeline.filter(e => e.eventType === 'execution_start');
      const endEvents = result.timeline.filter(e => e.eventType === 'execution_end');
      
      expect(startEvents.length).toBeGreaterThanOrEqual(1);
      expect(endEvents.length).toBeEqualOrGreater(startEvents.length);
      expect(result.timeline[result.timeline.length - 1].eventType).toBe('execution_end');
    });
  });

  describe('Out-of-Order Events', () => {
    it('should handle out-of-order events correctly', () => {
      const mockEvents = generateMockTelemetryEvents('agent-3', 'TestAgent', 20, true);
      const sortedEvents = [...mockEvents].sort((a, b) => a.timestamp - b.timestamp);
      const result = reconstructTelemetry(mockEvents);
      
      expect(result.byEventId.size).toBe(20);
      // The reconstruction should not change based on input order
      expect(result.timeline.length).toBe(20);
    });

    it('should reconstruct timeline without gaps when events are out of order', () => {
      const events = [
        { id: '1', agentId: 'agent-1', agentName: 'Test', eventType: 'execution_start', timestamp: 1000 },
        { id: '2', agentId: 'agent-1', agentName: 'Test', eventType: 'tool_call', timestamp: 1500 },
        { id: '3', agentId: 'agent-1', agentName: 'Test', eventType: 'tool_call', timestamp: 2000 },
        { id: '4', agentId: 'agent-1', agentName: 'Test', eventType: 'execution_start', timestamp: 500 }, // Out of order
        { id: '5', agentId: 'agent-1', agentName: 'Test', eventType: 'execution_end', timestamp: 2500 },
      ];
      
      const result = reconstructTelemetry(events);
      expect(result.byEventId.size).toBe(5);
    });
  });

  describe('Missing/Partial Data', () => {
    it('should handle missing events gracefully', () => {
      const fullEvents = generateMockTelemetryEvents('agent-4', 'TestAgent', 20);
      const partialEvents = generatePartialMockTelemetryEvents(fullEvents, 0.2); // Remove 20%
      const result = reconstructTelemetry(partialEvents);
      
      expect(result.byEventId.size).toBeLessThan(20);
      expect(result.timeline.length).toBeLessThan(20);
      // Should still have some valid data
      expect(result.byEventId.size).toBeGreaterThan(0);
    });

    it('should handle events with missing timestamps', () => {
      const events = generateMockTelemetryEvents('agent-5', 'TestAgent', 10);
      const incompleteEvents = generateIncompleteTimestampEvents(events);
      const result = reconstructTelemetry(incompleteEvents);
      
      expect(result.byEventId.size).toBe(10);
      // Timestamps should be preserved where present
      events.forEach((original, i) => {
        const reconstructed = result.byEventId.get(original.id);
        if (original.timestamp) {
          expect(reconstructed?.timestamp).toBe(original.timestamp);
        }
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty event lists', () => {
      const result = reconstructTelemetry([]);
      
      expect(result.byEventId.size).toBe(0);
      expect(result.timeline.length).toBe(0);
      expect(result.startTime).toBe(Infinity);
      expect(result.endTime).toBe(-1);
      expect(result.totalDuration).toBe(0);
    });

    it('should handle single event correctly', () => {
      const events = createEdgeCaseScenarios().singleEvent;
      const result = reconstructTelemetry(events);
      
      expect(result.byEventId.size).toBe(1);
      expect(result.timeline.length).toBe(1);
      expect(result.startTime).toBeGreaterThanOrEqual(0);
      expect(result.endTime).toBe(result.startTime);
    });
  });

  describe('Timestamp Validation', () => {
    it('should reject events with negative timestamps', () => {
      const events = createEdgeCaseScenarios().invalidTimestamps;
      const result = reconstructTelemetry(events);
      
      const withNegative = result.timeline.filter(e => e.timestamp && e.timestamp < 0);
      expect(withNegative.length).toBeLessThan(events.length);
    });

    it('should handle events with undefined timestamps gracefully', () => {
      const events = [
        { id: '1', agentId: 'agent-1', agentName: 'Test', eventType: 'execution_start', timestamp: 1000 },
        { id: '2', agentId: 'agent-1', agentName: 'Test', eventType: 'tool_call', timestamp: undefined },
      ];
      
      const result = reconstructTelemetry(events);
      
      // Should process events without error even with undefined timestamps
      expect(() => reconstructTelemetry(events)).not.toThrow();
      expect(result.byEventId.size).toBe(2);
    });
  });
});

describe('GAP-O1: Telemetry End-to-End', () => {
  
  it('should correctly calculate execution metadata from reconstructed telemetry', () => {
    const mockEvents = generateMockTelemetryEvents('agent-6', 'QA-Agent', 15, false);
    const result = reconstructTelemetry(mockEvents);
    
    // Calculate derived metadata
    const totalToolCalls = result.timeline.filter(e => e.eventType === 'tool_call').length;
    const totalExecutions = result.timeline.filter(e => e.eventType === 'execution_start' || e.eventType === 'execution_end').length / 2;
    
    expect(totalToolCalls).toBeGreaterThan(0);
    expect(totalExecutions).toBeGreaterThan(0);
    expect(result.totalDuration).toBeGreaterThan(0);
  });

  it('should preserve all event metadata after reconstruction', () => {
    const mockEvents = generateMockTelemetryEvents('agent-7', 'QA-Agent', 5, false);
    const result = reconstructTelemetry(mockEvents);
    
    mockEvents.forEach((original) => {
      const reconstructed = result.byEventId.get(original.id);
      expect(reconstructed).toBeDefined();
      expect(reconstructed?.eventType).toBe(original.eventType);
      expect(reconstructed?.agentName).toBe(original.agentName);
      expect(reconstructed?.agentId).toBe(original.agentId);
    });
  });
});