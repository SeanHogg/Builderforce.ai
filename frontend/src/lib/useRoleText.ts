'use client';

import { useTranslations } from 'next-intl';

/**
 * The ONE localized vocabulary for a workspace role: its name, and what it lets a
 * person do.
 *
 * Replaces the English `ROLE_LABEL` / `ROLE_DESCRIPTION` maps that used to live in
 * `rbac.ts`. A role name is chrome and translates with the viewer's locale; the
 * English map leaked into every locale's role picker, and into two panels that
 * spliced it into an otherwise translated "Requires … role" sentence. Both messages
 * are ICU selects on the role KEY (`common.tenantRoleLabel`,
 * `common.tenantRoleDescription`) — the same shape `common.requiresRoleHint` uses —
 * so each locale owns the whole phrase and an unknown role renders as itself.
 */
export interface RoleText {
  label: (role: string) => string;
  description: (role: string) => string;
}

export function useRoleText(): RoleText {
  const t = useTranslations('common');
  return {
    label: (role) => t('tenantRoleLabel', { role }),
    description: (role) => t('tenantRoleDescription', { role }),
  };
}
