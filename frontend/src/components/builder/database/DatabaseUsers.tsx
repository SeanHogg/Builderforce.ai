// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, SectionEmpty, SectionError, SectionLoading } from '@/components/ui';
import { useConfirm } from '@/components/ConfirmProvider';
import { InlineConfirmButton } from '@/components/InlineConfirmButton';
import { faultText } from '@/lib/apiClient';
import { useFormat } from '@/i18n/useFormat';
import type { SiteUser } from '@/lib/growthApi';
import { useSiteUsers } from './useSiteUsers';

/**
 * Everyone who signed in to the app. Sign-in is a one-time email code, so there
 * is no password to reset — the levers are suspend (signs them out everywhere)
 * and remove.
 */
export function DatabaseUsers({ projectId }: { projectId: number }) {
  const t = useTranslations('builderDatabase.users');
  const confirm = useConfirm();
  const { users, hasMore, loadError, loadMore, setStatus, remove } = useSiteUsers(projectId);
  const [failure, setFailure] = useState<string | null>(null);

  const attempt = async (action: () => Promise<unknown>) => {
    setFailure(null);
    try { await action(); } catch (cause) { setFailure(faultText(cause, t('failed'))); }
  };

  if (users === null) return loadError ? <SectionError error={loadError} /> : <SectionLoading label={t('loading')} />;

  const removeUser = async (user: SiteUser) => {
    if (await confirm({ message: t('removeConfirm', { email: user.email }), confirmLabel: t('remove'), destructive: true })) {
      await attempt(() => remove(user.id));
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('intro')}</p>
      {failure && <p role="alert" style={{ margin: 0, color: 'var(--error-text)', fontSize: 'var(--font-size-small)' }}>{failure}</p>}
      {users.length === 0 ? (
        <SectionEmpty message={t('empty')} />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {users.map((user) => (
            <UserRow key={user.id} user={user}
              onSuspend={() => attempt(() => setStatus(user.id, 'suspended'))}
              onReinstate={() => attempt(() => setStatus(user.id, 'active'))}
              onRemove={() => removeUser(user)} />
          ))}
        </ul>
      )}
      {hasMore && (
        <Button type="button" size="sm" variant="secondary" onClick={() => { void attempt(loadMore); }} style={{ justifySelf: 'start' }}>
          {t('loadMore')}
        </Button>
      )}
    </div>
  );
}

function UserRow({ user, onSuspend, onReinstate, onRemove }: {
  user: SiteUser;
  onSuspend: () => Promise<void>;
  onReinstate: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const t = useTranslations('builderDatabase.users');
  const fmt = useFormat();
  const suspended = user.status === 'suspended';

  return (
    <li style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', padding: 10, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div style={{ display: 'grid', gap: 2, minWidth: 0, flex: '1 1 14rem' }}>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', color: 'var(--text-primary)', fontWeight: 600, overflowWrap: 'anywhere' }}>
          {user.displayName ? `${user.displayName} · ${user.email}` : user.email}
          <Badge tone={suspended ? 'warning' : 'success'}>{suspended ? t('suspended') : t('active')}</Badge>
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
          {t('meta', { joined: fmt.dateTime(user.createdAt), seen: user.lastSeenAt ? fmt.dateTime(user.lastSeenAt) : t('never') })}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {suspended ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => { void onReinstate(); }}>{t('reinstate')}</Button>
        ) : (
          <InlineConfirmButton className="ui-button ui-button--secondary ui-button--sm" confirmLabel={t('suspendConfirm')} hint={t('suspendHint')} onConfirm={onSuspend}>
            {t('suspend')}
          </InlineConfirmButton>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={() => { void onRemove(); }}>{t('remove')}</Button>
      </div>
    </li>
  );
}
