# Progress Tracking Guide

## Overview

This guide describes how to consume progress events for jobs and tasks, including the canonical rules for `progressPct: 100`.

## Expected Event Format

Progress events are delivered as JSON objects conforming to the canonical Event Payload Schema (Draft 2020-12). For reference, see `docs/api/event-payload.schema.json`.

Key fields:

- `id` — Event identifier.
- `type` — Event type (`job_status` or `progress_update`).
- `resourceId` — The job or task ID.
- `resourceType` — `job` or `task`.
- `status` — Overall status (`queued`, `running`, `completed`, `failed`, `canceled`, `unknown`).
- `progressPct` (optional) — Progress percentage, 0–100.
- `created` — Timestamp (`date-time`).

## Canonical Rule: `progressPct: 100`

`progressPct: 100` is emitted **only when the entire processing pipeline for the job or task has finished**. Important points:

- Emitted at most once per job/task.
- Must not be emitted before all required steps complete.
- No further progress events follow it.
- This is the authoritative terminal signal for progress-based UI and downstream consumers.

See the PRD and API reference for full definition and rationale.

## Example: Terminal Listener Pattern

Below is a minimal implementation using an in-progress progress-tracker pattern (based on canonical event format). Note that 99% or any other intermediate value is **not** equivalent to `progressPct: 100`. The canonical pattern registers a progress listener that terminates and tears it down when the event delivers `progressPct: 100`.

```python
import json
from typing import Callable

StreamPayload = dict[str, object]

class ProgressTracker:
    """
    Minimal progress tracker showing the canonical registration/cleanup pattern for progressPct=100.
    """
    def __init__(self):
        self._listener_ended = False
        self._callbacks: list[Callable[[dict[str, object]], None]] = []

    def add_progress_listener(self, callback: Callable[[dict[str, object]], None]) -> None:
        """
        Register a progress callback. The callback receives the full event payload.
        Precaution: write state-only handling code; do NOT assume idempotence.
        """
        self._callbacks.append(callback)

    def remove_progress_listener(self, callback: Callable[[dict[str, object]], None]) -> None:
        """Unregister a progress callback."""
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    def _process(self, payload: StreamPayload) -> None:
        # State-only handling: don't assume the emitter guarantees idempotence.
        rid = payload["resourceId"]
        pct = payload.get("progressPct")
        st = payload.get("status")

        if pct is None:
            # Progress-value absent: only update status.
            print(f"STATUS: {rid}={st}")
        else:
            # Optional: validate range; emission logic in the platform enforces [0, 100].
            if pct < 0.0 or pct > 100.0:
                print(f"WARN: Invalid progressPct={pct} for {rid}")
            else:
                print(f"PROGRESS: {rid}={pct}% (status={st})")

    def update(self, payload: StreamPayload) -> None:
        """Main entry point: call _process for all listeners once per event."""
        for cb in self._callbacks:
            cb(payload)

        # Canonical pattern: if progressPct is exactly 100, cleanup listeners and stop polling.
        pct = payload.get("progressPct")
        st = payload.get("status")
        if isinstance(pct, (int, float)) and pct == 100:
            if st == "completed":
                self._on_completion()
            # If status != completed but progressPct is 100, treat it as suspicious.
            elif st != "completed":
                print(f"WARN: Received progressPct=100 with status={st} for {payload['resourceId']}")

    def _on_completion(self) -> None:
        """
        Terminal cleanup: poller/listener can stop. The platform emits at most one progressPct=100,
        so this may be called once per resource.
        """
        self._listener_ended = True
        # Remove all callbacks and tear down the listener.
        self._callbacks.clear()
        print(f"COMPLETE: Terms. Tear down listeners and stop polling.")

    def terminate(self) -> None:
        self._callbacks.clear()
        self._listener_ended = False

# Example usage
import socket

server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.bind(("127.0.0.1", 9999))
server.listen()

tracker = ProgressTracker()

def progress_handler(payload: StreamPayload) -> None:
    tracker.update(payload)

tracker.add_progress_listener(progress_handler)

print("Listening on :9999 for progress events...")
while True:
    client_sock, addr = server.accept()
    print(f"Connection from {addr}")
    while True:
        data = client_sock.recv(4096)
        if not data:
            break
        lines = data.decode().splitlines()
        for line in lines:
            if not line.strip():
                continue
            try:
                tracker.update(json.loads(line))
            except Exception as exc:
                print(f"WARN: Failed to parse event line: {exc}")
    client_sock.close()
    if tracker._listener_ended:
        print("Server: polling terminated; exiting.")
        break

tracker.terminate()
```

## Warning: Intermediate Values Near 100

```python
# Terminal condition requires exact 100:
if progress_pct == 100.0 and status == "completed":
    # Cancel polling, close listeners, and clean up state.
    pass

# Do NOT treat 99 or 99.9 as completion:
if progress_pct in (99, 99.9):
    # Keep polling active; check again for exact 100.
    pass
```

### Common Pitfall

Ignoring 100 semantics can cause UI issues:

- Reloading prematurely.
- Not tearing down listeners, leading to memory leaks.
- Misrepresenting "finished" state in dashboards.

Follow the canonical rule to avoid these issues.

## Stateful vs Stateless Consumers

- **Stateful listeners** should remove their callback on `progressPct == 100`.
- **Idempotent stateless handlers** can safely process a duplicate 100 event as a no-op.

The rule assures at most one terminal event, preventing duplicate side effects.

## Technical Notes

- The rule is enforced by the underlying job/task processing pipeline.
- Integrators may still receive older events or older payloads; treat overlap carefully.
- If you receive `progressPct === 100` and `status !== "completed"`, treat it as suspicious and either consider dropping the event or adding a warning.

## Related Documentation

- PRD section FR-1…FR-5 (progressPct semantics).
- Canonical schema: `docs/api/event-payload.schema.json`.
- Changelog: `docs/CHANGELOG.md`.