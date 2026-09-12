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

import { useCallback, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { signInHref } from '@/lib/auth';
import type { TeamRosterMember } from '@/lib/kernel/kernelApi';
import { isTeammateOnBoard, type BoardAgent } from '@/lib/canvas/boardAgents';
import { useTeamRoster } from '@/lib/team/useTeamRoster';
import {
  TEAMMATE_DND_MIME,
  requestTeammateJoin,
  serializeTeammate,
  type TeammatePayload,
} from '@/lib/team/teammate';
import { AnchoredPopover, ButtonLink } from '@/components/ui';
import { isStageRoute } from '@/lib/workbenchPolicy';
import styles from './TeamBar.module.css';

/** Identity survives compression; a title does not — the same rule the seat rail
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
  seat: member.seat,
  domain: member.domain,
});

function TeammateChip({ member, locallyAvailable = false, compact = false, onBoard = false }: { member: TeamRosterMember; locallyAvailable?: boolean; compact?: boolean; onBoard?: boolean }) {
  const t = useTranslations('team');
  const [dragging, setDragging] = useState(false);
  const locked = member.locked && !locallyAvailable;

  // Pressing a seat that is already on the board brings its card into view — the
  // board's own `seatTeammate` rule — so the same press serves both, and only the
  // label changes to say which one it will do.
  const join = useCallback(() => {
    if (locked) return;
    requestTeammateJoin(payloadOf(member));
  }, [locked, member]);

  const role = member.role ?? t('roleTeammate');
  const label = locked
    ? t('chipLocked', { name: member.name })
    : onBoard
      ? t('chipOnBoard', { name: member.name, role })
      : t('chipJoin', { name: member.name, role });

  return (
    <button
      type="button"
      className={compact ? styles.compactChip : styles.chip}
      data-kind={member.kind}
      data-on-board={onBoard ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      // The drag and the keypress are the same action; `onClick` covers `Enter`
      // and `Space` on a native button, which is the parity §3.3 requires.
      draggable={!locked}
      disabled={locked}
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
        ? <img className={styles.avatar} src={member.avatarUrl} alt="" width={20} height={20} />
        : <span className={styles.initials} aria-hidden="true">{initials(member.seat ?? member.name)}</span>}
      {/* The name and the availability dot are what a BAND has room for. The compact
          strip keeps the accessible name — which already carries both — and drops only
          the drawn text, so nothing is lost to a screen reader. */}
      {!compact && <>
        <span>{member.name}</span>
        <span className={styles.dot} data-availability={member.availability} aria-hidden="true" />
      </>}
    </button>
  );
}

/** How many seats the compact strip draws before it starts counting. Five 26px circles
 *  overlapping at -7px is ~103px, which is what the command bar can spare beside Run, the
 *  glyph clusters and the add-object circles without starting to scroll on a laptop. */
const COMPACT_TEAM_LIMIT = 5;

export interface TeamBarProps {
  /**
   * `band` — the shell's footer row, with names, availability dots and the invite link.
   * `bar`  — the canvas command bar's avatar strip: the same roster, the same chips, the
   *          same drag payload, drawn as overlapping initials because a bar has room for
   *          identity and not for job titles.
   *
   * ONE component for both, because the alternative is a second roster that reads a
   * second endpoint and drifts on who counts as always-on. `useTeamRoster` stays the
   * single source and `TeammateChip` stays the single chip.
   */
  variant?: 'band' | 'bar';
  /**
   * The agent cards on the board this strip sits under (`boardAgents`). Each seat
   * with a card there is ringed and drawn first, so the strip says who is working
   * on THIS board rather than only who could. Absent off a board.
   */
  onBoard?: readonly BoardAgent[];
}

const NO_BOARD_AGENTS: readonly BoardAgent[] = [];

export function TeamBar({ variant = 'band', onBoard = NO_BOARD_AGENTS }: TeamBarProps) {
  const t = useTranslations('team');
  const { hasTenant } = useAuth();
  const { members, loading } = useTeamRoster();
  const seated = (member: TeamRosterMember) => isTeammateOnBoard(member, onBoard);
  const pathname = usePathname() || '';
  const [overflowOpen, setOverflowOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const closeOverflow = useCallback(() => setOverflowOpen(false), []);

  // Nothing to show and nothing to explain yet — the bar appears with its data
  // rather than reserving an empty strip of chrome.
  if (loading && members.length === 0) return null;

  const alwaysOn = members.filter((m) => m.alwaysOn);
  const team = members.filter((m) => !m.alwaysOn);

  /**
   * THE BAND STANDS DOWN ON A STAGE ROUTE.
   *
   * It decides that itself, the way it already decides everything else about its own
   * visibility. A canvas gives the whole window to the board and floats its chrome over
   * it; a full-width roster strip pinned under that board is the last of the four bands
   * the redesign set out to remove, and it was the one still standing.
   *
   * The roster is not lost — the canvas renders this same component as `bar` inside its
   * command bar, where "who is always on" is a status slot that survives a collapse.
   */
  if (variant === 'band' && isStageRoute(pathname)) return null;

  if (variant === 'bar') {
    // On this board first — a seat with a card here is working here, and must not be
    // the one pushed into the overflow. Then always-on, then invited humans; the
    // overflow carries whoever did not fit.
    const byRoster = [...alwaysOn, ...team];
    const ordered = [...byRoster.filter(seated), ...byRoster.filter((member) => !seated(member))];
    if (ordered.length === 0) return null;
    const shown = ordered.slice(0, COMPACT_TEAM_LIMIT);
    const rest = ordered.slice(COMPACT_TEAM_LIMIT);
    return (
      <div className={styles.compact} role="group" aria-label={t('alwaysOn')}>
        {shown.map((member) => <TeammateChip key={member.id} member={member} locallyAvailable compact onBoard={seated(member)} />)}
        {rest.length > 0 && <>
          {/* Not a link and not a truncation: it opens the rest as the SAME chips, so a
              seat that did not fit is one press away rather than unreachable. */}
          <button
            ref={moreRef}
            type="button"
            className={styles.compactMore}
            data-on-board={rest.some(seated) ? 'true' : 'false'}
            aria-expanded={overflowOpen}
            aria-haspopup="true"
            aria-label={t('moreSeats', { count: rest.length })}
            title={t('moreSeats', { count: rest.length })}
            onClick={() => setOverflowOpen((open) => !open)}
          >{`+${rest.length}`}</button>
          {/* PORTALLED, not absolutely positioned inside the strip. This strip lives in the
              canvas command bar — a `z-index:20` floating card — and the panel opens upward
              into the band the prompt composer (`z-index:21`) occupies. Nested inside, no
              z-index could lift it out of the bar's stacking context, so the panel was drawn
              and then painted over: pressing `+6` looked like it did nothing. The layer now
              places itself against the viewport, above every float on the board.
              `above` because the bar is at the bottom of the window. */}
          <AnchoredPopover
            open={overflowOpen}
            anchorRef={moreRef}
            onDismiss={closeOverflow}
            placement="above"
            align="end"
            gap={10}
            className={styles.compactOverflow}
            role="group"
            aria-label={t('moreSeats', { count: rest.length })}
            /* Joining a teammate is what this panel is FOR, so it closes on the way out
               rather than sitting over the board the seat was just dropped onto. */
            onClick={closeOverflow}
          >
            {rest.map((member) => <TeammateChip key={member.id} member={member} locallyAvailable onBoard={seated(member)} />)}
          </AnchoredPopover>
        </>}
      </div>
    );
  }

  // Creation Canvas owns sharing in its session bar, including account-free
  // guest links. Repeating an account-backed workforce invite in this footer is
  // both a duplicate action and, for local canvases, a contradiction.
  const canvasOwnsInvites = isStageRoute(pathname);
  const invite = hasTenant
    ? { href: '/workforce', label: t('invite') }
    : { href: signInHref(pathname), label: t('inviteSignedOut') };

  return (
    <div className={styles.bar} role="group" aria-label={t('barLabel')}>
      {alwaysOn.length > 0 && (
        <div className={styles.group}>
          <span className={styles.eyebrow}>{t('alwaysOn')}</span>
          <div className={styles.chips}>
            {alwaysOn.map((member) => <TeammateChip key={member.id} member={member} locallyAvailable={canvasOwnsInvites} />)}
          </div>
        </div>
      )}
      <div className={styles.group}>
        <span className={styles.eyebrow}>{t('team')}</span>
        <div className={styles.chips}>
          {team.map((member) => <TeammateChip key={member.id} member={member} locallyAvailable={canvasOwnsInvites} />)}
        </div>
        {!canvasOwnsInvites && <ButtonLink href={invite.href} variant="ghost" size="sm" className={styles.invite}>
          {invite.label}
        </ButtonLink>}
      </div>
    </div>
  );
}
