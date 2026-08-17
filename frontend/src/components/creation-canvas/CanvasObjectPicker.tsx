// No 'use client': rendered only inside `CreationCanvas`'s client boundary.
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { SearchPicker, type SearchPickerSection } from '@/components/ui/SearchPicker';
import type { CreationObjectGroup, CreationObjectKind } from './types';
import { CREATION_PALETTE_GROUPS } from './creationObjectRegistry';
import styles from './CreationCanvas.module.css';

/**
 * ONE picker, two doors.
 *
 * The board needs "choose an object" in two places that look nothing alike: the centre
 * `+` on a node (insert the next step, connected to this one) and the coloured circles on
 * the command bar (add something to the board). They are the same question, so they are
 * the same component — anchored differently and told what they are adding TO.
 *
 * The alternative, which is what the mockup review kept describing as six popovers, is a
 * hand-written module list per category. That list goes stale the first time a kind is
 * added to `creationObjectRegistry` and not to the bar, and the object then exists, is
 * authorable by Brain, and is unreachable by a person. So the contents come from
 * `CREATION_PALETTE_GROUPS` and nothing here knows any kind's name.
 *
 * The search/filter/keyboard-close/outside-click interaction itself lives in the shared
 * `SearchPicker` — the workflow builder's step picker needs the exact same behaviour over
 * a completely different catalog, so only the catalog mapping and the canvas's own theme
 * classes live here.
 */

export interface CanvasObjectPickerProps {
  /** Where it opens, in screen px. */
  anchor: { x: number; y: number };
  /** The group it opens on. Absent = every group, which is the bar's "all" circle. */
  group?: CreationObjectGroup;
  /**
   * The node this insert hangs off. Present when the centre `+` opened it: the chosen
   * object is created beside that node AND connected to it, which is the difference
   * between "add a step" and "add an object".
   */
  fromNodeId?: string;
  onPick: (kind: CreationObjectKind, fromNodeId?: string) => void;
  onClose: () => void;
}

const PICKER_CLASS_NAMES = {
  root: styles.objectPicker,
  search: styles.objectPickerSearch,
  close: styles.objectPickerClose,
  rows: styles.objectPickerRows,
  rail: styles.objectPickerRail,
  list: styles.objectPickerList,
  icon: styles.objectPickerIcon,
  empty: styles.anchoredPanelEmpty,
};

export function CanvasObjectPicker({ anchor, group, fromNodeId, onPick, onClose }: CanvasObjectPickerProps) {
  const t = useTranslations('creationCanvas');
  const tPicker = useTranslations('creationCanvas.picker');

  const sections = useMemo<SearchPickerSection<CreationObjectKind>[]>(
    () => CREATION_PALETTE_GROUPS.map((entry) => ({
      key: entry.group,
      label: t(`group.${entry.group}` as 'group.Build'),
      items: entry.items.map((item) => ({
        kind: item.kind,
        icon: item.icon,
        label: t(`object.${item.kind}` as 'object.note'),
        description: t(`objectDescription.${item.kind}` as 'objectDescription.note'),
      })),
    })),
    [t],
  );

  return (
    <SearchPicker
      anchor={anchor}
      sections={sections}
      initialGroupKey={group}
      classNames={PICKER_CLASS_NAMES}
      ariaLabel={fromNodeId ? tPicker('insertLabel') : tPicker('addLabel')}
      searchPlaceholder={tPicker('search')}
      categoriesLabel={tPicker('categories')}
      allGroupsLabel={tPicker('allGroups')}
      closeLabel={tPicker('close')}
      noMatches={(query) => tPicker('noMatches', { query })}
      testIdPrefix="canvas-picker"
      dialogTestId="canvas-object-picker"
      onPick={(kind) => onPick(kind, fromNodeId)}
      onClose={onClose}
    />
  );
}
