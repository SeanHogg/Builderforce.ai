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

Below is a minimal implementation using an in-progress progress-tracker pattern (based on canonical event format). Note that 99% or any other intermediate value is **not** equivalent to `progressPct: 100`.

```python
import json
from collections import defaultdict
from typing import Callable

StreamPayload = dict[str, object]

class SimpleProgressTracker:
    def __init__(self):
        # Map resource IDs to a (resourceType, status) tuple
        self._state: dict[str, tuple[str, str]] = {}
        # Map resource IDs to their latest progress percentage
        self._progress_by_res: dict[str, float] = {}

    def update(self, payload: StreamPayload) -> None:
        rid = payload["resourceId"]
        rtype = payload["resourceType"]
        st = payload["status"]
        pct = payload.get("progressPct")
        if percent is None:
            # Update status only
            self._state[rid] = (rtype, st)
            self._progress_by_res.pop(rid, None)
        else:
            assert 0.0 <= percent <= 100.0, f"percent must be 0–100: {rid} {percent}"
            self._state[rid] = (rtype, st)
            self._progress_by_res[rid] = percent
            self._on_progress(pct, rid, st)

        # If progressPct is 100 and status is completed, we treat it as terminal.
        if st == "completed" and isinstance(pct, (int, float)) and pct == 100.0:
            self._on_completion(rid)

    def _on_progress(self, pct: float, rid: str, status: str) -> None:
        """
        Called when a progress update is received.
        - 99.9 or any intermediate value is NOT terminal; keep listeners active.
        """
        print(f"PROGRESS: {rid}={pct}% (status={status})")

    def _on_completion(self, rid: str) -> None:
        """
        Called when progressPct is 100 and status is completed.
        - This is the terminal point; remove listeners and tear down resources.
        """
        print(f"COMPLETE: {rid} (progressPct=100). Clean up listeners.")

# Example usage
import socket
server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.bind(('127.0.0.1', 9999))
server.listen()

tracker = SimpleProgressTracker()

while True:
    (client_sock, addr) = server.accept()
    while True:
        data = client_sock.recv(4096)
        if not data:
            break
        events = data.decode().splitlines()
        for line in events:
            if line.strip():
                payload = json.loads(line)
                tracker.update(payload)
    client_sock.close()
```

## Warning: Intermediate Values Near 100

```python
if progress_pct == 100 and status == "completed":
    # Terminal: clean up listeners, stop polling, etc.
    pass

# Do NOT treat 99 or 99.9 as completion:
if progress_pct in (99, 99.9):
    # Keep listeners active, continue, check again for 100.
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