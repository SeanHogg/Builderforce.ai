/** A small outlined status chip (10px, bold): the provenance badge and the finding-source chip are this, in a tone each. */

import type { HTMLAttributes, ReactNode } from 'react';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { TYPE } from './type';

export type ChipProps = Omit<HTMLAttributes<HTMLSpanElement>, 'className' | 'style'> & {
    tone: ThemeTone;
    children: ReactNode;
};

export function Chip({ tone, children, ...rest }: ChipProps) {
    const color = cssVar(tone);
    return (
        <span {...rest} style={{ ...TYPE.tag, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap', border: `1px solid ${color}`, color }}>
            {children}
        </span>
    );
}
