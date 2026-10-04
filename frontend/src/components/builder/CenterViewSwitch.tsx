// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useTranslations } from 'next-intl';
import { Icon, type IconName } from '@/components/ui/Icon';
import styles from './workspaceChrome.module.css';

export type CenterView = 'preview' | 'code' | 'database';

/** A project that publishes a site has a database (its tables, sign-ins and server functions); the rest have only preview and code. */
export const centerViewsFor = (publishPanel: string): CenterView[] =>
  publishPanel === 'site' ? ['preview', 'code', 'database'] : ['preview', 'code'];

const VIEW_META: Record<CenterView, { icon: IconName; label: 'centerPreview' | 'centerCode' | 'centerDatabase' }> = {
  preview: { icon: 'eye', label: 'centerPreview' },
  code: { icon: 'code', label: 'centerCode' },
  database: { icon: 'database', label: 'centerDatabase' },
};

/**
 * Preview | Code | Data — the one switch for what fills the workspace, in the
 * header.
 *
 * On a narrow screen the chat and the workspace take turns, so `chat` adds a
 * Chat segment in front: one control decides what fills the screen. A project
 * type with no views of its own (`views` empty) gets a single segment named
 * `workLabel` for its workspace.
 */
export function CenterViewSwitch({ views, value, onChange, chat, workLabel }: {
  views: readonly CenterView[];
  value: CenterView;
  onChange: (view: CenterView) => void;
  chat?: { active: boolean; onSelect: () => void };
  workLabel?: string;
}) {
  const t = useTranslations('ide');
  const chatActive = chat?.active ?? false;
  return (
    <div role="group" aria-label={t('workspace.viewSwitch')} className={styles.segmented}>
      {chat && (
        <button type="button" aria-pressed={chatActive} onClick={chat.onSelect} className={styles.segment}>
          <Icon name="message" size={15} />
          {t('workspace.chat')}
        </button>
      )}
      {views.length === 0 && workLabel && (
        <button type="button" aria-pressed={!chatActive} onClick={() => onChange(value)} className={styles.segment}>
          <Icon name="apps" size={15} />
          {workLabel}
        </button>
      )}
      {views.map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={!chatActive && value === view}
          onClick={() => onChange(view)}
          className={styles.segment}
        >
          <Icon name={VIEW_META[view].icon} size={15} />
          {t(VIEW_META[view].label)}
        </button>
      ))}
    </div>
  );
}
