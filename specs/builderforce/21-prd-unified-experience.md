# PRD 21 — The Unified Experience: one design system, one canvas shell, and the 549 destinations that never become pages

> **Status:** BUILT (E0–E6) · 2026-08-08
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
| Panel primitive | `frontend/src/components/SlideOutPanel.tsx` (`width: 'sheet' \| 'wide' \| 'full'`, `crumb`, `index`) |
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
| **E5** | Primitive migration sweep + delete `freelance/formStyles.ts` | Literal-hex and off-scale-radius counts drop | ◑ the parallel vocabulary is deleted and its consumers moved onto `.ui-*`; the wider sweep across the remaining call sites is the ratchet's job now |
| **E6** | Two guard ratchets wired into `npm test` | The build fails on a new literal hex or off-scale radius | ✅ `check:design-scale`, shrink-only in both directions |

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
