/** The chrome shared by the rail's line rows and stop rows: a full-width button that lights up when it is the selected one. */

import type { CSSProperties } from 'react';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../ui/type';

export const railRow = (on: boolean, minHeight = `calc(var(--kg-control, 40px) - 2px)`): CSSProperties => ({
    width: '100%', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'start', cursor: 'pointer', font: 'inherit', ...TYPE.body,
    minHeight, padding: '0 8px', borderRadius: 8, color: cssVar('text'), boxSizing: 'border-box',
    border: `1px solid ${on ? cssVar('accent') : 'transparent'}`, background: on ? cssVar('accentSoft') : 'transparent',
});

export const clip: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 };
