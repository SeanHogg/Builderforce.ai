import type { CSSProperties } from 'react';

/**
 * THE FOUR STYLES A STEP'S OWN EDITOR IS DRAWN WITH.
 *
 * Most step kinds declare typed `fields` and are rendered by `StepConfigForm`'s own
 * CSS module. A few cannot: their options come from something live — the tenant's
 * connector catalog, the canvases they have — so they bring their own editor
 * (`stepFieldEditors.tsx`). Those editors sit INSIDE the shared form and have to
 * look like the fields above and below them, which is why the styles are here and
 * not copied into each one.
 *
 * Every colour is a token. A literal hex here would read correctly in exactly one
 * theme, and the editor is rendered on the canvas inspector and in the standalone
 * builder, both of which follow the viewer's.
 */

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '7px 9px',
  // The SAME role `.input` names in `StepConfigForm.module.css` — these styles
  // exist to look like the fields above and below them, and a hand-typed size is
  // exactly how that stops being true.
  fontSize: 'var(--font-size-small)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
  marginTop: 3,
};

/** Native `<option>` needs its own opaque colours — the popup does not inherit
 *  the control's theme on every platform. */
export const optionStyle: CSSProperties = {
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
};

export const labelStyle: CSSProperties = {
  // `.field` — same role, same weight, same colour.
  fontSize: 'var(--font-size-eyebrow)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  display: 'block',
};

export const hintStyle: CSSProperties = {
  // `.identity small` — the module's own hint role.
  fontSize: 'var(--font-size-eyebrow)',
  color: 'var(--text-muted)',
  marginTop: 4,
  lineHeight: 1.5,
};
