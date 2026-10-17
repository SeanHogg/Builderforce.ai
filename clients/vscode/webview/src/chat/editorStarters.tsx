/**
 * The editor chat's FIXED starting points — one list, shown two ways: as the empty
 * state's starter tiles before the first message, and as the composer's suggestion
 * chips once a chat is under way. Never a model call; picking one seeds the composer
 * and the person edits and sends it.
 */

import type { ReactNode } from 'react';
import { HeaderIcon, StarterGroup, StarterTile, SurfaceEmptyState } from '@seanhogg/builderforce-brain-ui';

export interface EditorStarter {
  id: 'review' | 'tests' | 'explain';
  label: string;
  /** What picking it puts in the box — also the tile's one-line hint. */
  prompt: string;
  icon: ReactNode;
}

export function editorStarters(t: (key: string, fallback: string) => string): EditorStarter[] {
  return [
    {
      id: 'review',
      label: t('app.suggestReview', 'Review my changes'),
      prompt: t('app.suggestReviewPrompt', 'Review my uncommitted changes and point out anything risky.'),
      // A branch-and-merge mark: the working tree's changes.
      icon: <HeaderIcon d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9" />,
    },
    {
      id: 'tests',
      label: t('app.suggestTests', 'Write tests'),
      prompt: t('app.suggestTestsPrompt', 'Write tests for the file I have open.'),
      // A flask.
      icon: <HeaderIcon d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10" />,
    },
    {
      id: 'explain',
      label: t('app.suggestExplain', 'Explain this file'),
      prompt: t('app.suggestExplainPrompt', 'Explain how the file I have open works.'),
      // A page with lines.
      icon: <HeaderIcon d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6M8 13h8M8 17h5" />,
    },
  ];
}

/** A new chat before its first message: the shared docked empty state with these starters. */
export function EditorEmptyState({ t, onPick }: {
  t: (key: string, fallback: string) => string;
  /** Seed the composer with a starter's prompt. */
  onPick: (prompt: string) => void;
}) {
  return (
    <SurfaceEmptyState
      layout="docked"
      title={t('app.emptyTitle', 'What are we working on?')}
      hint={t('app.emptyHint', 'Ask about this workspace, or start from one of these.')}
      starters={(
        <StarterGroup heading={t('app.startersHeading', 'Start with')}>
          {editorStarters(t).map((s) => (
            <StarterTile key={s.id} icon={s.icon} label={s.label} hint={s.prompt} onClick={() => onPick(s.prompt)} />
          ))}
        </StarterGroup>
      )}
    />
  );
}
