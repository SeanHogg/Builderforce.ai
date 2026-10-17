import { useTranslations } from 'next-intl';
import type { ChatMode } from '@/lib/brain';
import { StarterGroup, StarterTile } from './StarterTiles';
import { BrainMark } from '@seanhogg/builderforce-brain-ui';

export interface BrainEmptyStateProps {
  /**
   * `page` — the full Brain page: a centred hero with the composer in the middle.
   * `docked` — a side column: a compact greeting and the starter list scroll ABOVE a
   * composer the host pins at the bottom, in the same place it stays once the chat has
   * started, so the first message does not make the input jump.
   */
  layout: 'page' | 'docked';
  /** The armed mode — the hint and the starters follow it. Chosen in ONE place: the
   *  composer's `/` menu (Mode), the same control on every surface. */
  mode: ChatMode;
  /** Host-owned controls above the starters (the new-chat project picker). */
  controls?: React.ReactNode;
  /** Page layout only — docked hosts render the composer in their pinned footer. */
  composer?: React.ReactNode;
  /** The mode's starting points (`WorkOptionsPicker` / `BrainCapabilityPicker`). */
  starters: React.ReactNode;
  /** Seed an onboarding conversation. */
  onOnboard: () => void;
}

/**
 * A Brain conversation before its first message: a greeting, the host's controls and
 * the starting points, which follow the armed mode. The mode itself is chosen in the
 * composer's `/` menu — one Chat|Work control on every surface, not a second toggle here.
 *
 * There is no "Start new chat" button: this IS a new chat, and sending (or picking a
 * starter) creates it. That button and "Help me get started" used to sit as two
 * primary buttons between the greeting and the composer; onboarding is now one more
 * starting point in the list, where people look for one.
 */
export function BrainEmptyState({ layout, mode, controls, composer, starters, onOnboard }: BrainEmptyStateProps) {
  const t = useTranslations('brain');
  const docked = layout === 'docked';
  const hint = t(mode === 'work' ? 'emptyHintWork' : 'emptyHint');

  const switcher = controls ? (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: docked ? 'flex-start' : 'center' }}>
      {controls}
    </div>
  ) : null;

  const startingPoints = (
    <div style={{ width: '100%', maxWidth: docked ? undefined : 720, display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left' }}>
      {starters}
      <StarterGroup heading={t('onboardHeading')} ariaLabel={t('onboardHeading')}>
        <StarterTile icon="✨" label={t('onboardMe')} hint={t('onboardMeHint')} onClick={onOnboard} />
      </StarterGroup>
    </div>
  );

  if (docked) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span aria-hidden style={{ fontSize: 'var(--font-size-section)', lineHeight: 1, color: 'var(--accent)' }}><BrainMark /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 600, color: 'var(--text-primary)' }}>{t('emptyGreeting')}</div>
            <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>
          </div>
        </div>
        {switcher}
        {startingPoints}
      </div>
    );
  }

  return (
    <div className="bs-empty">
      <div style={{ fontSize: 'var(--font-size-page-title)' }}><BrainMark /></div>
      <div style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 500, color: 'var(--text-primary)' }}>{t('brainTitle')}</div>
      <div style={{ fontSize: 'var(--font-size-small)' }}>{hint}</div>
      {switcher}
      <div style={{ width: '100%', maxWidth: 720, marginTop: 12 }}>{composer}</div>
      {startingPoints}
    </div>
  );
}
