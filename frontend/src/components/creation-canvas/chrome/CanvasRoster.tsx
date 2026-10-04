import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { memberAvatarClass, memberInitials } from '../rosterAvatar';
import type { useCanvasBrainSurface } from '../hooks/useCanvasBrainSurface';
import styles from '../CreationCanvas.module.css';

/** Faces drawn on the bar before the roster stops growing. */
const VISIBLE_MEMBERS = 4;
const AVATAR_CLASSES = { pink: styles.avatarPink, orange: styles.avatarOrange, green: styles.avatarGreen };

export interface CanvasRosterProps {
  members: ReturnType<typeof useCanvasBrainSurface>['rosterMembers'];
  followingUserId: string | null;
  currentUserId: string | null;
  /** Follow a collaborator's viewport, or stop following them. */
  setFollowingUserId: (value: string | null | ((current: string | null) => string | null)) => void;
}

/**
 * WHO IS HERE is the single most important thing a folded bar can still say.
 * A collapsed roster is a team nobody can see is working, and on a shared
 * board that is somebody editing next to people they cannot see.
 */
export const CanvasRoster = memo(function CanvasRoster({ members, followingUserId, currentUserId, setFollowingUserId }: CanvasRosterProps) {
  const t = useTranslations('creationCanvas');
  return <div className={styles.collaborators} aria-label={t('activeCollaborators')} data-tour="creation-collaborators">
            {members.slice(0, VISIBLE_MEMBERS).map((member, index) => <button key={member.userId} type="button" data-typing={'typing' in member && member.typing ? 'true' : 'false'} aria-pressed={followingUserId === member.userId} title={`${member.displayName || t('collaborator')} · ${member.role}${'typing' in member && member.typing ? ` · ${t('writingPrompt')}` : ''}${member.userId !== currentUserId ? ` · ${t('clickToFollow')}` : ''}`} onClick={() => { if (member.userId !== currentUserId && member.userId !== 'local') setFollowingUserId((current) => current === member.userId ? null : member.userId); }} className={memberAvatarClass(index, AVATAR_CLASSES)}>{memberInitials(member.displayName)}</button>)}
            {/* The roster's `+` used to open the invite sheet — the same sheet the
                Share button opens, which is one decision with two controls and the
                exact failure the surface registry was written to prevent. The roster
                now only reports who is here; Share is the door. */}
          </div>;
});
