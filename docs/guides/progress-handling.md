# Progress Handling Guide

This guide explains how to correctly handle progress events from Builderforce tickets and jobs, particularly the **progressPct=100 emission rule**.

## Overview: The progressPct=100 Rule

When a task or job completes, the system emits a progress event with `progressPct: 100`. This signal has critical semantics that integrators must understand:

| Constraint | Explanation |
|------------|-------------|
| **Single emission** | `progressPct=100` is emitted **ONLY ONCE**, not repeatedly |
| **Terminal guarantee** | The 100% signal marks the end of progress updates — no more events of this type will follow |
| **After complete processing** | The event is emitted **AFTER** all processing steps are confirmed complete |
| **Authentic signal** | For progress-stream consumers, `progressPct=100` is the authoritative indicator of true completion |

> **⚠️ WARNING:** Do NOT Treat Intermediate Values as Completion
>
> Values such as 99, 99.9, or "almost done" are **NOT** completion signals. They represent active progress and may be followed by additional updates. Only `progressPct=100` terminates a progress stream.

## Pattern: Register and Cleanup Progress Listener

The correct pattern is to register a progress listener and tear it down (unsubscribe or remove the event handler) when `progressPct=100` is received.

### Example: JavaScript/TypeScript Client

```typescript
interface ProgressEvent {
  kind: "task" | "epic" | "goal" | "objective" | "initiative" | "portfolio" | "roadmap" | "spec";
  ref: string;
  label: string;
  status: string;
  progressPct: number;
  done: number;
  total: number;
  exists: boolean;
}

async function monitorTicketCompletion(ticketId: string): Promise<void> {
  let cleanupRequired = false;

  const onProgress = (data: ProgressEvent): void => {
    if (data.progressPct === 100) {
      // ↓ 100% is received: clean up the listener
      cleanupRequired = true;
      console.log(`✅ ${data.label} COMPLETE`);
      return;
    }

    // Track progress for intermediate steps
    console.log(`${data.label}: ${data.progressPct}% (${data.done}/${data.total})`);
  };

  // Subscribe to progress events
  const subscription = api.subscribeToTicketProgress(ticketId, onProgress);

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (!cleanupRequired) {
        subscription.unsubscribe();
        console.log(`⚠️ No completion signal received for ${ticketId}`);
      }
      resolve(undefined);
    }, 30000); // 30-second timeout for cleanup
  });
}

// Example usage:
await monitorTicketCompletion("42");
```

The key points in this example:
- **Cleanup is triggered by the 100% signal**: The listener removes itself or its subscription when completion is detected
- **Terminal guarantee**: Once 100% is hit, no more progress events of this type arrive
- **Finite cleanup**: Even without a 100% signal, an optimal solution optionally exhaustively removes the subscription after a timeout

## Distinguishing `progressPct=100` from Other Terminal Status Fields

While `progressPct: 100` is the authoritative signal for progress-stream consumers, some work items have their own terminal status fields:

| Work Item Type | Terminal Status Field | Notes |
|----------------|----------------------|-------|
| Task/Epic/Gap | `status: "done"` | May coexist with `progressPct: 100` |
| Spec | `status: "complete"` | May coexist with `progressPct: 100` |
| Roadmap Item | `status: "shipped"` | May coexist with `progressPct: 100` |
| Strategy Tier | No dedicated status; rely on `progressPct` | Objectives, Initiatives, Portfolios |

**Best practice:** When integrating progress streams, prefer `progressPct: 100` as the definitive completion signal. Use status fields for display purposes (e.g., human-readable text).

## Error Cases

### 1. No Completion Signal Received

If processing completes but no 100% signal arrives within a reasonable timeout (e.g., 30–60 seconds), the integration should:

1. Log a warning
2. Perform a final read of the associated ticket or job to determine actual state
3. Unregister the progress listener

### 2. Partial Progress Updates

Value ranges other than 0–100 (e.g., negative values or >100) indicate a system error. Treat these as warnings and check integration configuration.

## Frontend / UI Considerations

When displaying progress to users:

1. **Do not show "Complete" for 99%** – treat it as "Almost done"
2. **Stop the progress spinner after 100%** – no further polling is needed
3. **Smooth transition to completion state** once 100% is detected

### Example: React Component

```tsx
import { useEffect, useState } from 'react';

interface ProgressEvent {
  progressPct: number;
  label: string;
  status: string;
}

export function TicketProgress({ ticketId }: { ticketId: string }) {
  const [progress, setProgress] = useState<ProgressEvent | undefined>(undefined);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    const subscription = api.subscribeToTicketProgress(ticketId, (event) => {
      setProgress(event);

      if (event.progressPct === 100) {
        setIsComplete(true);
        subscription.unsubscribe(); // ← CLEANUP: remove listener
      }
    });

    return () => subscription.unsubscribe(); // ← Fallback cleanup
  }, [ticketId]);

  if (isComplete) {
    return <span className="status-complete">✅ Done</span>;
  }

  const pct = progress?.progressPct ?? 0;
  return <span className="status-progress">{pct}% complete</span>;
}
```

## Summary Checklist

Before integrating progress events:

- [ ] You understand that `progressPct=100` is the terminal, authoritative completion signal
- [ ] Your listener unsubscribes/destroys itself when 100% is received
- [ ] You do NOT treat intermediate values (e.g., 99) as equivalent to completion
- [ ] You have a timeout pattern in case no 100% event arrives
- [ ] You have considered cleanup fallbacks (e.g., `useEffect` return)
- [ ] You distinguish 100% from other terminal status fields where applicable

## Additional Resources

- [Event Payload Schema](../api/event-payload.schema.json) – Full JSON Schema with examples
- [Progress Documentation Checklist](./progress-docs-checklist.md) – Verify consistency across all docs
- [Chat Ticket API Reference](../../../api/src/application/brain/ChatTicketService.ts) – Server-side implementation