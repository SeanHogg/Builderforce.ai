'use client';

/**
 * The footer roster — the team (PRD 21 §3.3, §4).
 *
 * "**A seat is a teammate, not a menu.**" PRD 20 §3 already assigns every bounded
 * context an owner; that column is this bar, so the always-on C-suite agents sit
 * beside the humans you invited in ONE chip shape — because to a session they are
 * the same kind of participant.
 *
 * Three rules this component is the enforcement of:
 *
 *  - **One roster.** It reads `useTeamRoster()`, which is one endpoint returning
 *    one row shape, rather than merging an agents list with a members list.
 *  - **Keyboard parity is mandatory.** Every chip is a `<button>`: `Enter` /
 *    `Space` joins exactly as a drag does, through the same payload. A drag is
 *    never the only route in.
 *  - **Disable, never hide.** A seat with nothing provisioned behind it renders
 *    dimmed and inert with an explanation, because hiding it turns "not set up
 *    yet" into "this product cannot do that".
 *
 * It decides its own visibility: no board on the stage means nothing to drop a
 * teammate onto, so it returns null rather than taking a `canShow` prop the
 * caller would have had to compute.
 */

import { useCallback, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { signInHref } from '@/lib/auth';
import type { TeamRosterMember } from '@/lib/kernel/kernelApi';
import { useTeamRoster } from '@/lib/team/useTeamRoster';
import {
  TEAMMATE_DND_MIME,
  requestTeammateJoin,
  serializeTeammate,
  type TeammatePayload,
} from '@/lib/team/teammate';
import { ButtonLink } from '@/components/ui';
import styles from './TeamBar.module.css';

/** Identity survives compression; a title does not — the same rule `RosterNav`
 *  applies to seats, applied to people. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

const payloadOf = (member: TeamRosterMember): TeammatePayload => ({
  kind: member.kind,
  ref: member.id,
  name: member.name,
  role: member.role,
});

function TeammateChip({ member }: { member: TeamRosterMember }) {
  const t = useTranslations('team');
  const [dragging, setDragging] = useState(false);

  const join = useCallback(() => {
    if (member.locked) return;
    requestTeammateJoin(payloadOf(member));
  }, [member]);

  const label = member.locked
    ? t('chipLocked', { name: member.name })
    : t('chipJoin', { name: member.name, role: member.role ?? t('roleTeammate') });

  return (
    <button
      type="button"
      className={styles.chip}
      data-kind={member.kind}
      data-dragging={dragging ? 'true' : 'false'}
      // The drag and the keypress are the same action; `onClick` covers `Enter`
      // and `Space` on a native button, which is the parity §3.3 requires.
      draggable={!member.locked}
      disabled={member.locked}
      onClick={join}
      onDragStart={(event) => {
        event.dataTransfer.setData(TEAMMATE_DND_MIME, serializeTeammate(payloadOf(member)));
        event.dataTransfer.effectAllowed = 'copy';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      title={label}
      aria-label={label}
    >
      {member.avatarUrl
        ? <img className={styles.avatar} src={member.avatarUrl} alt="" />
        : <span className={styles.initials} aria-hidden="true">{initials(member.seat ?? member.name)}</span>}
      <span>{member.name}</span>
      <span className={styles.dot} data-availability={member.availability} aria-hidden="true" />
    </button>
  );
}

export function TeamBar() {
  const t = useTranslations('team');
  const { hasTenant } = useAuth();
  const { members, loading } = useTeamRoster();
  const pathname = usePathname() || '';

  // Nothing to show and nothing to explain yet — the bar appears with its data
  // rather than reserving an empty strip of chrome.
  if (loading && members.length === 0) return null;

  const alwaysOn = members.filter((m) => m.alwaysOn);
  const team = members.filter((m) => !m.alwaysOn);
  // Creation Canvas owns sharing in its session bar, including account-free
  // guest links. Repeating an account-backed workforce invite in this footer is
  // both a duplicate action and, for local canvases, a contradiction.
  const canvasOwnsInvites = pathname.startsWith('/create/');
  const invite = hasTenant
    ? { href: '/workforce', label: t('invite') }
    : { href: signInHref(pathname), label: t('inviteSignedOut') };

  return (
    <div className={styles.bar} role="group" aria-label={t('barLabel')}>
      {alwaysOn.length > 0 && (
        <div className={styles.group}>
          <span className={styles.eyebrow}>{t('alwaysOn')}</span>
          <div className={styles.chips}>
            {alwaysOn.map((member) => <TeammateChip key={member.id} member={member} />)}
          </div>
        </div>
      )}
      <div className={styles.group}>
        <span className={styles.eyebrow}>{t('team')}</span>
        <div className={styles.chips}>
          {team.map((member) => <TeammateChip key={member.id} member={member} />)}
        </div>
        {!canvasOwnsInvites && <ButtonLink href={invite.href} variant="ghost" size="sm" className={styles.invite}>
          {invite.label}
        </ButtonLink>}
      </div>
    </div>
  );
}
