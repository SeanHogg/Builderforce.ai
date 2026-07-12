> **PRD** — drafted by Ada (Sr. Product Mgr) · task #469
> _Each agent that updates this PRD signs its change below._

# PRD: Fix Duplicate `padding` Key in `TeamMemberAvatarFilter.tsx`

## Problem & Goal

A style object in `TeamMemberAvatarFilter.tsx` declares the `padding` property twice within the same object literal:

```ts
padding: '0 12px',
// ... other keys ...
padding: 0,
```

TypeScript (enforced during the Next.js type-check / build step) rejects duplicate keys in object literals with the error:

> **An object literal cannot have multiple properties with the same name.**

The build is currently broken. The goal is to remove the duplicate `padding` declaration so the build passes with no regressions to the visual appearance of the "All" chip.

---

## Target Users / ICP Roles

| Role | Interest |
|---|---|
| Frontend Engineers | Unblocked local dev and CI builds |
| CI/CD Pipeline | Green build required before any deploy |
| QA / Design | "All" chip renders correctly post-fix |

---

## Scope

Single file change in the frontend codebase:

```
components/TeamMemberAvatarFilter.tsx   (or equivalent path)
```

---

## Functional Requirements

### FR-1 — Remove the Duplicate Key
Exactly one `padding` declaration must remain in the style object that styles the "All" chip. The surviving value must correctly reproduce the intended spacing.

### FR-2 — Preserve Intended Visual Behaviour
The "All" chip must retain horizontal padding of `12px` on each side and `0` vertical padding, matching the design intent expressed by `padding: '0 12px'`. If the later `padding: 0` was meant to override or serve a different purpose (e.g., reset on a nested element), it must be moved to its own separate, correctly scoped style object instead of being deleted silently.

### FR-3 — Build Must Pass
Running the Next.js type-check (`next build` / `tsc --noEmit`) must complete without TypeScript errors related to this file.

### FR-4 — No Other Style Regressions
No other properties in the same style object may be altered, removed, or reordered as a side-effect of this fix.

### FR-5 — Lint Clean
The file must pass the project's ESLint rules after the change (no new warnings or errors introduced).

---

## Acceptance Criteria

| # | Criterion | How Verified |
|---|---|---|
| AC-1 | `TeamMemberAvatarFilter.tsx` contains exactly **one** `padding` key in the "All" chip style object | Code review / `grep` |
| AC-2 | The retained value is `'0 12px'` (or an equivalent longhand achieving the same box model) | Code review |
| AC-3 | `next build` or `tsc --noEmit` exits with code `0` | CI log |
| AC-4 | ESLint exits with code `0` for the changed file | CI log |
| AC-5 | Visual snapshot / manual QA shows the "All" chip unchanged in appearance | QA sign-off or snapshot diff |
| AC-6 | No other files are modified | `git diff --name-only` |

---

## Out of Scope

- Refactoring or renaming any other style objects in the file
- Migrating styles to CSS Modules, Tailwind, or any other styling system
- Changing the behaviour or layout of any chip other than "All"
- Updating tests unrelated to this bug
- Any changes to backend code or API contracts