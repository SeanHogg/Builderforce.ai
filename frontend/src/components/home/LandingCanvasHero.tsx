'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import BrainBackdrop from '@/components/BrainBackdrop';
import { ChatInput } from '@/components/ChatInput';
import { PromptUseCasePicker } from '@/components/PromptUseCasePicker';
import { startGuestCreationSession } from '@/lib/guestPromptCapture';
import { NEW_CHAT_MODE, type ChatMode } from '@/lib/brain';
import { useIsMobile } from '@/lib/useIsMobile';
import styles from './LandingCanvasHero.module.css';

/**
 * The homepage hero IS the Creation Canvas.
 *
 * A visitor lands on a board that already has connected objects on it and a
 * composer sitting bottom-centre — the product argues for itself instead of
 * being described. Submitting (or clicking a seeded object and submitting) opens
 * a real guest canvas at `/create/{id}` with no account, exactly as the previous
 * hero prompt did; `CreationSessionClient` claims the local draft on sign-in.
 *
 * Two deliberate constraints:
 *
 * 1. This is a SEEDED PREVIEW, not a mounted `CreationCanvas`. The real canvas is
 *    ~4,400 lines plus a flow engine, and putting it above the fold would trade
 *    the homepage's first paint for a surface whose test suite cannot currently
 *    give a verdict. The preview paints instantly and hands off on first intent.
 * 2. The board is not rendered at all on narrow viewports — an infinite pan/zoom
 *    surface is the wrong first touch on a phone. Narrow gets the same copy and
 *    the same composer in normal flow, over the Evermind brain animation that
 *    the wide hero trades away for the board. The scene is a dark art surface in
 *    both themes (like the canvas board), so the narrow hero declares its own
 *    light-on-dark palette rather than inheriting the app shell's tokens.
 *
 * Neither the board nor the brain is rendered on the server or the first client
 * paint, so the headline and composer are painted before any of it is laid out.
 */

/**
 * Non-translatable geometry for the seeded objects, paired with the localized
 * `home.canvas.objects` array BY INDEX — the same convention the landing page
 * already uses for FEATURES icons. Keep both arrays the same length and order.
 */
const OBJECT_LAYOUT: { style: React.CSSProperties }[] = [
  { style: { left: '52%', top: '10%' } },
  { style: { left: '27%', top: '3%' } },
  { style: { right: '2%', top: '10%' } },
  { style: { left: '28%', top: '60%' } },
  { style: { right: '2%', top: '58%' } },
  { style: { left: '2%', top: '10%' } },
  { style: { left: '3%', top: '58%' } },
  { style: { left: '53%', top: '58%' } },
];

/** Index of the object that renders a chart preview, and of the live agent. */
const CHART_INDEX = 1;
const AGENT_INDEX = 2;

/** Bar heights for the chart preview. Decorative — never presented as data. */
const SPARK_BARS = ['38%', '62%', '88%', '47%', '71%', '96%'];

type CanvasObjectCopy = { kind: string; title: string; detail: string; prefill: string };

/**
 * A teammate in the board's footer roster. The C-suite agents are TEAM MEMBERS
 * who are always available, not navigation — so the preview shows them where the
 * product shows them (along the bottom of the canvas, beside the people you
 * invited) rather than implying they are a menu somewhere.
 */
type CanvasTeammateCopy = { short: string; name: string; prefill: string };

/**
 * What a click on the board seeded. Both the objects and the footer roster seed
 * the composer identically, so they share one selection shape rather than two
 * parallel `selectedX` states that could drift out of sync.
 */
type Seeded = { group: 'object' | 'teammate'; index: number };

export function LandingCanvasHero() {
  const router = useRouter();
  const t = useTranslations('home');
  const [prompt, setPrompt] = useState('');
  const [seeded, setSeeded] = useState<Seeded | null>(null);
  const [canvasRevealed, setCanvasRevealed] = useState(false);
  const [lensActive, setLensActive] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const blurRef = useRef<HTMLDivElement>(null);
  // The visitor's first turn is armed HERE, before the canvas exists — so the mode
  // rides into the guest session rather than being a control that did nothing.
  const [chatMode, setChatMode] = useState<ChatMode>(NEW_CHAT_MODE);

  // The board mounts only after the copy has painted, and only when the viewport
  // is wide enough to pan a board on. `useIsMobile` reports false on the server
  // and the first paint, so `mounted` is what actually gates the board.
  const isNarrow = useIsMobile(899);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const showBoard = mounted && !isNarrow;
  // Narrow gets the brain instead of the board — one of the two, never neither.
  const showBrain = mounted && isNarrow;

  const objects = t.raw('canvas.objects') as CanvasObjectCopy[];
  const teammates = t.raw('canvas.team') as CanvasTeammateCopy[];
  const presenceInitials = t.raw('canvas.presenceInitials') as string[];

  useEffect(() => {
    function resetWhenClickingOutside(event: PointerEvent) {
      if (boardRef.current?.contains(event.target as Node)) return;
      setSeeded(null);
      setCanvasRevealed(false);
      setLensActive(false);
    }

    document.addEventListener('pointerdown', resetWhenClickingOutside);
    return () => document.removeEventListener('pointerdown', resetWhenClickingOutside);
  }, []);

  function startCreating(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Creation starts without an account. The browser draft is claimed by
    // CreationSessionClient once the visitor signs in and has a workspace.
    // The intent is recorded BEFORE the navigation, by the shared starter.
    // Everything after this line happens in the browser and then a page later,
    // so waiting for the canvas's first model call would keep no record at all
    // of the visitors who bounced on the way — exactly the drop-off worth
    // knowing about. The capture is `keepalive` and never delays the push.
    router.push(`/create/${startGuestCreationSession(trimmed, { mode: chatMode, surface: 'landing' })}`);
  }

  /** Seed the composer instead of navigating: the board is an invitation. */
  function seedPrompt(text: string, group: Seeded['group'], index: number) {
    setPrompt(text);
    setSeeded({ group, index });
    setCanvasRevealed(false);
  }

  const isSeeded = (group: Seeded['group'], index: number) =>
    seeded?.group === group && seeded.index === index;

  function moveLens(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    blurRef.current?.style.setProperty('--lens-x', `${event.clientX - bounds.left}px`);
    blurRef.current?.style.setProperty('--lens-y', `${event.clientY - bounds.top}px`);
    setLensActive(true);
  }

  function resetFromCanvasBackground(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('[data-canvas-object], [data-canvas-prompt]')) return;
    setSeeded(null);
    setCanvasRevealed(false);
  }

  // One composer, declared once and placed in whichever layout renders — so the
  // wide and narrow heroes can never drift in what the composer can do.
  const composer = (
    <Composer
      value={prompt}
      onChange={setPrompt}
      onSubmit={() => startCreating(prompt)}
      chatMode={chatMode}
      onChatModeChange={setChatMode}
      onEngage={() => setCanvasRevealed(true)}
    />
  );

  return (
    <section className={`${styles.hero}${showBrain ? ` ${styles.heroBrain}` : ''}`}>
      {showBrain && <BrainBackdrop className={styles.brain} />}

      <div className={styles.inner}>
        <span className={styles.badge}>
          <span className={styles.badgeDot} aria-hidden="true" />
          {t('heroBadge')}
        </span>

        <h1 className={styles.title}>
          {t.rich('heroTitle', { em: (chunks) => <em>{chunks}</em> })}
        </h1>
        <p className={styles.lede}>{t('heroSub')}</p>

        <div className={`${styles.stage} ${showBoard ? '' : styles.stageNarrow}`}>
          {showBoard && (
            <div
              ref={boardRef}
              className={`${styles.board}${canvasRevealed ? ` ${styles.boardRevealed}` : ''}`}
              role="group"
              aria-label={t('canvas.boardAria')}
              data-revealed={canvasRevealed}
              onPointerMove={moveLens}
              onPointerLeave={() => setLensActive(false)}
              onPointerDown={resetFromCanvasBackground}
            >
              {/* Session bar — the board is a live room with people in it, not a
                  static illustration. Sits under the veil so it blurs with the
                  rest of the board. */}
              <div className={styles.chrome}>
                <span className={styles.liveDot} aria-hidden="true" />
                <span className={styles.chromeTitle}>{t('canvas.sessionTitle')}</span>
                <span className={styles.facepile} aria-label={t('canvas.presenceAria')}>
                  {presenceInitials.map((initials) => (
                    <em key={initials} className={styles.face}>{initials}</em>
                  ))}
                </span>
              </div>

              <div className={styles.field}>
                <svg
                  className={styles.wires}
                  viewBox="0 0 1240 500"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path className="solid" d="M190 92 C 235 92, 260 82, 330 82" />
                  <path d="M175 295 C 260 295, 280 235, 365 235" />
                  <path d="M475 235 C 565 235, 610 285, 690 285" />
                  <path d="M785 285 C 815 230, 790 135, 735 105" />
                  <path d="M790 105 C 860 105, 885 265, 1030 285" />
                  <path d="M790 105 C 875 105, 945 95, 1040 95" />
                </svg>

                {objects.map((object, index) => (
                  <button
                    key={object.title}
                    type="button"
                    className={[
                      styles.node,
                      index === AGENT_INDEX ? styles.nodeAgent : '',
                      isSeeded('object', index) ? styles.nodeSelected : '',
                    ].filter(Boolean).join(' ')}
                    style={OBJECT_LAYOUT[index]?.style}
                    onClick={() => seedPrompt(object.prefill, 'object', index)}
                    aria-label={t('canvas.objectAction', { title: object.title })}
                    aria-pressed={isSeeded('object', index)}
                    data-canvas-object
                  >
                    <span className={styles.nodeKind}>{object.kind}</span>
                    <span className={styles.nodeTitle}>{object.title}</span>
                    <span className={styles.nodeDetail}>{object.detail}</span>

                    {index === CHART_INDEX && (
                      <span className={styles.spark} aria-hidden="true">
                        {SPARK_BARS.map((height) => <i key={height} style={{ height }} />)}
                      </span>
                    )}

                    {index === AGENT_INDEX && (
                      <span className={styles.who}>
                        <em className={styles.whoAvatar} aria-hidden="true">{t('canvas.agentInitials')}</em>
                        <span className={styles.whoLabel}>{t('canvas.agentPresence')}</span>
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* The roster. The C-suite agents are teammates who are always
                  available, so they sit along the bottom beside the people you
                  invited — and clicking one seeds the composer with what it would
                  be brought in to do, the same invitation the objects make. */}
              <div className={styles.team}>
                <span className={styles.teamLabel}>{t('canvas.alwaysOn')}</span>
                {teammates.map((mate, index) => (
                  <button
                    key={mate.short}
                    type="button"
                    className={`${styles.teamChip}${isSeeded('teammate', index) ? ` ${styles.teamChipSelected}` : ''}`}
                    onClick={() => seedPrompt(mate.prefill, 'teammate', index)}
                    aria-label={t('canvas.teammateAction', { name: mate.name })}
                    aria-pressed={isSeeded('teammate', index)}
                    data-canvas-object
                  >
                    <em className={styles.teamAvatar} aria-hidden="true">{mate.short}</em>
                    {mate.name}
                  </button>
                ))}
              </div>

              <div
                ref={blurRef}
                className={`${styles.blurVeil}${lensActive ? ` ${styles.blurVeilLens}` : ''}`}
                aria-hidden="true"
              />

              {composer}
            </div>
          )}

          {!showBoard && composer}
        </div>

        <p className={styles.footRow}>
          <strong>{t('canvas.guestNote')}</strong>
          {!showBoard && mounted && <span className={styles.narrowNote}>{t('canvas.narrowNote')}</span>}
        </p>
      </div>
    </section>
  );
}

/**
 * The one composer. Rendered inside the board on wide viewports and in normal
 * flow on narrow ones — same state, same submit, so the "start creating" path
 * can never drift between the two layouts.
 *
 * It is the SAME `ChatInput` the canvas uses, with the same `/` menu, so the first
 * prompt a visitor types is typed into the control they will keep using. What it
 * does NOT offer is anything an account-less visitor cannot have: no attachments,
 * no model pin, no memory — those need a tenant behind them, and a control that
 * cannot do what it says is worse than no control.
 */
function Composer({ value, onChange, onSubmit, chatMode, onChatModeChange, onEngage }: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  chatMode: ChatMode;
  onChatModeChange: (mode: ChatMode) => void;
  onEngage: () => void;
}) {
  const t = useTranslations('home');
  return (
    <div
      className={styles.promptWrap}
      data-canvas-prompt
      onPointerDownCapture={onEngage}
      onFocusCapture={onEngage}
    >
      <ChatInput
        className={styles.prompt}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={t('heroPromptPlaceholder')}
        ariaLabel={t('heroPromptAria')}
        submitLabel={t('heroGetStarted')}
        rows={2}
        submitOnEnter
        showVoice
        chatMode={chatMode}
        onChatModeChange={onChatModeChange}
      />
      <PromptUseCasePicker placement="bottom" onSelect={onChange} />
    </div>
  );
}
