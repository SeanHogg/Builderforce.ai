/**
 * Type definitions for EvermindPayloadDelivery facade and related components.
 * Aligns with PRD AC-1, AC-5, and FR-6 (observability events).
 */

// === Core Snapshot ===

export interface EvermindPayloadSnapshot {
  payloadId: string;
  payloadVersion: string;
  lastCapturedAt: string;
  lastWinningAt: string;
  payload: Record<string, unknown>;
}

// === Errors ===

export class PayloadDeliveryError extends Error {
  constructor(
    message: string,
    public severity: 'validation' | 'network' | 'malformed',
    public cause?: unknown
  ) {
    super(message);
    this.name = 'PayloadDeliveryError';
  }
}

export class PayloadValidationError extends Error {
  constructor(
    public field: string,
    public constraint: string, // required | type | range | format
    public message: string
  ) {
    super(message);
    this.name = 'PayloadValidationError';
  }
}

// === Context for Agent Reasoning ===

export interface AgentContext {
  payloadVersion: string;
  lastWinningAt: string;
  payloadFields: string[];
  inferenceEnabled: boolean;
  driverAffect: number;
  targetMode: string;
  lastLearnedAt: string;
}

// === Model for Board Display ===

export interface BoardModel {
  payloadId: string;
  payloadVersion: string;
  claims: Map<string, string>;  // claim_id -> human-readable claim text
  evidence: Map<string, unknown>; // evidence_id -> full evidence object (modified for display)
  uncertainty: number | null;
  overallConfidence: number;
  reasoningChain: string | null;
}

// === Observability Events (FR-6) ===

export type EventType = 
  | 'payload_delivery' 
  | 'payload_validation' 
  | 'agent_context';

interface BaseEvent {
  type: EventType;
  timestamp: string;
  eventId: string;
}

export interface EventPayloadDelivery extends BaseEvent {
  type: 'payload_delivery';
  projectId: number;
  payloadId: string;
  status: 'success' | 'failed';
  payloadVersion: string;
  lastWinningAt: string;
}

export interface EventPayloadValidation extends BaseEvent {
  type: 'payload_validation';
  projectId: number;
  payloadId: string;
  status: 'success' | 'failed';
  level: 'info' | 'warning' | 'error';
  payloadVersion: string;
  errors: {
    field?: string;
    constraint: string;
    message: string;
  }[];
}

export interface EventAgentContext extends BaseEvent {
  type: 'agent_context';
  projectId: number;
  payloadId: string;
  payloadVersion: string;
  inferenceEnabled: boolean;
  payloadFields: string[];
  lastWinningAt: string;
}

export type EvermindEvent = 
  | EventPayloadDelivery
  | EventPayloadValidation
  | EventAgentContext;

// === Constants ===

export const EVERMIND_POLL_INTERVAL_MS = 10000; // 10s
export const EVERMIND_CLIENT_ERROR_LOAD_DELAY_MS = 500;
export const EVERMIND_ERROR_RETRY_DELAY_MS = 30000;