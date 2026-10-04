import { useMemo, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { GuestInviteLink } from '@/components/guest/GuestInviteLink';
import { GuestCollaboratorNotice } from '@/components/guest/GuestCollaboratorNotice';
import { creationSessionsApi, type CreationSessionDetail, type CreationSessionInvitation, type CreationSessionSummary } from '@/lib/builderforceApi';
import { canvasWebOrigin } from '@/lib/canvasHost';
import { copyTextToClipboard } from '@/lib/useCopyToClipboard';
import { faultText } from '@/lib/apiClient';
import type { SharedCanvasRoom } from '@/domains/canvas/presentation/useSharedCanvasRoom';
import { CanvasInviteLinkPanel } from '../CanvasInviteLinkPanel';
import { useCanvasSessionFacts } from './canvasSessionContext';
import styles from '../CreationCanvas.module.css';

type SessionRole = CreationSessionSummary['role'];
type SessionMember = CreationSessionDetail['members'][number];

/** Every role a collaborator can hold, in the order both pickers list them. */
const SESSION_ROLES: ReadonlyArray<{ value: SessionRole; label: 'roleViewer' | 'roleCommenter' | 'roleEditor' | 'roleRunner' | 'roleOwner' }> = [
  { value: 'viewer', label: 'roleViewer' },
  { value: 'commenter', label: 'roleCommenter' },
  { value: 'editor', label: 'roleEditor' },
  { value: 'runner', label: 'roleRunner' },
  { value: 'owner', label: 'roleOwner' },
];

const LIST_ROW_STYLE: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 6, marginTop: 8 };
const PENDING_LIST_STYLE: CSSProperties = { marginTop: 10 };

/**
 * The address and role being typed, held by the HOST so the draft survives the sheet
 * being closed and reopened — as it did when these were two `useState`s in `CanvasInner`.
 */
export function useInviteDraft() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<SessionRole>('editor');
  return useMemo(() => ({ email, setEmail, role, setRole }), [email, role]);
}

function RoleOptions() {
  const t = useTranslations('creationCanvas');
  return <>{SESSION_ROLES.map((role) => <option key={role.value} value={role.value}>{t(role.label)}</option>)}</>;
}

export interface CanvasInviteSheetProps {
  open: boolean;
  onClose: () => void;
  /** This account-less board is being shared through a guest room right now. */
  inRoom: boolean;
  sharedRoom: Pick<SharedCanvasRoom, 'code' | 'full' | 'participants' | 'busy' | 'leave' | 'start'>;
  draft: ReturnType<typeof useInviteDraft>;
  currentUserId: string | null;
  allMembers: CreationSessionDetail['members'];
  setAllMembers: Dispatch<SetStateAction<CreationSessionDetail['members']>>;
  pendingInvitations: CreationSessionInvitation[];
  setPendingInvitations: Dispatch<SetStateAction<CreationSessionInvitation[]>>;
}

/**
 * THE INVITE SHEET — opened by the roster's own trailing chip now (`.rosterInvite`
 * in `CanvasCommandBar`), so it is built by the host and handed down as its own prop
 * rather than nested inside `handoffChrome`: the panel anchors `right:0` against
 * whichever `position:relative` box renders it, and that box has to be the one
 * sitting right under the button that opened it, not the doors-out group at the
 * OTHER end of the bar.
 */
export function CanvasInviteSheet({ open, onClose, inRoom, sharedRoom, draft, currentUserId, allMembers, setAllMembers, pendingInvitations, setPendingInvitations }: CanvasInviteSheetProps) {
  const t = useTranslations('creationCanvas');
  const { sessionId, persistence, role: sessionRole, notify, requireAccount } = useCanvasSessionFacts();
  if (!open) return null;
  const invite = () => { void creationSessionsApi.invite(sessionId, { email: draft.email.trim() }, draft.role).then(async (result) => { if ('acceptPath' in result) { await copyTextToClipboard(`${canvasWebOrigin()}${result.acceptPath}`); setPendingInvitations((current) => [...current.filter((item) => item.id !== result.invitationId), { id: result.invitationId, email: result.email, role: result.role as SessionRole, expiresAt: result.expiresAt, acceptedAt: null, revokedAt: null, createdAt: new Date().toISOString() }]); notify(result.emailSent ? t('invitationEmailed') : t('invitationSavedLinkCopied')); } else { const detail = await creationSessionsApi.get(sessionId); setAllMembers(detail.members); notify(result.emailSent ? t('collaboratorInvitedEmail') : t('collaboratorInvited')); } draft.setEmail(''); }).catch((error) => notify(faultText(error, t('inviteFailed')))); };
  const changeRole = (member: SessionMember, role: SessionRole) => { void creationSessionsApi.members.update(sessionId, member.userId, role).then(() => setAllMembers((current) => current.map((item) => item.userId === member.userId ? { ...item, role } : item))).catch((error) => notify(faultText(error, t('roleUpdateFailed')))); };
  const removeMember = (member: SessionMember) => { void creationSessionsApi.members.remove(sessionId, member.userId).then(() => setAllMembers((current) => current.filter((item) => item.userId !== member.userId))).catch((error) => notify(faultText(error, t('memberRemovalFailed')))); };
  const revokeInvitation = (invitation: CreationSessionInvitation) => { void creationSessionsApi.invitations.revoke(sessionId, invitation.id).then(() => { setPendingInvitations((current) => current.filter((item) => item.id !== invitation.id)); notify(t('invitationRevoked')); }).catch((error) => notify(faultText(error, t('invitationRevokeFailed')))); };
  return <div className={styles.shareMenu} role="dialog" aria-label={t('inviteCollaborators')}>
    <div className={styles.shareMenuHeader}>
      <strong>{t('inviteCollaborators')}</strong>
      <button type="button" className={styles.shareMenuClose} aria-label={t('closeInvitationPanel')} onClick={onClose}>×</button>
    </div>
    <p>{persistence === 'local' ? (inRoom ? t('sharedLiveHint') : t('sharedInviteHint')) : t('invitedCanBuild')}</p>
    {/* NO ACCOUNT: invite by link into a shared free session. Everyone edits
        the same board and shares one free-message allowance; signing up is
        offered as the way to KEEP it, not as the price of sharing it. */}
    {persistence === 'local' ? (sharedRoom.code ? <>
      <GuestInviteLink code={sharedRoom.code} surface="canvas" full={sharedRoom.full} />
      <div className={styles.shareRoomPeople} aria-label={t('sharedPeopleHere', { count: sharedRoom.participants.length })}>
        {sharedRoom.participants.map((person) => <span key={`${person.name}-${person.joinedAt}`}>{person.name}{person.isHost ? ` ${t('sharedHostTag')}` : ''}</span>)}
      </div>
      <div className={styles.shareRoomActions}>
        <button type="button" onClick={() => void sharedRoom.leave()}>{t('sharedStopSharing')}</button>
        <button type="button" onClick={() => requireAccount('save', t('gateSaveSessionTitle'), t('gateSaveBody'))}>{t('sharedSaveToKeep')}</button>
      </div>
      {/* No call button here. "Get someone in here" and "talk to them" are one
          errand, but they are not one CONTROL: the call is a session action in
          the bar on every surface and in both auth states, and a second copy in
          this panel would be one decision with two homes. */}
    </> : <button disabled={sharedRoom.busy} onClick={() => void sharedRoom.start()}>{sharedRoom.busy ? t('sharedStarting') : t('sharedStart')}</button>) : <>
      {/* SIGNED IN, and the link half of sharing — the half that did not exist.
          A logged-out visitor could always start a room and send the URL; the moment
          somebody signed up, "share this" became an address field and an email the
          recipient had to sign in to redeem. Both motions live here now, in this order,
          because the link is the one that works when all you have is a chat window.
          The panel is owner-gated and decides that itself. */}
      <CanvasInviteLinkPanel sessionId={sessionId} role={sessionRole} />
      <div><input value={draft.email} onChange={(event) => draft.setEmail(event.target.value)} placeholder={t('emailPlaceholder')} /><select aria-label={t('invitationRole')} value={draft.role} onChange={(event) => draft.setRole(event.target.value as SessionRole)}><RoleOptions /></select><button disabled={!draft.email.trim()} onClick={invite}>{t('invite')}</button></div>
      {sessionRole === 'owner' && <div aria-label={t('sessionMembers')}>{allMembers.map((member) => <div key={member.userId} style={LIST_ROW_STYLE}>
        <span>{member.displayName || t('collaborator')}{member.userId === currentUserId ? ` ${t('youSuffix')}` : ''}</span>
        <select aria-label={t('roleFor', { name: member.displayName || member.userId })} value={member.role} onChange={(event) => changeRole(member, event.target.value as SessionRole)}><RoleOptions /></select>
        <button type="button" disabled={member.userId === currentUserId} aria-label={t('removeMember', { name: member.displayName || t('member') })} onClick={() => removeMember(member)}>×</button>
      </div>)}{!!pendingInvitations.length && <div aria-label={t('pendingInvitations')} style={PENDING_LIST_STYLE}><strong>{t('pendingInvitations')}</strong>{pendingInvitations.map((invitation) => <div key={invitation.id} style={LIST_ROW_STYLE}>
        <span>{invitation.email}</span><small>{invitation.role}</small><button type="button" aria-label={t('revokeInvitation', { email: invitation.email })} onClick={() => revokeInvitation(invitation)}>×</button>
      </div>)}</div>}</div>}
    </>}
    <small>{t('accessLabel', { access: persistence === 'local' ? (inRoom ? t('sharedAnyoneWithLink') : t('privateOnDevice')) : draft.role })}</small>
    {/* The other side of the same link: somebody who took one and declined to sign up.
        They are a real member of this board, so this is an offer of a workspace of
        their own — never a wall. It shows itself only to a guest identity. */}
    <GuestCollaboratorNotice />
  </div>;
}
