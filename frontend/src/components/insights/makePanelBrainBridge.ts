/**
 * The Brain tool that opens one family of insight slide-out panels (AI, delivery,
 * DevEx, finance). Each family's bridge was the same forty lines — build the
 * `show_*_insight` action around `open(id)` from the family's provider, validate
 * the id, return what opened — differing only in the tool name, the prose the
 * model reads, and the registry. The prose and registry are the data; this is
 * the rest.
 *
 * The returned component mounts inside the family's PanelProvider (so it can
 * drive the drawer) and inside the Brain action providers (so the tool reaches
 * the model) — see ConditionalAppShell. It renders no UI.
 */

import { useMemo } from 'react';
import { useRegisterBrainActions, type BrainAction } from '@/lib/brain';

interface PanelBridgeSpec<Id extends string> {
  toolName: string;
  /** Builds the model-facing description; `menu` is the quoted, comma-joined id list. */
  describe: (menu: string) => string;
  /** Description of the `panel` parameter. */
  panelParamDescription: string;
  ids: readonly Id[];
  isId: (value: unknown) => value is Id;
  /** The family's provider hook; `null` when mounted outside it. */
  useOptionalPanel: () => { open: (id: Id) => void } | null | undefined;
  /** The translation key of the panel's title, echoed back to the model. */
  titleOf: (id: Id) => string | undefined;
}

export function makePanelBrainBridge<Id extends string>(spec: PanelBridgeSpec<Id>) {
  return function PanelBrainBridge() {
    const panel = spec.useOptionalPanel();
    const open = panel?.open;

    const actions = useMemo<BrainAction[]>(() => {
      if (!open) return [];
      const menu = spec.ids.map((id) => `"${id}"`).join(', ');
      return [
        {
          name: spec.toolName,
          description: spec.describe(menu),
          parameters: {
            type: 'object',
            properties: {
              panel: { type: 'string', enum: [...spec.ids], description: spec.panelParamDescription },
            },
            required: ['panel'],
          },
          mutates: false,
          run: (args: unknown) => {
            const id = (args as { panel?: unknown })?.panel;
            if (!spec.isId(id)) {
              return { error: `Unknown panel. Valid ids: ${spec.ids.join(', ')}.` };
            }
            open(id);
            return { opened: id, title: spec.titleOf(id) };
          },
        },
      ];
    }, [open]);

    useRegisterBrainActions(actions);
    return null;
  };
}
