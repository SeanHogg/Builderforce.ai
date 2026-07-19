'use client';

/**
 * Registers the widget Brain tools: `list_widgets`, `pin_widget`, `unpin_widget`
 * and `show_widget`. Lets the Brain manage the user's personal /insights home
 * dashboard and jump to any surface's insight — the conversational counterpart to
 * the pin control that lives on every widget.
 *
 * Reads the SAME app-wide registry (listWidgets) + pin state (usePins) the
 * dashboard uses, so a widget id resolves identically for the Brain and the UI.
 * Mounted inside PinsProvider + the Brain action providers (see
 * ConditionalAppShell). Renders no UI — mirrors AiInsightPanelBrainBridge.
 */

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRegisterBrainActions, type BrainAction } from '@/lib/brain';
import { useOptionalPins } from '@/lib/widgets/PinsProvider';
import { getWidget, listWidgets } from '@/lib/widgets/registry';

export function WidgetBrainBridge() {
  const pins = useOptionalPins();
  const router = useRouter();
  const tw = useTranslations('widgets');

  const actions = useMemo<BrainAction[]>(() => {
    if (!pins) return [];
    const defs = listWidgets();
    const ids = defs.map((w) => w.id);
    const title = (key: string) => {
      try { return tw(`title.${key}`); } catch { return key; }
    };
    const catalog = () =>
      defs.map((w) => ({ id: w.id, title: title(w.titleKey), group: w.group, pinned: pins.isPinned(w.id) }));

    return [
      {
        name: 'list_widgets',
        description:
          'List the pinnable insight widgets available across the app (charts, KPIs, trends from every surface). ' +
          'Use this before pin_widget / show_widget to discover valid widget ids and see which are already pinned to the home dashboard.',
        parameters: { type: 'object', properties: {}, required: [] },
        mutates: false,
        run: () => ({ widgets: catalog() }),
      },
      {
        name: 'pin_widget',
        description:
          'Pin an insight widget to the user\'s personal /insights home dashboard so it shows up there every visit. ' +
          'Use when the user asks to add / pin / keep an eye on a metric or chart. Call list_widgets first if unsure of the id.',
        parameters: {
          type: 'object',
          properties: { widget: { type: 'string', enum: ids, description: 'The widget id to pin.' } },
          required: ['widget'],
        },
        mutates: true,
        run: (args: unknown) => {
          const id = (args as { widget?: unknown })?.widget;
          if (typeof id !== 'string' || !getWidget(id)) {
            return { error: `Unknown widget id. Call list_widgets for valid ids.` };
          }
          pins.pin(id);
          return { pinned: id, title: title(getWidget(id)!.titleKey) };
        },
      },
      {
        name: 'unpin_widget',
        description: 'Remove a widget from the user\'s /insights home dashboard.',
        parameters: {
          type: 'object',
          properties: { widget: { type: 'string', enum: ids, description: 'The widget id to unpin.' } },
          required: ['widget'],
        },
        mutates: true,
        run: (args: unknown) => {
          const id = (args as { widget?: unknown })?.widget;
          if (typeof id !== 'string' || !getWidget(id)) {
            return { error: `Unknown widget id. Call list_widgets for valid ids.` };
          }
          pins.unpin(id);
          return { unpinned: id };
        },
      },
      {
        name: 'show_widget',
        description:
          'Navigate the user to the surface behind an insight widget (its full report / source page). ' +
          'Use when the user asks to open / go to / see the details of a metric or chart.',
        parameters: {
          type: 'object',
          properties: { widget: { type: 'string', enum: ids, description: 'The widget id to open.' } },
          required: ['widget'],
        },
        mutates: false,
        run: (args: unknown) => {
          const id = (args as { widget?: unknown })?.widget;
          const def = typeof id === 'string' ? getWidget(id) : undefined;
          if (!def) return { error: `Unknown widget id. Call list_widgets for valid ids.` };
          const href = def.drill?.kind === 'route' ? def.drill.href : '/insights';
          router.push(href);
          return { opened: id, href };
        },
      },
    ];
  }, [pins, router, tw]);

  useRegisterBrainActions(actions);
  return null;
}
