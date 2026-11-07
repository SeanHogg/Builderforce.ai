/**
 * The little pictures of the legend ("Reading the picture now"): one glyph per overlay channel,
 * drawn the way the map draws that channel (a colour ramp, growing circles, a partial ring, a
 * thickening line, a pulse, a dashed outline, an issue pin), so the legend is read by LOOKING,
 * not by decoding a word. A channel whose data is not set up draws neutral. Decorative: the
 * row's text carries the meaning.
 */

import { cssVar, type ThemeTone } from '../scene/themeColors';
import type { ChannelId, ChannelStatus, MetricId } from './overlays';
import { LINE_TONES, SEVERITY_TONES } from './overlays';
import { FONT_UI, TYPE } from './ui/type';

export type GlyphChannel = ChannelId | 'pins';

export interface LegendGlyphProps {
    channel: GlyphChannel;
    metric: MetricId;
    status: ChannelStatus;
}

const W = 40;
const H = 16;

export function LegendGlyph({ channel, metric, status }: LegendGlyphProps) {
    const neutral = status === 'not-set-up';
    const tone = (t: ThemeTone) => cssVar(neutral ? 'edge' : t);
    const mid = H / 2;
    let body;
    switch (channel) {
        case 'colour': {
            const tones: readonly ThemeTone[] = metric === 'owner' ? LINE_TONES.slice(0, 4) : SEVERITY_TONES;
            const w = W / tones.length;
            body = tones.map((t, i) => <rect key={t} x={i * w} y={3} width={w - 1} height={H - 6} rx={2} fill={tone(t)} data-swatch={metric === 'owner' ? 'owner' : 'ramp'} />);
            break;
        }
        case 'size':
            body = [3, 5, 7].map((r, i) => <circle key={r} cx={7 + i * 13} cy={mid} r={r} fill={tone('text')} />);
            break;
        case 'ring':
            body = (
                <>
                    <circle cx={W / 2} cy={mid} r={6} fill="none" stroke={cssVar('edge')} strokeWidth={2.5} />
                    <circle cx={W / 2} cy={mid} r={6} fill="none" stroke={tone('accent')} strokeWidth={2.5} strokeDasharray="24 40" transform={`rotate(-90 ${W / 2} ${mid})`} />
                </>
            );
            break;
        case 'width':
            body = [2, 4, 7].map((sw, i) => <line key={sw} x1={i * 13 + 1} x2={i * 13 + 11} y1={mid} y2={mid} stroke={tone('text')} strokeWidth={sw} strokeLinecap="round" />);
            break;
        case 'pulse':
            body = (
                <>
                    <circle cx={W / 2} cy={mid} r={7} fill="none" stroke={tone('changed')} strokeWidth={1.5} opacity={0.6} />
                    <circle cx={W / 2} cy={mid} r={3.5} fill={tone('changed')} />
                </>
            );
            break;
        case 'outline':
            body = (
                <>
                    <circle cx={W / 2} cy={mid} r={7} fill="none" stroke={tone('violation')} strokeWidth={1.5} strokeDasharray="2 3" />
                    <circle cx={W / 2} cy={mid} r={3.5} fill={cssVar('edge')} />
                </>
            );
            break;
        default:
            body = (
                <>
                    <circle cx={W / 2} cy={mid} r={7} fill={cssVar('sev5')} />
                    <text x={W / 2} y={mid + 3.5} textAnchor="middle" fontFamily={FONT_UI} fontSize={TYPE.tag.fontSize} fontWeight={TYPE.tag.fontWeight} fill={cssVar('bg')}>3</text>
                </>
            );
    }
    return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" data-glyph={channel} style={{ flex: 'none' }}>{body}</svg>;
}
