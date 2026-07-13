/**
 * EvermindPayloadDelivery - Delivery Facade
 * 
 * Centralizes loading, validation, and contextual extraction for agent + board consumers.
 * 
 * Responsibilities:
 * - Load payload from server (or mock for test)
 * - Validate and normalize payload structure
 * - Extract reasoning-ready context for agents (agentContextFromPayload)
 * - Extract UI-friendly model for board (boardModelFromPayload)
 * - Emit structured observability events
 */

import { 
  EvermindPayloadSnapshot, 
  PayloadDeliveryError,
  PayloadValidationError,
  EventPayloadDelivery,
  EventPayloadValidation,
  EventAgentContext,
} from './types';

// === Types ===

export interface ValidationErrorDetail {
  field?: string;
  constraint: string;
  message: string;
}

export interface ValidatedPayload {
  snapshot: EvermindPayloadSnapshot;
  validity: 'valid' | 'invalid';
  errors: ValidationErrorDetail[];
}

export interface AgentContext {
  payloadVersion: string;
  lastWinningAt: string;
  payloadFields: string[];
  inferenceEnabled: boolean;
  driverAffect: number;
  targetMode: string;
  lastLearnedAt: string;
}

export interface BoardModel {
  payloadId: string;
  payloadVersion: string;
  claims: Map<string, string>;  // human-readable claim labels
  evidence: Map<string, unknown>; // UI-friendly representations
  uncertainty: number | null;
  overallConfidence: number;
  reasoningChain: string | null;
}

// === Stub Server API (for prototype) ===

interface ProjectEvermindContributions {
  lastWinningAt: string;
  lastCapturedAt: string;
  payloadVersion: string;
  messages: Array<{
    basis_id: string;
    content: Record<string, unknown>;
    timestamp: string;
  }>;
}

// === Mock Implementation (replace with real API call) ===

async function mockProjectEvermindContributions(projectId: number): Promise<ProjectEvermindContributions> {
  // In production, this would be: return await axios.get(`/api/projects/${projectId}/evermind/payload`)
  return {
    lastWinningAt: '2025-03-04T12:00:00Z',
    lastCapturedAt: '2025-03-04T12:00:00Z',
    payloadVersion: '1.0.0',
    messages: [
      {
        basis_id: '550e8400-e29b-41d4-a716-446655440000',
        content: {
          claims: [
            { 
              claim_id: 'claim-001', 
              text: 'The reported issue needs immediate investigation', 
              confidence: 0.85,
              weight: 0.9
            },
            { 
              claim_id: 'claim-002', 
              text: 'Multiple stakeholders are impacted by this failure', 
              confidence: 0.75,
              weight: 0.8
            }
          ],
          evidence: [
            { 
              evidence_id: 'evidence-001',
              summary: 'System logs indicate high error rates',
              confidence: 0.92,
              weight: 0.95
            }
          ],
          uncertainty: 0.2,
          overall_confidence: 0.84,
          model_id: 'builderforce-runtime-v1',
          environment: 'production',
          source_system: 'orchestrator',
          source_version: '1.0.0',
          context: {
            agent_id: 'agent-001',
            thread_reference: 'thread-123'
          },
          reasoning_chain: 'Analyze logs → identify root cause → evaluate impact'
        },
        timestamp: '2025-03-04T11:55:00Z'
      }
    ]
  };
}

// === Loading & Validation ===

export async function loadEvermindPayload(projectId: number): Promise<ValidatedPayload> {
  console.log(`[EvermindPayloadDelivery] Loading payload for project ${projectId}`);
  
  // Load from server (mock for now)
  const rawResponse = await mockProjectEvermindContributions(projectId);
  
  // Parse and validate
  const result = validatePayload(rawResponse.messages[0]?.content || {});
  
  // Emit validation event
  if (result.validity === 'invalid') {
    const validationEvent: EventPayloadValidation = {
      type: 'payload_validation',
      timestamp: new Date().toISOString(),
      eventId: `ev-${Date.now()}`,
      projectId,
      status: 'failed',
      level: 'warning',
      payloadVersion: rawResponse.payloadVersion,
      errors: result.errors,
    };
    console.log('[EvermindPayloadDelivery]', validationEvent);
  }
  
  // Emit delivery event
  const deliveryEvent: EventPayloadDelivery = {
    type: 'payload_delivery',
    timestamp: new Date().toISOString(),
    eventId: `ev-${Date.now()}`,
    projectId,
    payloadId: rawResponse.messages[0]?.basis_id || 'unknown',
    status: result.validity === 'valid' ? 'success' : 'failed',
    payloadVersion: rawResponse.payloadVersion,
    lastWinningAt: rawResponse.lastWinningAt
  };
  console.log('[EvermindPayloadDelivery]', deliveryEvent);
  
  return result;
}

// === Context Extraction for Agents ===

export function agentContextFromPayload(
  snapshot: EvermindPayloadSnapshot, 
  projectId: number
): AgentContext {
  const payloadFields = Object.keys(snapshot.payload);
  const lastLearnedAt = snapshot.payload.lastLearnedAt || new Date().toISOString();
  
  const context: AgentContext = {
    payloadVersion: snapshot.payloadVersion,
    lastWinningAt: snapshot.lastWinningAt,
    payloadFields,
    inferenceEnabled: true,
    driverAffect: snapshot.payload.driverAffect || 0,
    targetMode: snapshot.payload.targetMode || 'default',
    lastLearnedAt,
  };
  
  console.log(`[EvermindPayloadDelivery] Extracted agent context for project ${projectId}`, context);
  
  // Log agent context event
  const contextEvent: EventAgentContext = {
    type: 'agent_context',
    timestamp: new Date().toISOString(),
    eventId: `ec-${Date.now()}`,
    projectId,
    payloadId: snapshot.payloadId,
    payloadVersion: snapshot.payloadVersion,
    inferenceEnabled: context.inferenceEnabled,
    payloadFields: context.payloadFields,
    lastWinningAt: context.lastWinningAt,
  };
  console.log('[EvermindPayloadDelivery]', contextEvent);
  
  return context;
}

// === Model Extraction for Board ===

export function boardModelFromPayload(
  snapshot: EvermindPayloadSnapshot
): BoardModel {
  const rawPayload = snapshot.payload;
  
  // Extract and convert claims
  const claims = new Map<string, string>();
  const claimsArray = rawPayload.claims as Array<{ claim_id: string; text: string; confidence: number; weight: number }>;
  if (Array.isArray(claimsArray)) {
    claimsArray.forEach((c) => {
      claims.set(c.claim_id, c.text);
    });
  }
  
  // Convert evidence to UI-friendly format
  const evidence = new Map<string, unknown>();
  const evidenceArray = rawPayload.evidence as Array<{ evidence_id: string; text: string | unknown; confidence: number; weight: number }>;
  if (Array.isArray(evidenceArray)) {
    evidenceArray.forEach((e) => {
      evidence.set(e.evidence_id, e);
    });
  }
  
  const model: BoardModel = {
    payloadId: snapshot.payloadId,
    payloadVersion: snapshot.payloadVersion,
    claims,
    evidence,
    uncertainty: rawPayload.uncertainty ?? null,
    overallConfidence: rawPayload.overall_confidence ?? 0,
    reasoningChain: rawPayload.reasoning_chain ?? null,
  };
  
  console.log('[EvermindPayloadDelivery] Extracted board model for payload', snapshot.payloadId);
  
  return model;
}

// === Validation Logic ===

function validatePayload(payload: Record<string, unknown>): ValidatedPayload {
  const errors: ValidationErrorDetail[] = [];
  
  // Check required fields per PRD AC-1
  if (!payload.schema_version) {
    errors.push({
      field: 'schema_version',
      constraint: 'required',
      message: 'Schema version is required',
    });
  }
  
  if (!payload.basis_id) {
    errors.push({
      field: 'basis_id',
      constraint: 'required',
      message: 'Basis ID (UUID) is required',
    });
  }
  
  if (!payload.created_at) {
    errors.push({
      field: 'created_at',
      constraint: 'required',
      message: 'Created timestamp is required',
    });
  }
  
  if (!payload.agent_id) {
    errors.push({
      field: 'agent_id',
      constraint: 'required',
      message: 'Agent ID is required',
    });
  }
  
  // Check required arrays
  const claims = payload.claims as unknown[];
  if (!Array.isArray(claims) || claims.length === 0) {
    errors.push({
      constraint: 'required',
      message: 'claims array is required and must be non-empty',
    });
  }
  
  // Validate confidence weights
  const checkConfidence = (val: unknown, fieldName: string) => {
    if (typeof val !== 'number') {
      errors.push({
        field: fieldName,
        constraint: 'type',
        message: `${fieldName} must be a number`,
      });
    } else if (val < 0 || val > 1) {
      errors.push({
        field: fieldName,
        constraint: 'range',
        message: `${fieldName} must be in range [0, 1]`,
      });
    }
  };
  
  checkConfidence(payload.overall_confidence, 'overall_confidence');
  checkConfidence(payload.uncertainty, 'uncertainty');
  
  const isInvalid = errors.some(e => e.constraint === 'required');
  
  // Build snapshot
  const snapshot: EvermindPayloadSnapshot = {
    payloadId: payload.basis_id as string,
    payloadVersion: payload.schema_version as string,
    lastCapturedAt: payload.created_at as string,
    lastWinningAt: (payload.lastWinningAt || payload.created_at) as string,
    payload,
  };
  
  return {
    validity: isInvalid ? 'invalid' : 'valid',
    snapshot,
    errors,
  };
}