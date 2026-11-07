/**
 * The last rows of the System camera. DATA AND EXTERNAL: a dashed card per data store or outside
 * service a line ends in (the termini the transit map draws, named by the same rules). And, when
 * stations sit in no layer, ONE row that counts them and opens the List, instead of a tile each.
 */

import type { KnowledgeGraphLabels } from '../../labels';
import { counted } from '../plural';
import { cssVar } from '../../scene/themeColors';
import { muted } from '../../styles';
import { TYPE } from '../ui/type';
import type { Station, StationModel } from '../stations';
import { terminusText, type TerminusInfo } from '../transit/termini';
import { cardBox, ellipsis } from './SystemCard';
import { tierLabel } from './TierRowView';

export interface StoreRowProps {
    stores: readonly TerminusInfo[];
    byId: StationModel['byId'];
    labels: KnowledgeGraphLabels;
    selectedId: string | null;
    dim(stationId: string): boolean;
    onSelect(id: string): void;
}

export function StoreRow({ stores, byId, labels, selectedId, dim, onSelect }: StoreRowProps) {
    const s = labels.surface.system;
    return (
        <section aria-label={s.data} data-tier="data" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, flex: '1 1 auto' }}>
            <h3 style={{ ...tierLabel, color: cssVar('bandData') }}>{s.data}</h3>
            <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', gap: 6, overflowX: 'auto' }}>
                {stores.length === 0 ? <p style={{ ...muted, margin: 0, paddingTop: 8 }}>{s.dataEmpty}</p> : stores.map((t) => {
                    const st = byId.get(t.stationId);
                    return st && (
                        <button
                            key={t.stationId} type="button" data-terminus={t.kind} data-component={st.id} aria-pressed={selectedId === st.id} title={st.path ?? st.name}
                            style={cardBox(selectedId === st.id, dim(st.id), true)} onClick={() => onSelect(st.id)}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                <span aria-hidden="true" style={{ width: 12, height: 10, borderRadius: '5px / 3px', flex: 'none', background: cssVar('duplicate') }} />
                                <b style={{ ...ellipsis, ...TYPE.status, color: 'inherit' }}>{terminusText(t, labels)}</b>
                            </span>
                            <span style={{ ...ellipsis, ...TYPE.monoMeta }}>{st.name}</span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

export interface NotLayeredRowProps {
    stations: readonly Station[];
    labels: KnowledgeGraphLabels;
    /** Opens the List on these stations. */
    onOpen(stations: readonly Station[]): void;
}

/** "Not layered · N parts → List": one button, never a tile per station. */
export function NotLayeredRow({ stations, labels, onOpen }: NotLayeredRowProps) {
    const s = labels.surface.system;
    if (stations.length === 0) return null;
    const text = counted(labels, 'notLayered', stations.length);
    return (
        <button
            type="button" data-row="not-layered"
            style={{ ...cardBox(false, false, true), flex: 'none', flexDirection: 'row', alignItems: 'center', ...TYPE.body, minWidth: 0 }}
            onClick={() => onOpen(stations)}
        >
            {text}
        </button>
    );
}
