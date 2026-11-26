/** An HTTP method as a coloured badge. The method is in the text, so colour never carries it alone. */

import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { FONT_MONO, TYPE } from '../ui/type';

const METHOD_TONE: Record<string, ThemeTone> = { GET: 'agrees', POST: 'accent', PUT: 'cycle', PATCH: 'cycle', DELETE: 'violation' };

export const methodTone = (method: string): ThemeTone => METHOD_TONE[method] ?? 'muted';

export function MethodBadge({ method }: { method: string }) {
    const color = cssVar(methodTone(method));
    return (
        <span data-method={method} style={{ ...TYPE.tag, fontFamily: FONT_MONO, padding: '1px 6px', borderRadius: 4, border: `1px solid ${color}`, color, whiteSpace: 'nowrap' }}>
            {method}
        </span>
    );
}
