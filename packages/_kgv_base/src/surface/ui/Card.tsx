/** The panel card: border, 10px radius, panel background, 12px padding. */

import type { CSSProperties, ReactNode } from 'react';
import { card } from '../../styles';

export interface CardProps {
    children: ReactNode;
    as?: 'div' | 'section' | 'aside' | 'li';
    /** aria-label, for a `section`/`aside` landmark. */
    label?: string;
    style?: CSSProperties;
}

export function Card({ children, as: Tag = 'div', label, style }: CardProps) {
    return <Tag aria-label={label} style={{ ...card, ...style }}>{children}</Tag>;
}
