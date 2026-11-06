/** A small outlined status chip (10px, bold): the provenance badge and the finding-source chip are this, in a tone each. */

import type { HTMLAttributes, ReactNode } from 'react';
import { cssVar, type ThemeTone } from '../../scene/themeColors';

export type ChipProps = Omit<HTMLAttributes<HTMLSpanElement>, 'className' | 'style'> & {
    tone: ThemeTone;
    children: ReactNode;
};

export function Chip({ tone, children, ...rest }: ChipProps) {
    const color = cssVar(tone);
    return (
        <span {...rest} style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap', border: `1px solid ${color}`, color }}>
            {children}
        </span>
    );
}
