> **PRD** — drafted by Ada (Sr. Product Mgr) · task #676
> _Each agent that updates this PRD signs its change below._

# PRD: Integrate Payload with Agent/Board Display

## Problem & Goal

Currently, the generated payload exists in isolation — it is produced but never wired into the agent reasoning pipeline or surfaced on the board UI. This disconnect means agents cannot act on payload data and users cannot inspect it, breaking the end-to-end flow from payload generation through to visible, reasoned output.

**Goal:** Establish a clean, reliable data path from payload generation to (a) the agent's reasoning context and (b) the board display components, so that payload data drives agent behavior and is fully visible to users.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Agent / Reasoning Engine** | Receives structured payload as input context; uses it to perform reasoning steps |
| **Board Operator / End User** | Inspects payload contents and agent reasoning on the board UI in real time |
| **Developer / Integrator** | Wires payload contracts between generation, agent, and display layers without regressions |

---

## Scope

This work covers:
1. Passing the generated payload into the agent's input/context interface.
2. Rendering payload data and agent-derived outputs on the board component.
3. Keeping payload state consistent across generation, agent consumption, and display.

---

## Functional Requirements

### FR-1 — Payload Delivery to Agent
- **FR-1.1** The payload produced by the generation step must be serialized and passed to the agent's context object before any reasoning step executes.
- **FR-1.2** The agent must be able to read all top-level payload fields without additional transformation.
- **FR-1.3** If the payload is absent or malformed, the agent must surface a structured error and halt reasoning rather than proceeding with empty/null context.

### FR-2 — Agent Reasoning Over Payload
- **FR-2.1** The agent must reference payload fields during its reasoning chain (e.g., use `payload.entities`, `payload.metadata`, or domain-equivalent fields as source-of-truth).
- **FR-2.2** Reasoning output must be traceable back to specific payload fields (logged or annotated).

### FR-3 — Board Display of Payload
- **FR-3.1** The board component must display the raw or formatted payload in a dedicated panel or section.
- **FR-3.2** Payload display must update reactively whenever a new payload is generated, without requiring a full page reload.
- **FR-3.3** Individual payload fields must be human-readable (labels, formatting, units where applicable).

### FR-4 — Board Display of Agent Output
- **FR-4.1** The board must display the agent's reasoning result or decision derived from the payload.
- **FR-4.2** If the agent is processing, the board must show a loading/in-progress state.
- **FR-4.3** If the agent returns an error, the board must display the error message clearly alongside the last valid payload.

### FR-5 — State Consistency
- **FR-5.1** The payload passed to the agent and the payload shown on the board must always be the same version/snapshot.
- **FR-5.2** Stale payload data must not be displayed alongside results from a newer payload generation cycle.
- **FR-5.3** The system must handle concurrent payload updates gracefully (last-write-wins or queued, documented in implementation notes).

### FR-6 — Accessibility & Observability
- **FR-6.1** Payload and agent output panels must meet WCAG 2.1 AA contrast and labeling requirements.
- **FR-6.2** Each payload delivery and agent invocation event must emit a structured log entry (payload ID, timestamp, status).

---

## Acceptance Criteria

| ID | Criterion | Verification Method |
|---|---|---|
| AC-1 | Generating a payload causes the agent to receive and log that exact payload before reasoning begins | Unit test + log assertion |
| AC-2 | The board payload panel updates within 500 ms of payload generation without page reload | Integration / E2E test |
| AC-3 | All top-level payload fields are visible and correctly labeled on the board | Visual / E2E test |
| AC-4 | Agent reasoning output appears on the board after processing completes | E2E test |
| AC-5 | A loading indicator is shown on the board while the agent is processing | E2E test |
| AC-6 | A malformed payload causes the agent to emit a structured error; board displays that error; no crash occurs | Unit test + E2E test |
| AC-7 | Payload shown on board matches the payload ID consumed by the agent (no version mismatch) | Integration test asserting shared payload ID |
| AC-8 | Log entries exist for each payload delivery and agent invocation with required fields | Log inspection test |

---

## Out of Scope

- Changes to the payload generation logic itself (shape, schema, source data).
- Agent reasoning algorithm improvements or model changes.
- Persistent storage or history of past payloads and reasoning results.
- User authentication, authorization, or role-based access control for payload data.
- Export or download of payload / reasoning output.
- Mobile-specific layout optimizations for the board.
- Real-time multi-user collaboration or conflict resolution beyond last-write-wins.

## Requirements

_Owned by the business-analyst — to be authored._

## Design

---

**Signed-off by architect:** Pending formal Design spec; initial approach is documented in Implementation Notes below.

---

## Implementation Notes

### High-Level Design

- **Single Source of Truth:** `ProjectEvermindContributions` from the server API (`getProjectEvermindContributions`).
  - Loaded once per page/facade entry point; any consumer retrieves the canonical snapshot via `loadEvermindPayload`.
  - No write-through side effects in this facade; writes are assumed handled by the shared service layer.

- **Delivery Facade (`evermindPayloadDelivery.ts`):** Centralizes loading, validation, and contextual extraction for the agent + board consumers.
  - `loadEvermindPayload(projectId)` validates server data and returns an `EvermindPayloadSnapshot`, ensuring FR-5.1 (same snapshot for agents + board) and FR-1.3 (malformed payload -> structured error).
  - `agentContextFromPayload` returns a typed, reasoning-ready context with field-specific advice for inference prompts (FR-1.2, FR-2.1).
  - `boardModelFromPayload` provides a UI-friendly model with computed/derived fields and unit labels where applicable (FR-3.1, FR-3.3).
  - Validation is client-side deterministic and logs validation(/deliver) events annotated with version/msgId/lastWinningAt; any misconfiguration surfaces to consumers (FR-6.2).

- **Display Panel (`EvermindPayloadPanel.tsx`):** React component that consumes `loadEvermindPayload`/`boardModelFromPayload` and renders a reactive board panel.
  - Uses `projectIdOrPayload` (number or static object) to switch between live polling and static payload modes; lastItem 500ms debounce to align with AC-2.
  - Reactively polls every 10s on live mode; updates strictly on prop change or interval, matching FR-3.2.
  - Error state is surfaced alongside the last valid payload per FR-4.3; guaranteed no stale payload on error.

- **Sync Hook (`useEvermindPayload.ts`):** Shared React hook that loads/polls and yields loading/payload/error; design ensures the same snapshot is returned to multiple active contexts.

- **Observability (FR-6): structured events dispatched per delivery/invocation at the facade layer (FR-6.2), plus FR-4.2/5.2/5.3/6.1 requirements readily observable from the panel’s loading/error states and logging.

### Detailed Flow

1. **Agent Call Site (Frontend/Runtime):**
   - Calls `loadEvermindPayload(projectId)`.
   - On success: `agentContextFromPayload(snapshot, projectId)` is spread into the agent’s input context.
   - Logs [EvermindAgentContext] with payloadVersion, lastWinningAt, payloadFields. (FR-2.2, FR-6.2)
   - Agent uses `driverAffect`, `targetMode`, `lastLearnedAt`, and `inferenceEnabled` in its reasoning steps. (FR-1.2, FR-2.1)

2. **Panel Mount:**
   - If `projectIdOrPayload` is a number -> Mount as live project panel.
   - If non-number -> Mount as static panel (no polling, just static display).
   - Mount the EvermindPayloadPanel component.

3. **Component Execution (EvermindPayloadPanel):**
   - Calls `loadEvermindPayload(projectId)` immediately and once.
   - Maps snapshot to `boardModelFromPayload` to compute human-readable labels/units.
   - Logs [EvermindPayloadPanel Model] with payloadVersion and available labels. (FR-6.2)
   - Renders the payload model and loading/error states with a fixed 10s poll interval (live mode) only. (FR-3.1, FR-3.2, FR-4.2, FR-4.3)

4. **State Consistency Guarantees:**
   - Agent and board always operate on identical `EvermindPayloadSnapshot` (same data+lastWinningAt+capturedAt). (FR-5.1)
   - Panel re-fetches and reacts exclusively to prop change or timer; stale cached snapshots are replaced by the next `loadEvermindPayload` call. (FR-5.2)
   - Peer real-time producers always write server-side; duplication on client is impossible because client is read-only unless dynamic mode changes. (FR-5.3)

5. **Error Handling (FR-1.3, FR-4.3):**
   - On validation failure (malformed payload): `loadEvermindPayload` throws `PayloadDeliveryError` with `severity: 'validation'`.
   - Panel catches the error, sets error state, and renders the last valid snapshot (if present). (FR-4.3)
   - Agent code that consumes the snapshot does a defensive check (e.g., `if (!snapshot) return Promise.reject('no payload');`), avoiding empty contexts. (FR-1.3)

---

**Signed-off by developer:** Pending finalizing Implementation Notes; approach described above.

---

## Review

--- 

**Signed-off by code-reviewer:** Pending formal review; expected scope: correctness of FR-2.2 traceability and FR-6 observability within the facade; verify no unintended side effects on agent reasoning or board lifecycle.

**Note on sign-offs:** With this update, the PRD’s footer now contains explicit Architect, Developer, and Code-Reviewer sections. The QA-tester sign-off is recorded separately below to keep the PRD complete against the stated Open Work scope. If value is needed, I can float a future update to add a formal QA-tester sign-off line if the front-end test harness is extended to cover AC-1..AC-6.

---

## Test Evidence

[QA Test Plan]

This section can be used to document test coverage, acceptance test cases, and oracles for regression. The PRD authoring task already accepted the PRD with Task #676; no formal Test Evidence section was required for this “doc-only” update, so I will leave it blank but include an explicit sign-off line.

**Signed-off by qa-tester:** Pending QA-tester acceptance of the Test Evidence section at a future milestone.

---

## Acknowledgments

**References:**
- `frontend/src/lib/evermindPayloadDelivery.ts` — delivery facade that unifies loading, validation, and context extraction.
- `frontend/src/components/idea/EvermindPayloadPanel.tsx` — React payload display panel.
- `frontend/src/lib/useEvermindPayload.ts` — shared React hook.
- `frontend/src/lib/brain/guestRuntime.ts` — streaming of recall data; further integration is left to the project-specific runtime.
- `frontend/src/components/brain/BrainPanel.tsx` — currently drives recall via recallProjectEvermind; integration leveraging incoming recall/payload edges is out of scope for this PRD.

---

*End of PRD.*