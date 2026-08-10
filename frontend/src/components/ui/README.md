# Builderforce UI system

The UI system is the shared presentation contract for public pages, the Creation
Canvas, and authenticated application surfaces. Theme values live in
`src/app/globals.css`; React primitives in this directory expose those values
without creating a second palette or spacing scale.

## Foundations

- Base spacing: 4px (`--space-1`) through 48px (`--space-12`).
- Controls: 32px compact, 36px default, 44px large/touch.
- Radius: 6px small, 8px control, 12px panel, 16px feature surface.
- Borders: `--border-default` and `--border-strong`; avoid literal border colors.
- Surfaces: page, panel, raised, and sunken. Use semantic surface tokens instead
  of white/black literals.
- Focus: every interactive primitive uses `--focus-ring`. Do not remove focus
  treatment unless an equivalent visible treatment is provided.
- Shadows: `--shadow-xs`, `--shadow-sm`, and `--shadow-lg`. Light mode uses warm
  neutral shade; dark mode uses matte depth. Accent glow is not an elevation.

## Components

- `Button` / `ButtonLink`: primary, secondary, ghost, and danger variants; small,
  default, and large sizes. One primary action per action group.
- `Surface`: panel, raised, sunken, or accent container. `interactive` is reserved
  for surfaces that actually navigate or select.
- `Badge`: status metadata, not a substitute for headings or buttons.
- `TextField` / `TextAreaField`: label, hint, optional marker, and error wiring.
- `PageHeader`: canonical title, description, eyebrow, and action layout.
- `EmptyState`: canonical icon, explanation, and recovery action layout.

Legacy `.btn`, `.card`, `.input`, and `.badge-*` call sites map to the same CSS
contract. New code should use the React primitives; existing screens can migrate
incrementally without visual drift.

## Page patterns

- Marketing: comfortable density, large type, deliberate whitespace. The homepage
  keeps the Creation Canvas as the centerpiece and uses Evermind as its foundation.
- Product: compact controls and tables, persistent navigation, the same surface and
  state semantics as marketing.
- Editorial/media: readable line length, raised media surface, quiet metadata.
- Pricing/commerce: `Surface` cards and semantic comparison states; do not introduce
  a pricing-only button or badge family.
- Mobile: 44px touch controls, stacked `PageHeader`, horizontally scrollable tabs,
  and no desktop-only hover dependency.

## Theme rules

Components must render from tokens in both themes. Light mode is warm stock with
opaque white elevation and neutral shade; dark mode is deep ink with matte navy
elevation. The canonical logo keeps its gradient, but violet is not a general UI
accent. Do not add theme-specific component markup unless the information itself
changes.

## Content and accessibility

All user-visible copy, including `aria-label` and tooltips, comes from locale
catalogs. Preserve semantic elements, keyboard operation, visible focus, reduced
motion support, and WCAG-readable status contrast. Color never carries status
without text or an icon.
