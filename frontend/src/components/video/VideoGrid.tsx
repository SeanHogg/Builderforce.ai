'use client';

import { useTranslations } from 'next-intl';
import { VideoTile } from './VideoTile';
import type { RemoteTile } from '@/lib/useMediaRoom';

/** A virtual tile for an agent attendee (no MediaStream — agents have no browser). */
export interface AgentTile { ref: string; name: string; }

interface Item {
  id: string;
  ref: string;
  name: string;
  stream: MediaStream | null;
  camOn: boolean;
  micOn: boolean;
  isSelf: boolean;
  isAgent: boolean;
}

/**
 * Responsive gallery of camera tiles — the self tile first, then remote peers, then
 * any agent attendees (as avatar tiles). Cameras default to a SMALL size; a viewer
 * can switch to large (`size`) or spotlight one participant (`focusedId` +
 * `onSelect`), which renders that tile big with the rest as a thumbnail strip.
 * Live `captions` and `speaking` state overlay each tile by member ref.
 */
export function VideoGrid({
  self, tiles, agents, compact = false,
  size = 'small', focusedId = null, onSelect, captions, speaking,
}: {
  self: { name: string; ref?: string; stream: MediaStream | null; camOn: boolean; micOn: boolean } | null;
  tiles: RemoteTile[];
  /** Agent attendees rendered as avatar tiles. */
  agents?: AgentTile[];
  /** Smaller minimum tile size (ceremony strip) vs. a full meeting stage. */
  compact?: boolean;
  /** Default tile size when not spotlighting. */
  size?: 'small' | 'large';
  /** Spotlight this tile id (renders it large, the rest as a strip). */
  focusedId?: string | null;
  /** Click a tile → spotlight/unspotlight it (id, or null to clear). */
  onSelect?: (id: string | null) => void;
  /** Live caption text keyed by member ref. */
  captions?: Record<string, string>;
  /** Refs currently speaking (accent ring). */
  speaking?: Set<string>;
}) {
  const t = useTranslations('meetings');

  const items: Item[] = [];
  if (self) items.push({ id: 'self', ref: self.ref ?? '', name: self.name, stream: self.stream, camOn: self.camOn, micOn: self.micOn, isSelf: true, isAgent: false });
  for (const tile of tiles) items.push({ id: tile.peerId, ref: tile.ref, name: tile.name, stream: tile.stream, camOn: tile.camOn, micOn: tile.micOn, isSelf: false, isAgent: false });
  for (const a of agents ?? []) items.push({ id: `agent:${a.ref}`, ref: a.ref, name: a.name, stream: null, camOn: false, micOn: true, isSelf: false, isAgent: true });

  if (items.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>
        {t('noOneOnCamera')}
      </div>
    );
  }

  const selectable = !!onSelect;
  const captionFor = (it: Item) => (it.ref ? captions?.[it.ref] : undefined) ?? null;
  const speakingFor = (it: Item) => (it.ref ? speaking?.has(it.ref) ?? false : false);
  const tileProps = (it: Item, expanded: boolean) => ({
    key: it.id,
    name: it.name,
    stream: it.stream,
    camOn: it.camOn,
    micOn: it.micOn,
    isSelf: it.isSelf,
    labelYou: it.isSelf ? t('you') : undefined,
    caption: captionFor(it),
    speaking: speakingFor(it),
    badge: it.isAgent ? t('agent') : null,
    expanded,
    selected: focusedId === it.id,
    onSelect: selectable ? () => onSelect!(focusedId === it.id ? null : it.id) : undefined,
    expandLabel: focusedId === it.id ? t('shrinkTile') : t('expandTile'),
  });

  // Spotlight layout: the focused tile large, everyone else in a thumbnail strip.
  const focused = focusedId ? items.find((it) => it.id === focusedId) : null;
  if (focused) {
    const rest = items.filter((it) => it.id !== focused.id);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        <VideoTile {...tileProps(focused, true)} />
        {rest.length > 0 && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {rest.map((it) => (
              <div key={it.id} style={{ flex: '0 0 auto', width: 150 }}>
                <VideoTile {...tileProps(it, false)} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const min = compact ? 140 : size === 'large' ? 300 : 170;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`,
        gap: 10,
        width: '100%',
      }}
    >
      {items.map((it) => <VideoTile {...tileProps(it, false)} />)}
    </div>
  );
}
