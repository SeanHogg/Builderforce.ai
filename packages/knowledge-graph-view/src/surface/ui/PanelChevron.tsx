import type { CSSProperties } from 'react';
import { cssVar } from '../../scene/themeColors';

export function PanelChevron({ open, label, onClick, side = 'left', action, testId, style }: {
    open: boolean; label: string; onClick(): void; side?: 'left' | 'right' | 'bottom';
    action?: string; testId?: string; style?: CSSProperties;
}) {
    const glyph = side === 'bottom' ? (open ? '⌄' : '⌃') : (open === (side === 'left') ? '‹' : '›');
    return (
        <button type="button" data-action={action} data-testid={testId} aria-expanded={open} aria-label={label} title={label} onClick={onClick}
            style={{ width: 28, height: 28, flex: 'none', display: 'inline-grid', placeItems: 'center', padding: 0, borderRadius: 4, border: `1px solid ${cssVar('border')}`, background: cssVar('panel'), color: cssVar('text'), font: 'inherit', cursor: 'pointer', ...style }}>
            <span aria-hidden="true">{glyph}</span>
        </button>
    );
}
