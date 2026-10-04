import { useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { MAP_ZOOM_RANGE, boundsCenter, geoBoundsFor, mapViewportBounds, outlinePaths, panCenter, projectMap, sanitizeGeoBounds, sanitizeMapCenter, sanitizeMapPoints, sanitizeMapZoom } from '@/lib/canvasGeo';
import { useFormat } from '@/i18n/useFormat';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';

/**
 * The Map Object — places plotted where they actually are.
 *
 * The card draws its own geography (see `lib/canvasGeo`): a graticule, an optional
 * boundary the object carries with it, and one marker per plotted row. There is no tile
 * layer, so the map renders identically online, offline, and in an export, and a private
 * canvas never announces what it is plotting to a third-party raster host.
 *
 * Everything geometric is computed by the pure projection helper and rendered here as a
 * flat `map()`, so the maths is unit-tested rather than eyeballed at card size.
 */
/**
 * A map you can INTERROGATE, not only look at.
 *
 * It used to render one projection fitted to the data and stop there: a marker's
 * only affordance was its `<title>` tooltip, so a plot of every district in one
 * metro was a smudge that could be admired and not read, and clicking a place
 * did nothing at all.
 *
 * Three things changed, and each is deliberate about WHERE its state lives:
 *
 *  · **Zoom and pan are on the OBJECT** (`mapZoom` / `mapCenter`), not in this
 *    component. A reading a person worked for has to survive a re-render, ride
 *    the session snapshot, and be something Brain can read and set — component
 *    state would lose all three. The maths is `mapViewportBounds`, which is pure
 *    and tested away from React.
 *  · **The board keeps its own gestures.** The surface carries `nodrag nowheel`,
 *    which is how React Flow is told a wheel or a drag inside this element is
 *    not a canvas pan. Without them, zooming the map would zoom the board.
 *  · **A marker click SELECTS**, writing `mapSelectedLabel` back to the object,
 *    and — where the map was built from a dataset on the board — offers the row
 *    it came from through the `sourceDatasetId` link that already existed.
 */
export function MapBody({ data }: CreationBodyProps) {
  // `revealObject` puts the reader in front of another object — the dataset this map came from.
  const { edit: onEdit, revealObject: onReveal } = useCreationNodeActions();
  const fmt = useFormat();
  const t = useTranslations('creationCanvas.node');
  const points = useMemo(() => sanitizeMapPoints(data.mapPoints), [data.mapPoints]);
  const region = useMemo(() => sanitizeGeoBounds(data.mapRegion), [data.mapRegion]);
  /** The extent the data occupies — the reading nothing has touched. */
  const base = useMemo(() => geoBoundsFor(points, region), [points, region]);
  const zoom = sanitizeMapZoom(data.mapZoom);
  const view = useMemo(() => (base ? mapViewportBounds(base, zoom, data.mapCenter) : null), [base, zoom, data.mapCenter]);
  const projection = useMemo(
    () => projectMap(points, { width: 320, height: 190, region: view }),
    [points, view],
  );
  const outline = useMemo(
    () => (projection && data.mapOutline ? outlinePaths(data.mapOutline, projection.project) : []),
    [projection, data.mapOutline],
  );
  const surfaceRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const interactive = !!onEdit && !!base && !!view;
  const selectedLabel = typeof data.mapSelectedLabel === 'string' ? data.mapSelectedLabel : '';
  const sourceId = typeof data.sourceDatasetId === 'string' && data.sourceDatasetId.trim() ? data.sourceDatasetId.trim() : '';

  /** Zoom about the pointer, so the thing under the cursor stays under it. */
  const zoomBy = useCallback((factor: number, at?: { x: number; y: number }) => {
    if (!onEdit || !base || !view) return;
    const next = sanitizeMapZoom(zoom * factor);
    if (next === zoom) return;
    const centre = sanitizeMapCenter(data.mapCenter) ?? boundsCenter(base);
    if (!at) {
      onEdit({ mapZoom: next, mapCenter: centre });
      return;
    }
    // Keep the pointer's coordinate fixed: move the centre a fraction of the way
    // towards it, equal to how much of the window the zoom step removes.
    const [south, north, west, east] = view;
    const lat = north - (at.y * (north - south));
    const lng = west + (at.x * (east - west));
    const share = 1 - zoom / next;
    onEdit({ mapZoom: next, mapCenter: [centre[0] + (lat - centre[0]) * share, centre[1] + (lng - centre[1]) * share] });
  }, [onEdit, base, view, zoom, data.mapCenter]);

  const resetView = useCallback(() => {
    onEdit?.({ mapZoom: 1, mapCenter: null, mapSelectedLabel: '' });
  }, [onEdit]);

  if (!projection || !base || !view) {
    return <div className={styles.mapBody}>
      <p className={styles.mapEmpty}>{t('mapEmpty')}</p>
      <div className={styles.pills}><span>{data.status || t('mapEmptyStatus')}</span></div>
    </div>;
  }

  const valueLabel = typeof data.mapValueLabel === 'string' && data.mapValueLabel.trim() ? data.mapValueLabel.trim() : '';
  const valued = projection.points.filter((point) => typeof point.value === 'number');
  // Only the largest few carry a printed name — at card size every label collides, and
  // a legible map of the top places beats an illegible one of all of them. The rest stay
  // readable through the marker's own title/aria text. Zooming in re-runs this over
  // whatever is still in frame, which is how a cluster becomes readable.
  const labelled = new Set([...valued].sort((first, second) => (second.value ?? 0) - (first.value ?? 0)).slice(0, 5).map((point) => point.label));
  const [south, north, west, east] = projection.bounds;
  const selected = projection.points.find((point) => point.label === selectedLabel) ?? null;
  const ariaLabel = t('mapAria', {
    count: projection.points.length,
    places: projection.points.slice(0, 12).map((point) => point.value != null ? `${point.label} (${fmt.number(point.value)})` : point.label).join(', '),
  });

  /** Pointer position as a 0..1 fraction of the surface, for pointer-anchored zoom. */
  const fractionOf = (event: { clientX: number; clientY: number }) => {
    const box = surfaceRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return undefined;
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };

  return (
    <div className={styles.mapBody}>
      <div className={styles.widgetContext}>
        <span><small>{t('mapPlaces')}</small><b>{fmt.number(projection.points.length)}</b></span>
        {typeof data.mapRegionName === 'string' && data.mapRegionName.trim() && <span><small>{t('mapRegion')}</small><b>{data.mapRegionName}</b></span>}
        {valueLabel && valued.length > 0 && <span><small>{t('mapSizedBy')}</small><b>{valueLabel}</b></span>}
      </div>
      <svg
        ref={surfaceRef}
        // `nodrag nowheel` is how React Flow is told this element owns its own
        // gestures. Without them a wheel here zooms the BOARD and a drag pans it.
        className={`${styles.mapSurface}${interactive ? ` ${styles.mapSurfaceLive} nodrag nowheel` : ''}`}
        viewBox={`0 0 ${projection.width} ${projection.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ariaLabel}
        data-zoomed={zoom > 1 ? 'true' : undefined}
        {...(interactive ? {
          onWheel: (event: React.WheelEvent<SVGSVGElement>) => {
            event.preventDefault();
            event.stopPropagation();
            zoomBy(event.deltaY < 0 ? 1.25 : 1 / 1.25, fractionOf(event));
          },
          onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            drag.current = { x: event.clientX, y: event.clientY, moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          },
          onPointerMove: (event: React.PointerEvent<SVGSVGElement>) => {
            const from = drag.current;
            if (!from) return;
            const dx = event.clientX - from.x;
            const dy = event.clientY - from.y;
            // A few pixels of travel is a click with a shaky hand, not a pan.
            if (!from.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
            from.moved = true;
            const box = surfaceRef.current?.getBoundingClientRect();
            if (!box) return;
            const centre = sanitizeMapCenter(data.mapCenter) ?? boundsCenter(base);
            onEdit?.({ mapZoom: zoom, mapCenter: panCenter(view, centre, dx, dy, { width: box.width, height: box.height }) });
            drag.current = { x: event.clientX, y: event.clientY, moved: true };
          },
          onPointerUp: (event: React.PointerEvent<SVGSVGElement>) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            drag.current = null;
          },
          onPointerCancel: () => { drag.current = null; },
          onDoubleClick: (event: React.MouseEvent<SVGSVGElement>) => { event.stopPropagation(); resetView(); },
        } : {})}
      >
        <rect className={styles.mapPlate} x="0" y="0" width={projection.width} height={projection.height} rx="8" />
        <g className={styles.mapGraticule}>
          {projection.graticule.verticals.map((line) => <line key={`v${line.lng}`} x1={line.x} y1="0" x2={line.x} y2={projection.height} />)}
          {projection.graticule.horizontals.map((line) => <line key={`h${line.lat}`} x1="0" y1={line.y} x2={projection.width} y2={line.y} />)}
        </g>
        {outline.length > 0 && <g className={styles.mapOutline}>{outline.map((path, index) => <path key={`outline-${index}`} d={path} />)}</g>}
        <g className={styles.mapMarkers}>
          {projection.points.map((point, index) => (
            <circle
              key={`${point.label}-${index}`}
              cx={point.x}
              cy={point.y}
              r={point.radius}
              data-tone={point.tone ?? undefined}
              data-selected={point.label === selectedLabel ? 'true' : undefined}
              {...(interactive ? {
                onClick: (event: React.MouseEvent<SVGCircleElement>) => {
                  event.stopPropagation();
                  // A pan that ended on a marker is a pan, not a selection.
                  if (drag.current?.moved) return;
                  onEdit?.({ mapSelectedLabel: point.label === selectedLabel ? '' : point.label });
                },
              } : {})}
            >
              <title>{point.value != null ? `${point.label} — ${fmt.number(point.value)}${valueLabel ? ` ${valueLabel}` : ''}` : point.label}</title>
            </circle>
          ))}
        </g>
        <g className={styles.mapLabels}>
          {projection.points.filter((point) => labelled.has(point.label) || point.label === selectedLabel).map((point, index) => (
            <text key={`label-${point.label}-${index}`} x={point.x} y={point.y - point.radius - 2.5} textAnchor="middle">{point.label.slice(0, 22)}</text>
          ))}
        </g>
      </svg>

      {interactive && <div className={`${styles.mapControls} nodrag`}>
        <button type="button" onClick={(event) => { event.stopPropagation(); zoomBy(1.6); }} aria-label={t('mapZoomIn')} disabled={zoom >= MAP_ZOOM_RANGE.max}>+</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); zoomBy(1 / 1.6); }} aria-label={t('mapZoomOut')} disabled={zoom <= MAP_ZOOM_RANGE.min}>−</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); resetView(); }} disabled={zoom <= MAP_ZOOM_RANGE.min && !selectedLabel}>{t('mapReset')}</button>
      </div>}

      {selected && <div className={`${styles.mapSelection} nodrag`}>
        <b>{selected.label}</b>
        {selected.value != null && <span>{fmt.number(selected.value)}{valueLabel ? ` ${valueLabel}` : ''}</span>}
        <span>{t('mapAt', { lat: selected.lat.toFixed(3), lng: selected.lng.toFixed(3) })}</span>
        {sourceId && onReveal && (
          <button type="button" onClick={(event) => { event.stopPropagation(); onReveal(sourceId); }}>{t('mapOpenSource')}</button>
        )}
      </div>}

      <div className={styles.mapFooter}>
        <small>{t('mapExtent', { south: south.toFixed(1), north: north.toFixed(1), west: west.toFixed(1), east: east.toFixed(1) })}</small>
        {typeof data.mapAttribution === 'string' && data.mapAttribution.trim() && <small>{data.mapAttribution}</small>}
      </div>
    </div>
  );
}
