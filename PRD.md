> **PRD** — drafted by Ada (Sr. Product Mgr) · task #467
> _Each agent that updates this PRD signs its change below._

# PRD: Fix Duplicate `padding` Property in TeamMemberAvatarFilter Component

## Problem & Goal

The Next.js production build fails with a TypeScript compilation error caused by a duplicate `padding` property defined twice within the same inline style object on the **'All' reset button** in `frontend/src/components/board/TeamMemberAvatarFilter.tsx`. TypeScript enforces that object literals cannot contain multiple properties with the same key. The goal is to remove the redundant `padding` declaration so the build compiles cleanly without altering any visual behaviour.

---

## Target Users / ICP Roles

| Role | Impact |
|---|---|
| **Frontend Engineers** | Blocked from shipping; need a green build to merge and deploy |
| **CI/CD Pipeline** | Build step fails on every run until resolved |
| **End Users** | Indirectly blocked from receiving updates while build is broken |

---

## Scope

Single-file, surgical fix limited to:

- **File:** `frontend/src/components/board/TeamMemberAvatarFilter.tsx`
- **Location:** Inline `style` object on the 'All' reset button (~line 154 – 168)
- **Change type:** Delete one duplicate `padding` key/value pair; no logic, layout, or styling changes permitted beyond eliminating the redundancy

---

## Functional Requirements

### FR-1 — Remove Duplicate Property
The inline style object on the 'All' reset button **must** contain exactly **one** `padding` property after the fix. The surviving entry must be `padding: 0` (matching the existing intended zero-padding style).

### FR-2 — No Visual Regression
The rendered appearance of the 'All' reset button must be pixel-identical before and after the change. No other CSS properties in the style object may be added, removed, or altered.

### FR-3 — No Collateral Changes
No other files, components, or logic may be modified as part of this fix. The diff must be a single net line deletion within the identified file.

### FR-4 — TypeScript Strict Compliance
After the fix, the file must parse without TypeScript errors related to duplicate object-literal keys (`TS2783` / "An object literal cannot have multiple properties with the same name").

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | `next build` completes with exit code `0` | Run `npm run build` (or `yarn build`) in `frontend/`; observe no errors |
| AC-2 | `tsc --noEmit` reports zero errors in `TeamMemberAvatarFilter.tsx` | Run TypeScript compiler check; confirm clean output |
| AC-3 | The style object on the 'All' button contains exactly one `padding` key | Code review / grep confirms single occurrence within the object literal |
| AC-4 | Visual snapshot / manual inspection shows no UI change to the 'All' button | Browser or Storybook side-by-side comparison |
| AC-5 | No other files are modified | `git diff --name-only` lists only `TeamMemberAvatarFilter.tsx` |

---

## Out of Scope

- Refactoring inline styles to CSS modules, Tailwind classes, or styled-components
- Fixing any other TypeScript errors in the codebase unrelated to this duplicate property
- Changing the button's padding value to anything other than `0`
- Adding or modifying unit tests (no test currently covers the inline style object)
- Upgrading TypeScript, ESLint, or any project dependency
- Any changes to sibling components or shared style utilities