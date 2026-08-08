'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import BrainBackdrop from '@/components/BrainBackdrop';
import { ChatInput } from '@/components/ChatInput';
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
  { style: { left: '3%', top: '12%' } },
  { style: { left: '30%', top: '6%' } },
  { style: { right: '4%', top: '14%' } },
  { style: { left: '4%', top: '55%' } },
  { style: { right: '5%', top: '60%' } },
];

/** Index of the object that renders a chart preview, and of the live agent. */
const CHART_INDEX = 1;
const AGENT_INDEX = 2;

/** Bar heights for the chart preview. Decorative — never presented as data. */
const SPARK_BARS = ['38%', '62%', '88%', '47%', '71%', '96%'];

type CanvasObjectCopy = { kind: string; title: string; detail: string; prefill: string };

export function LandingCanvasHero() {
  const router = useRouter();
  const t = useTranslations('home');
  const [prompt, setPrompt] = useState('');
  const [focusToken, setFocusToken] = useState(0);
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
  function seedPrompt(text: string) {
    setPrompt(text);
    setFocusToken((token) => token + 1);
  }

  // One composer, declared once and placed in whichever layout renders — so the
  // wide and narrow heroes can never drift in what the composer can do.
  const composer = (
    <Composer
      value={prompt}
      onChange={setPrompt}
      onSubmit={() => startCreating(prompt)}
      focusToken={focusToken}
      chatMode={chatMode}
      onChatModeChange={setChatMode}
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
            <div className={styles.board} role="group" aria-label={t('canvas.boardAria')}>
              <div className={styles.field}>
                <svg
                  className={styles.wires}
                  viewBox="0 0 1240 500"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path className="solid" d="M227 100 C 300 100, 300 85, 372 85" />
                  <path d="M568 140 C 720 140, 840 300, 988 330" />
                  <path d="M240 313 C 500 313, 780 180, 1000 130" />
                </svg>

                {objects.map((object, index) => (
                  <button
                    key={object.title}
                    type="button"
                    className={styles.node}
                    style={OBJECT_LAYOUT[index]?.style}
                    onClick={() => seedPrompt(object.prefill)}
                    aria-label={t('canvas.objectAction', { title: object.title })}
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
function Composer({ value, onChange, onSubmit, focusToken, chatMode, onChatModeChange }: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  focusToken: number;
  chatMode: ChatMode;
  onChatModeChange: (mode: ChatMode) => void;
}) {
  const t = useTranslations('home');
  const examples = t.raw('heroExamples') as string[];
  return (
    <div className={styles.promptWrap}>
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
        focusToken={focusToken}
      />
      <div className={styles.chips}>
        {examples.map((example) => (
          <button key={example} type="button" className={styles.chip} onClick={() => onChange(example)}>
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
