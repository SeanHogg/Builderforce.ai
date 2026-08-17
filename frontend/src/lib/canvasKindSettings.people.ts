/**
 * `agent` and `staff` — the two kinds the Persona panel serves.
 *
 * This is the manifest behind the bug that started this module: a built-in seat like a
 * board's CMO is `canvasPersonOrigin(kind) === 'builtin'` and must not be sellable, must
 * not have its name/role edited out from under the seat it represents, and its full
 * inspector must show the built-in workbench (Execute, diagnostics) rather than the
 * custom-agent authoring flow. `agent` additionally carries a `custom.component` for
 * the rich, per-instance authoring surface (personality, tools, knowledge, test bench)
 * — a real workflow with cross-node state, not a field list, so it stays a component
 * the manifest merely DISPATCHES to rather than one this module re-declares.
 */

import { registerKindSettings } from './canvasKindSettings';
import { canvasPersonOrigin } from './canvasNodeAffordances';

const identityEditable = (data: { kind: string }) => canvasPersonOrigin(data.kind) !== 'builtin';

registerKindSettings({
  kinds: ['agent'],
  marketplace: { sellable: (data) => canvasPersonOrigin(data.kind) === 'custom' },
  fields: [
    // `title` is NOT declared for the full surface: the inspector's universal name
    // field at the top of every kind's body already binds `data.title` — this only
    // adds the compact panel's copy, origin-locked the same way.
    { name: 'title', control: 'text', section: 'identity', labelKey: 'name', surface: 'compact', editable: identityEditable },
    { name: 'role', control: 'text', section: 'identity', labelKey: 'role', surface: 'compact', editable: identityEditable },
    { name: 'focus', control: 'textarea', section: 'basic', labelKey: 'focus', surface: 'compact' },
    // The full inspector's own Model select (with the real option list) lives in the
    // `agent` custom section below; this is the compact panel's simple text fallback.
    { name: 'model', control: 'text', section: 'advanced', labelKey: 'model', surface: 'compact', placeholderKey: 'modelPlaceholder' },
  ],
  actions: [],
  custom: { component: 'agent' },
});

registerKindSettings({
  kinds: ['staff'],
  // A role-catalog seat carries no separate listing to sell — it is not authored on
  // this board, so there is nothing here for the marketplace to take a copy of.
  marketplace: { sellable: () => false },
  // `role`/`focus` are declared once for each surface rather than `surface: 'both'`:
  // the compact panel's labels resolve under `creationCanvas.nodePanel` and the full
  // inspector's under plain `creationCanvas`, and those two catalogs do not share a
  // key for "current focus" (`focus` vs `currentFocus`) — one `labelKey` cannot serve
  // both without either catalog going stale.
  fields: [
    { name: 'title', control: 'text', section: 'identity', labelKey: 'name', surface: 'compact', editable: identityEditable },
    { name: 'role', control: 'text', section: 'identity', labelKey: 'role', surface: 'compact', editable: identityEditable },
    { name: 'focus', control: 'textarea', section: 'basic', labelKey: 'focus', surface: 'compact' },
    // Unlike `title` (now locked everywhere a seat is builtin — see the universal name
    // field in `CreationCanvas`), `role`/`focus` were never locked on the full surface
    // even for a builtin seat; keeping that means "what this seat is doing on THIS
    // board" stays editable there exactly as it always was.
    { name: 'role', control: 'text', section: 'basic', labelKey: 'role', surface: 'full' },
    { name: 'focus', control: 'textarea', section: 'basic', labelKey: 'currentFocus', surface: 'full' },
  ],
  actions: [],
});
