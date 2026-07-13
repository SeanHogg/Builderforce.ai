/**
 * Payload Display Component
 * 
 * Renders payload data in a reactive panel on the board UI.
 * 
 * Conforms to FR-3:
 * - FR-3.1: Displays raw/formatted payload in a dedicated panel
 * - FR-3.2: Updates reactively within 500ms (via polling hook)
 * - FR-3.3: Human-readable labels and formatting
 * 
 * Conforms to FR-4:
 * - FR-4.2: Loading state shown during generation
 * - FR-4.3: Error state displayed alongside last valid payload
 */

import React, { useMemo } from 'react';
import { BoardModel, PayloadDeliveryError } from '../lib/types';

// Types expected from parent hook
interface PayloadDisplayProps {
  model: BoardModel | null;
  loading: boolean;
  lastValidModel: BoardModel | null;
  error: PayloadDeliveryError | null;
  reasonError: string | null;
}

export function PayloadDisplay({ 
  model, 
  loading, 
  lastValidModel, 
  error, 
  reasonError,
}: PayloadDisplayProps): JSX.Element | null {
  const maybeModel = loading ? lastValidModel : model;
  
  const loaded = maybeModel != null;
  const isMalformed = !loaded;
  
  // Use simple value extraction since data is now typed as BoardModel
  const payloadProps = useMemo(() => {
    if (!maybeModel) return {};
    
    const props: Record<string, unknown> = {
      schema_version: maybeModel.payloadVersion,
      basis_id: maybeModel.payloadId,
      claims: maybeModel.claims,
      evidence: maybeModel.evidence,
      uncertainty: maybeModel.uncertainty,
      overall_confidence: maybeModel.overallConfidence,
      reasoning_chain: maybeModel.reasoningChain,
    };
    
    // Convert evidence maps to array for display
    if (maybeModel.evidence.size > 0) {
      props.evidence_display = Array.from(maybeModel.evidence.values()).map(
        (e: unknown) => e
      );
    }
    
    return props;
  }, [maybeModel]);

  // Loading state (FR-4.2)
  if (loading) {
    return (
      <div className="flex flex-col gap-1 p-3 border border-gray-200 rounded bg-gray-50">
        <span className="font-semibold text-gray-600">Loading payload...</span>
        <span className="text-gray-400 text-xs italic">While generating payload</span>
      </div>
    );
  }

  // Empty state
  if (!loaded) {
    return null;
  }

  // Malformed state (FR-4.3, FR-1.3)
  if (isMalformed) {
    const description = reasonError || 'Payload format invalid';
    return (
      <div className="p-3 bg-red-50 border border-red-200 rounded">
        <p className="text-red-700 font-medium">{description}</p>
        {error && (
          <p className="text-red-600 text-xs mt-1">{error.message}</p>
        )}
        <p className="text-xs text-red-400 mt-2">
          Highlighted issue: failed to parse payload structure
        </p>
      </div>
    );
  }

  // Valid payload display (FR-3.1, FR-3.2, FR-3.3)
  return (
    <div className="flex flex-col gap-3 p-3 border border-gray-200 rounded bg-white">
      {/* Header with version info */}
      <div className="flex items-center justify-between border-b pb-2">
        <span className="text-sm font-medium text-gray-700">Payload Display</span>
        {maybeModel.payloadVersion && (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
            v{maybeModel.payloadVersion}
          </span>
        )}
      </div>
      
      {/* Summary metrics */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        {maybeModel.overallConfidence !== undefined && (
          <div>
            <span className="text-gray-500 text-xs">Overall Confidence</span>
            <div className="font-medium">
              {(maybeModel.overallConfidence * 100).toFixed(0)}%
            </div>
          </div>
        )}
        {maybeModel.uncertainty !== null && maybeModel.uncertainty !== undefined && (
          <div>
            <span className="text-gray-500 text-xs">Uncertainty</span>
            <div className={`font-medium ${maybeModel.uncertainty > 0.5 ? 'text-amber-600' : 'text-green-600'}`}>
              {(maybeModel.uncertainty * 100).toFixed(0)}%
            </div>
          </div>
        )}
      </div>
      
      {/* Claims display */}
      {maybeModel.claims.size > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Claims ({maybeModel.claims.size})
          </h4>
          <ul className="space-y-1">
            {Array.from(maybeModel.claims.entries()).map(([id, text]) => (
              <li key={id} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-blue-600 mt-0.5">•</span>
                <span className="flex-1">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      
      {/* Evidence display */}
      {payloadProps.evidence_display && (payloadProps.evidence_display as unknown[]).length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Evidence
          </h4>
          <div className="flex flex-col gap-1.5 text-xs text-gray-600">
            {(payloadProps.evidence_display as unknown[]).map((e, i) => {
              const evidenceItem = e as Record<string, unknown>;
              return (
                <div key={i} className="pl-2 pr-1 py-1.5 bg-gray-50 rounded border border-gray-100">
                  <div className="font-medium text-gray-800">
                    {evidenceItem.summary as string || 'Evidence item'}
                  </div>
                  {typeof evidenceItem.confidence === 'number' && (
                    <div className="text-gray-500">
                      Confidence: {(evidenceItem.confidence * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      {/* Reasoning Chain */}
      {maybeModel.reasoningChain && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Reasoning Chain
          </h4>
          <p className="text-sm text-gray-700">→ {maybeModel.reasoningChain}</p>
        </div>
      )}
      
      {/* Error Message (if valid payload but error occurred) */}
      {error && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs">
          <strong>Error:</strong> {error.message}
        </div>
      )}
    </div>
  );
}