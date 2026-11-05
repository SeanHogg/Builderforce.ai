/**
 * The overlay popover: four presets and, per channel, the metric it shows. Every view reads
 * the same bindings, so a preset recolours the map and the tower alike. A metric whose data
 * has not been collected stays selectable but is marked "Not set up", and the channel then
 * draws neutral instead of inventing a value.
 */

import { useState } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { chip, heading, muted } from '../styles';
import { CHANNELS, METRICS, metricStatus, PRESET_ORDER, type ChannelId, type MetricId, type PresetId } from './overlays';
import type { Station } from './stations';

export interface OverlayMenuProps {
    labels: KnowledgeGraphLabels;
    stations: readonly Station[];
    bindings: Record<ChannelId, MetricId> & { pins: 'on' | 'off' };
    preset: PresetId | 'custom';
    onPreset(id: PresetId): void;
    onChannel(channel: ChannelId, metric: MetricId): void;
    onPins(on: boolean): void;
}

const small = (active: boolean) => ({ ...chip(active), minHeight: 32, padding: '0 10px', fontSize: 12 });

export function OverlayMenu({ labels, stations, bindings, preset, onPreset, onChannel, onPins }: OverlayMenuProps) {
    const s = labels.surface;
    const [open, setOpen] = useState(false);
    return (
        <div style={{ position: 'relative' }} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}>
            <button type="button" aria-expanded={open} aria-controls="kg-overlay-menu" style={chip(open)} onClick={() => setOpen((v) => !v)}>
                {fillTemplate(s.presetLabel, { preset: s.presets[preset] })}
            </button>
            {open && (
                <div
                    id="kg-overlay-menu" role="group" aria-label={s.overlaysTitle} data-testid="kg-overlay-menu"
                    style={{
                        position: 'absolute', insetInlineEnd: 0, top: '100%', marginTop: 6, zIndex: 4, width: 'min(340px, 92vw)', display: 'grid', gap: 10, padding: 12,
                        background: cssVar('bg'), border: `1px solid ${cssVar('border')}`, borderRadius: 12, boxShadow: '0 8px 28px color-mix(in srgb, currentColor 18%, transparent)',
                    }}
                >
                    <h3 style={heading}>{s.overlaysTitle}</h3>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {PRESET_ORDER.map((id) => (
                            <button key={id} type="button" aria-pressed={preset === id} style={small(preset === id)} onClick={() => onPreset(id)}>{s.presets[id]}</button>
                        ))}
                        <span style={{ ...small(preset === 'custom'), display: 'inline-flex', alignItems: 'center', opacity: preset === 'custom' ? 1 : 0.5 }} aria-hidden={preset !== 'custom'}>
                            {s.presets.custom}
                        </span>
                    </div>
                    {CHANNELS.map((channel) => (
                        <div key={channel.id} role="group" aria-label={s.channels[channel.id]} style={{ display: 'grid', gap: 4 }}>
                            <span style={muted}>{s.channels[channel.id]}</span>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {METRICS.filter((m) => channel.allows(m)).map((m) => {
                                    const missing = metricStatus(m, stations) === 'not-set-up';
                                    return (
                                        <button
                                            key={m} type="button" aria-pressed={bindings[channel.id] === m} data-metric={m}
                                            title={missing ? s.notSetUp : undefined} style={{ ...small(bindings[channel.id] === m), opacity: missing ? 0.7 : 1 }}
                                            onClick={() => onChannel(channel.id, m)}
                                        >
                                            {s.metricNames[m]}{missing ? ` · ${s.notSetUp}` : ''}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    <div role="group" aria-label={s.channels.pins} style={{ display: 'grid', gap: 4 }}>
                        <span style={muted}>{s.channels.pins}</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                            <button type="button" aria-pressed={bindings.pins === 'on'} style={small(bindings.pins === 'on')} onClick={() => onPins(true)}>{s.on}</button>
                            <button type="button" aria-pressed={bindings.pins === 'off'} style={small(bindings.pins === 'off')} onClick={() => onPins(false)}>{s.off}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
