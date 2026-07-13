/**
 * Provider → ActivitySource factory for the poll producer. Kept separate from
 * activityIngest.ts (which defines the ActivitySource interface) so the concrete
 * sources can import the interface without a cycle.
 */
import type { FetchLike } from '../repos/sources/repoSourceBase';
import type { ActivitySource } from './activityIngest';
import { GithubActivitySource } from './githubActivitySource';
import { GitlabActivitySource } from './gitlabActivitySource';
import { BitbucketActivitySource } from './bitbucketActivitySource';

/** Providers the activity poller can pull from. */
export const POLLABLE_PROVIDERS = ['github', 'gitlab', 'bitbucket'] as const;

export interface ActivitySourceCoords { owner: string; repo: string; host?: string | null; token: string; }

/** Build the activity source for a provider, or null if unsupported. */
export function createActivitySource(
  provider: string, coords: ActivitySourceCoords, fetchFn: FetchLike,
): ActivitySource | null {
  switch (provider) {
    case 'github':    return new GithubActivitySource(coords, fetchFn);
    case 'gitlab':    return new GitlabActivitySource(coords, fetchFn);
    case 'bitbucket': return new BitbucketActivitySource(coords, fetchFn);
    default:          return null;
  }
}
