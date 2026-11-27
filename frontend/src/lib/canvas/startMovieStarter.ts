import { emptyCanvasVideoTimeline } from '@builderforce/creation-canvas-contract';
import { localCreationSnapshotFrom, projectCardObject } from '@/domains/canvas/domain/boardSnapshot';
import { fetchProject } from '@/lib/api';
import { createLocalStarterBoard, reportStudioFailure } from '@/lib/pendingWork';

/** Seed the existing video editor before the board's first sync. */
export async function startMovieStarter(title: string, projectId?: number): Promise<{ sessionId: string; videoId: string }> {
  const project = projectId === undefined ? undefined : await fetchProject(projectId).catch((error: unknown) => {
    void reportStudioFailure('movieStarter.linkProject', error);
    return undefined;
  });
  const videoId = crypto.randomUUID();
  const sessionId = createLocalStarterBoard(localCreationSnapshotFrom(null, {
    title,
    edges: [],
    nodes: [
      ...(project ? [projectCardObject(project)] : []),
      {
        id: videoId,
        type: 'creation',
        position: { x: 120, y: project ? 380 : 140 },
        data: { kind: 'video', title, videoTimeline: emptyCanvasVideoTimeline(), videoSources: [] },
      },
    ],
  }));
  return { sessionId, videoId };
}
