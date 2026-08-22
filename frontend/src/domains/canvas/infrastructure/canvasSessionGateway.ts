/**
 * CANVAS SESSION GATEWAY — `PersistCanvas`'s port, over `creationSessionsApi`.
 *
 * Two methods out of the twenty-odd on that client, which is the whole point: a
 * use case handed the entire API surface will eventually reach past its own
 * responsibility, and the compiler cannot object because everything is there.
 * Narrowing it here is the Interface Segregation half of the architecture rules
 * doing actual work rather than being quoted.
 *
 * The one translation that earns its keep is the SHAPE of a read. The client
 * returns a `CreationSessionDetail` — invitations, role, project ids, an embedded
 * app, a fifteen-field shape — and the canvas needs four of those fields: the
 * graph, the revision, the title and the roster. Handing the whole detail to a
 * use case would put the transport's model inside the domain's decision, which is
 * the anti-corruption boundary the canvas context exists to hold (see
 * `boardFromPersistedGraph`).
 *
 * `revision` is the one field that needs real thought rather than a rename, and
 * the comment below is why.
 */

import { creationSessionsApi } from '@/lib/builderforceApi';
import type { CanvasSessionPort } from '../application/PersistCanvas';

export const canvasSessionGateway: CanvasSessionPort = {
  async replaceGraph({ sessionId, expectedRevision, idempotencyKey, graph }) {
    const saved = await creationSessionsApi.applyCommands(sessionId, expectedRevision, idempotencyKey, [
      { type: 'graph.replace', ...graph },
    ]);
    return { revision: saved.revision };
  },
  async read(sessionId) {
    const detail = await creationSessionsApi.get(sessionId);
    return {
      graph: { objects: detail.objects, connections: detail.connections },
      // `canvasRevision` is the board's; `revision` counts everything the session
      // has ever done, conversation included. Saving against the latter makes
      // every message a stale-revision conflict on the next save.
      revision: detail.session.canvasRevision ?? detail.session.revision ?? 1,
      title: detail.session.title,
      members: detail.members,
    };
  },
};
