# EvermindPayloadDelivery Library

This library provides a clean, reliable data path from Evermind payload generation to agent reasoning context and board display UI.

## Overview

- **Purpose:** Bridge the gap between payload generation, agent consumption, and board display.
- **Design Pattern:** Single source of truth (`EvermindPayloadSnapshot`) shared across consumers.
- **Core Components:**
  - `evermindPayloadDelivery.ts` — Delivery facade (loading, validation, extraction)
  - `types.ts` — Shared TypeScript definitions
  - `useEvermindPayload.ts` — Shared React hook for reactive loading
  - `payload-page-client.tsx` — Integration examples

## Components

### 1. Delivery Facade (`evermindPayloadDelivery.ts`)

**Main exports:**
- `loadEvermindPayload(projectId: number) → Promise<ValidatedPayload>` — Load and validate payload from server
- `agentContextFromPayload(snapshot, projectId) → AgentContext` — Extract reasoning-ready context for agents
- `boardModelFromPayload(snapshot) → BoardModel` — Extract UI-friendly model for board display

**Features:**
- Client-side payload validation (required fields, confidence ranges, etc.)
- Structured error handling (`PayloadDeliveryError`)
- Observability events logged for each operation

### 2. Hook (`useEvermindPayload.ts`)

**Main exports:**
- `useEvermindPayload(props: UseEvermindPayloadProps) → UseEvermindPayloadReturn`

**Returns:**
- `snapshot: EvermindPayloadSnapshot | null` — Full payload snapshot
- `agentContext: AgentContext | null` — Reasoning context
- `loading: boolean` — Loading state
- `error: PayloadDeliveryError | null` — Error state
- `validity: 'valid' | 'invalid' | 'unknown'` — Validation result
- `isError: boolean` — Whether error is network-related

**Behavior:**
- Auto-loads on mount
- Polls every 10s (configurable) to detect fresh payloads
- Debounces polling during validation errors (500ms)
- Halts reasoning if payload fails validation (FR-1.3, FR-4.3)
- Returns same snapshot to multiple contexts

### 3. Integration Client (`payload-page-client.tsx`)

**Use cases:**
- `useBoardPayload(projectId: number)` — Board display components
- `useAgentPayloadContext(projectId: number)` — Agent reasoning hooks
- `AgentBoardIntegration` — Demo component showing complete flow

**PRD Alignment:**
- FR-1.3: Invalid payloads halt reasoning with structured error
- FR-2.2: Reasoning output traceable to payload fields (via AgentContext)
- FR-3.1/3.2/3.3: Board model extracts human-readable fields
- FR-4.1/4.2/4.3: Agent reasoning/processing states surfaced to UI
- FR-5: Single snapshot guarantee across consumers
- FR-6: Events logged per delivery/invocation

## Usage Examples

### Agent Reasoning Integration

```typescript
import { useAgentPayloadContext } from './lib/payload-page-client';

function Agent({ projectId }: { projectId: number }) {
  const agentContext = useAgentPayloadContext(projectId);
  
  if (!agentContext) {
    return <div>Loading payload context...</div>;
  }
  
  // Use payload fields in reasoning
  const reasoning = `Driver affect: ${agentContext.driverAffect}, target mode: ${agentContext.targetMode}`;
  
  return <div>{reasoning}</div>;
}
```

### Board Display Integration

```typescript
import { useBoardPayload } from './lib/payload-page-client';

function BoardPayloadPanel({ projectId }: { projectId: number }) {
  const { boardModel, loading, error } = useBoardPayload(projectId);
  
  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;
  if (!boardModel) return null;
  
  return (
    <div>
      <h3>Payload ({boardModel.payloadId})</h3>
      <p>Confidence: {(boardModel.overallConfidence * 100).toFixed(0)}%</p>
      {/* Display claims */}
    </div>
  );
}
```

### Custom Integration

```typescript
import { loadEvermindPayload } from './lib/evermindPayloadDelivery';

async function myComponent({ projectId }: { projectId: number }) {
  const result = await loadEvermindPayload(projectId);
  
  if (result.validity === 'invalid') {
    throw new Error(`Invalid payload: ${result.errors.map(e => e.message).join(', ')}`);
  }
  
  // Use snapshot directly
  const context = agentContextFromPayload(result.snapshot, projectId);
  const model = boardModelFromPayload(result.snapshot);
}
```

## Observability

All operations emit console logs with structured events (FR-6):

```typescript
{
  type: 'payload_delivery',
  timestamp: '2025-03-04T12:00:00Z',
  eventId: 'ev-1712208000000',
  projectId: 11,
  payloadId: '550e8400-e29b-41d4-a716-446655440000',
  status: 'success',
  payloadVersion: '1.0.0',
  lastWinningAt: '2025-03-04T12:00:00Z'
}
```

## Testing

See `frontend/src/components/payload-display.tsx` for UI integration tests.

## Dependencies

- React 18+
- TypeScript (for types)
- Node.js runtime features only (no heavy dependencies)

## Future Enhancements

- [ ] Real server API integration (replace mock)
- [ ] WebSocket/WebSocket-like streaming for real-time payload updates
- [ ] Batch loading for many contexts (optimization)
- [ ] Persistence layer for payload history (out of scope per PRD)