/**
 * The surface a gateway call is attributed to — the usage ledger's `surface` column.
 *
 * The vocabulary and the header are declared once in `@builderforce/spend-contract`
 * (the api reads both). A client that drives its own transport tags every gateway call
 * through {@link withUsageSurface} so "what did this cost, and where" is answered by the
 * ledger, not guessed: the VS Code native run (`vsix`) and Rovr (`rovr`) share it.
 */
import { USAGE_SURFACE_HEADER, type UsageSurface } from '@builderforce/spend-contract';

export { USAGE_SURFACE_HEADER, USAGE_SURFACES, isUsageSurface, type UsageSurface } from '@builderforce/spend-contract';

type TransportFetch = (input: string, init: RequestInit) => Promise<Response>;

/** `fetchImpl`, with every request tagged as coming from `surface`. */
export function withUsageSurface(fetchImpl: TransportFetch, surface: UsageSurface): TransportFetch {
  return (input, init) =>
    fetchImpl(input, {
      ...init,
      headers: { ...((init.headers as Record<string, string> | undefined) ?? {}), [USAGE_SURFACE_HEADER]: surface },
    });
}
