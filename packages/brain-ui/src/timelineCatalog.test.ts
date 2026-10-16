import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMELINE_LABELS } from './BrainTimeline';
import { DEFAULT_LIVE_ACTIVITY_LABELS } from './LiveActivity';
import { liveActivityLabelsFrom, timelineCatalogLookup, timelineLabelsFrom } from './timelineCatalog';

describe('timeline catalog → labels', () => {
  const lookup = timelineCatalogLookup({
    thinking: 'Denkt nach…',
    thoughtFor: 'Hat {duration} nachgedacht',
    live: { starting: 'Wird gestartet…', ariaLabel: 'Aktuelle Aktivität' },
    activityStarted: '{agent} hat {kind} #{ref} begonnen',
    learnSkipReasonFrozen: 'eingefroren',
    empty: '',
  });

  it('reads every canonical path, keeping the renderer\'s placeholders as written', () => {
    const labels = timelineLabelsFrom(lookup);
    expect(labels.thinking).toBe('Denkt nach…');
    expect(labels.thoughtFor).toBe('Hat {duration} nachgedacht');
    expect(labels.live.starting).toBe('Wird gestartet…');
    expect(labels.live.ariaLabel).toBe('Aktuelle Aktivität');
    expect(labels.activity.milestoneStarted).toBe('{agent} hat {kind} #{ref} begonnen');
    expect(labels.learnSkipReason.frozen).toBe('eingefroren');
  });

  it('falls back to the English default for anything the catalog lacks (an empty string too)', () => {
    const labels = timelineLabelsFrom(lookup);
    expect(labels.empty).toBe(DEFAULT_TIMELINE_LABELS.empty);
    expect(labels.copy).toBe(DEFAULT_TIMELINE_LABELS.copy);
    expect(labels.live.tool).toBe(DEFAULT_LIVE_ACTIVITY_LABELS.tool);
    expect(labels.activity.agentDispatched).toBe(DEFAULT_TIMELINE_LABELS.activity.agentDispatched);
    expect(timelineLabelsFrom(timelineCatalogLookup(undefined))).toEqual(DEFAULT_TIMELINE_LABELS);
  });

  it('lets a surface override what it words on purpose', () => {
    expect(timelineLabelsFrom(lookup, { assistant: 'Rovr' }).assistant).toBe('Rovr');
    expect(liveActivityLabelsFrom(lookup, { thinking: 'Reading the board…' }).thinking).toBe('Reading the board…');
  });

  it('takes any lookup — a flat host bundle maps its own keys onto the canonical paths', () => {
    const bundle: Record<string, string> = { 'tl.you': 'Du', 'tl.liveStarting': 'Los…' };
    const flat = (path: string) => bundle[path.startsWith('live.') ? `tl.live${path[5]!.toUpperCase()}${path.slice(6)}` : `tl.${path}`];
    const labels = timelineLabelsFrom(flat);
    expect(labels.you).toBe('Du');
    expect(labels.live.starting).toBe('Los…');
  });
});
