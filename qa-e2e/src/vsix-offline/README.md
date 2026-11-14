# VSIX packaged offline acceptance — PRD 41 §A6 (WS13)

The gate for claiming **offline** in release notes (PRD 41
`docs/specs/41-prd-offline-understanding-and-run-delta.md` §A6): the shipped
`.vsix`, installed into a real VS Code, with **all network egress denied**, must

1. complete the **L0–L3** codebase scan — a deterministic projection, **no key**,
2. **render the knowledge graph** from that local projection,
3. run **one agent on a local model** to completion, and
4. emit a **run delta** card,

…with **zero requests** reaching any BuilderForce origin or npm. Every attempt
is counted by the shipped host fetch guard (`platformPolicy.ts`) **and** an
OS-level socket counter (`egress.ts`).

This is an e2e acceptance harness, not a unit test. It drives the packaged
extension through its real surfaces (commands, contributed views, on-disk
artifacts) rather than a test-owned network boundary.

## Run

```bash
# Fast local run — ~40-file fixture, 4 languages (A6 step 2 scaled down)
pnpm a6:offline -- --small

# Full A6 step 2 — ~2,000 files in 4 languages
pnpm a6:offline
```

Prerequisites (done **with the network up**, before the denied instance launches):

- A cached VS Code under `clients/vscode/.vscode-test/` — run
  `pnpm test:integration` in `clients/vscode` once so `@vscode/test-electron`
  downloads the binary.
- The VSIX is built by the scenario itself (`clients/vscode` `package` script).

## Egress denial (the "socket counter")

Two layers, per the G27 packaged-acceptance design
(`docs/design/local-first-closure-g03-g21-g23-g27.md`):

- a **loopback CONNECT recorder** the whole instance is pointed at with
  Electron's `--proxy-server` flag: every attempted egress is logged and the
  socket is destroyed (fail closed);
- where the OS allows it, a real denial **in front of** that:
  - Linux — `unshare --user --net --mount` with a temp hosts file mapping every
    platform/npm host to the recorder, so raw Node `fetch` (which ignores the
    proxy flag) is counted too; an in-namespace helper binds 80/443.
  - Windows — a `netsh advfirewall` outbound block rule scoped to the Code
    executable.
  - Neither available — the fail-closed recorder alone (mode `proxy-only`),
    which still denies and counts.

The assertion is **allow-list** style: VS Code's own update/telemetry/gallery
traffic is ignored; **any** recorded attempt at a BuilderForce origin or npm is
a hard failure of A6 step 5.

## Machine-readable skips

Stages the environment cannot run are reported as skipped with a reason, never
as failures:

| Stage                 | Skip reason        | How to enable                                            |
|-----------------------|--------------------|----------------------------------------------------------|
| agent run + run delta | `no-local-model`   | Set `BF_A6_LOCAL_MODEL` (or `OLLAMA_HOST`) to a reachable local inference endpoint, e.g. `http://127.0.0.1:11434`. |

The scan, graph and egress-denial stages always run and are the A6 gate; the
agent run is additionally gated on a local model being present.

## Signed out

The scenario uses fresh `--user-data-dir` and `--extensions-dir`, so the
install has no persisted secret — that **is** the "signed out" state (A6 step
1). It asserts no BuilderForce secret exists before it starts.
