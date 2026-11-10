/**
 * The package sheet with a FOOTER: a `KnowledgePanelRenderer` for a host that has no slide-out of its own (the VS Code
 * webview) and wants a section under a panel's body — the run delta panel's history and trend (PRD 41 §C11.3). It goes
 * through the panel's existing `renderPanel` slot, so the panel itself stays unchanged; the web passes its
 * `SlideOutPanel` there instead.
 */

import type { ReactNode } from 'react';
import { Sheet } from '../../Sheet';
import type { KnowledgePanelRenderer } from '../../types';

/** The run delta panel's docked width, px: ONE number for `RunDeltaPanel`'s own sheet and a host's footer sheet. */
export const RUN_DELTA_PANEL_WIDTH = 440;

export function footerPanel(footer: ReactNode, opts: { closeLabel: string; compact: boolean; width?: number | undefined }): KnowledgePanelRenderer {
    return function FooterPanel({ open, title, onClose, children }) {
        return (
            <Sheet open={open} title={title} closeLabel={opts.closeLabel} onClose={onClose} compact={opts.compact} width={opts.width}>
                {children}
                {footer}
            </Sheet>
        );
    };
}
