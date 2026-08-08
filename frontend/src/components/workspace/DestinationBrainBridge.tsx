'use client';

/**
 * Registers `list_destinations` and `show_panel` — the Brain's door onto the
 * SAME destination registry the command palette and the sidebar read.
 *
 * The Brain could already open two specific drawers (`show_ai_insight`,
 * `show_delivery_insight`). Generalising that is what makes asking a real
 * alternative to finding: at the destination count the consolidation brings,
 * "show me delivery" is faster than any menu, and it degrades gracefully because
 * the model is choosing from an enumerated list rather than guessing a URL.
 *
 * Reads {@link useDestinations}, so a destination this account may not reach is
 * not offered to the Brain either — one gate, not a second copy. Renders no UI.
 */

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRegisterBrainActions, type BrainAction } from '@/lib/brain';
import { useDestinations } from '@/lib/destinations/useDestinations';

export function DestinationBrainBridge() {
  const router = useRouter();
  const t = useTranslations('nav');
  const destinations = useDestinations();

  const actions = useMemo<BrainAction[]>(() => {
    if (destinations.length === 0) return [];
    const label = (key: string): string => {
      try { return t(key); } catch { return key.split('.').at(-1) ?? key; }
    };
    const ids = destinations.map((destination) => destination.id);
    const catalog = () => destinations.map((destination) => ({
      id: destination.id,
      title: label(destination.labelKey),
      section: label(destination.groupLabelKey),
      href: destination.href,
    }));

    return [
      {
        name: 'list_destinations',
        description:
          'List every page/panel in the app this user can open (projects, tasks, insights lenses, workforce, knowledge, quality, incidents, settings, canvases). '
          + 'Call this before show_panel to discover valid destination ids.',
        parameters: { type: 'object', properties: {}, required: [] },
        mutates: false,
        run: () => ({ destinations: catalog() }),
      },
      {
        name: 'show_panel',
        description:
          'Open one of the app\'s destinations for the user. Use when they ask to go to / open / show a page, report, board or canvas. '
          + 'Call list_destinations first if unsure of the id.',
        parameters: {
          type: 'object',
          properties: { destination: { type: 'string', enum: ids, description: 'The destination id to open.' } },
          required: ['destination'],
        },
        mutates: false,
        run: (args: unknown) => {
          const id = (args as { destination?: unknown })?.destination;
          const found = typeof id === 'string' ? destinations.find((destination) => destination.id === id) : undefined;
          if (!found) return { error: 'Unknown destination id. Call list_destinations for valid ids.' };
          router.push(found.href);
          return { opened: found.id, href: found.href, title: label(found.labelKey) };
        },
      },
    ];
  }, [destinations, router, t]);

  useRegisterBrainActions(actions);
  return null;
}
