'use client';

import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { WorkflowNodeKind } from '@/lib/builderforceApi';
import { SearchPicker, type SearchPickerSection } from '@/components/ui/SearchPicker';
import { NODE_GROUPS, NODE_GROUP_KEYS, NODE_KINDS, nodeKindLabel, nodeKindBlurb, type NodeGroup } from './nodeKinds';
import { INTEGRATIONS, INTEGRATION_CATEGORIES, INTEGRATION_CATEGORY_KEYS, integrationIcon, type Integration } from './integrations';
import styles from './WorkflowNodePicker.module.css';

/**
 * The workflow builder's ONE way to add a step — same search/rail/close
 * interaction as the canvas's own object picker (`CanvasObjectPicker`, via
 * the shared `SearchPicker`), over the step catalog instead of the canvas
 * object catalog. There is deliberately no second, always-visible sidebar
 * palette: everything reachable here used to also be draggable from a
 * 210px-wide rail that only fit a fraction of the catalog and had no search
 * across integrations vs. core kinds — this replaces it rather than sitting
 * beside it.
 *
 * Two catalogs share one picker: the plain step kinds (Flow Control, Tools,
 * Text Parser, AI Agents, …) from `nodeKinds.ts`, and the integration
 * presets (LLM Platforms, MCP servers, …) from `integrations.ts`. They are
 * disambiguated with a synthetic id (`kind:<WorkflowNodeKind>` vs.
 * `integration:<id>`) since many integrations share one underlying kind
 * (every LLM Platform preset is a `kind: 'llm'` node).
 */

type PickId = `kind:${WorkflowNodeKind}` | `integration:${string}`;

export interface WorkflowNodePickerProps {
  anchor: { x: number; y: number };
  onPickKind: (kind: WorkflowNodeKind) => void;
  onPickIntegration: (integration: Integration) => void;
  onClose: () => void;
}

const PICKER_CLASS_NAMES = {
  root: styles.picker,
  search: styles.pickerSearch,
  close: styles.pickerClose,
  rows: styles.pickerRows,
  rail: styles.pickerRail,
  list: styles.pickerList,
  icon: styles.pickerIcon,
  empty: styles.pickerEmpty,
};

export function WorkflowNodePicker({ anchor, onPickKind, onPickIntegration, onClose }: WorkflowNodePickerProps) {
  const t = useTranslations('evermindBuild');
  const tPicker = useTranslations('evermindBuild.nodePicker');

  const sections = useMemo<SearchPickerSection<PickId>[]>(() => {
    const kindSections = NODE_GROUPS.map((group: NodeGroup) => ({
      key: `kind-group:${group}`,
      label: t(`nodeGroup.${NODE_GROUP_KEYS[group]}` as 'nodeGroup.trigger'),
      items: NODE_KINDS.filter((meta) => meta.group === group).map((meta) => ({
        kind: `kind:${meta.kind}` as PickId,
        icon: meta.icon,
        label: nodeKindLabel(meta, t),
        description: nodeKindBlurb(meta, t),
      })),
    })).filter((section) => section.items.length > 0);

    const integrationSections = INTEGRATION_CATEGORIES
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((category) => ({
        key: `integration-category:${category.id}`,
        label: t(`integrationCategory.${INTEGRATION_CATEGORY_KEYS[category.id]}`),
        items: INTEGRATIONS.filter((integ) => integ.category === category.id).map((integ) => ({
          kind: `integration:${integ.id}` as PickId,
          icon: integrationIcon(integ),
          label: integ.label,
          description: integ.description,
        })),
      }))
      .filter((section) => section.items.length > 0);

    return [...kindSections, ...integrationSections];
  }, [t]);

  const integrationsById = useMemo(() => new Map(INTEGRATIONS.map((integ) => [integ.id, integ])), []);

  const handlePick = useCallback((id: PickId) => {
    if (id.startsWith('kind:')) {
      onPickKind(id.slice('kind:'.length) as WorkflowNodeKind);
      return;
    }
    const integ = integrationsById.get(id.slice('integration:'.length));
    if (integ) onPickIntegration(integ);
  }, [integrationsById, onPickKind, onPickIntegration]);

  return (
    <SearchPicker
      anchor={anchor}
      sections={sections}
      classNames={PICKER_CLASS_NAMES}
      ariaLabel={tPicker('addLabel')}
      searchPlaceholder={tPicker('search')}
      categoriesLabel={tPicker('categories')}
      allGroupsLabel={tPicker('allGroups')}
      closeLabel={tPicker('close')}
      noMatches={(query) => tPicker('noMatches', { query })}
      testIdPrefix="workflow-node-picker"
      dialogTestId="workflow-node-picker"
      onPick={handlePick}
      onClose={onClose}
    />
  );
}
