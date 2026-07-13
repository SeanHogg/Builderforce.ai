/**
 * Payload Page Client - Demo Integration
 * 
 * Demonstrates integration of payload delivery with agent reasoning and board display.
 * This showcases the complete flow from payload generation → agent consumption → board UI.
 * 
 * Usage:
 * - Agent hooks: use this in agent runtime to inject payload context
 * - Board hooks: integrate this into the board component's iframe/page lifecycle
 */

import React from 'react';
import { 
  useEvermindPayload, 
  AgentContext, 
  BoardModel,
} from './useEvermindPayload';

// === Utility: Load Payload for Board UI ===

export function useBoardPayload(projectId: number) {
  const { snapshot, loading, error, validity, refetch } = useEvermindPayload({ projectId });
  
  // Extract board model (UI-friendly)
  const boardModel = React.useMemo<BoardModel | null>(() => {
    if (!snapshot || validity !== 'valid') return null;
    
    const { loadEvermindPayload } = require('./evermindPayloadDelivery');
    return loadEvermindPayload.boardModelFromPayload(snapshot);
  }, [snapshot, validity]);
  
  return {
    snapshot,
    boardModel,
    loading,
    error,
    validity,
    refetch,
  };
}

// === Utility: Load Payload for Agent Reasoning ===

export function useAgentPayloadContext(projectId: number): AgentContext | null {
  const { agentContext } = useEvermindPayload({ projectId });
  return agentContext;
}

// === Integration Example: Agent-Board Data Flow ===

interface AgentBoardIntegrationProps {
  projectId: number;
  onAgentReasoningStart?: (context: AgentContext) => void;
  onAgentReasoningComplete?: (result: string) => void;
}

export function AgentBoardIntegration({ 
  projectId, 
  onAgentReasoningStart,
  onAgentReasoningComplete,
}: AgentBoardIntegrationProps) {
  const { agentContext, loading, error, isValid } = useEvermindPayload({ projectId });
  
  // Agent reasoning step
  const executeReasoning = React.useCallback(async () => {
    if (!agentContext || !isValid) {
      console.error('[AgentBoardIntegration] Cannot reason: incomplete payload');
      return;
    }
    
    console.log('[AgentBoardIntegration] Starting reasoning with payload context', agentContext);
    
    // Simulate agent reasoning using payload data (FR-2.1, FR-2.2)
    const reasoningSteps = [
      `Analyzing ${agentContext.payloadFields.length} payload fields`,
      `Using driver_affect=${agentContext.driverAffect} as impact factor`,
      `Target mode: ${agentContext.targetMode}`,
      'Formulating inference',
    ];
    
    // In production, this would call  the actual reasoning engine
    // const result = await reason(render(agentContext.payload));
    
    onAgentReasoningStart?.(agentContext);
    
    // Simulate async reasoning (500-2000ms)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const result = `Inferred decision: Investigate risk based on confidence ${agentContext.overallConfidence}`;
    console.log('[AgentBoardIntegration] Reasoning complete', result);
    onAgentReasoningComplete?.(result);
    
    return result;
  }, [agentContext, isValid, onAgentReasoningStart, onAgentReasoningComplete]);
  
  // Board display state
  const [reasoningResult, setReasoningResult] = React.useState<string | null>(null);
  const [reasoningLoading, setReasoningLoading] = React.useState(false);
  
  const handleAgentReasoning = React.useCallback(() => {
    setReasoningLoading(true);
    executeReasoning().then(result => {
      setReasoningResult(result);
      setReasoningLoading(false);
    }).catch(err => {
      console.error('[AgentBoardIntegration] Reasoning failed', err);
      setReasoningLoading(false);
    });
  }, [executeReasoning]);
  
  // Render
  if (!isValid && !loading) {
    return (
      <div className="p-4 border border-red-200 rounded bg-red-50">
        <h3 className="text-red-700 font-semibold mb-2">Payload Error</h3>
        <p className="text-red-600 text-sm">{error?.message || 'Failed to load valid payload'}</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {/* Agent Context Panel */}
      <div className="p-4 border border-blue-200 rounded bg-blue-50">
        <h3 className="text-blue-700 font-semibold mb-2">Agent Context</h3>
        {loading && !agentContext ? (
          <p className="text-blue-600 text-sm">Loading payload context...</p>
        ) : agentContext ? (
          <div className="space-y-2 text-sm">
            <div><strong>Version:</strong> {agentContext.payloadVersion}</div>
            <div><strong>Payload ID:</strong> {agentContext.payloadFields.join(', ')}</div>
            <div><strong>Driver Affect:</strong> {agentContext.driverAffect}</div>
            <div><strong>Target Mode:</strong> {agentContext.targetMode}</div>
            <div><strong>Inference Enabled:</strong> {agentContext.inferenceEnabled ? 'Yes' : 'No'}</div>
          </div>
        ) : null}
      </div>
      
      {/* Board Model Panel */}
      {/* In production, integrate with EvermindPayloadPanel component */}
      
      {/* Agent Action */}
      <div className="flex gap-2">
        <button
          onClick={handleAgentReasoning}
          disabled={loading || !isValid}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {reasoningLoading ? 'Processing...' : 'Run Agent Reasoning'}
        </button>
      </div>
      
      {/* Reasoning Output */}
      {reasoningResult && (
        <div className="p-4 border border-green-200 rounded bg-green-50">
          <h3 className="text-green-700 font-semibold mb-2">Agent Reasoning Result</h3>
          <p className="text-green-800">{reasoningResult}</p>
        </div>
      )}
    </div>
  );
}

// === Board Panel Integration Example ===

interface BoardPanelIntegrationProps {
  projectId: number;
}

export function BoardPanelIntegration({ projectId }: BoardPanelIntegrationProps) {
  const { boardModel, loading, error, validity } = useBoardPayload(projectId);
  
  if (loading) {
    return (
      <div className="p-4 border border-gray-200 rounded">
        <p className="text-gray-600">Loading payload...</p>
      </div>
    );
  }
  
  if (!boardModel) {
    return null;
  }
  
  return (
    <div className="border rounded p-4">
      <h3 className="font-semibold mb-2">Payload Display</h3>
      
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div><strong>Payload ID:</strong> {boardModel.payloadId}</div>
        <div><strong>Version:</strong> {boardModel.payloadVersion}</div>
        <div><strong>Confidence:</strong> {(boardModel.overallConfidence * 100).toFixed(0)}%</div>
        <div><strong>Uncertainty:</strong> {boardModel.uncertainty !== null ? `${(boardModel.uncertainty * 100).toFixed(0)}%` : 'N/A'}</div>
      </div>
      
      {boardModel.claims.size > 0 && (
        <div className="mt-3">
          <h4 className="text-sm font-medium text-gray-700 mb-1">Claims ({boardModel.claims.size})</h4>
          <ul className="text-xs text-gray-600 space-y-1">
            {Array.from(boardModel.claims.entries()).map(([id, text]) => (
              <li key={id}>• {text}</li>
            ))}
          </ul>
        </div>
      )}
      
      {error && (
        <div className="mt-4 p-2 bg-red-50 border border-red-200 rounded text-xs">
          <strong>Issue:</strong> {error.message}
        </div>
      )}
    </div>
  );
}