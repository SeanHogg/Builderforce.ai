# C2 — ICP Picker Frontend Design

**Ticket:** #2636  
**Role:** Architect Design  
**Date:** 2026-09-16  

## Architecture Decision

The ICP picker is a **section** (not a standalone numbered step) within the guided campaign intake flow (epic #2547). It is always skippable; the primary CTA is the intake's existing Continue — never "Select ICP."

```
Guided Campaign Intake
  Context (brand/ws) → Checklist → Connect → [ICP Picker section] → Draft Copy → ... → Send (C3)
```

## Component Tree

```
IcpPickerSection  (states: loading | empty | list | error | selected-summary)
├─ Badge/label: "ICP (optional)"
├─ Helper text: "Attach an Ideal Customer Profile — optional, does not block draft or send."
│
├─ [loading]  IcpSkeleton
├─ [empty]    IcpEmptyState
├─ [error]    IcpErrorState
│
├─ [list]     IcpList
│   ├─ IcpRow (name, short description, updatedAt) — single-select
│   ├─ "Clear selection" link
│   └─ "Create ICP" button → CreateIcpModal
│
├─ [selected-summary]  IcpSummary (later steps)
│   ├─ Name + short description
│   ├─ "Change" → reopens picker
│   └─ "Clear" → clears selection
│
└─ CreateIcpModal (in-flow, never abandons intake)
    ├─ Prefilled fields from brandKit / workspace profile (editable)
    ├─ Submit → POST ri_icps
    ├─ Error → inline, retry, modal stays
    └─ Cancel → prior selection unchanged
```

## Field Binding (C1 contract)

| UI action | `intake.icp` value |
|-----------|-------------------|
| No selection, skipped, cleared | **omitted** or **`null`** |
| Row selected | `string` — ICP id |
| Created in-flow | `string` — new ICP id |
| Selected id deleted/404 | cleared (omit/null); non-blocking notice |

**Never:** `""`, `0`, `"none"`, `"pending"`, placeholder UUID, or any synthetic id.

## Prefill Mapping (brandKit → ICP form)

| Source | Field | ICP form field |
|--------|-------|---------------|
| brandKit | audience / whoWeServe / targetAudience | audience |
| brandKit | industry / vertical | industry |
| workspace profile | industry / vertical | industry (fallback) |
| workspace profile | companySize / size | companySize |
| workspace profile | geography / region / country | geography |
| brandKit | valueProposition / offer | valueProposition |
| brandKit | tone / voice / brandVoice | tone |

Prefill is assistive only. Empty sources → empty form. Never auto-create or auto-select.

## State Machine

```
MOUNT → fetch ri_icps
  LOADING → success → EMPTY or LIST
  LOADING → error → ERROR (retry enabled, Continue enabled)
  LIST → select → SELECTED (intake.icp = id)
  SELECTED → clear → LIST (field cleared)
  SELECTED → create (modal) → success → SELECTED (new id)
                              → failure → inline error, modal stays
                              → cancel → SELECTED unchanged
  Any state → detected-deleted → clear + non-blocking notice → LIST or EMPTY
```

**Invariant (P8):** Continue, Save draft, Generate, and Send are **never disabled** due to ICP absence, error, empty list, or cleared selection.

## Session Persistence

Selection stored on C1 intake state only (`intake.icp`). No new store. On mount: verify persisted id exists in fetched list. If missing → clear (R-6). If present → restore.

## Later-Step Summary

When a selection exists on later intake steps:
```
ICP: "SMB SaaS Founders"
Early-stage B2B SaaS founders, 1-50 employees
[Change]  [Clear]
```
When none selected: show nothing (absence is normal).

## Files

| File | Change |
|------|--------|
| `frontend/src/components/guidedCampaign/IcpPickerSection.tsx` | New |
| `frontend/src/components/guidedCampaign/IcpList.tsx` | New |
| `frontend/src/components/guidedCampaign/IcpRow.tsx` | New |
| `frontend/src/components/guidedCampaign/CreateIcpModal.tsx` | New |
| `frontend/src/components/guidedCampaign/IcpSummary.tsx` | New |
| `frontend/src/components/guidedCampaign/IcpEmptyState.tsx` | New |
| `frontend/src/components/guidedCampaign/IcpErrorState.tsx` | New |
| `frontend/src/components/guidedCampaign/IcpSkeleton.tsx` | New |
| `frontend/src/lib/icpService.ts` | New |
| `frontend/src/lib/canvasMarketing.ts` | Modify (read/write intake.icp) |
| `packages/creation-canvas-contract/src/guidedCampaign.ts` | Verify (C1 home) |

## Integration

- **`ri_icps` API:** Existing list (GET) and create (POST). No new routes/columns/permissions.
- **C1 intake state:** `canvasMarketing.ts` adapter. Read/write `intake.icp` through existing channel.
- **brandKit / workspace profile:** Read from intake session context. Prefill create form.
- **Growth send:** No change. `intake.icp` pass-through only when set.
- **C3 (#2638):** Unchanged. Remains the human-confirm send gate.