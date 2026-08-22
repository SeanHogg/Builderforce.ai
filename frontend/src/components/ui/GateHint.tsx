/**
 * The lock pill a GATE shows over the thing it is gating.
 *
 * There are three gates in this product and they deliberately share one visual
 * grammar: `RoleGate` (you need a role), `UpgradeGate` (you need a plan) and
 * `SessionGate` (you need an account). All three follow the same product rule —
 * *indicate the gate, never hide the feature* — so all three dim the surface and
 * float the same pill over it saying what is missing.
 *
 * It lives here because it was written twice. `SessionGate` was added as the
 * third member of the family and copied `RoleGate`'s `lockPillStyle` verbatim,
 * shadow and all — which is exactly how a shared grammar stops being shared: the
 * next person to adjust the pill adjusts one of two, and the gates start looking
 * like different mechanisms for the same idea.
 *
 * Presentational only. It takes the message and renders it; every gate keeps its
 * own decision about WHEN to show one, which is the part that differs.
 *
 * No `'use client'`, matching `Icon`, `Badge` and `Surface` — the other leaves in
 * this folder. It holds no state, no handler and no hook, so it renders the same
 * on either side of the boundary; the gates that render it declare their own.
 * That is not a licence to strip the directive from a shared component in
 * general — one with a hook in it needs the declaration wherever it is mounted —
 * only the observation that this file has nothing to declare.
 */

import type { CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';

const pill: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 'var(--font-size-small)', fontWeight: 600, padding: '6px 12px',
  borderRadius: 'var(--radius-full)',
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)', boxShadow: '0 1px 6px rgba(0,0,0,0.14)',
};

export function GateHint({ children }: { children: React.ReactNode }) {
  return (
    <span style={pill}>
      <Icon source="lock" size="1em" /> {children}
    </span>
  );
}
