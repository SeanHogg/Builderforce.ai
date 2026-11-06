/**
 * "Risk overlays ▾": the overlay popover (a `Menu` in dialog mode, 560px wide, 92vw at most) with
 * four presets and, per channel, the metric it shows. Every view reads the same bindings, so a
 * preset recolours the map and the tower alike. A metric whose data has not been collected stays
 * selectable but is marked "Not set up", and the channel then draws neutral instead of inventing
 * a value. On a narrow container the trigger is the short "Risk ▾" and the panel spans the width.
 */

import type { CSSProperties } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { muted } from '../styles';
import { CHANNELS, METRICS, metricStatus, PRESET_ORDER, type ChannelId, type MetricId, type PresetId } from './overlays';
import type { Station } from './stations';
import { Menu, Pill, pillStyle } from './ui';

export interface OverlayMenuProps {
    labels: KnowledgeGraphLabels;
    stations: readonly Station[];
    bindings: Record<ChannelId, MetricId> & { pins: 'on' | 'off' };
    preset: PresetId | 'custom';
    onPreset(id: PresetId): void;
    onChannel(channel: ChannelId, metric: MetricId): void;
    onPins(on: boolean): void;
    /** The container is phone-narrow: short trigger, full-width panel. */
    narrow?: boolean;
}

const WIDE: CSSProperties = { width: 'min(560px, 92vw)', gap: 9, padding: '12px 14px' };
// Absolute against the status strip (the menu's `anchor="container"`), spanning it, so a trigger mid-strip cannot push the
// panel off screen and the panel still works inside a docked host (nothing is fixed to the viewport).
const NARROW: CSSProperties = { insetInlineStart: 12, insetInlineEnd: 12, width: 'auto', maxWidth: 'none', gap: 9, padding: '12px 14px' };

const SMALL: CSSProperties = { height: 26, padding: '0 8px', fontSize: 11 };
const rowLabel: CSSProperties = { fontSize: 12, fontWeight: 600, color: 'inherit' };

export function OverlayMenu({ labels, stations, bindings, preset, onPreset, onChannel, onPins, narrow = false }: OverlayMenuProps) {
    const s = labels.surface;
    const trigger = narrow ? `${s.presets[preset]} ▾` : `${fillTemplate(s.presetLabel, { preset: s.presets[preset] })} ▾`;
    return (
        <Menu trigger={trigger} label={s.overlaysTitle} title={s.overlaysTitle} active variant={narrow ? 'pill' : 'accent'} anchor={narrow ? 'container' : 'trigger'} panelStyle={narrow ? NARROW : WIDE}>
            <div data-testid="kg-overlay-menu" style={{ display: 'grid', gap: 9 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {PRESET_ORDER.map((id) => (
                        <Pill key={id} on={preset === id} onClick={() => onPreset(id)}>{s.presets[id]}</Pill>
                    ))}
                    <span aria-hidden={preset !== 'custom'} style={{ ...pillStyle(preset === 'custom'), display: 'inline-flex', alignItems: 'center', cursor: 'default', opacity: preset === 'custom' ? 1 : 0.5 }}>{s.presets.custom}</span>
                </div>
                <p style={{ ...muted, margin: 0, fontSize: 11, lineHeight: '15px' }}>{labels.surface.header.overlaysNote}</p>
                {CHANNELS.map((channel) => (
                    <div key={channel.id} role="group" aria-label={s.channels[channel.id]} style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '96px minmax(0, 1fr)', alignItems: 'center', gap: 8 }}>
                        <span style={{ ...muted, ...rowLabel }}>{s.channels[channel.id]}</span>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {METRICS.filter((m) => channel.allows(m)).map((m) => {
                                const missing = metricStatus(m, stations) === 'not-set-up';
                                return (
                                    <Pill
                                        key={m} on={bindings[channel.id] === m} data-metric={m} title={missing ? s.notSetUp : undefined}
                                        style={{ ...SMALL, opacity: missing ? 0.7 : 1 }} onClick={() => onChannel(channel.id, m)}
                                    >
                                        {s.metricNames[m]}{missing ? ` · ${s.notSetUp}` : ''}
                                    </Pill>
                                );
                            })}
                        </div>
                    </div>
                ))}
                <div role="group" aria-label={s.channels.pins} style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '96px minmax(0, 1fr)', alignItems: 'center', gap: 8 }}>
                    <span style={{ ...muted, ...rowLabel }}>{s.channels.pins}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                        <Pill on={bindings.pins === 'on'} style={SMALL} onClick={() => onPins(true)}>{s.on}</Pill>
                        <Pill on={bindings.pins === 'off'} style={SMALL} onClick={() => onPins(false)}>{s.off}</Pill>
                    </div>
                </div>
            </div>
        </Menu>
    );
}
