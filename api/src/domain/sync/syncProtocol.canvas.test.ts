import { describe, expect, it } from 'vitest';
import { syncImporterFor } from '../../application/sync/importers';
import { CANVAS_ENTITY_TYPES, DOMAIN_IMPORTED_ENTITY_TYPES } from './syncProtocol';

describe('the canvas entity types', () => {
  it('are declared once (the package) and the server’s domain-imported list carries every one', () => {
    expect([...CANVAS_ENTITY_TYPES]).toEqual(['canvas-board', 'canvas-object', 'canvas-edge', 'canvas-timeline', 'canvas-media']);
    for (const type of CANVAS_ENTITY_TYPES) expect(DOMAIN_IMPORTED_ENTITY_TYPES).toContain(type);
  });

  it('each have an OWNING importer — none falls into the mirror or is rejected as unknown', () => {
    expect(CANVAS_ENTITY_TYPES.map((type) => syncImporterFor(type))).toEqual([
      'importSyncedCanvasBoard',
      'importSyncedCanvasObject',
      'importSyncedCanvasEdge',
      'importSyncedCanvasTimeline',
      'importSyncedCanvasMedia',
    ]);
  });

  it('every domain-imported type resolves to a non-mirror importer', () => {
    for (const type of DOMAIN_IMPORTED_ENTITY_TYPES) expect(syncImporterFor(type)).not.toBe('importMirrorRecord');
  });
});
