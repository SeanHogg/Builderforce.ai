import { describe, expect, it, vi } from 'vitest';
import { startMovieStarter } from './startMovieStarter';

const { fetchProject, createLocalStarterBoard } = vi.hoisted(() => ({
  fetchProject: vi.fn(),
  createLocalStarterBoard: vi.fn(() => 'board-id'),
}));

vi.mock('@/lib/api', () => ({ fetchProject }));
vi.mock('@/lib/pendingWork', () => ({ createLocalStarterBoard, reportStudioFailure: vi.fn() }));

describe('startMovieStarter', () => {
  it('opens a saved, empty timeline with a card for the project returned by the API', async () => {
    fetchProject.mockResolvedValue({ id: 17, name: 'Project name' });
    const { sessionId, videoId } = await startMovieStarter('Movie', 17);

    expect(sessionId).toBe('board-id');
    expect(createLocalStarterBoard).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Movie',
      nodes: [
        expect.objectContaining({ data: { kind: 'project', title: 'Project name', resourceId: 'project:17' } }),
        expect.objectContaining({
          id: videoId,
          data: expect.objectContaining({ kind: 'video', videoTimeline: expect.objectContaining({ clips: [] }), videoSources: [] }),
        }),
      ],
    }));
  });

  it('starts the video without a project card when the project is inaccessible', async () => {
    fetchProject.mockRejectedValue(new Error('Project unavailable'));
    await startMovieStarter('Movie', 17);

    expect(createLocalStarterBoard).toHaveBeenLastCalledWith(expect.objectContaining({
      nodes: [expect.objectContaining({ data: expect.objectContaining({ kind: 'video' }) })],
    }));
  });
});
