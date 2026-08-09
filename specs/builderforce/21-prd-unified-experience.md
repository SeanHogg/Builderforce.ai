# PRD 21 — The Unified Experience: one design system, one canvas shell, and the 549 destinations that never become pages

> **Status:** shell BUILT (E0–E6) · 2026-08-08 — **residuals closed 2026-08-09**: literal-hex files
> 341 → **0** (the ratchet is now an allowlist, not a count) and the panel body is a named size
> container. Nothing outstanding in the Gap Register's design-system block.
> **§11 (the unified MENU — what is in it, what it is called, where it sits): M0, M1, M2 and the
> IA halves of M3/M4 are BUILT, 2026-08-09.** Seven registries became one; the left panel renders
> the Idea → Make → Run arc with collapsible headers; `burnrateCatalog.ts` and the `seat` and
> `dashboard` rows are deleted; the reference pages open as panels; the marketplace has four
> families with a derived publish CTA; `/features` is a registry projection in the ported band
> rhythm; `check:destinations` is wired into `npm test`. What remains is named in §11.11.
> **Consolidates:** [PRD 19 — BurnRateOS consolidation](./19-prd-burnrateos-consolidation.md) ·
> [PRD 20 — The Consolidated Data Model](./20-prd-consolidated-data-model.md)
> **Supersedes for experience decisions:** the navigation architecture "The Session Is The Anchor"
> (v3), whose nine-door rail this PRD **reverses** — see §4.
> **Basis chosen by the operator, 2026-08-08:** palette **Deep Space**, typography **All Sans**.

---

## 0 · The rule

**The canvas is the product. Everything else is a panel over it.**

After sign-in a person lands on the board they last worked on and never leaves it. The left panel
lists their **sessions**. The footer holds their **team** — the always-on C-suite agents beside the
humans they invited — and dragging a teammate onto the board is how it joins the session. Every
other destination opens as a **slide-in panel over a board that stays mounted**. Only marketing,
docs and auth remain pages.

Two corollaries that decide most arguments downstream:

1. **A route may change what is on screen. It may never unmount the stage.** Presence, camera,
   screen share and an in-flight agent turn all belong to the session, and the session outlives
   every navigation.
2. **A seat is a teammate, not a menu.** PRD 20 already assigns every bounded context an owner.
   That owner is a person-shaped thing in the footer, not a nav item in a rail.
3. **An authoring runtime is a Canvas mode, not a destination.** Video, audio, image, document,
   animation, game, comic and CAD editors replace the body of the already-mounted Canvas according
   to the active object's kind. “Studio” is hired.video source provenance only. In particular,
   prompt-to-video, screen/camera capture, timeline editing, music/voice/SFX mixing, preview and
   export are one continuous Canvas workflow over one editable object; none opens a separate area.

---

## 1 · Why this PRD exists

PRD 19 and PRD 20 each solve half of a problem whose other half is the experience, and neither
owns it:

| | PRD 19 | PRD 20 | **PRD 21** |
|---|---|---|---|
| **Answers** | What arrives, and who owns each contested capability | What the data is, once deduplicated | **Where any of it appears, and to whom** |
| **Unit** | A track (B0–B9) | A domain (15) + kernel (25 tables) | A **panel**, a **teammate**, a **session** |
| **Scale fact** | 328 API modules + 471 pages arrive on top of 78 surveyed routes | 1,206 → **387** tables | **549 destinations, 0 of them pages** |
| **Organised by** | C-suite seat (B1 CFO, B2 CEO, B3 CRO, …) | C-suite seat (owner column, §3) | C-suite seat (**the footer roster**) |

The last row is the reason these consolidate rather than merely relate. **All three are already
organised by the same list of seats.** PRD 20 §3 says so outright — *"the navigation design argues
the team panel* is *the navigation because ownership already exists in the data; this section is
that claim in schema form."* PRD 21 is the other end of that sentence: it makes the seat a
teammate, the domain a panel, and the merge invisible to the person using it.

Without this PRD, PRD 19's 471 pages land as 471 **pages**, and the product that sells "one
continuous session" ships a shell that destroys the session on every click.

### What this PRD takes over

- **From PRD 19:** the *experience* half of every track. Tracks keep their data and API scope; how
  their surfaces appear is decided here, once, instead of nine times.
- **From PRD 20:** §7 (the experience layer). The data model, the kernel and the 15 domains are
  unchanged and remain PRD 20's.
- **Nothing else moves.** PRD 19's §2 ownership register and PRD 20's §3 roster stay authoritative
  where they are; this PRD cites them and must never restate them.

---

## 2 · The design system

> **This section is the implementable reference.** An agent should be able to build a compliant
> surface from §2 alone, without reading `globals.css`. Where a value appears here and in
> `globals.css`, **`globals.css` wins** — it is the runtime source of truth and this is its
> documentation. If they disagree, that is a bug in this document; fix it here.

### 2.0 Where everything lives

| What | Path |
|---|---|
| All tokens, both themes | `frontend/src/app/globals.css` (`:root` = dark, `html[data-theme='light']` = light) |
| React primitives | `frontend/src/components/ui/` — `Button` · `Surface` · `Badge` · `Field` · `PageHeader` · `EmptyState` |
| Primitive CSS | `globals.css`, `.ui-*` classes |
| Token guard | `frontend/scripts/check-design-tokens.mjs` → `npm run check:design-tokens` |
| Tailwind bridge | `frontend/tailwind.config.js` — the `gray-*` ramp is **remapped to theme tokens** |
| Locale catalogs | `frontend/src/i18n/messages/{en,zh,es,fr,de}.json` |
| Panel primitive | `frontend/src/components/SlideOutPanel.tsx` (`width: 'sheet' \| 'wide' \| 'full'`, `crumb`, `index`); its body is `.ui-panel-body`, the `panel` size container (§3.4) |
| Board's own palette | `frontend/src/components/creation-canvas/CreationCanvas.module.css` (`--canvas-*`, both themes) · author-picked colour: `creation-canvas/authoredColors.ts` |
| Panel host over the board | `frontend/src/components/shell/ShellPanel.tsx` |
| THE index (replaced three tab bars) | `frontend/src/components/shell/DestinationIndex.tsx` · route-driven wrapper `shell/ShellIndex.tsx` |
| The footer roster | `frontend/src/components/team/TeamBar.tsx` · client read `lib/team/useTeamRoster.ts` |
| Join-a-session payload (drag **and** keyboard) | `frontend/src/lib/team/teammate.ts` |
| Left-panel sessions | `frontend/src/components/SessionList.tsx` |
| Roster read model (api) | `api/src/application/kernel/TeamRoster.ts` → `GET /api/roster/team` |
| Panel / stage policy | `frontend/src/lib/workbenchPolicy.ts` (`panelOpen`, `panelWidth`) |
| Scale ratchets | `frontend/scripts/check-design-scale.mjs` → `npm run check:design-scale` |
| Nav data | `frontend/src/lib/navGroups.ts` |

### 2.1 ⚠ Three naming traps that will burn an agent

1. **`--coral-*` is the brand BLUE.** The name is historical. `--coral-bright` is `#4d9eff` in dark
   and `#1d4ed8` in light. There is no coral in the brand. Do not "fix" a blue you find behind a
   coral-named token.
2. **`--cyan-bright` is the SECONDARY signal**, `#00e5cc` dark / `#0284c7` light. It is not an
   accent you may reach for freely; it marks the second thing, not any thing.
3. **`gray-*` Tailwind classes are remapped.** `bg-gray-900` resolves to `var(--bg-surface)`, so it
   already flips per theme. Never add `dark:` variants to a `gray-*` class — you will double-flip it.

### 2.2 Colour tokens — the complete set

**Grounds — a real three-step elevation scale in both themes.**

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg-deep` | `#050810` | `#f4f1ec` | Page ground |
| `--bg-surface` | `#0a0f1a` | `#fdfcfa` | Panels, the board |
| `--bg-elevated` | `#111827` | `#ffffff` | Cards, inputs, anything on a panel |
| `--surface-sunken` | `rgba(0,0,0,.16)` | `rgba(60,48,36,.045)` | Wells, chrome bands, inset rows |

**Translucent surfaces — the family the marketing pages actually paint with.** The three grounds
above are opaque. Every card on `/`, `/product`, `/pricing`, `/soc2`, `/evermind`, `/compare` and
the `RouteMarketing` teaser is instead `--surface-card`, and an agent building "from §2 alone"
would have reached for `--bg-elevated` and produced a surface that does not match a single
neighbour. Documented here because the omission, not the code, was the bug.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--surface-card` | `rgba(10,15,26,.65)` | `rgba(255,255,255,.9)` | **The default card.** Translucent over the page ground |
| `--surface-card-strong` | `rgba(10,15,26,.85)` | `rgba(255,255,255,.97)` | A card that must stay readable over imagery |
| `--surface-interactive` | `rgba(255,255,255,.08)` | `rgba(60,48,36,.07)` | Chips, ghost buttons, hoverable rows |
| `--surface-interactive-hover` | `rgba(255,255,255,.14)` | `rgba(60,48,36,.13)` | Their hover state |
| `--surface-overlay` | `rgba(0,0,0,.3)` | `rgba(60,48,36,.1)` | Scrims behind a panel |
| `--surface-coral-soft` / `--surface-cyan-soft` | — | — | Tinted wells for the brand and secondary signals |

`--surface-page`, `--surface-panel`, `--surface-raised` and `--surface` are **aliases** of
`--bg-deep` / `--bg-surface` / `--bg-elevated` / `--bg-elevated`. Prefer the `--bg-*` name; the
aliases exist so older call sites keep resolving.

**Ink.**

| Token | Dark | Light | Use |
|---|---|---|---|
| `--text-primary` | `#f0f4ff` | `#1c1917` | Body, headings |
| `--text-secondary` | `#8892b0` | `#4f463d` | Supporting copy |
| `--text-muted` | `#5a6480` | `#736961` | Metadata, placeholders, disabled |
| `--text-on-accent` | `#fff` | `#fff` | Text on an accent fill |

**Rules.** `--border-subtle` (`rgba(136,146,176,.15)` / `rgba(60,48,36,.14)`) ·
`--border-strong` (`rgba(136,146,176,.28)` / `rgba(60,48,36,.24)`) ·
`--border-accent` (`rgba(77,158,255,.3)` / `rgba(29,78,216,.32)`).

**Signals.** Each has `-text`, `-bg` and `-border` companions. `--danger-*` **aliases** `--error-*`
— one hue, defined once.

| Family | Dark | Light | Means |
|---|---|---|---|
| `--error` / `--danger` | `#f87171` | `#b91c1c` | Failure, destructive |
| `--success` | `#22c55e` | `#15803d` | Done, healthy |
| `--warning` | `#f59e0b` | `#b45309` | Blocked, needs attention |
| `--info` | `#60a5fa` | `#1d4ed8` | Neutral notice |

**Categorical hues** — for chart series, speaker tiles, run-source badges. Distinct from each other
*and* from the brand. Never hardcode: they flip per theme like everything else.
`--violet-bright` `#a78bfa`/`#6d28d9` · `--indigo-bright` `#7c83fd`/`#4338ca` ·
`--emerald-bright` `#34d399`/`#047857` · `--amber-bright` `#fbbf24`/`#b45309` ·
`--red-bright` `#ff6b6b`/`#b91c1c` · `--teal-bright` `#14b8a6`/`#0f766e` ·
`--pink-bright` `#ec4899`/`#be185d` · `--purple-bright` `#8b5cf6`/`#7e22ce` ·
`--sky-bright` `#38bdf8`/`#0369a1` · `--yellow-bright` `#eab308`/`#a16207` ·
`--orange-bright` `#f97316`/`#c2410c`. Eleven, because the shared `CHART_PALETTE` needs ten and the
first five ran out at series six — which is why it carried raw literals until 2026-08-09.

**Ink on a computed fill.** Two more, for the surfaces whose fill is decided at runtime rather than
by the theme. `--ink-on-light` (`#16241c`, both themes) is for a surface that is light in BOTH — a
DevEx score chip is an HSL ramp at 68–88% lightness, so it is pale on slate as much as on paper.
`--ink-on-categorical` (`#0b1220` dark / `#ffffff` light) is the label printed ON a categorical
fill: the whole `*-bright` family is pale on slate and deep on paper, so that is one relationship
and one token — a chart segment cannot measure a fill that is a `var()`, and does not need to.

**Severity.** `--error-strong` (`#fb7185`/`#7f1d1d`) is the rung above `--error`. A fatal is not
"very error"; a swatch you cannot tell from the one below it is not carrying information.

**Two families that are identities rather than palette.** `--ev-*` (Evermind's brain regions) and
`--canvas-obj-*` (Canvas object kinds) are declared in `globals.css` for both themes, because more
than one surface reads each of them. Each existed as two or three drifting copies before that.

**Elevation.** Dark builds depth from **matte darkness**; light builds it from **warm neutral
shade**. `--shadow-xs` · `--shadow-sm` · `--shadow-lg`. **Accent-coloured shadow is a dark-mode
mechanic only — never use it as elevation in light.**

**Focus.** `--focus-color` (`#60a5fa` / `#0f766e`), `--focus-ring`
(`0 0 0 3px rgba(...,.28)`). Every interactive element shows it. Removing focus without an
equivalent visible treatment fails review.

### 2.3 Typography — All Sans

One family. Mono is reserved, never decorative. **No serif anywhere.**

```
--font-sans / --font-display / --font-body   ui-sans-serif, -apple-system, BlinkMacSystemFont,
                                             "Segoe UI", Roboto, Helvetica, Arial, sans-serif
--font-mono                                  'SF Mono', 'Fira Code', 'JetBrains Mono', monospace
```

| Role | Size | Weight | Tracking | Line height |
|---|---|---|---|---|
| Hero | `clamp(2.6rem, 7.4vw, 5.1rem)` | 800 | `-.045em` | `.95` |
| Page title | `clamp(1.85rem, 4.4vw, 2.9rem)` | 700 | `-.033em` | `1.02` |
| Section | `clamp(1.25rem, 2.6vw, 1.62rem)` | 700 | `-.022em` | `1.15` |
| Card title | `1rem` | 650 | `-.006em` | `1.3` |
| Body | `.95rem` | 400 | — | `1.6` |
| Small / meta | `.82rem` | 400 | — | `1.5` |
| **Eyebrow** (mono) | `.68rem` | 600 | `.15em`, uppercase | — |
| **Field label** (mono) | `.62rem` | 600 | `.12em`, uppercase | — |

**Mono is for:** eyebrows, field labels, IDs, paths, counts and anything in a numeric column
(pair with `font-variant-numeric: tabular-nums`). **Mono is not for:** body copy, headings, buttons.

> ⚠ **This table is the one part of §2 an agent cannot build from.** Measured 2026-08-09 across the
> public surface: **the eight roles above have no implementation.** There is no `--font-size-*`
> token in `globals.css`, and only one role — Eyebrow, as `.ui-eyebrow` — exists as a class. There
> is nothing to import, so every author types a number, and the public pages carry **89 distinct
> font-size literals** and **129 distinct `clamp()` ramps**. Contrast §2.4: radius has five values,
> a class of tokens, and a ratchet — and comes in at 9 off-scale corners.
>
> Worse than absent, the three role-shaped classes that *do* exist each disagree with this table,
> and §2's preamble says `globals.css` wins — so today it wins three different arguments:
>
> | Role | §2.3 says | `globals.css` declares |
> |---|---|---|
> | Hero | `clamp(2.6rem, 7.4vw, 5.1rem)` / 800 | *nothing* |
> | Page title | `clamp(1.85rem, 4.4vw, 2.9rem)` / 700 / `-.033em` | `.ui-page-header__title` = `clamp(1.5rem, 2.5vw, 2rem)` / 700 / `-.025em`; **and** `.page-title` = flat `1.5rem` |
> | Section | `clamp(1.25rem, 2.6vw, 1.62rem)` / 700 | `.section-title` = `clamp(1.4rem, 3vw, 1.8rem)` / 600 |
> | Card title | `1rem` / 650 | `.card-title` = `15px` / 700 |
> | Field label | `.62rem` mono | *nothing* |
>
> **Until the roles are declared as tokens and a ratchet counts off-scale sizes the way
> `check-design-scale.mjs` counts corners, typography is the half of §2 that cannot be adopted.**
> That work is the open item; see the Gap Register, group 14.

### 2.4 Metrics — fixed scales, no exceptions

```
--space-1..12   4  8  12  16  20  24  32  40  48        (1,2,3,4,5,6,8,10,12)
--radius-sm/md/lg/xl/full     6px  8px  12px  16px  9999px
--control-sm/md/lg            32px  36px  44px          (44 is the touch floor)
--content-readable 1100px  ·  --content-narrow 720px
Panel widths       sheet 440  ·  wide 660  ·  full 94%
Duration           --duration-fast 120ms; nothing over 260ms
```

**Any radius not in the five-step scale is a defect.** Today there are 20+ distinct values across
26 CSS modules; §2.7's ratchet is what stops that returning.

### 2.5 Component contracts

**`<Button>` / `<ButtonLink>`** — `variant: 'primary' | 'secondary' | 'ghost' | 'danger'`,
`size: 'sm' | 'md' | 'lg'`, `block`, `loading`. `loading` supplies the spinner **and**
`aria-busy` — never hand-roll either. **One `primary` per action group.** `danger` is
outline-on-transparent, never a filled red button.

**`<Surface>`** — `tone: 'panel' | 'raised' | 'sunken' | 'accent'`, `padding: 'none' | 'sm' | 'md' | 'lg'`,
`interactive`. `interactive` is **only** for a surface that actually navigates or selects.

**`<Badge>`** — status metadata. Never a substitute for a heading or a button. Colour alone never
carries status: always pair with text or an icon.

**`<TextField>` / `<TextAreaField>`** — label, hint, optional marker, error wiring. A bare `<input>`
in a form is a defect.

**`<PageHeader>`** — title, description, eyebrow, actions. **`<EmptyState>`** — icon, explanation,
recovery action. Both are canonical; do not re-lay-out either at a call site.

**`<SlideOutPanel>`** *(the shell primitive — see §3.4)* — `width: 'sheet' | 'wide' | 'full'`,
`title`, `crumb`, `index?`, `onClose`. Closes on `Esc` and on scrim click. Never a modal: modals are
reserved for destructive confirmation via `useConfirm` — **never `window.confirm`**.

**`<TeamBar>`** *(new — §4)* — reads the one roster (`kind: 'human' | 'agent'`). Chips are drag
sources; the canvas is the drop target; focus + `Enter` is the required keyboard equivalent.

### 2.6 Rules an implementing agent must follow

1. **Never a literal hex or `rgba()` at a call site.** `var(--x, #fallback)` is allowed *only* when
   `--x` is genuinely declared, so the other theme is covered.
2. **Never a `dark:` Tailwind variant.** Tokens flip themselves; a `dark:` variant double-flips.
3. **Import the primitive.** If you are writing `border: '1px solid var(--border-subtle)'` inline,
   you want `<Surface>`. 301 files got this wrong; do not make it 302.
4. **Localize in the same pass.** Every visible string — labels, placeholders, `aria-label`, toasts,
   empty and error states — through `useTranslations` / `getTranslations`, with real translations in
   **all five** catalogs. Namespace to mirror the route. Only genuinely non-translatable tokens
   (code, IDs, brand names, role acronyms per the `home.roles` precedent) stay literal.
5. **Both themes, and 360px.** Fluid layouts; horizontal scroll only where intended; tap targets
   ≥44px on coarse pointers.
6. **Respect `prefers-reduced-motion`.** Every transition and animation.
7. **Disable, never hide.** A locked destination, teammate or control stays visible and disabled
   with an upgrade path. Hiding turns "you need Pro" into "this product cannot do that".
8. **The composer is bottom-centre on the canvas.** Never in a side panel.
9. **The board declares its own palette.** The canvas is a dark art surface in both themes; do not
   quietly convert it into a shell-themed surface.
10. **Run the guards before claiming done:** `npm run check:design-tokens` and the component's tests.

### 2.7 The finding, and where it ended up

The system existed on paper and was not adopted.

| Measure | When this PRD was written | 2026-08-09 |
|---|---|---|
| Files importing `@/components/ui` | **3** (was 2 before this PRD's first fix) | 12 |
| Files hand-rolling `border: '1px solid var(--border-subtle)'` | **301** | unchanged — see below |
| Inline `style={{…}}` sites in `frontend/src` | **~9,400** | unchanged — see below |
| Files carrying a literal hex | **315** (405 on the ratchet's wider sweep) | **0** |
| Distinct `border-radius` values across 26 CSS modules | **20+**, against a documented 5-step scale | **9**, each a live expression |
| Design-token guard (`check-design-tokens.mjs`) | **Passes** — 245 declared | Passes — 287 declared |
| Distinct `font-size` literals on the public surface | not measured | **89** (1,185 uses) — see §2.3 |
| Distinct `clamp()` type ramps on the public surface | not measured | **129** |
| Marketing files importing `@/components/ui` | not measured | **4** of 478 |

The token guard is why *undeclared-token* bugs are gone. It could not see a literal hex or an
off-scale radius, which is why every other row was still true.

**It can now.** `check-design-scale.mjs` reads every `.ts`/`.tsx`/`.css` under `src`, counts each
corner of a multi-value declaration, and is wired into `npm test`.

- **Radius: shrink-only.** Baselined at 2,087, now **9**. A count that goes UP fails the build; a
  count that comes in BELOW its baseline ALSO fails, with the instruction to lower the baseline —
  which is what stops a ratchet from quietly going slack.
- **Colour: no longer a count.** The baseline is **0** and `COLOUR_EXEMPT` is an allowlist where
  every entry carries a written reason. A number lets 341 files sit there looking like progress; a
  list makes the next author say out loud why a token cannot reach their case. Six reasons qualify:
  where the tokens are declared, documents opened outside this app, generated project source,
  third-party brand marks, colour the AUTHOR picks and we persist, and consumers that never read a
  stylesheet.

**The two "unchanged" rows are deliberate.** Hand-rolled borders and inline styles are a
*primitive-adoption* measure, not a *correctness* one: an inline `border: '1px solid
var(--border-subtle)'` is themed correctly and renders right in both themes — it is verbose, not
broken. The literal-hex row was the one that shipped bugs, and it is the one that is closed. Moving
9,400 inline styles onto `<Surface>` is a continuing sweep with no ratchet, because a ratchet that
counts verbosity would fail builds over nothing.

**A literal is not always the wrong answer, and four ways of "fixing" one are worse than leaving
it.** Each of these shipped in an earlier pass of this very migration and was found by the sweep
that closed it (see DONE.md, 2026-08-09):

1. **A consumer that never reads our CSS.** xterm paints its own canvas from a JS theme object;
   `<meta name="theme-color">` is read by the browser chrome before a stylesheet exists.
2. **A document opened somewhere else** — a print sheet, a downloadable landing page, a generated
   React Native scaffold where `borderRadius` must be a number.
3. **A control whose VALUE is a colour.** `<input type="color">` takes `#rrggbb` and nothing else;
   given a `var()` it shows black and writes black on first touch.
4. **A cycle.** `--text-primary: var(--text-primary)` in a scope meaning to OVERRIDE it is invalid
   at computed-value time and takes the token from every descendant.

### 2.8 The decisions

- **Palette — Deep Space.** The existing `--bg-deep` / `--coral-bright` family is kept in both
  themes. Coral stays the live/record/destructive signal and never becomes the brand.
- **Typography — All Sans.** One sans family across marketing and product; mono reserved for
  eyebrows, labels, identifiers and anything with digits in a column. No serif.
- **Scale — fixed and enforced.** Radius `6 / 8 / 12 / 16 / full`; controls `32 / 36 / 44px`; the
  existing `--space-*` ramp. Panels `440 / 660 / 94%`.
- **Every colour is a token.** A literal fallback is allowed only where the variable is also
  declared, so the other theme is covered.

### 2.9 What has to be built

1. **Migrate onto the primitives.** `Button`, `Surface`, `Badge`, `Field`, `PageHeader`,
   `EmptyState` already exist and are backed by real `.ui-*` CSS. The work is call sites, not
   components. Start with the surfaces the shell touches (§3), then sweep.
2. **Delete the parallel vocabularies.** `freelance/formStyles.ts` (`talentCard` / `talentLabel` /
   `talentInput` / `talentSoftBtn`) re-declares card, label, input and button. It goes, and its
   consumers move onto the primitives.
3. **Extend the guard with two shrink-only ratchets** — literal-hex count and off-scale-radius
   count — baselined at the post-migration numbers and wired into the existing `npm test` guard
   chain. **This is the item that makes the rest permanent. It lands with the migration, not
   after it.**

---

## 3 · The shell

### 3.1 Layout

```
┌──────────────────────────────────────────────────────────────┐
│  sessions        │  board top: scope · canvas · ⌘K · live    │
│  ─────────       │                                            │
│  New canvas      │                                            │
│  Canvases        │            THE BOARD                       │
│  Projects        │        (mounted once, kept)                │
│  Artifacts       │                              ┌───────────┐ │
│  Scheduled       │        composer              │  PANEL    │ │
│                  │      (bottom-centre)         │  slides   │ │
│  ACTIVE ●        │                              │  over it  │ │
│  Bakery landing  │                              └───────────┘ │
│  RECENTS         ├────────────────────────────────────────────┤
│  …               │  ALWAYS ON  CEO CFO CTO CMO CHRO CISO      │
│  ───────         │  TEAM  Jules  Tom  Mia  + Invite   ● Cam   │
│  Sean Hogg  MAX  │                                            │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 The left panel — sessions

Today `Sidebar.tsx` renders `NAV_GROUPS`, so the persistent surface is a site map and the person's
own work appears nowhere. It becomes: **New canvas**, a short object index (Canvases, Projects,
Artifacts, Scheduled, Knowledge), then **Active** (live dot) and **Recents**. Collapsible to a
single floating control, which is the default posture for real work.

**The recorded block was stale.** `listLocalCreationSessions()` does exist
(`lib/creationSessions.ts`), is self-healing on both sides, and is already what `pendingWork.ts`
reads — so a guest's session list is complete. `SessionList` reads it beside `fetchRecentCanvases()`,
which is shared and read-through, so mounting next to the canvas switcher costs one request.

**One deliberate departure.** The destinations are not deleted from the left panel; they follow the
sessions under a `Workspace` label. §3.2's "short object index" is only short if what it omits is
reachable another way, and today `⌘K` is the only other way in — so removing Insights, Growth,
Reliability and the rest would put real destinations behind a keystroke. They are secondary here,
not absent.

> **Superseded in part by §11.** Keeping the destinations was right; calling the block `Workspace`
> and letting a *second* block (`Product Domains`) sit under it was not. §11 replaces both with one
> registry grouped by the Idea → Make → Run arc. Read §11 before touching this surface.

### 3.3 The footer — the team

The always-on C-suite agents sit beside the humans you invited. One chip shape, one drag, one
presence model, because **to a session they are the same kind of participant**.

- **Drag a teammate onto the board** → it joins the session, takes a seat, appears in presence, and
  can be addressed in the composer.
- **Keyboard parity is mandatory.** Focus + `Enter` does the same thing. A drag must never be the
  only route in.
- **Locked teammates stay visible and disabled** with an upgrade path, per the standing `RoleGate`
  rule ("disable, never hide") — which navigation does not currently honour.

### 3.4 Panels

One primitive (`SlideOutPanel`, which already exists and is the house convention), three widths:

| Width | Used for |
|---|---|
| **Sheet** (440) | Settings, Profile, `⌘K`, short forms |
| **Wide** (660) | Index + detail — Workforce's 14 sub-views, Projects' tickets |
| **Full** (94%) | Dashboards that need the room; the board is one `Esc` away |

**The panel body is a size container, and that is not a detail.** A route rendered here is the same
route that used to own the screen — it renders unchanged, which is the only reason this shell
survives the hundreds of surfaces PRD 18/19 bring. What it must not do is measure the *viewport*: a
panel at 660px inside a 2560px window means `@media (max-width: 700px)` never fires and the
destination lays itself out for a screen it does not have. `.ui-panel-body` carries
`container-type: inline-size; container-name: panel`, so a destination asks the panel instead:

```css
@container panel (max-width: 640px) { .myGrid { grid-template-columns: 1fr } }
```

Wide content (a table, a Gantt) scrolls *inside* the panel rather than pushing the drawer past the
viewport. Asserted in `unifiedExperience.test.tsx`.

The nested menu becomes the panel's **index column**, grouped by the question a person is actually
asking — *You* vs *Workspace* in Settings; *People / Working / Measure* in Workforce. Fourteen
items fit vertically; a horizontal tab bar cannot hold them.

`SectionTabs`, `PillTabs` and `AdminGroupNav` are **deleted**. Three components in, one out.

### 3.5 URLs

Deep links keep working and keep naming a **state**, not a replacement for the stage. `/settings`
resolves to *your last board plus the settings panel open* (`?panel=settings/profile`). Sign-in,
sign-up and the OAuth return stay pages, and each **ends by landing you on your last board** —
which is what "the canvas is the front door" has to mean to be true.

### 3.6 What stays a page

Marketing, blog, docs, pricing, legal, auth. The split is by **who is looking**: signed in means
there is a board, so everything is a panel; signed out means there is no board, so real pages with
real URLs and real SEO.

---

## 4 · The seat is the teammate

**This section reverses a decision.** The navigation architecture proposed a nine-door rail of
C-suite *domains*. That was wrong: it modelled the seats as navigation. They are team members who
are always available, and the rail is deleted.

PRD 20 §3 already assigns each domain an owner. That column becomes the footer roster:

| Domain (PRD 20 §3) | Owner | Tables | Appears as |
|---|---|---|---|
| Growth & marketing | **CMO** | 58 | Teammate + panel |
| Delivery & work | **Manager** | 54 | Teammate + panel |
| Agents & runtime | platform | 40 | Panel only |
| Hiring | **Recruiter** | 27 | Teammate + panel |
| Finance | **CFO** | 26 | Teammate + panel |
| Revenue & CRM | **CRO** | 24 | Teammate + panel |
| Commerce | platform | 24 | Panel only |
| Identity & tenancy | platform | 23 | Panel only |
| People & HR | **HR** | 23 | Teammate + panel |
| Platform & observability | platform | 16 | Panel only |
| Governance & security | **Security** | 15 | Teammate + panel |
| Investor & portfolio | **CEO** | 14 | Teammate + panel |
| Support & knowledge | **Support** | 9 | Teammate + panel |
| Canvas & ideas | **Brain** | 8 | The board itself |
| Integrations | platform | 1 | Panel only |

**A domain owned by `platform` has no teammate** — there is no one to drag in, so it is a panel
only. That is the test for whether a seat belongs in the footer, and it comes from the data rather
than from taste.

### 4.1 The blocking dependency: one roster

`WorkforceCard` unifies the *card*. It does not unify the *roster* — `AgentCard` reads
`ide_agents`, `MemberCard` reads the members path. There is no single list a footer, a presence
pile or a drop target can read, and no `kind` discriminator to render them uniformly.

**Required:** one roster read model — `kind: 'human' | 'agent'`, id, display name, role,
availability, avatar — served through `getOrSetCached` and invalidated on membership writes. Both
cards become renderers of one row shape.

**3NF note:** this is a **read model over the existing owners**, not a third table. A new kind is a
column value, not a new table (PRD 20 §0).

---

## 5 · Sequence

Each step is shippable and leaves the app working.

| Step | Work | Gate | State |
|---|---|---|---|
| **E0** | Roster read model (§4.1) + `getOrSetCached` + invalidation | One endpoint returns humans and agents in one shape | ✅ `GET /api/roster/team`; `invalidateTeamCaches` is now THE membership invalidation and every prior `assignableWorkforceCacheKey` site was migrated onto it |
| **E1** | `TeamBar` + canvas drop target + keyboard parity | A teammate can join a session by drag **and** by keyboard | ✅ one payload (`lib/team/teammate.ts`) carried by both routes, one `seatTeammate` on the board |
| **E2** | Panel primitive at three widths + index column; port Settings and Profile | Settings opens over a mounted board; the board's agent turn survives it | ✅ the dock is deleted; every workbench route renders inside `ShellPanel`, and the board is now VISIBLE under it rather than merely mounted |
| **E3** | Left panel becomes sessions; `listLocalCreationSessions()` lands | Sign-in returns you to your last board | ✅ `SessionList`; the helper already existed (see §3.2). `LastBoardBridge` closes §6.7 and §6.8 together |
| **E4** | Delete `SectionTabs`, `PillTabs`, `AdminGroupNav`; migrate every group's tabs into panel indexes | Zero references to all three; no horizontal tab bar over 6 items | ✅ one `DestinationIndex` that picks its own orientation past six items — the rule is in the primitive, not in review |
| **E5** | Primitive migration sweep + delete `freelance/formStyles.ts` | Literal-hex and off-scale-radius counts drop | ✅ the parallel vocabulary is deleted; literal-hex files 403 → **0** and off-scale radii 2,086 → **9** (2026-08-09). The inline-style/`<Surface>` sweep continues without a ratchet — see §2.7 |
| **E6** | Two guard ratchets wired into `npm test` | The build fails on a new literal hex or off-scale radius | ✅ `check:design-scale` — radius shrink-only in both directions, colour now an allowlist at zero |

**E6 is not optional and is not last-if-time-permits.** Without it, E5 is undone by the next
feature and this PRD gets rewritten in a quarter.

### 5.1 Against PRD 19's tracks

E0–E2 **block B1–B9's frontend work**, and only that. A track may land its schema, its migrations
and its API against PRD 20 at any time. What it may not do is ship a surface as a page — every
track's UI arrives as a panel and registers its destination once, in the pass that lands it.

---

## 6 · Acceptance criteria

1. Opening any authenticated destination does **not** unmount the canvas: an in-flight agent turn,
   a peer cursor, presence and an active call all survive it. Asserted by test, not by eye.
2. `SectionTabs`, `PillTabs` and `AdminGroupNav` have **zero references** in the repo.
3. No horizontal tab bar renders more than 6 items anywhere.
4. The footer roster renders humans and agents from **one** endpoint returning one row shape.
5. A teammate can be added to a session by drag **and** by keyboard.
6. Locked destinations and locked teammates render **visible and disabled**, never hidden.
7. `/settings` (and every other legacy destination URL) resolves to a board plus an open panel.
8. Sign-in lands on the last board, not a dashboard.
9. `check:design-tokens` passes **and** both new ratchets are wired into `npm test` and shrink-only.
10. Every surface touched renders correctly in **both themes** at **360px** and is fully localized
    in all five catalogs.

---

## 7 · Open decisions — operator, not engineering

Neither is an engineering call, and both block a specific step.

1. **"Persona" vs "Personality".** `navGroups.ts:224` **Persona** is the insight lens
   (CEO/CFO/CTO reshaping of dashboards); `SettingsClient.tsx:168` **Personality** is the user's
   psychometric profile. Adjacent, unrelated, near-homographs. One must be renamed. *Blocks E2's
   Settings index copy.*
2. **`/security` vs `?sub=sessions`.** Account security is reachable twice — the L2 Security tab
   routes to `/security`, the L3 Sessions pill renders `AccountSecurityPanel` inline. The file's own
   comment says sessions "moved here from /security", but the tab was never removed. One survives.
   *Blocks E4, which cannot place a surface that exists in two places.*

---

## 8 · Out of scope

- The data model, the kernel and the 15 domains — those stay PRD 20's.
- PRD 19's §2 ownership register — cited here, never restated.
- The marketing site's information architecture. It keeps its pages and its sections; it adopts the
  palette and type scale only.
- Mobile-native shells. The panel becomes a full-height bottom sheet and the roster scrolls
  horizontally; that is responsive web, not a separate app.

---

## 9 · Already landed

- `settings.logsTab` — the Logs sub-tab was a hardcoded English string; now in all five catalogs.
- The Save Personality button rendered `var(--accent, #6366f1)` from a hand-rolled `<button>`;
  now the `Button` primitive, with the spinner and `aria-busy` it never had.
- `LandingCanvasHero` carries the shell's aesthetic: a session bar with presence, the always-on
  roster along the bottom, an agent object tinted rather than merely labelled, and its two
  off-scale radii moved onto the scale. Blur and click-to-seed are unchanged; the roster seeds the
  composer exactly as the objects do.
- **The whole sequence, E0–E6.** The dock is gone: a destination now opens as a panel over a board
  that stays mounted *and visible*, at one of three widths chosen by `panelWidth()` rather than by a
  call site. Three tab bars became one `DestinationIndex` that turns vertical past six items on its
  own. The footer is the roster — the PRD 20 §3 seats beside the invited team, in one row shape from
  one endpoint, joinable by drag and by keyboard through one payload. The left panel leads with the
  person's own sessions. Two shrink-only ratchets hold the scale.
- **Two corrections to this document, made against the code rather than around it.** §2.8 claimed
  controls of `29 / 34 / 44px` where `globals.css` — which §2 says wins — declares `32 / 36 / 44px`.
  §3.2 recorded E3 as blocked on a helper that already existed.
- **A latent panel bug.** `SlideOutPanel` closed on the scrim but not on `Esc`, so a keyboard user
  could open a panel they had no way to dismiss. §2.5 had always said otherwise.
- **The last two residuals, 2026-08-09.** The literal-hex sweep finished at zero and the panel
  gained its size container. What the sweep cost was not the 1,483 mechanical replacements but the
  nine shipped defects it walked into — six of them left by EARLIER passes of this same migration,
  each one a token put somewhere a token cannot go: a self-referential CSS variable that stripped
  the landing hero's ink, an xterm cursor that vanished, an unthemed light-mode address bar, a
  React Native scaffold with `borderRadius: 'var(--radius-xl)'`, tokens written into a print sheet
  and a downloadable proposal, and white ink on a white page. Three duplicated palettes (Evermind's
  regions ×3, the Canvas object kinds ×2, the board's series colours inside a 5,000-line component)
  became one declaration each. That is why §2.7 now ends with the four ways of "fixing" a literal
  that are worse than leaving it, and why the colour ratchet asks for a REASON rather than a number.

---

## 11 · The unified menu — one destination registry, one arc, one storefront

> **Status:** design, 2026-08-09. E0–E6 built the *shell*: a panel over a mounted board, three
> widths, one design system. What they did not touch is what is *in* the left panel — and there the
> product still carries seven separate lists of destinations. §11 is that half. It changes no shell
> mechanic; §§0–10 stay authoritative for those.

### 11.0 The rule

**A destination appears in exactly one registry, is named exactly once, and is placed by two facts
it already carries: its OWNER (which seat) and its STAGE (idea · make · run).**

1. **The left panel is the arc.** Idea → Make → Run, plus Measure, Market and Admin. It answers
   *where am I in the journey* — the only question a first-time visitor can actually ask.
2. **The footer is the roster.** One chip per seat, always listed. It answers *who owns this*. A
   seat is never *also* a nav item — §4 settled that, and the code currently does it twice.
3. **A destination never points at a marketing page from inside the app.** The signed-out twin is a
   field on the same row, not a second registry.
4. **The marketplace is the second front door.** Canvas is "I have an idea". Marketplace is "I have
   a business". Both end in the same place: a company you run with the whole Run stack behind it.

### 11.1 The finding — seven registries for one product

Measured 2026-08-09 against live source.

| # | Registry | File | Rows | Renders as |
|---|---|---|---|---|
| 1 | `NAV_GROUPS` | `frontend/src/lib/navGroups.ts` | 15 groups + 48 tabs | left panel, **WORKSPACE** block |
| 2 | `BURNRATE_DOMAINS` | `frontend/src/lib/burnrateCatalog.ts` | 9 domains + 3 foundations | left panel, **PRODUCT DOMAINS** block → **marketing pages** |
| 3 | `DOMAINS` (kernel) | `frontend/src/lib/kernel/kernelApi.ts` | 15 seats | `/seat/<domain>` + `RosterNav` |
| 4 | Team roster | `GET /api/roster/team` | humans + agents | footer `TeamBar` (§3.3) |
| 5 | `ADMIN_GROUP_META` | `frontend/src/lib/adminGroups.ts` | 10 groups | admin index |
| 6 | `CATEGORY_IDS` | `app/marketplace/MarketplacePageClient.tsx:56` | 8 categories | marketplace tabs |
| 7 | `system_features` | BurnRateOS Postgres (incoming, PRD 19) | 9 categories + ~120 leaves, persona- and plan-gated, **recursive** | its own sidebar |

**The CFO exists four times:**

| Where | Called | Goes to |
|---|---|---|
| `BURNRATE_DOMAINS` | Business Intelligence `CFO` | `/business-intelligence` — **a marketing page** |
| kernel `DOMAINS` | finance | `/seat/finance` |
| footer `TeamBar` | CFO | drag-to-seat |
| `NAV_GROUPS` → Insights | Finance | `/insights/finance` |

Four names, four icons, four hrefs, one job. On screen today the left panel renders **WORKSPACE**
above **PRODUCT DOMAINS** (`Product Management CPO`, `Business Intelligence CFO`, `Agile Survival
CTO`, `Sales & Revenue CRO`) while the footer simultaneously renders `CMO · Manager · Recruiter ·
CFO · CRO · HR · Security · CEO · Support`. **Two rosters, disjoint, visible at once** — and the
left one navigates out of the product.

**Why it happened.** Each list was correct when written. `NAV_GROUPS` predates the seats.
`BURNRATE_DOMAINS` landed as *marketing* taxonomy and was later reused as navigation because it was
the only list that knew about CFO/CMO/CRO. Kernel `DOMAINS` came from PRD 20's data model. The
roster came from E0. Nobody added a duplicate; four people each added the first one for their layer.
**A registry is not prevented by review — it is prevented by there being only one place a
destination can be declared** (§11.7.1).

### 11.2 The unified model

One row shape, one array, four renderers.

```ts
// frontend/src/lib/destinations.ts — THE registry
export type Stage = 'idea' | 'make' | 'run' | 'measure' | 'market' | 'admin';

export interface Destination {
  /** Stable and unique across the whole product. */
  id: string;
  /** PRD 20 §3 owner. `'platform'` means no teammate — panel only (§4). */
  seat: Domain | 'platform';
  /** Where in Idea → Make → Run this sits. Decides the LEFT PANEL grouping. */
  stage: Stage;
  /** i18n key under `nav`. THE name — marketing, app rail, ⌘K and the seat index all read it. */
  labelKey: string;
  icon: string;
  /** The in-app destination. Never a marketing route. */
  href: string;
  /** The signed-out twin, when one exists. Rendered only by the public shell. */
  marketingHref?: string;
  /** How this destination presents when someone signed in opens it (§11.4.5).
   *  `'panel'` — mounts over the canvas at `full` width; the stage never unmounts.
   *  `'page'` — a real page; only auth, legal and the blog qualify (§3.6). */
  surface?: 'panel' | 'page';
  /** Progressive disclosure: the row is always LISTED; the rung gates its STATE (§11.4.4). */
  rung: number;
  plan?: 'free' | 'pro' | 'scale';
  /** Level 2 — this row is a leaf of a seat's workbench index. */
  parent?: string;
  /** Marketplace family, when this destination is also listable (§11.5). */
  listable?: Family;
}

/** The marketplace families. ONE derivation for the filter label, the publish
 *  CTA and the flow that CTA runs — so the button can never disagree with the
 *  filter above it, and "Publish a company" genuinely runs the claim (§11.5). */
export const FAMILIES = {
  talent:  { label: 'Talent',    publish: 'Publish a listing', flow: 'listing' },
  company: { label: 'Companies', publish: 'Publish a company', flow: 'claim'   },
  agent:   { label: 'Agents',    publish: 'Publish an agent',  flow: 'agent'   },
  asset:   { label: 'Assets',    publish: 'Publish an asset',  flow: 'asset'   },
} as const;
export type Family = keyof typeof FAMILIES;
```

| Surface | Projection over the one array |
|---|---|
| Left panel | `group by stage`, top-level rows only (`!parent`) |
| Footer roster | `group by seat`, joined to `GET /api/roster/team` for presence + avatar |
| `⌘K` | flat search |
| Seat workbench index (§3.4's index column) | `filter(parent === seat)` — where the ~120 BurnRateOS leaves land |
| Public shell / marketing | `filter(marketingHref)`, same `labelKey` — so a marketing page can never describe a feature by a name the product does not use |

`NAV_GROUPS`, `BURNRATE_DOMAINS`, `ADMIN_GROUP_META` and `CATEGORY_IDS` become derived selectors
over this array in the migration pass, then are deleted. Kernel `DOMAINS` stays — it is the *seat*
enum, and `Destination.seat` references it.

### 11.3 The arc — Idea → Make → Run

The operator's framing, made into an information architecture: *one canvas — idea to real — with
all the AI and business tools you need to go from a business idea to a company.*

| Stage | The question | What lives here | Owning seats |
|---|---|---|---|
| **Idea** | *what if?* | Canvas · Challenges · Ideas & scratch pad · Validation lab · Market & competitor research · Pitch & narrative | Brain · CPO · CEO |
| **Make** | *build it* | Projects · Delivery board · Sprints & ceremonies · Agents & runtime · Quality · Knowledge · Deploy & embed | Manager · CTO · platform |
| **Run** | *run it as a company* | Finance · Revenue & CRM · Growth & marketing · People & HR · Hiring · Investors & fundraising · Governance & SOC 2 · Support · Commerce & billing | CFO · CRO · CMO · HR · Recruiter · CEO · Security · Support |
| **Measure** | *is it working?* | Insights — the one analytics hub | platform |
| **Market** | *sell · buy · hire · be found* | Marketplace: talent · companies · things | platform |
| **Admin** | *settings* | Settings · Security · Billing · Tenants · Platform admin | platform |

**Stage is not a synonym for seat.** A seat can own rows in more than one stage — the CEO owns Pitch
in Idea and Investors in Run. That is precisely why two axes are needed, and why they must be two
**columns on one row** rather than two registries.

#### 11.3.1 BurnRateOS's nine categories, mapped

Verified against `api/prisma/migrations/20260411_seed_feature_tree/migration.sql` plus the twelve
later menu migrations.

| BurnRateOS category | Leaves | Stage | Seat | Destination |
|---|---|---|---|---|
| Product Management | 8 | idea → make | CPO / Manager | `/projects?tab=pm` |
| Agile Survival | 7 | make | CTO / Manager | `/projects?tab=ceremonies` |
| Business Intelligence | 8 | run | **CFO** | `/seat/finance` |
| Operational Cadence | 8 | run | **HR** | `/seat/people` |
| Customer Engagement | 8 | run | **CRO** | `/seat/support` + `/quality?tab=feedback` |
| Investor Intelligence | 13 | idea (pitch) + run | **CEO** | `/seat/investor` |
| Revenue & Growth | 20+ | run | **CRO** + **CMO** | `/seat/revenue` · `/seat/growth` |
| Governance & Collaboration | 14 | run | **Security** | `/seat/governance` |
| **AI Assistant** | 4 | — | Brain | **deleted — see below** |

#### 11.3.2 "AI Assistant" is deleted, and that is the largest simplification the merge buys

In BurnRateOS the AI was a *department*: `/ai/coach`, `/ai/hub`, `/ai-assistant/insights`,
`/ai-assistant/predictive`, `/ai/competitor-monitor`, `/ai/contract-analyzer`,
`/ai/email-classifier`, `/ai/expense-categorizer`, `/ai/pitch-deck-feedback`, `/ai/voice-agent` —
ten destinations whose only shared property is *the implementation uses a model*.

In Builderforce the AI is the *surface*. Each of those ten is a capability of the seat that owns the
work: expense categorisation is the CFO's, contract analysis is Security's, competitor monitoring is
the CMO's, pitch-deck feedback is the CEO's. **They become tools on a teammate, not rooms in a
building.** BurnRateOS itself started this — migration `20260412_consolidate_ai_menu` deleted four
and reparented six to their owner domains. This finishes it.

The corollary is load-bearing: **there is no "AI" item in the unified menu at all.** A menu item
named after the technology is the tell that the product has not decided who the work belongs to.

### 11.4 The surfaces

#### 11.4.1 The left panel

```
┌────────────────────────┐
│  ✦ New                 │   always: empty board + prompt, one meaning everywhere
├────────────────────────┤
│  ● ACTIVE              │   the live session (canvas OR chat — one stream, 0409 `mode`)
│    Bakery landing      │
│  RECENTS               │
│    LLM startup comp…   │
├────────────────────────┤
│  IDEA                  │
│    Canvas · Challenges │
│  MAKE                  │
│    Projects · Quality  │
│    Knowledge · Deploy  │
│  RUN                   │   ← the eight seats' domains, by NAME not by acronym
│    Finance        CFO  │
│    Revenue        CRO  │
│    Growth         CMO  │
│    People          HR  │
│    Hiring   Recruiter  │
│    Investors      CEO  │
│    Governance Security │
│    Support     Support │
│  MEASURE  Insights     │
│  MARKET   Marketplace  │
├────────────────────────┤
│  Settings              │
│  Sean Hogg        MAX  │
└────────────────────────┘
```

Three deliberate departures from what ships today:

1. **PRODUCT DOMAINS is deleted as a block.** Its nine rows are not lost — they are the RUN group,
   under their *product* names with the seat as a trailing chip rather than as the identity. "You
   are going to Finance, which the CFO owns" reads correctly; "you are going to CFO" does not.
2. **The `seat` nav group is deleted.** `/seat/delivery` as a menu item was a door labelled *door*.
   Each seat's surface is reached by its RUN row or by its footer chip; `/seat/<domain>` remains the
   route both resolve to.
3. **`dashboard` is deleted.** §6.8 already requires sign-in to land on the last board; a Dashboard
   nav item is the thing that undoes it.

**Every stage header collapses, and the state persists.** With PRD 18/19 landed the Run group alone
carries nine rows, and a person who lives in Make should not scroll past a company they only touch
on Fridays. The header is a `<button aria-expanded>` with a rotating chevron — not a hover
affordance, because the stage underneath is a drag surface and a hover-opened region at the left
edge eats drags. Collapse is per-group, keyed by `stage`, and stored beside the rail's
collapsed/expanded preference so the panel reopens the way it was left.

Collapsed-rail behaviour is unchanged: identity compresses, text flies out. Sessions leave the rail
and return as a click-opened flyout; stage groups become icon runs with their eyebrow as tooltip —
and a collapsed *group* inside an expanded rail is a different state from a collapsed *rail*, so
the two preferences are stored separately and neither infers the other.

#### 11.4.2 The footer — the roster, and the only seat list

Behaviour is unchanged from §3.3 (one row shape, drag **and** keyboard, disable-never-hide). What
changes is that it becomes the **only** place a seat is enumerated. A left-panel RUN row is a
*domain*; a footer chip is a *person*. Clicking either opens the same panel; only the chip drags.

#### 11.4.3 The seat workbench — where 549 destinations actually go

Level 2 is §3.4's index column, and it is `destinations.filter(d => d.parent === seat)`:

```
CFO · Finance                       ▸ Runway
  ── PLAN ──                          £412k · 14.2 months
  Runway · Burn rate                  ┌──────────────────────────┐
  Break-even · Forecast               │  chart                    │
  ── MEASURE ──                       └──────────────────────────┘
  Cashflow · Cohort retention         Assumptions · Sensitivity · Monte Carlo
  CAC · LTV · payback
  ── OPERATE ──
  Expenses · Bank sync · Invoicing
  ── REPORT ──
  Board pack · Variance
```

Fourteen items fit vertically; a tab bar cannot hold them — the same argument §3.4 already made and
`DestinationIndex` already implements (it turns vertical past six items on its own). **No new
component is needed for level 2.** The registry is the work; the renderers exist.

**The width control returns to the panel header.** §3.4 declares three widths and `panelWidth()`
picks one, but a *policy* choosing the width is not the same as a *person* choosing it — a Gantt in
a 660px drawer and a settings form in 94% are both wrong, and only the reader knows which. So
`SlideOutPanel` gains a three-step control in its header (`440 · 660 · 94%`), keyboard-reachable,
with `panelWidth()` supplying the default rather than the final answer. The choice persists per
destination, because the person who widens Finance wants Finance wide every time and does not want
Settings to follow it. Widening never navigates and never remounts the stage.

#### 11.4.5 A reference page is a panel, not a page

`/soc2`, `/integrations`, `/survival-focused-agile` and the other eight domain pages are the last
place the product still navigates *away* from the board. They carry `surface: 'panel'`:

| Who is looking | What the route resolves to |
|---|---|
| signed out | a real page, real URL, real SEO, inside `MarketingShell` — unchanged (§3.6) |
| signed in | the **same route component**, mounted in `ShellPanel` at `full` width over the board |

Three things this buys, and one it does not cost:

- **One implementation, two shells.** A marketing page that drifts from the product lies. `/soc2`
  signed out explains the controls; signed in it shows *your* controls, from the same component
  reading the same endpoint at a different rung.
- **The session survives a curiosity.** Someone mid-agent-turn who wants to check whether an HRMS
  is supported opens Integrations, reads it, presses `Esc`, and the turn is still running. Today
  that is a full navigation and the answer to "is my work still there" is *no*.
- **SEO is untouched**, because the signed-out path is the one crawlers take and its URL shape does
  not change. This is what makes it cheap: no redirect map, no slug migration.

The cost is the one §3.4 already paid — these routes must measure the **panel**, not the viewport,
via `@container panel`. A domain page written against `@media (max-width: 700px)` lays itself out
for a screen it does not have. That is a per-route fix at M3, not a blocker.

#### 11.4.6 The public header is the same registry

The signed-out header is a fourth renderer, not a fourth list. Two corrections it needs, both from
the operator's 2026-08-09 review:

1. **`Home` is deleted.** The logo already is home; a `Home` item is the second way to do the one
   thing every logo in every product already does. Six items become five plus the mark.
2. **`Get Started →` opens the canvas, not a signup form.** The board is real, local-first and
   theirs before an account exists (`newLocalCreationSession()`, `LOCAL_CREATION_PREFIX`), so the
   primary CTA should hand over the product. A signup wall in front of a product that works without
   one is an acquisition cost spent on a form.

`Product ▾` is the arc — Idea / Make / Run columns rendered from `stage`. `Learn ▾` is the
reference set. Every item in both menus carries `surface:'panel'`, so a signed-in visitor clicking
`SOC 2` from the marketing header lands on their board with the panel open rather than being thrown
out of their session into a brochure.

#### 11.4.4 Progressive disclosure — one field, not a prop

| Rung | Left panel | Footer |
|---|---|---|
| visitor with an idea | Idea + Market live; Make/Run **listed and dim** | all seats listed, only Brain active |
| shipped something, no account | unchanged | unchanged |
| signed in | + Recents activates | + your own row |
| tracking work | + Make and Measure activate | Manager, CPO activate |
| someone joins | unchanged | + the actual people in the room |
| **claimed or formed a company** | **+ Run activates** | CFO/CEO/CMO/CRO/HR/Recruiter/Security/Support activate |
| several companies | + company chip in the session bar | unchanged — seats are TENANT-level |

**A dim row is an invitation; a missing row is a secret.** Clicking a dim row opens its workbench in
preview — real index, real empty states, one honest line, and one button that hands you to the seat
that owns the unlock (§11.5: the CEO owns company formation). This is §2.6 rule 7 applied to the
menu rather than to a control.

### 11.5 The marketplace — three listing families, one storefront

Today `CATEGORY_IDS` is `all · personas · skills · workforce · talent · models · gigs · publish` —
eight tabs mixing *what is sold* with *who sells it* with *a verb*. The ask is to add companies;
adding a ninth tab to that list is how it reaches fifteen.

| Family | Kinds | Who lists | Who is buying |
|---|---|---|---|
| **Talent** | person · gig | freelancers, agencies | anyone hiring |
| **Companies** | business · service · product · storefront | claimed company owners | customers, partners, investors, acquirers |
| **Agents** | built-in · community | agent authors, the platform | anyone staffing a seat |
| **Assets** | model · skill · persona · prompt · template · canvas | builders | anyone |

`publish` is not a family — it is the **verb**, and it belongs on a primary button. `all` is the
absence of a filter, not a filter.

**There is no `/agents` destination.** An agent is a *listing* whose purchase writes a roster row —
so the catalog and the footer are the same rows at two rungs and cannot drift. Agents split out of
Talent rather than sitting inside it because, although a person and an agent are the same kind of
*participant* to a session, they are not the same kind of *listing*: one has availability and an
hourly rate, the other has a price, a seat and a set of tools. Merging them forces one publish form
to serve two shapes, which is where the honest flow dies.

**The publish CTA is derived, and that is the point of `FAMILIES` (§11.2).** Four buttons written
by hand drift from the filter above them within one release; one `FAMILIES[active].publish` cannot.
The `flow` field matters as much as the label — **"Publish a company" runs the claim-and-verify
flow, not a listing form**, because a company you do not own is not yours to list.

> **Copy decision, flagged for the operator.** The fourth family was drafted as **Things**, which
> fails the CTA test — no product ships a button reading *Publish a thing*. **Assets** survives the
> publish sentence, so §11 uses it. The test itself is the durable rule: **a family name that
> cannot complete "Publish a ___" is not a family name.** It is also what splits Talent's CTA to
> "Publish a listing" rather than the ungrammatical *Publish a talent*.

#### 11.5.1 A company listing is not a new concept

It is `companies` + `account_company_relationships(kind='OWNER')` — the company-graph v1 BurnRateOS
shipped in April 2026 and PRD 19 §3.2 already adopted. Nothing here needs designing; it needs
**surfacing**:

- **`Company.accountId` is deliberately NULLABLE** — NULL is an unclaimed row in the global business
  graph, enriched from a data provider. That one nullable column is what lets a single table be both
  *the business you operate* and *a company in someone's CRM*.
- **The claim flow exists** — `claimedByUserId`, `claimVerificationMethod ∈ DOMAIN_DNS_TXT |
  EMAIL_AT_DOMAIN | MANUAL_REVIEW`, a DNS TXT token, verification stamps.
- **The relationship kinds exist** — `OWNER | CUSTOMER | PROSPECT | INVESTOR_TARGET |
  PORTFOLIO_COMPANY | PARTNER | COMPETITOR | VENDOR | OTHER`.

So one directory row feeds five consumers with no duplication:

```
                       ┌─→ OWNER             → the Run stack scopes to it
  companies row  ──────┼─→ CUSTOMER/PROSPECT → CRO's CRM pipeline
  (accountId NULL      ├─→ INVESTOR_TARGET   → CEO's fundraising pipeline
   until claimed)      ├─→ PORTFOLIO_COMPANY → an investor persona's portfolio
                       └─→ VENDOR            → Security's vendor + DPA register
```

hired.video's `companies` (employer profiles a candidate browses) arrive as rows **with no OWNER
relationship** — PRD 19 §2 row 19 already made that call. The three-way "company" collision
therefore resolves to one table: the directory a jobseeker browses is the directory a founder claims
their business in.

#### 11.5.2 Claiming is the rung that turns the business on

```
  browse the directory → "this is my business" → verify (DNS TXT / email@domain)
        │                                                  │
        │                                                  ▼
        │                                      accountId = your tenant
        │                                      OWNER relationship written
        └────── or: the CEO agent forms a new company ─────┤
                                                           ▼
                              RUN activates · eight seats go live · the company
                              chip appears in the session bar
```

**The unlock is the claim, not the plan.** Plan gating stays exactly where PRD 19 §2 row 14 put it
(`planFeatures` + `featureGate`, one evaluator, miss = 402) and decides *depth* — how many
scenarios, how many seats, whether Monte Carlo runs. It does not decide whether the Finance row
exists. Someone who claimed a bakery sees Finance on the free plan with their real numbers in it.

#### 11.5.3 What a claimed company gets

The Run group in full is PRD 18 + PRD 19 pointed at one company:

| Row | Behind it | From |
|---|---|---|
| Finance | runway · burn · break-even · forecast + sensitivity + Monte Carlo · ARR · cohort retention · CAC/LTV/payback · expenses + AI classification · bank sync · invoicing · TCO | PRD 19 B1 |
| Revenue | contacts + provenance · deals · pipelines · quota · sequences · enrichment · dedup · business phone | PRD 19 B3 |
| Growth | campaigns (one engine) · landing pages · lead forms · nurture flows · A/B tests · NPS · referrals · SEO · brand kit · content calendar · heatmaps | PRD 19 B4 |
| People | employees · goals · reviews · 1:1s · check-ins · pulse · scorecards · org design · headcount plan · HRMS connectors | PRD 18 T3 + PRD 19 B7 |
| Hiring | jobs · pipelines · screening · interviews · scorecards · résumé tailoring · candidate packets | PRD 18 T1/T2 |
| Investors | pitch decks + slide analytics · investor updates + approvals · data room · due diligence · funding rounds · portfolio health · deal flow | PRD 19 B2 |
| Governance | SOC 2 controls + evidence · vendors · DPAs · PII assets · security training · compliance calendar · DSR | PRD 19 B8 |
| Support | tickets · knowledge base · live chat · CSAT | PRD 19 §2 row 7 |
| Commerce | plans · invoices · cart/orders · payouts · affiliates · AI credits | PRD 18 T6 + PRD 19 B9 |

Nine rows. Each is one seat, one panel, one index column, N leaves. **That is how 549 destinations
become a menu you can read.**

#### 11.5.4 Cart and purchase memory

The cart is global chrome, not a marketplace-page widget. The same cart icon and item count appear
in the signed-out public header and the signed-in top bar, and its drawer survives navigation. Every
marketplace listing that can be acquired enters this cart before checkout; subscriptions and other
recurring services may share the drawer but complete through their own provider checkout.

**Free is a price, not an absence of a transaction.** Completing checkout for a zero-dollar skill,
persona or content item writes a `marketplace_purchases` row with `price_cents = 0` before the item
is removed from the cart. Paid acquisitions write the same record only after payment is verified.
The drawer exposes the authenticated person's purchase history, newest first, so acquisition history
does not disappear merely because an item was free, later uninstalled, or no longer listed.

The server-owned listing price is authoritative at checkout. The cart may display a cached price for
responsiveness, but it cannot confer an entitlement or submit a client-selected amount. Mixed carts
that require different checkout providers are completed separately and say so explicitly.

### 11.6 What gets deleted

Deletion is the deliverable; an addition that leaves the old list standing is the failure mode this
section exists to prevent.

| Deleted | Replaced by | Milestone |
|---|---|---|
| `BURNRATE_PRODUCT_DOMAINS` as a nav rail (`.nav-domain-section` in `Sidebar.tsx`) | the RUN group | M1 |
| `burnrateCatalog.ts` (whole file) | `destinations.ts` + the `marketingHref` field | M1 |
| `NAV_GROUPS` / `FOR_HIRE_NAV_GROUPS` / `FREELANCER_NAV_GROUPS` / `SALES_NAV_GROUPS` | one array + an account-type selector | M1 |
| The `seat` nav group · the `dashboard` nav group | RUN rows + footer chips · last-board landing (§6.8) | M1 |
| The public header's `Home` item | the logo, which was always home (§11.4.6) | M1 |
| The signup-form destination behind `Get Started →` | `/create/new` — a real local-first board (§11.4.6) | M1 |
| Standalone page rendering for the nine domain pages + `/soc2` + `/integrations` when signed in | `surface:'panel'` over the mounted board (§11.4.5) | M3 |
| `ADMIN_GROUP_META` as its own list | `stage:'admin'`, `parent:'admin'` rows | M3 |
| `CATEGORY_IDS` literal (8 mixed tabs) | `FAMILIES` — four families, derived label + CTA + flow | M4 |
| The `/agents` destination | the `agent` marketplace family (§11.5) | M4 |
| Per-surface seat colours (roster / marketing cards / canvas agent objects) | `--seat-*`, one declaration (§11.10.1) | M0 |
| BurnRateOS "AI Assistant" category, `/ai/hub`, `/ai/coach` | the composer and the owning seats | M3 |
| BurnRateOS hard-coded "Hubs" block (`/bi/hub`, `/ops/hub`, `/ai/hub`, `/agile/holistic`) | the seat workbench home | M3 |
| BurnRateOS `system_features` **as a menu mechanism** | the registry; the table survives as *entitlement only* | M3 |

> **`system_features` deserves its own line.** BurnRateOS drives its sidebar from a database table
> carrying `menuLabel`, `menuIcon`, `menuOrder`, `route`, `parentFeatureId` and `allowedPersonas`.
> It is a good entitlement store and a bad navigation store: a route rename becomes a migration, a
> label is untranslatable (that side ships no i18n at all), and the tree can render a link to a
> route that no longer exists. **Split it:** `enabled(featureKey, tenant)` is data and survives;
> label / icon / order / route / parent are code and move into the registry, where next-intl and the
> type system can see them.

### 11.7 Sequence

| # | Work | Gate |
|---|---|---|
| **M0** | `destinations.ts` + the `Destination` type + `FAMILIES`; populate from all five existing lists **with no UI change**. Declare `--seat-*`, `--grad-brand`, `--wash-hero` in both themes (§11.10). Add the ratchet (§11.7.1) baselined at today's numbers. | Every currently-reachable route resolves through the registry; every seat has a hue in both themes; ratchet green |
| **M1** | Left panel renders from the registry, grouped by stage, with collapsible headers. `burnrateCatalog.ts`, the `seat` group and the `dashboard` group are deleted. The public header drops `Home` and repoints its CTA at the canvas. `SlideOutPanel` gets its width control back. | Zero references to `burnrateCatalog`; no marketing href reachable from the app rail; the CTA lands on a board |
| **M2** | The footer is the only seat enumeration; a RUN row and a footer chip resolve to the same panel. | One roster endpoint, one seat list, drag + keyboard parity retained (§6.4, §6.5) |
| **M3** | Seat workbench index = `filter(parent === seat)`. Absorb `ADMIN_GROUP_META` and, as PRD 19 tracks land, the `system_features` leaves; demote that table to entitlement. **Flip the reference destinations to `surface:'panel'`** (§11.4.5) and fix their viewport-vs-container queries. | §6.3 still holds; every ported leaf has a `parent`; a signed-in `/soc2` opens over a board whose agent turn survives it |
| **M4** | Marketplace: four families from `FAMILIES`, the `company` listing kind, the claim flow surfaced, `publish` becomes a derived button. The `/agents` destination is deleted and becomes the `agent` family. | Browse → claim → verify → RUN activates; the CTA label and flow are derived, never written per tab |
| **M5** | Progressive disclosure through one `earned(rung)` helper; dim rows open a real preview. | A visitor sees every row; a claimed company activates eight seats |

Against PRD 18/19: **M0–M2 block no track's schema or API, and gate every track's left-panel
entry.** A track registers its destinations in the same pass that lands its surface — §5.1's rule,
restated for the menu.

#### 11.7.1 The ratchet — the item that makes it permanent

`frontend/scripts/check-destinations.mjs`, wired into `npm test` beside `check:design-tokens` and
`check:design-scale`:

1. **One declaration.** Any array literal outside `destinations.ts` whose elements carry both an
   `href`/`route` and a `labelKey`/`menuLabel` fails the build. Allowlist entries carry a written
   reason — the pattern §2.7 settled on after a count-based ratchet went slack.
2. **No duplicate labels.** Two rows resolving to the same `labelKey` fail.
3. **No marketing href in an app surface.** A `Destination.href` matching `PUBLIC_SHELL_PREFIXES`
   fails unless the row also sets `marketingHref` and the app rail reads `href`.
4. **Every seat is covered.** Each kernel `DOMAINS` entry either owns ≥1 destination or is
   explicitly `platform`.
5. **The registry count is deliberately NOT ratcheted** — PRD 18/19 add hundreds of leaves. What is
   ratcheted is the number of *registries*, and that number is 1.

**M0 and the ratchet land together.** Without it, M1–M5 are undone by the first track that ships a
surface — the same argument §5 makes about E6.

### 11.8 Acceptance criteria

1. `frontend/src/lib/destinations.ts` is the only file declaring a navigable destination's label,
   icon, href and parent. Enforced by `npm run check:destinations`.
2. No seat is enumerated in two places: the footer roster is the only seat list.
3. No in-app navigation control resolves to a route in `PUBLIC_SHELL_PREFIXES`.
4. The left panel renders `Idea · Make · Run · Measure · Market · Admin`, in that order, at every
   rung — rows dim, never disappear (§2.6 rule 7).
5. Every BurnRateOS `system_features` leaf and every hired.video page group has exactly one `parent`
   in the registry before its track's UI ships.
6. The marketplace exposes exactly four families from `FAMILIES`; the publish CTA's label **and**
   flow are derived from the active family, and `/agents` has zero references as a destination.
7. A company can be browsed unclaimed, claimed with verification, and the claim activates the RUN
   group and the eight business seats for that tenant.
8. Every registry string is a `labelKey` present in all five catalogs with real translations.
9. Both themes, 360px, `@container panel` for anything rendered inside a panel (§3.4).
10. `check:design-tokens`, `check:design-scale` and `check:destinations` all pass.
11. Every left-panel stage header collapses, is a `<button aria-expanded>`, and its state persists
    independently of the rail's collapsed state (§11.4.1).
12. `SlideOutPanel` exposes a keyboard-reachable three-step width control; the choice persists per
    destination and never remounts the stage (§11.4.4).
13. Every `surface:'panel'` destination renders identically signed out (as a page) and signed in
    (in `ShellPanel` at `full`), from one component, with its public URL unchanged (§11.4.5).
14. The public header has no `Home` item, and its primary CTA resolves to a real board (§11.4.6).
15. Every seat in kernel `DOMAINS` has a `--seat-*` token declared in both themes, no two seats
    share a hue, and no surface hard-codes a seat colour (§11.10.1).
16. The Features page renders its domain cards from the registry — title, seat, hue, stage and
    feature bullets — and carries no second copy of any of them (§11.10.3).
17. Both public and signed-in headers expose the same persisted cart; completing a free marketplace
    acquisition creates a queryable purchase-history row with a zero amount (§11.5.4).

### 11.9 Open decisions — operator, not engineering

Added to §7's two, which remain.

3. **"Run" vs "Real".** The operator's phrase is *idea to REAL*; the group's job is *running the
   business*. `REAL` is the better marketing word, `RUN` the better verb for a menu heading. §11
   currently writes `run`. *Blocks M1's copy and the `Stage` union.*
4. **Does the marketplace list a company that never opted in?** Browsing unclaimed rows is what
   makes the directory useful on day one, and it is how hired.video's employer profiles arrive. It
   also means publishing profiles of businesses that did not ask. A data-protection call, not a
   schema question. *Blocks M4.*
5. **Whose custom domain does a claimed company's storefront use** — the site-backend work (0412) or
   the whitelabel table PRD 18 T6 ports? Both exist; PRD 19 §2's one-owner rule applies and neither
   PRD has claimed the row. *Blocks M4's publish path.*
6. **"Things" vs "Assets"** for the fourth marketplace family (§11.5). The CTA test picked Assets;
   Things was the earlier draft. *Blocks M4's copy and the `Family` union.*

---

### 11.10 What the merge adds to the design system

§2 settles palette, type and scale for one product. Consolidating two products' menus adds exactly
three token families, and each one exists for the same reason: **a value that was being re-invented
per surface now has more than one reader.** Nothing here introduces a new colour — every value is
drawn from the eleven categorical hues §2.2 already declares.

#### 11.10.1 Seat hue — `--seat-*`

BurnRateOS assigns each domain a Mantine colour on its marketing cards. Builderforce's roster picks
its own. The canvas picks a third for agent objects. Twelve seats × three surfaces is how a CFO
ends up green in one place and blue in another, and it is the colour equivalent of the four-name
problem §11.1 describes.

**One declaration, both themes, five readers** — the roster chip, the nav row's seat badge, the
panel's top rule and index marker, the marketing card, and any chart series broken down by owner.

| Seat | Token | Categorical hue |
|---|---|---|
| CEO | `--seat-ceo` | violet |
| CFO | `--seat-cfo` | emerald |
| CRO | `--seat-cro` | amber |
| CMO | `--seat-cmo` | pink |
| CTO | `--seat-cto` | sky |
| CPO | `--seat-cpo` | yellow |
| HR | `--seat-hr` | teal |
| Recruiter | `--seat-recruiter` | orange |
| Security | `--seat-security` | red |
| Support | `--seat-support` | purple |
| Manager | `--seat-manager` | indigo |
| Brain | `--seat-brain` | the brand blue |

Twelve seats consume exactly the eleven categorical hues plus the brand — which is why §2.2's
eleventh hue was needed and is now spent. **A thirteenth seat needs a twelfth hue before it needs a
menu entry**, and that is a deliberate constraint on how many always-on seats the product grows.

Soft fills derive with `color-mix(in srgb, var(--seat-x) 12%, transparent)` rather than twelve more
tokens: the mix follows the base through both themes, so there is still one declaration per seat.

#### 11.10.2 Brand gradient — `--grad-brand`, `--wash-hero`

Ported from `burnrateos.com/features`, and deliberately restricted to **two positions on a page**:
the hero word-mark and the closing CTA band. `--wash-hero` is its ~8% tint for the hero ground.
Everything between them stays flat. A gradient that also appears on cards stops meaning *this is
the beginning or the end of the page* and becomes decoration, which is the failure mode §2.6 rule 1
guards against for colour generally.

#### 11.10.3 Marketing band rhythm

BurnRateOS ships **95 marketing pages built from `MarketingPageShell` plus six section primitives**
(Hero / FeatureGrid / NarrativeSplit / FAQ / FinalCTA / PartnerBadge). **Port the system, never the
pages** — hand-authoring a third marketing system is how a product gets a fourth.

The rhythm, which the Features page is the reference implementation of:

```
wash (hero + overview card)  →  tint (domain grid)  →  raised (foundations, dashed cards)
   →  tint (tier table)  →  raised (FAQ)  →  gradient (final CTA)
```

Five content bands and a close. A page that needs a sixth content band is two pages. The primitives
carry `.mk-*` names and sit beside the existing `.ui-*` set, because a marketing section and a
product surface are different contracts and merging their class namespaces is how `.card` came to
mean three things.

**Two DRY consequences worth naming, both visible in the mockup:**

1. **The features page is a registry projection.** Every domain card's title, seat badge, seat hue,
   stage pill and feature bullets come from the same array the left panel reads — so a features
   page cannot advertise a capability under a name the product does not use. This is the same rule
   as §11.4.6, applied to the page rather than the menu.
2. ~~**The FAQ disclosure is the nav disclosure.**~~ **Corrected on contact with the code,
   2026-08-09.** They are deliberately NOT one component. `/features` is a server component, so its
   FAQ is `<details>/<summary>` — the platform primitive, keyboard-correct and zero JS. The nav's
   stage header cannot be: it is controlled, its state persists per stage, and it has to stay shut
   when the rail collapses to icons. Forcing one component on two different contracts would have
   made the marketing page ship JavaScript to open a paragraph. Same `aria-expanded` contract, two
   implementations, and the reason is written at both call sites.

#### 11.10.4 What this adds to `check:design-tokens`

Three assertions, landing with M0:

1. Every seat in kernel `DOMAINS` has a `--seat-*` token declared in **both** themes.
2. No `--seat-*` value is used by more than one seat (a duplicate hue defeats the point).
3. `--grad-brand` appears at most twice per page (hero + CTA), enforced as a lint over `.mk-band`
   usage rather than a runtime check.

---

### 11.11 What shipped, and what did not — 2026-08-09

**Built.**

| Milestone | What landed |
|---|---|
| **M0** | `NavGroup` gains `seat`, `stage` and `rung`; `REFERENCE_DESTINATIONS`, `PUBLIC_NAV` and `bottomNavFor()` join it, so `navGroups.ts` is the one declaration site. `lib/seats.ts` + `--seat-*` / `--stage-*` / `--grad-brand` / `--wash-hero` in `globals.css`. `scripts/check-destinations.mjs` wired into `npm test`. |
| **M1** | The left panel renders the arc with collapsible, persisted stage headers and a seat badge in each RUN row's own hue. `burnrateCatalog.ts` **deleted** (12 rows moved onto the registry as reference destinations). The `seat` and `dashboard` rows **deleted**. The public header drops `Home`, folds Agents into Marketplace, and its CTA opens `/create/new`. `SlideOutPanel` gains the three-step width control, persisted per destination. |
| **M2** | `RosterNav` no longer renders on `/seat/<domain>` — it was a third seat enumeration beside the RUN rows and the footer. The footer is the only one. |
| **M3** (IA half) | `surface:'panel'` behaviour is live: the nine domain pages, `/soc2`, `/integrations` and `/features` are ordinary pages signed out and full-width panels over a mounted board signed in. |
| **M4** (IA half) | Four families from `FAMILIES`, kinds as sub-filters, and a publish CTA whose label **and** flow are derived. Every legacy `?category=` link still resolves. |
| **Features** | `/features` rebuilt on the ported band rhythm, every card projected from the registry, counts computed from it. |

**The ratchet earned its keep on day one.** It failed its first run against two lists nobody had
noticed: the marketing header's `FLAT_LINKS` and `MobileBottomNav`'s item table. Both were {href,
labelKey} arrays living beside the component that rendered them — the sixth and seventh registries,
found by a script rather than by a person. Both are now registry rows.

**Not built, and why.**

1. **M3's other half — the seat workbench index.** Level 2 is still each destination's existing tab
   set; `filter(parent === seat)` waits on the PRD 19 tracks that bring leaves to parent.
2. **M4's company directory and claim flow.** The `companies` table exists (PRD 20, investor
   domain) but is tenant-scoped with no nullable-owner column and no verification. The directory
   needs the company graph PRD 19 B0 brings *and* the answer to §7's decision 4. The family is
   therefore **visible and inert** with an honest line, per §2.6 rule 7 — not hidden.
3. **M5's preview state.** `earnedRung()` exists and dims what is unearned; clicking a dim row does
   not yet open its workbench in preview.
4. **Two entitlement helpers.** `earnedRung()` (three rungs: public / signed-in / workspace) and
   `RosterNav`'s `earned()` (PRD 20's manifest rungs) now coexist. Reconciling them is a *data*
   decision about the manifest's rung scale, not a UI one.
5. **The fourth rung.** "Claimed a company" cannot be enforced until a company can be claimed, so
   RUN rows sit at `WORKSPACE`. That is honest: they need a workspace, and there is not yet a
   company for them to need.
