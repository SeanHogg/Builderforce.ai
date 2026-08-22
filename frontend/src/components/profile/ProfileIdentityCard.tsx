'use client';

/**
 * WHO YOU ARE — one card, every account type (PRD 21 §5 E2, "port Settings and
 * Profile").
 *
 * The Settings Account view showed three read-only facts (email, display name,
 * user id) with no avatar and nothing editable, while a real identity editor
 * existed only at `/freelancer/profile` — so a builder who opted in to being
 * hired was sent to a page styled like a different product to change their own
 * name. The fork was never a product decision; the avatar upload has always
 * written `users.avatar_url`, which is to say it was always the USER's avatar
 * sitting behind a freelancer-shaped route.
 *
 * So this is the identity half, owned once. `/settings` renders it, and
 * `/freelancer/profile` renders the SAME component above its gig-specific
 * fields (headline, rate, alias, skills) — those extend the profile rather than
 * forking it, which is the shape the gap register asked for.
 *
 * It decides its own state: it reads the stored user, owns its own draft, and
 * persists on blur/Save. No caller passes a `canEdit` it could have computed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { getStoredUser, getStoredWebToken, updateMyDisplayName } from '@/lib/auth';
import { uploadMyAvatar } from '@/lib/freelance/talentProfile';

/** Initials are the fallback identity — legible at any size, unlike a title. */
function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * The avatar, wherever a person is shown at rest. Exported because the talent
 * surfaces render the same thing — one avatar, not a `TalentAvatar` beside a
 * builder one that drifts from it.
 */
export function ProfileAvatar({ displayName, avatarUrl, size = 64 }: {
  displayName?: string | null;
  avatarUrl?: string | null;
  size?: number;
}) {
  const common: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: 'var(--radius-full)',
    flexShrink: 0,
    objectFit: 'cover',
    border: '1px solid var(--border-subtle)',
  };
  // eslint-disable-next-line @next/next/no-img-element
  if (avatarUrl) return <img src={avatarUrl} alt="" style={common} />;
  return (
    <div
      style={{
        ...common,
        background: 'var(--surface-interactive)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: size * 0.36,
        color: 'var(--text-primary)',
      }}
    >
      {initials(displayName)}
    </div>
  );
}

export function ProfileIdentityCard({
  /** The talent editor already holds these in its own draft; it passes them so
   *  the two do not render different names while one of them is unsaved. */
  displayName: controlledName,
  avatarUrl: controlledAvatar,
  onDisplayNameChange,
  onAvatarChange,
}: {
  displayName?: string;
  avatarUrl?: string | null;
  onDisplayNameChange?: (next: string) => void;
  onAvatarChange?: (url: string) => void;
} = {}) {
  const t = useTranslations('profile');
  const user = getStoredUser();

  const controlled = onDisplayNameChange != null;
  const [ownName, setOwnName] = useState(user?.name ?? '');
  const [ownAvatar, setOwnAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const name = controlled ? (controlledName ?? '') : ownName;
  const avatarUrl = controlledAvatar !== undefined ? controlledAvatar : ownAvatar;

  useEffect(() => {
    if (!controlled) setOwnName(user?.name ?? '');
  }, [controlled, user?.name]);

  const setName = useCallback((next: string) => {
    if (onDisplayNameChange) onDisplayNameChange(next);
    else setOwnName(next);
  }, [onDisplayNameChange]);

  /** Only the uncontrolled (Settings) case saves — the talent editor has its own
   *  Save, and two writers of one field is how they disagree. */
  const save = useCallback(async () => {
    const token = getStoredWebToken();
    if (!token) return;
    setSaving(true);
    setNotice('');
    try {
      await updateMyDisplayName(token, ownName);
      setNotice(t('saved'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [ownName, t]);

  const onAvatarUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setNotice('');
    try {
      const { avatarUrl: uploaded } = await uploadMyAvatar(file);
      if (onAvatarChange) onAvatarChange(uploaded);
      else setOwnAvatar(uploaded);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('avatarFailed'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [onAvatarChange, t]);

  return (
    <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <ProfileAvatar displayName={name || user?.email} avatarUrl={avatarUrl} size={64} />
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <label className="ui-field__label" htmlFor="profile-display-name">{t('displayName')}</label>
        <input
          id="profile-display-name"
          className="ui-input"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('displayNamePlaceholder')}
        />
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
          {/* A file input is invisible by contract, so the label carries the
              button treatment — the primitive's classes, not a hand-rolled one. */}
          <label className="ui-button ui-button--secondary ui-button--sm">
            {uploading ? t('avatarUploading') : (avatarUrl ? t('avatarChange') : t('avatarUpload'))}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={onAvatarUpload}
              style={{ display: 'none' }}
            />
          </label>
          {!controlled && (
            <Button variant="primary" size="sm" loading={saving} onClick={save}>{t('save')}</Button>
          )}
        </div>
        {notice && (
          <p role="status" style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{notice}</p>
        )}
      </div>
    </div>
  );
}

export default ProfileIdentityCard;
