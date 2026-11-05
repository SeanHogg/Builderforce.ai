/** A small borderless text button: status strip, breadcrumbs, "Copy as Mermaid". */

import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import { cssVar } from '../../scene/themeColors';
import { CONTROL } from '../../styles';

export type QuietButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'type' | 'style'> & {
    style?: CSSProperties;
};

export const quietStyle: CSSProperties = {
    minHeight: `calc(${CONTROL} - 6px)`, padding: '0 6px', border: 0, borderRadius: 6, background: 'transparent',
    color: cssVar('muted'), font: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
};

export function QuietButton({ style, ...rest }: QuietButtonProps) {
    return <button type="button" {...rest} style={{ ...quietStyle, ...style, ...(rest.disabled ? { opacity: 0.5, cursor: 'default' } : null) }} />;
}
