# Error reporting

## The contract: errors stay on your machine

A self-hosted runtime's logs belong to whoever hosts it. By default, **every error
this runtime catches is written locally and nowhere else**:

- the console formatter (the gateway terminal), and
- the JSON log file under the configured log directory (`~/.builderforce/logs` by
  default — see `src/logging/file.ts`).

Nothing about an error leaves the machine. That is true whether or not the host is
linked to a builderforce.ai workspace, and it is the default you get by installing
and running the runtime.

## The consequence of that default

The platform cannot see what it was never sent. When an on-prem agent crashes, the
only trace visible in builderforce.ai is whatever the execution status happened to
record — so "why did this customer's on-prem agent fail" is a question that can
only be answered by asking them to send a log file.

## The opt-in

Set `BUILDERFORCE_ERROR_REPORTING` to a truthy value (`1`, `true`, `yes`, `on`,
`enabled`) — in the process environment or in `~/.builderforce/.env` — and the
errors that already go to the local log are **also** filed against the linked
workspace's project, landing in the same Quality feed as every other error the
platform knows about.

```sh
# per-invocation
BUILDERFORCE_ERROR_REPORTING=1 builderforce gateway run

# persistently, alongside the link credentials this host already stores
printf 'BUILDERFORCE_ERROR_REPORTING=1\n' >> ~/.builderforce/.env
```

### What it sends

One event per error, to `POST /api/quality-ingest/client-report`:

| Field       | Value                                                          |
| ----------- | -------------------------------------------------------------- |
| `type`      | the error's constructor name                                     |
| `message`   | the error message                                                |
| `stack`     | the stack trace                                                  |
| `operation` | the seam it happened at, e.g. `uncaughtException`                |
| `context`   | whatever the reporting call site attached                        |
| `release`   | the runtime version                                              |

The environment is stamped `on-prem-runtime` server-side, so on-prem errors are
distinguishable from cloud ones in the Quality feed and can be routed by a
tenant-level collector's mapping rules.

### What it needs

- `BUILDERFORCE_API_KEY` and `BUILDERFORCE_URL` — the credentials `builderforce
  connect` already wrote. **No new credential is provisioned for reporting.**
- A workspace whose `.builderForceAgents/context.yaml` carries the Builderforce
  link (`builderforce.instanceId`, and `builderforce.projectId` to name the
  destination project).

If any of those are missing, the reporter no-ops and the local log is unaffected.

### When it will not send, whatever the setting says

- **Offline / air-gapped mode.** `BUILDERFORCE_OFFLINE` or `BUILDERFORCE_AIRGAP`
  wins: a runtime declared isolated makes zero outbound control-plane calls, and a
  reporting switch left on from before the machine was isolated is not an
  exception to that.
- **Not linked.** No API key, or no host id in the workspace context.

### Failure behaviour

Reporting is fire-and-forget and can never fail a run. A non-2xx response or a
network error is logged at debug and dropped; a terminal crash waits at most five
seconds for its report before the process exits regardless.

## Implementation

- `src/infra/platform-error-reporter.ts` — the reporter (`logAndReportRuntimeError`
  for ordinary caught errors, `sendRuntimeErrorReport` for callers that own their
  own log line).
- `src/infra/fatal-exit.ts` — the single terminal-crash path (`reportAndExit`,
  `installUncaughtExceptionHandler`) shared by every entry point.

## The VS Code extension

The extension follows the same shape: its output channel is the contract, and the
`builderforce.reportErrors` setting (off by default) additionally files caught
errors against the selected project.
