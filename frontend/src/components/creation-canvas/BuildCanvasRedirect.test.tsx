import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { fetchProject } from '@/lib/api';
import { legacyCreationHref } from '@/lib/canvas/legacyCreationRoute';
import { BuildCanvasRedirect } from './BuildCanvasRedirect';

const navigation = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  search: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('@/lib/api', () => ({ fetchProject: vi.fn() }));
vi.mock('@/lib/ideProjectsApi', () => ({ ensureIdeProjectForStorage: vi.fn() }));
vi.mock('@/lib/builderforceApi', () => ({ creationSessionsApi: { openIdeProject: vi.fn() } }));

it('keeps resolving the same build when activity attribution is removed', async () => {
  vi.mocked(fetchProject).mockReturnValue(new Promise(() => {}));
  navigation.search = new URL(legacyCreationHref('/create/build/4?prompt=hello', '/ide'), 'https://example.com').search;
  const view = render(<BuildCanvasRedirect projectRef="4" />);

  navigation.search = '?prompt=hello';
  view.rerender(<BuildCanvasRedirect projectRef="4" />);
  expect(fetchProject).toHaveBeenCalledExactlyOnceWith('4');

  navigation.search = '?chat=8';
  view.rerender(<BuildCanvasRedirect projectRef="4" />);
  await waitFor(() => expect(fetchProject).toHaveBeenCalledTimes(2));
});
