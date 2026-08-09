'use client';

/**
 * EvermindStudioCenter — the center stage of the `llm` build modality: the live
 * Knowledge Map beside the region-filterable Learnings list. It owns the ONE fetch
 * of the (server-cached) contributions payload and the selected-region state, then
 * hands both down — so the map and the list never double-fetch and always agree on
 * the filter. Clicking a region in the map (or a legend chip) filters the list; the
 * list's chip clears it. The `--ev-*` region hues are defined here on `.ev-studio`
 * so BOTH children (and the list's swatches) resolve them. Responsive: side-by-side
 * on wide, stacked under 1100px.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getProjectEvermindContributions, type ProjectEvermindContributions } from '@/lib/projectEvermindApi';
import type { EvermindRegionKey } from '@/lib/evermindRegions';
import { EvermindBrainMap } from './EvermindBrainMap';
import { EvermindLearnings } from './EvermindLearnings';
import { useEvermindValidation } from './EvermindValidationContext';

export function EvermindStudioCenter({ projectId }: { projectId: number }) {
  const [data, setData] = useState<ProjectEvermindContributions | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<EvermindRegionKey | null>(null);
  const inFlight = useRef(false);
  const { highlight } = useEvermindValidation();

  // A Validate recall takes over both surfaces (map highlights matches, list shows
  // them ranked) — clear any region filter so it isn't dimming the recall view.
  useEffect(() => { if (highlight) setSelectedRegion(null); }, [highlight]);

  const reload = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const d = await getProjectEvermindContributions(projectId);
      setData(d);
      setError(false);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => { setLoaded(false); setSelectedRegion(null); void reload(); }, [reload]);

  // Light poll so the map + list stay live while runs/teaching/chat merge. The read
  // endpoint is server-cached, so this is cheap.
  useEffect(() => {
    const id = setInterval(() => { void reload(); }, 20_000);
    return () => clearInterval(id);
  }, [reload]);

  return (
    <div className="ev-studio">
      <style>{EV_STUDIO_CSS}</style>
      <div className="ev-studio-map">
        <EvermindBrainMap
          data={data} loaded={loaded} error={error} onReload={() => void reload()}
          selectedRegion={selectedRegion} onSelectRegion={setSelectedRegion}
        />
      </div>
      <div className="ev-studio-learn">
        <EvermindLearnings data={data} selectedRegion={selectedRegion} onClearRegion={() => setSelectedRegion(null)} />
      </div>
    </div>
  );
}

/* Region hues come from globals.css — one declaration for both themes, so the map
   and the learnings swatches (a SIBLING of the map, not inside `.ev-brainmap`)
   resolve the same identity without either surface restating the list. */
const EV_STUDIO_CSS = `
.ev-studio {
  display: flex; gap: 16px; height: 100%; min-height: 0;
}
.ev-studio-map { flex: 1.7 1 460px; min-width: 0; min-height: 0; display: flex; }
.ev-studio-learn { flex: 1 1 300px; min-width: 0; min-height: 0; display: flex; }
@media (max-width: 1100px) {
  .ev-studio { flex-direction: column; height: auto; }
  .ev-studio-map { flex: 0 0 auto; height: 520px; }
  .ev-studio-learn { flex: 0 0 auto; min-height: 300px; }
}
`;
