'use client';

import { useTranslations } from 'next-intl';
import { VideoTile } from './VideoTile';
import type { RemoteTile } from '@/lib/useMediaRoom';

/**
 * Responsive gallery of camera tiles — the self tile first, then every remote
 * peer. Auto-fits columns to the tile count and container width (fluid, so it
 * reflows on mobile). Used by the ceremony cameras strip and the meeting room.
 */
export function VideoGrid({
  self, tiles, compact = false,
}: {
  self: { name: string; stream: MediaStream | null; camOn: boolean; micOn: boolean } | null;
  tiles: RemoteTile[];
  /** Smaller minimum tile size (ceremony strip) vs. a full meeting stage. */
  compact?: boolean;
}) {
  const t = useTranslations('meetings');
  const total = (self ? 1 : 0) + tiles.length;
  const min = compact ? 140 : 220;

  if (total === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>
        {t('noOneOnCamera')}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`,
        gap: 10,
        width: '100%',
      }}
    >
      {self && (
        <VideoTile name={self.name} stream={self.stream} camOn={self.camOn} micOn={self.micOn} isSelf labelYou={t('you')} />
      )}
      {tiles.map((tile) => (
        <VideoTile key={tile.peerId} name={tile.name} stream={tile.stream} camOn={tile.camOn} micOn={tile.micOn} />
      ))}
    </div>
  );
}
