// No 'use client': rendered only inside `CreationCanvas`'s client boundary.
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { SearchPicker, type SearchPickerSection } from '@/components/ui/SearchPicker';
import type { CreationObjectGroup, CreationObjectKind } from './types';
import { useAuth } from '@/lib/AuthContext';
import { useCanvasCapabilities } from '@/lib/canvasCapabilitiesApi';
import { creationPaletteGroupsFor } from './creationObjectRegistry';
import { STENCIL_PACKS, stencilChoice, type PaletteChoice } from '@/lib/canvasStencils';
import {
  NODE_GROUPS, NODE_GROUP_KEYS, NODE_KINDS, nodeKindBlurb, nodeKindLabel, type NodeGroup,
} from '@/domains/workflow/domain/stepCatalog';
import {
  INTEGRATIONS, INTEGRATION_CATEGORIES, INTEGRATION_CATEGORY_KEYS, integrationIcon,
} from '@/domains/workflow/domain/stepIntegrations';
import { integrationDescription } from '@/domains/workflow/domain/stepCatalogI18n';
import { integrationStepChoice, stepChoice } from '@/domains/workflow/domain/flowStepObject';
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
 * ── THE SECOND CATALOGUE: STENCILS ──────────────────────────────────────────────
 * A stencil is not a kind — it is a named PRESET of the untyped card (a geometry, a
 * pigment, a size, sometimes a starting word), so it cannot come from the object
 * registry and must not become twenty-nine new kinds the board can compute nothing over.
 * It comes from `lib/canvasStencils.ts` by exactly the same rule: this file knows that
 * packs exist and no stencil's name.
 *
 * They share the picker's one string key space, which is what `stencilChoice` /
 * `parsePaletteChoice` are for — a declared vocabulary with a parser rather than an
 * ad-hoc encoding, and the reason nothing outside that module splits the string.
 *
 * ── THE THIRD CATALOGUE: STEPS ──────────────────────────────────────
 * Every executable step — Flow Control, Tools, Text Parser, AI Agents, LLM Logic,
 * and the whole integration preset list — comes from the SAME catalog the standalone
 * builder's palette reads (`stepCatalog.ts` / `stepIntegrations.ts`). Not a copy of
 * it, and not a canvas-flavoured subset: one set of components, offered wherever a
 * person is building something, which is what makes the canvas the workflow rather
 * than a place you go to open one.
 *
 * They are one canvas kind (`flowStep`) with the step as a VALUE, encoded through
 * `stepChoice` / `integrationStepChoice` — same declared-prefix rule as stencils, and
 * again nothing outside `flowStepObject.ts` splits the string.
 *
 * Steps come LAST, after the object groups and the stencil packs: a person opening
 * the palette is choosing what to make far more often than which step to run, and a
 * rail that opened on "Flow Control" would bury the thing the board is for.
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
   * The node this insert hangs off. Present when the node's `+` opened it: the chosen
   * object is created beside that node AND connected to it, which is the difference
   * between "add a step" and "add an object".
   */
  fromNodeId?: string;
  onPick: (choice: PaletteChoice, fromNodeId?: string) => void;
  /** Carry a row onto the board and drop it where it belongs. See `SearchPicker`. */
  onDragStart?: (choice: PaletteChoice, event: React.DragEvent<HTMLButtonElement>) => void;
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

export function CanvasObjectPicker({ anchor, group, fromNodeId, onPick, onDragStart, onClose }: CanvasObjectPickerProps) {
  const t = useTranslations('creationCanvas');
  const tPicker = useTranslations('creationCanvas.picker');
  const tStencil = useTranslations('creationCanvas.stencil');
  const tPack = useTranslations('creationCanvas.stencilPack');
  // The step catalog names itself out of the builder's namespace — the same keys the
  // standalone palette reads, because they name the same steps.
  const tStep = useTranslations('evermindBuild');
  const tWorkflow = useTranslations('workflowBuilder');
  // The picker decides its own contents rather than being handed a boolean: a signed-out
  // board has no access control, so it does not advertise the restricted-by-default
  // kinds. `authReady` guards the first hydrated frame, where `isAuthenticated` is
  // unavoidably false for everyone and would briefly hide those kinds from a member.
  const { isAuthenticated, authReady, tenant } = useAuth();
  const signedIn = !authReady || isAuthenticated;
  // ENTITLEMENT, resolved by the server. The picker asks the same question the palette
  // does through the same accessor, so the two cannot advertise different catalogues —
  // and neither offers a card the API would refuse to let this workspace place.
  const capabilities = useCanvasCapabilities(tenant?.id ?? null);

  const sections = useMemo<SearchPickerSection<PaletteChoice>[]>(
    () => [
      ...creationPaletteGroupsFor(signedIn, capabilities).map((entry) => ({
        key: entry.group,
        label: t(`group.${entry.group}` as 'group.Build'),
        items: entry.items.map((item) => ({
          kind: item.kind as PaletteChoice,
          icon: item.icon,
          label: t(`object.${item.kind}` as 'object.note'),
          description: t(`objectDescription.${item.kind}` as 'objectDescription.note'),
          // Shown and refused rather than dropped — see `SearchPickerItem.locked`.
          ...(item.locked ? { locked: true, lockedReason: t('objectNeedsUpgrade') } : {}),
        })),
      })),
      // The stencil packs come AFTER every object group, deliberately: a person opening
      // the palette is choosing what to make far more often than which shape to draw it
      // as, and a rail that opens on "Flowchart" would bury the thing the board is for.
      // Never entitlement-gated — a shape is the untyped card, which every visitor
      // already has.
      ...STENCIL_PACKS.map((pack) => ({
        key: `stencil-${pack.key}`,
        label: tPack(pack.labelKey as 'flowchart'),
        items: pack.stencils.map((stencil) => ({
          kind: stencilChoice(pack.key, stencil.key),
          icon: pack.icon,
          label: tStencil(stencil.labelKey as 'process'),
          description: tPack(`${pack.labelKey}Description` as 'flowchartDescription'),
        })),
      })),
      ...NODE_GROUPS.map((group: NodeGroup) => ({
        key: `step-group:${group}`,
        label: tStep(`nodeGroup.${NODE_GROUP_KEYS[group]}` as 'nodeGroup.trigger'),
        items: NODE_KINDS.filter((meta) => meta.group === group).map((meta) => ({
          kind: stepChoice(meta.kind) as PaletteChoice,
          icon: meta.icon,
          label: nodeKindLabel(meta, tStep),
          description: nodeKindBlurb(meta, tStep),
        })),
      })).filter((section) => section.items.length > 0),
      ...INTEGRATION_CATEGORIES
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((category) => ({
          key: `step-integration:${category.id}`,
          label: tStep(`integrationCategory.${INTEGRATION_CATEGORY_KEYS[category.id]}`),
          items: INTEGRATIONS.filter((integ) => integ.category === category.id).map((integ) => ({
            kind: integrationStepChoice(integ.id) as PaletteChoice,
            icon: integrationIcon(integ),
            label: integ.label,
            description: integrationDescription(tWorkflow, integ.description),
          })),
        }))
        .filter((section) => section.items.length > 0),
    ],
    [t, tPack, tStencil, tStep, tWorkflow, signedIn, capabilities],
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
      onPick={(choice) => onPick(choice, fromNodeId)}
      {...(onDragStart ? { onDragStart } : {})}
      onClose={onClose}
    />
  );
}

/** Re-exported so the host types its handler against the picker's own vocabulary rather
 *  than restating `CreationObjectKind | \`stencil:…\`` at the call site. */
export type { PaletteChoice, CreationObjectKind };
