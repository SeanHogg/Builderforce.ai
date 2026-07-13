import { EvermindPayloadSnapshot } from '../lib/types';

/**
 * PayloadDisplay - React component that renders the Evermind payload as a readable board panel
 * 
 * FR-3: Payload display updates reactively without page reload, displays human-readable fields, 
 * and includes proper accessibility and error states.
 */

interface PayloadDisplayProps {
  /** The complete payload snapshot from delivery facade */
  snapshot: EvermindPayloadSnapshot | null;
  /** Loading indicator state */
  loading: boolean;
  /** Last valid snapshot when payload is being generated or invalidated */
  lastValidPayload: EvermindPayloadSnapshot | null;
  /** Error message if payload failed validation or network request */
  reasonError: string | null;
}

export function PayloadDisplay({
  snapshot,
  loading,
  lastValidPayload,
  reasonError,
}: PayloadDisplayProps): JSX.Element | null {
  // Show last valid payload under loading (FR-3.2, FR-5)
  const currentPayload = loading ? lastValidPayload : snapshot;
  const payload = currentPayload || null;

  // FR-1.3: Reject malformed payloads with structured error
  if (payload && (payload.validity !== 'valid')) {
    return (
      <div className="p-4 border border-red-200 rounded bg-red-50" role="alert">
        <h2 className="text-red-700 font-bold mb-1">Payload Validation Error</h2>
        <p className="text-sm text-red-600">{reasonError || 'Payload is invalid or incomplete'}</p>
        {reasonError && (
          <p className="text-xs text-red-500 mt-1">
            {reasonError}
          </p>
        )}
      </div>
    );
  }

  // Initial loading state (FR-4.2: loading indicator while processing)
  if (loading && !payload) {
    return (
      <div className="p-4 border border-gray-200 rounded bg-gray-50 min-h-[100px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-sm text-gray-600">
          <span className="animate-pulse font-medium">Processing payload...</span>
          <span className="text-xs opacity-60">
            Generating reasoning context from payload
          </span>
        </div>
      </div>
    );
  }

  // Nothing to display
  if (!payload) {
    return null;
  }

  // Create flat list of top-level fields for display (FR-3.1)
  const fieldsToShow = Array.from(previewFields(payload.payload));

  // Render payload
  return (
    <div className="border rounded p-4 bg-white shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-800">
          Payload: {payload.payloadId}
        </h2>
        <span className="text-xs text-gray-500">
          v{payload.payloadVersion}
        </span>
      </div>

      {/* Confidence Meter */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="font-medium text-gray-700">Overall Confidence</span>
          <span className="font-mono text-gray-900">
            {(payload.payload.overall_confidence ?? 0) * 100}%
          </span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className="h-full bg-green-500 transition-all duration-500"
            style={{
              width: `${(payload.payload.overall_confidence ?? 0) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Claims Section */}
      {payload.payload.claims && Array.isArray(payload.payload.claims) && payload.payload.claims.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
            Claims ({payload.payload.claims.length})
          </h3>
          <ul className="space-y-2">
            {payload.payload.claims.slice(0, 5).map((claim: { claim_id: string; text: string; confidence: number }) => (
              <li 
                key={claim.claim_id}
                className="flex items-start gap-2 p-2 bg-gray-50 rounded border border-gray-100"
              >
                <span className="text-xs text-gray-400 mt-0.5">•</span>
                <span className="text-sm text-gray-800 leading-snug">{claim.text}</span>
                <span 
                  className="ml-auto text-xs font-medium whitespace-nowrap"
                  style={{ 
                    color: getConfidenceColor(claim.confidence) 
                  }}
                >
                  {Math.round(claim.confidence * 100)}%
                </span>
              </li>
            ))}
            {payload.payload.claims.length > 5 && (
              <li className="text-xs text-gray-500 italic">
                +{payload.payload.claims.length - 5} more claim{payload.payload.claims.length > 6 ? 's' : ''}
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Evidence Section */}
      {payload.payload.evidence && Array.isArray(payload.payload.evidence) && payload.payload.evidence.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
            Evidence ({payload.payload.evidence.length})
          </h3>
          <ul className="space-y-2">
            {payload.payload.evidence.slice(0, 3).map((evidenceItem: { evidence_id: string; summary: string }) => (
              <li 
                key={evidenceItem.evidence_id}
                className="text-sm text-gray-800"
              >
                <span className="font-medium text-gray-600">
                  {evidenceItem.summary}
                </span>
              </li>
            ))}
            {payload.payload.evidence.length > 3 && (
              <li className="text-xs text-gray-500 italic">
                +{payload.payload.evidence.length - 3} more evidence{payload.payload.evidence.length > 4 ? 's' : ''}
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Uncertainty & Reasoning Chain */}
      {(payload.payload.uncertainty !== undefined || payload.payload.reasoning_chain) && (
        <div className="space-y-2 text-xs">
          {payload.payload.uncertainty !== undefined && (
            <div className="flex justify-between">
              <span className="text-gray-600">Uncertainty</span>
              <span className="font-mono">
                {Math.round((payload.payload.uncertainty ?? 0) * 100)}%
              </span>
            </div>
          )}
          {payload.payload.reasoning_chain && (
            <div>
              <span className="text-gray-600">Reasoning Chain</span>
              <p className="text-gray-800 mt-1 pl-2 border-l-2 border-blue-200">
                {payload.payload.reasoning_chain}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Bottom Metadata */}
      <div className="mt-4 pt-3 border-t border-gray-200 text-xs text-gray-500">
        <div className="flex justify-between">
          <span>Generated: {new Date(payload.lastCapturedAt).toLocaleTimeString()}</span>
          <span>Last Updated: {new Date(payload.lastWinningAt).toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Preview top-level fields from payload for initial display (FR-3.1)
 */
function previewFields(payload: Record<string, unknown>): Map<string, unknown> {
  const fields = new Map();
  const visibility: Record<string, boolean> = {
    schema_version: false,
    basis_id: false,
    created_at: false,
    agent_id: false,
  };
  
  // Mark top-level fields as visible if they're not hidden
  Object.keys(payload).forEach(key => {
    if (!visibility[key]) {
      const value = payload[key];
      
      // Skip nested objects for now (show via details), but keep simple values
      if (typeof value === 'string' || 
          typeof value === 'number' || 
          typeof value === 'boolean' || 
          value === null) {
        fields.set(key, value);
      } else if (Array.isArray(value) && value.length === 0) {
        fields.set(key, `[]`);
      } else if (typeof value === 'object') {
        // Skip nested objects for the top-level preview
        fields.set(`${key} (object)`, `{...}`);
      } else {
        fields.set(key, String(value));
      }
    }
  });
  
  return fields;
}

/**
 * Get color-coded confidence label
 */
function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.7) return 'text-green-600';
  if (confidence >= 0.4) return 'text-amber-600';
  return 'text-red-600';
}