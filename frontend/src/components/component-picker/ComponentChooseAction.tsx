'use client';

import { useTranslations } from 'next-intl';
import { usePermission, type Capability } from '@/lib/rbac';
import type { ComponentDef } from '@/lib/components/types';

/**
 * USE THIS ONE — the picker's errand when a surface is choosing exactly one
 * component rather than collecting several.
 *
 * The board mounts one component per card, so choosing is a commit-and-close
 * rather than a toggle. Kept beside the picker rather than inside the canvas
 * because there is nothing about a board in it: any surface that stores a single
 * `componentId` — a settings field, a published page's slot — wants this same
 * button and the same entitlement rule behind it.
 *
 * Self-gating for the reason every action here is: the picker cannot know what a
 * given errand is asking permission for. A component the reader cannot access is
 * shown with its button DISABLED rather than hidden, which is the same rule
 * `RoleGate` follows — and disabled rather than absent so the reader can see the
 * thing exists and ask for it.
 */
export function ComponentChooseAction({
  def,
  current,
  onChoose,
}: {
  def: ComponentDef;
  /** The id already chosen, so the row for it reads "in use" instead of offering
   *  an action that would change nothing. */
  current?: string;
  onChoose: (def: ComponentDef) => void;
}) {
  const t = useTranslations('components');
  const gate = usePermission((def.capability ?? 'insights.aiImpact') as Capability);
  const allowed = !def.capability || gate.allowed;
  const chosen = current === def.id;

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onChoose(def); }}
      disabled={!allowed || chosen}
      aria-label={chosen ? t('inUse') : t('use')}
      style={{
        flexShrink: 0,
        minHeight: 32,
        padding: '5px 12px',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${chosen ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
        background: chosen ? 'var(--coral-bright)' : 'transparent',
        color: chosen ? 'var(--text-on-accent)' : allowed ? 'var(--text-primary)' : 'var(--text-muted)',
        cursor: allowed && !chosen ? 'pointer' : 'default',
        fontSize: '0.8rem',
      }}
    >
      {chosen ? t('inUse') : t('use')}
    </button>
  );
}
