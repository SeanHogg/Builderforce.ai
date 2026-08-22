'use client';

import { Icon } from '@/components/ui/Icon';
import { useTranslations } from 'next-intl';
import { usePermission, type Capability } from '@/lib/rbac';
import type { ComponentDef } from '@/lib/components/types';
import { PinButton } from './PinButton';

/**
 * PIN THIS ONE TO MY DASHBOARD — the dashboard's errand in the component picker.
 *
 * Self-gating, and it has to be: only the action knows what it is asking
 * permission FOR. `ComponentPicker` offers a component to two surfaces with two
 * different grants behind them, so a picker that decided entitlement centrally
 * would be deciding it for an errand it cannot see.
 *
 * A component the reader cannot access is SHOWN with its control replaced by a
 * lock rather than hidden — the same product rule `RoleGate` follows everywhere
 * else. Hiding it would make the catalogue silently differ per reader, and
 * "where did that go" is a worse experience than "you cannot have this yet".
 */
export function ComponentPinAction({ def }: { def: ComponentDef }) {
  const t = useTranslations('components');
  // A component with no declared capability is ungated; `usePermission` still has
  // to be called unconditionally, so it is asked about a harmless one and the
  // answer is discarded.
  const gate = usePermission((def.capability ?? 'insights.aiImpact') as Capability);
  const allowed = !def.capability || gate.allowed;

  if (!allowed) {
    return (
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }} title={t('locked')} aria-label={t('locked')}>
        <Icon source="🔒" size="1em" />
      </span>
    );
  }
  return <PinButton widgetKey={def.id} />;
}
