# PRD 28 — Canvas: one composer, and the phone as a first-class canvas client

> **Status:** the redesign's CODE landed uncommitted in the working tree on 2026-09-15
> (frontend **2026.9.34**), and `DONE.md` already carries a ✅ RESOLVED entry for it. This PRD is
> the **remainder**: the verification gate that entry depends on, the phone behaviour that no test
> can currently see, the VS Code client that compiles the same source, and four decisions that were
> taken by the implementer and need ratifying or reversing.
> **Design of record:** https://claude.ai/artifact/DVvEQembQ4SREUN2wHBoD7 — five artboards
> (desktop Ideas surface, composer states, and three phone screens). The artboards are the visual
> spec; where this document and an artboard disagree, the artboard wins on pixels and this document
> wins on behaviour.
> **Governs:** the canvas half of [PRD 21 — The Unified Experience](./21-prd-unified-experience.md)
> on a phone, and the canvas surfaces in
> [PRD 17 — Creation Sessions and the Infinite Canvas](./17-prd-creation-canvas-sessions.md).

---

## 0. What the redesign asserts (the five rules the code must keep obeying)

These are not aspirations; they are the invariants any later change to the canvas must preserve.
They are stated here because the code that enforces them is spread across a registry, a component
and a stylesheet, and the next person to add a surface will otherwise re-introduce the defect.

1. **One composer per screen.** A surface never draws its own text input. It declares the VERBS it
   offers (`CanvasSurfaceDef.composerIntents`, `lib/canvasComposerIntents.ts`), and the one page
   composer draws them as a leading segmented control — only at two or more, because a single
   segment is a label wearing a control's chrome. `ideas` is `['captureIdea','ask']`; every other
   surface is `['ask']`.
2. **Brain never covers the surface uninvited.** Desktop: a docked rail. Phone: a bottom sheet the
   reader opens, with a veil that stops below the app bar and strip so leaving is always one tap.
   While the sheet is closed, unread replies are a COUNT on the launcher pill above the composer,
   never an auto-opened panel.
3. **On a phone the `+` in the composer row IS the command bar.** One sheet, the arc groups as
   captioned 44px tiles, every registry action present. No action is hidden, and nothing scrolls
   sideways to reach a command.
4. **`/create/<id>` on a phone is an app screen.** A 52px canvas app bar replaces the shell header
   on stage routes (`AppShell`, `data-phone-chrome="stage"`). The persistent `MobileBottomNav`
   (56px + safe area) STAYS, and every piece of canvas chrome sits above it.
5. **One breakpoint.** 767px, matching `--mobile-nav-height`, in both the stylesheet and
   `usePhoneViewport()`. The old 760/767 split gave 761–767px the bottom nav AND the desktop canvas.

---

## 1. THE GATE — verification the DONE.md entry is currently writing a cheque for

**This is the first work item and it blocks everything else in this document.** The implementing
agent could not obtain verification results before handing back, so the following have NEVER been
run against this change. Per the repo's model-role rule, a **Sonnet** agent runs all of these; the
implementer fixes what they surface.

| # | Command (from `Builderforce.ai/frontend`) | Why it is at risk here |
|---|---|---|
| 1.1 | the repo's typecheck script | ~190 lines of JSX moved across a new prop boundary; `CanvasBoardMenuBody` now owns `export type CanvasDockPanel` |
| 1.2 | `node scripts/check-react-hooks-ratchet.mjs --changed` then `--update` | **Known RED.** Seven hooks were removed from `CreationCanvas.tsx` and three added; the baseline still reads `92`. This ratchet **fails on an unrecorded improvement**, so the guard is red until the baseline is lowered. |
| 1.3 | `npm run check:architecture` | `CreationCanvas.tsx` fell 14659 → 14610 lines and nine client components were added; a baseline LOOSER than the tree also fails |
| 1.4 | `npm run check:i18n-keys` | 13 keys added, 6 removed, across five catalogs |
| 1.5 | `check:design-tokens`, `check:design-scale` | nine new components, all new CSS |
| 1.6 | the twelve affected vitest files | four test files were rewritten; `IdeaCaptureForm` and the `phone` action axis were deleted out from under their assertions |

**Acceptance:** every command green, with the old and new `CreationCanvas.tsx` ratchet numbers
recorded. **If anything is still red, the `## ✅ RESOLVED 2026-09-15` entry at the top of `DONE.md`
must move back into `ROADMAP.md`'s Consolidated Gap Register until it is not** — a resolved entry
for a red tree is exactly what the roadmap-hygiene rule exists to prevent.

---

## 2. The real gap: every phone arrangement in this redesign is invisible to the test suite

This is the substantial engineering left, and it is a pre-existing hole the redesign has now made
load-bearing.

`usePhoneViewport()` resolves through `useMediaQuery`, which returns **`false` in jsdom** (no
`matchMedia`, and `false` until mount by design). That is the honest answer for a test with no
viewport, and it means the desktop arrangement is the only one any current test can see. So:

- the app bar, the surface strip, the `+` actions sheet, the Brain bottom sheet, the veil, the
  unread pill, and the intent the composer arms when the sheet opens — **none of them render in a
  single test in the suite.**
- Two decisions are JavaScript rather than CSS precisely because `display:none` cannot change state
  (which host owns the board menu; which intent is armed). Those are the two most breakable things
  here and the two least observable.
- There is no phone-width test anywhere in the canvas tree today, and jsdom never applies a media
  query, so the CSS half is equally unobserved.

**Required:**

1. **A `matchMedia` stub** in the canvas test setup (or a small `renderAtPhoneWidth()` helper beside
   the existing test utilities) so `usePhoneViewport()` can be driven to `true`. It must be a shared
   helper, not a per-file mock, or the next phone test will invent a second one.
2. **Behavioural tests at phone width** covering, at minimum: the app bar renders with back/title/
   stage/roster/•••; exactly ONE board-menu sheet exists in the document; the `+` sheet lists every
   registry action grouped by the arc order; opening the Brain sheet arms the `ask` intent and
   closing it restores the surface default; the unread count appears only while the sheet is closed.
3. **Playwright, at 390×844 and at desktop, in BOTH themes** (`bf-theme`), because "tests pass" is
   not "it renders" — this codebase has shipped invisible text behind a green suite before. Extend
   `qa-e2e/tests/creation-canvas.spec.ts`, which today asserts only that `canvas-composer` is
   visible and covers none of the new behaviour.
4. **A 360px check.** The design was drawn at 390px; the repo's floor is 360.

---

## 3. The VS Code client compiles this same source and has not been rebuilt

`clients/vscode/webview/vite.config.ts` compiles `frontend/src/components/creation-canvas/**`, and
`clients/vscode/webview/src/WorkspaceApp.tsx` imports `CreationCanvas` directly. The extension is at
**2026.9.72** and has not been rebuilt against any of this.

Three specific risks, none of them speculative:

- **New imports must resolve in the VSIX bundle** — `usePhoneViewport` → `useMediaQuery`, and the
  thirteen new next-intl keys. The webview reads the frontend's catalogs through its own path.
- **`webview/tsconfig.json` IS in the extension's `type-check`** (`tsgo -p webview/tsconfig.json`
  and `tsc -p webview/tsconfig.json`), so a type error here fails the extension build even though it
  never reaches the frontend's own typecheck.
- **`hostOwnsSurface` must still close the composer.** The editor supplies `hostSurfaces.chat` and
  runs its turns in the extension host; if the intent work changed when the canvas composer stands
  down, the VSIX gets two inputs that start differently-behaving runs.

**Required:** rebuild the webview, run the extension's `type-check`, package the VSIX, install by
absolute path and verify with `--list-extensions`, and bump the extension version. Sonnet runs all
of it. The phone chrome itself is not expected to appear in the editor (the webview is routinely
narrower than 767px — **confirm this explicitly**, because a VS Code panel at 500px wide would now
get the phone app bar, which is almost certainly wrong for a docked editor panel and may need
`usePhoneViewport` to consider the HOST rather than the viewport alone).

---

## 4. Four decisions taken by the implementer that need ratifying or reversing

Each was a real fork in the road, each was decided defensibly, and each deserves an explicit yes.

1. **The phone's ••• board menu lives in the APP BAR, not in the `+` actions sheet.** The brief said
   both; doing both would put two doors onto one body on one screen. The artboard shows the sheet's
   Board section as four tiles, not the whole menu, so the implementer followed the artboard.
   `CanvasBoardMenuBody` is one body with two hosts (desktop bar •••, phone app bar •••), gated so
   only one mounts. **Recommend: ratify.**
2. **The command bar is NOT RENDERED below 767px** rather than `display:none`. A hidden-but-mounted
   bar would have let `useChromeSpace` measure a band from the top of the viewport instead of zero
   height, pushing the composer most of a screen upward, and would have put two ••• sheets and two
   invite panels in one document. A defensive `display:none` remains for the first frame before
   `usePhoneViewport` answers. **Recommend: ratify**, and cover the measurement with a test (§2).
3. **`canvasBarGroupCaption()` was not extracted.** The actions sheet renders the same
   `CanvasBarGroup` the bar does, so caption copy already resolves in one place; the brief's
   "extract if needed" condition was not met. **Recommend: ratify.**
4. **No release-notes row was authored.** This was treated as UX repair rather than a new
   capability, which is correct by the feature test — nothing here lets a user do something they
   could not do before. It is, however, a large and visible improvement to the most-used surface on
   a phone. **Open call for the operator:** a `category=improvement` row (not a marketing push) via
   `ReleaseNotesPanel` → `POST /api/release-notes`. No blog post either way.

### Recorded verdicts (2026-09-16)

1. **Ratified.** Phone ••• stays in the app bar. `CanvasBoardMenuBody` remains one body, two hosts,
   only one mounts. Covered by the phone-width CreationCanvas test (exactly one `canvas-board-menu`).
2. **Ratified.** Command bar is not rendered below 767px. The phone-width test asserts
   `canvas-command-bar` is absent from the document and `--canvas-command-bar-space` is not the
   desktop 66px default.
3. **Ratified.** No `canvasBarGroupCaption()` extract. The actions sheet already renders
   `CanvasBarGroup`.
4. **Ratified as no row.** UX repair, not a new capability. No `POST /api/release-notes` and no
   blog. An operator who later wants an in-app improvement chip can add one without reversing
   this PRD.

**Host vs viewport (closes the §3 open question):** `usePhoneViewport()` still reports the media
query. `CreationCanvas` ANDs it with `!hostSurfaces`, and the 767px stylesheet block is nested
under `.canvasShell:not([data-host='editor'])`. A 500px VS Code webview therefore keeps desktop
chrome. Extension bumped to **2026.9.73**.

---

## 5. Out of scope, deliberately

- **The other surfaces' own panels.** Only `ideas` ever drew a competing composer. `CanvasSiteSurface`'s
  URL field is a form field, not a prompt, and stays. Panels and inspectors mounted inside surfaces
  (email composer, publish, resume, scene generator) are editors, not composers, and are untouched.
- **The desktop left rail, the marketing header above 767px, and `MobileBottomNav` itself.** The
  nav's contents are the shell's business; this work only stops covering it.
- **Room / 3D station content**, which has its own open items in the Gap Register.

---

## 6. Acceptance for this PRD

The document is closed when: §1 is green and the `DONE.md` entry is honest; §2's phone tests exist
and run in CI, with a Playwright pass at 390px and desktop in both themes; §3's VSIX is rebuilt,
verified and version-bumped; and §4's four decisions each have a recorded yes or a reversal.

Until §1 is green, the Consolidated Gap Register — not `DONE.md` — is where this work lives.
