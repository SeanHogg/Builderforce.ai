import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import styles from './styles/brain.module.css';
import chromeStyles from './styles/chrome.module.css';
import { BrainSurface, type BrainSurfaceBodyProps } from './BrainSurface';
import { BrainSurfaceViewProvider } from './brainSurfaceView';
import { BrainSurfaceActions } from './BrainSurfaceActions';
import { memberAvatarClass, memberInitials } from './rosterAvatar';
import type { CanvasRosterMember } from './types';
import { SurfaceHeader } from '@seanhogg/builderforce-brain-ui';

/**
 * The conversation as the whole canvas — the zero-object case of the board.
 *
 * ── WHY THIS IS A SURFACE AND NOT A PAGE ─────────────────────────────────────────
 * Someone arriving with a question lands on a board offering ~95 object kinds, which is
 * a hostile first screen for "what does this error mean?". The obvious fix — a separate
 * /chat page — would fork the product: a second transcript, a second composer, a second
 * model control, and a conversation that can never become anything. So chat is the same
 * canvas with the board stood down. Nothing is duplicated, and the board is one press
 * away the moment the conversation produces something worth keeping.
 *
 * That is the whole point of the placement: the surface GRADUATES. Objects Brain
 * materialises during a chat land on the board behind it, and the footer says so with a
 * live count — so "just asking" turns into "I have a board" without a migration, an
 * import, or a decision made up front.
 *
 * ── THE PEOPLE IN IT, AND NOT THE NAME ───────────────────────────────────────────
 * The same roster the command bar's collapsed cluster shows is drawn here too. It is the
 * SAME `rosterMembers` array (see `CreationCanvas.tsx`), not a second read: a participant
 * added to this conversation is a participant added to the session, and therefore already
 * on the board the moment the conversation graduates into one.
 *
 * The session's NAME is not in here. This header used to open with it, which put a
 * read-only copy of the title directly underneath the floating session pill — the pill is
 * at `top:14px` and this surface starts at the shell's top edge — so the name was painted
 * over by the same name, with only its last few characters showing between the cards. The
 * pill is the one that can be EDITED, so the pill is the one that stays.
 *
 * There is no invite button here either. It opened the same share sheet the Share button
 * opens, which is one decision with two controls — the exact duplicate the command bar's
 * roster had its own `+` removed for. The roster reports who is here; Share is the door.
 *
 * ── WHAT IS DELIBERATELY NOT IN HERE ─────────────────────────────────────────────
 * The body is `BrainSurface`, verbatim — the SAME component the edge dock and the inline
 * Brain Object render. A third copy of the chat is the one thing this placement must
 * never become. The prompt is not OWNED here either — it is THE canvas composer — but it
 * is DOCKED here: when Brain is the surface there is no board for a floating prompt to sit
 * over, so the canvas hands it in (`effectiveCanvasPromptPlacement`) and it is the
 * footer's last row of this one reading column, like every chat product people know.
 */

/** The roster shape is shared with the play surface — see `CanvasRosterMember`. */
export type CanvasChatSurfaceMember = CanvasRosterMember;

export interface CanvasChatSurfaceProps extends BrainSurfaceBodyProps {
  onExecutionDetailChange: (show: boolean) => void;
  /** Hand the board back. Also what the header's dismiss does — closing the
   *  conversation when it IS the page can only mean "show me the board". */
  onOpenBoard: () => void;
  /** Objects already on the board behind this conversation. */
  objectCount: number;
  /** Who is in this session — the SAME roster the command bar's cluster shows. */
  participants: readonly CanvasChatSurfaceMember[];
  /** THE canvas prompt, docked as this surface's footer. Absent while the host owns the
   *  input or the canvas is presenting. */
  composer?: ReactNode;
}

export function CanvasChatSurface({
  onExecutionDetailChange, onOpenBoard, objectCount, participants, composer, ...body
}: CanvasChatSurfaceProps) {
  const t = useTranslations('creationCanvas');

  return (
    <BrainSurfaceViewProvider>
    <BrainSurface
      {...body}
      className={styles.chatSurface}
      footerClassName={styles.chatSurfaceFooter}
      label={t('surface.chat.label')}
      dataAttrs={{ 'data-testid': 'canvas-chat-surface' }}
      header={<SurfaceHeader
        className={styles.chatSurfaceHeader}
        title={t('brain')}
        running={body.running}
        // The same roster the command bar's collapsed cluster draws — participants are
        // part of the conversation, not a fact the bar alone reports.
        presence={<span className={styles.chatSurfaceParticipants} aria-label={t('surface.chat.participants')}>
          {participants.slice(0, 4).map((member, index) => (
            <span
              key={member.userId}
              className={memberAvatarClass(index, { pink: chromeStyles.avatarPink, orange: chromeStyles.avatarOrange, green: chromeStyles.avatarGreen })}
              title={member.displayName ?? undefined}
            >{memberInitials(member.displayName)}</span>
          ))}
        </span>}
        // The shared controls decide for themselves which apply here: the execution-detail
        // toggle and nothing else — no `onModeChange` (no board to move into) and no
        // `onClose` (dismissing a conversation that IS the page would leave nothing). The
        // way out is the footer, and the surface switcher on the rail.
        actions={<BrainSurfaceActions
          mode="docked"
          showExecutionDetail={body.showExecutionDetail}
          onExecutionDetailChange={onExecutionDetailChange}
        />}
      />}
      composer={composer}
      footnote={<button type="button" className={styles.chatSurfaceOpenBoard} onClick={onOpenBoard}>
        <span aria-hidden><Icon source="◰" size="1em" /></span>
        {t('surface.chat.openBoard', { count: objectCount })}
      </button>}
    />
    </BrainSurfaceViewProvider>
  );
}
