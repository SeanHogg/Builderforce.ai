/**
 * HOW A REPLY'S MODEL IS NAMED and WHERE IT RAN - the one reading of a served `local/<runtime>/<model>` ref for the
 * reply chip and the live row.
 *
 * A `local/` ref means "a client on this machine makes the call", NOT "the weights are on this disk": Kimi Code is the
 * provider's hosted API called with the person's own account. Whether the model runs on the device is the runtime
 * registry's `onDevice` (`runsOnDevice`), never a runtime id compared here and never the `local/` prefix - the
 * prefix-as-on-device reading is what told a Kimi user their model was "on this device".
 *
 * The raw ref stays on the message metadata (and in a tooltip) so diagnostics are unchanged; this only decides what is
 * drawn: a human name and a truthful place.
 */

import { localCatalogModel, parseLocalModelRef, runsOnDevice } from '@builderforce/local-inference';

/** What the UI says of a served model. */
export interface ServedModelLabel {
  /** The human name: the catalogue's display name when it has one, else the ref's last path segment. Undefined for a ref that is not `local/` (the caller's own display rule names it). */
  name: string | undefined;
  /** The weights run on this device - the registry's `onDevice`. */
  onDevice: boolean;
  /** A runtime reached from this machine that is NOT on-device: the person's own account at a hosted provider. */
  hostedFromHere: boolean;
}

/** The label of a served model ref (see the module header). */
export function servedModelLabel(model: string | null | undefined): ServedModelLabel {
  const parsed = parseLocalModelRef(model ?? undefined);
  if (!parsed) return { name: undefined, onDevice: false, hostedFromHere: false };
  const onDevice = runsOnDevice(model ?? undefined);
  const catalogued = localCatalogModel(model as string)?.label;
  const lastSegment = parsed.model.split('/').filter(Boolean).pop() ?? parsed.model;
  return { name: catalogued ?? lastSegment, onDevice, hostedFromHere: !onDevice };
}
