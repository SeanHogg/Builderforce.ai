/** A compact rounded toggle for questions and presets: accent-soft with an accent border when `on`. */

import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import { cssVar } from '../../scene/themeColors';
import { CONTROL } from '../../styles';
import { TYPE } from './type';

export type PillProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'type' | 'style'> & {
    on?: boolean;
    style?: CSSProperties;
};

export const pillStyle = (on: boolean): CSSProperties => ({
    height: `calc(${CONTROL} - 2px)`, padding: '0 10px', borderRadius: 999, cursor: 'pointer', flex: 'none',
    font: 'inherit', ...(on ? TYPE.pillOn : TYPE.pill), whiteSpace: 'nowrap', color: cssVar('text'),
    border: `1px solid ${on ? cssVar('accent') : cssVar('border')}`,
    background: on ? cssVar('accentSoft') : 'transparent',
});

export function Pill({ on = false, style, ...rest }: PillProps) {
    return <button type="button" aria-pressed={on} {...rest} style={{ ...pillStyle(on), ...style, ...(rest.disabled ? { opacity: 0.5, cursor: 'default' } : null) }} />;
}
