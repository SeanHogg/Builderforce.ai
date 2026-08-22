'use client';

/**
 * Registers the widget Brain tools: `list_widgets`, `pin_widget`, `unpin_widget`,
 * `show_widget` and `answer_with_widgets`. Lets the Brain manage the user's
 * personal /insights home dashboard and jump to any surface's insight — the
 * conversational counterpart to the pin control that lives on every widget.
 *
 * Reads the SAME app-wide registry (listComponents) + pin state (usePins) the
 * dashboard uses, so a widget id resolves identically for the Brain and the UI.
 * Mounted inside PinsProvider + the Brain action providers (see
 * ConditionalAppShell). Renders no UI — mirrors AiInsightPanelBrainBridge.
 *
 * `answer_with_widgets` is the odd one out and deliberately so: it is a READ, and
 * it goes through the SAME `/api/dashboards/query` the Ask card posts to. That
 * matters more than the convenience. The server maps the question to whitelisted
 * metric keys and declared widget ids and computes the figures itself, so the
 * model receives numbers it cannot have invented and widget ids it cannot have
 * made up — a Brain answering "how are things looking?" from its own arithmetic is
 * exactly the failure a metrics surface cannot survive.
 */

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRegisterBrainActions, type BrainAction } from '@/lib/brain';
import { useOptionalPins } from '@/lib/widgets/PinsProvider';
import { getComponent, listComponents } from '@/lib/components/registry';
import { dashboardsApi } from '@/lib/dashboardsApi';

export function WidgetBrainBridge() {
  const pins = useOptionalPins();
  const router = useRouter();
  const tw = useTranslations('components');

  const actions = useMemo<BrainAction[]>(() => {
    if (!pins) return [];
    const defs = listComponents();
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
          if (typeof id !== 'string' || !getComponent(id)) {
            return { error: `Unknown widget id. Call list_widgets for valid ids.` };
          }
          pins.pin(id);
          return { pinned: id, title: title(getComponent(id)!.titleKey) };
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
          if (typeof id !== 'string' || !getComponent(id)) {
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
          const def = typeof id === 'string' ? getComponent(id) : undefined;
          if (!def) return { error: `Unknown widget id. Call list_widgets for valid ids.` };
          const href = def.drill?.kind === 'route' ? def.drill.href : '/insights';
          router.push(href);
          return { opened: id, href };
        },
      },
      {
        name: 'answer_with_widgets',
        description:
          'Answer an OPEN-ENDED question about how the business is doing with real figures and the charts that show them. ' +
          'Use this for "how are things looking?", "are we behind?", "how are we doing on cost?", "who is overworked / not working?", ' +
          '"is anything broken?" and any other question with no single-number answer — the server picks the relevant metrics and ' +
          'widgets itself, computes the values, and returns a headline built from them. ' +
          'Prefer it over answering from memory: the numbers it returns are the only ones you may quote. ' +
          'Set pin=true to also add the chosen charts to the user\'s /insights home dashboard.',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The user\'s question, in their own words. Include any period they named ("this week").' },
            pin: { type: 'boolean', description: 'Also pin the chosen widgets to the home dashboard. Default false.' },
          },
          required: ['question'],
        },
        // Reading the answer changes nothing; PINNING the charts does. A flat
        // `false` would let `pin: true` write to the user's dashboard without the
        // confirm gate the pin_widget tool goes through, so the answer depends on
        // the args — which is exactly what a predicate is for.
        mutates: (args: unknown) => (args as { pin?: unknown })?.pin === true,
        run: async (args: unknown) => {
          const question = (args as { question?: unknown })?.question;
          if (typeof question !== 'string' || !question.trim()) {
            return { error: 'A question is required.' };
          }
          const answer = await dashboardsApi.query(question.trim());
          // Only ids this bundle can actually render are offered back, so the model
          // never names a card the user cannot be shown.
          const widgets = (answer.widgetIds ?? [])
            .map((id) => ({ id, def: getComponent(id) }))
            .filter((w): w is { id: string; def: NonNullable<typeof w.def> } => w.def != null)
            .map((w) => ({ id: w.id, title: title(w.def.titleKey) }));

          if ((args as { pin?: unknown })?.pin === true) {
            for (const w of widgets) pins.pin(w.id);
          }

          return {
            topic: answer.topic,
            headline: answer.headline,
            narrative: answer.narrative,
            days: answer.days,
            // `source: 'default'` means NOTHING recognised the question — pass it
            // through so the model says so rather than presenting the fallback
            // metric as the answer to what was asked.
            source: answer.source,
            metrics: (answer.metrics ?? []).map((m) => ({ key: m.matchedMetric, label: m.label, value: m.value, unit: m.unit })),
            widgets,
            pinned: (args as { pin?: unknown })?.pin === true ? widgets.map((w) => w.id) : [],
          };
        },
      },
    ];
  }, [pins, router, tw]);

  useRegisterBrainActions(actions);
  return null;
}
