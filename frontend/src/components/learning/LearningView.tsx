'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PathDirectory } from './PathDirectory';
import { PathDetailPanel } from './PathDetailPanel';
import { CourseCatalogue } from './CourseCatalogue';
import { PrerequisiteEditor } from './PrerequisiteEditor';
import { LrsCredentialPanel } from './LrsCredentialPanel';
import styles from './learning.module.css';

/** The three things this surface is for. A tab is DATA here, so a fourth is a row
 *  in this array rather than another branch in the body. */
const TABS = ['paths', 'catalogue', 'lrs'] as const;
type Tab = (typeof TABS)[number];

/**
 * The composed Learning surface.
 *
 * Three states live here and nowhere else, because they are the only things the
 * panels share: which tab is open, which path is selected, and which course is
 * selected. Every panel owns its own fetching, its own entitlement and its own
 * empty state, so this file does not grow when any of them does.
 *
 * `LrsCredentialPanel` renders nothing at all for somebody who cannot manage the
 * workspace's keys, so there is no condition here about who may see it — the tab
 * is still offered, and it explains itself when empty.
 */
export function LearningView() {
  const t = useTranslations('learning');
  const [tab, setTab] = useState<Tab>('paths');
  const [pathId, setPathId] = useState<number | null>(null);
  const [courseId, setCourseId] = useState<number | null>(null);
  // Bumped when a panel changes something the directory shows (a status, a course
  // count). The directory stays the owner of its own data; this only asks.
  const [reloadToken, setReloadToken] = useState(0);

  return (
    <div>
      <div className={styles.tabs} role="tablist" aria-label={t('tabs.label')}>
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={styles.tab}
            onClick={() => setTab(name)}
          >
            {t(`tabs.${name}`)}
          </button>
        ))}
      </div>

      {tab === 'paths' && (
        <div className={styles.grid}>
          <PathDirectory
            selectedId={pathId}
            onSelect={(path) => setPathId(path.id)}
            reloadToken={reloadToken}
          />
          {pathId !== null && (
            <PathDetailPanel pathId={pathId} onChanged={() => setReloadToken((n) => n + 1)} />
          )}
        </div>
      )}

      {tab === 'catalogue' && (
        <div className={styles.grid}>
          <CourseCatalogue selectedId={courseId} onSelect={(gate) => setCourseId(gate.courseId)} />
          {courseId !== null && <PrerequisiteEditor courseId={courseId} />}
        </div>
      )}

      {tab === 'lrs' && (
        <div className={styles.grid}>
          <LrsCredentialPanel />
        </div>
      )}
    </div>
  );
}
