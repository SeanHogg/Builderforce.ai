# Progress Handling Guide

This guide explains how to correctly handle progress updates emitted during task and job execution, particularly the transition from `progressPct=100`.

## Overview

The progress API emits a standardized event payload with a `progressPct` field (0–100). Understanding when `progressPct=100` is emitted is critical for building reliable progress indicators and properly cleaning up listeners.

## Canonical `progressPct=100` Emission Rule

### Conditions under which `progressPct=100` is emitted

- The value 100 is emitted **once** per task/job.
- It MUST be emitted **after all processing steps are confirmed complete** and **no further progress updates will follow**.
- This is the authoritative signal of task/job completion for progress-stream consumers.

### Important guarantees

- A value like `99` or any other value less than 100 does NOT indicate final completion.
- Do not treat intermediate values near 100 as equivalent to `progressPct=100`.

## Example: Register and Clean Up a Listener

### Correct Pattern

Register a listener that:

1. Updates the UI with the received `progressPct`.
2. Terminates (removes or disables) the listener upon receiving `progressPct=100`.
3. Assumes the task/job is complete and does not wait for any further updates.

```typescript
type ProgressEvent = {
  progressPct: number;
};

function trackProgress(taskId: string): () => void {
  const listener = (event: ProgressEvent) => {
    if (event.progressPct < 100) {
      // Update the UI with the current progress.
    } else {
      // 100 is received: cleanup and treat as final.
      console.log('Progress complete:', taskId);
      cleanupProgress();
    }
  };

  subscribeToProgressUpdates(taskId, listener);

  // Returns a cleanup function for the caller to use.
  return () => {
    unsubscribeFromProgressUpdates(taskId, listener);
  };
}
```

### Using the listener

```typescript
// Register and get a cleanup function.
const untrack = trackProgress(taskId);

// If you must stop tracking early, invoke the cleanup:
// untrack();
```

### Pseudocode for integration tutorials

```text
On subscribeToProgress(taskId):
  Set listener = (event) ->
    if event.progressPct < 100:
      Update UI for this event
    else if event.progressPct == 100:
      Remove/complete progress listener
      Emit 'complete' to client

  Attach listener
  Return a cleanup function that:
    Detaches the listener
```

### What to avoid

- Never treat a `progressPct` of 99 or any other value close to 100 as a final or complete signal.
- Always clean up/removes the listener on `progressPct=100` to distinguish completion from ongoing updates.

## Related Documentation

- API Reference: `docs/api/event-payload.schema.json`
- Changelog: `docs/CHANGELOG.md`