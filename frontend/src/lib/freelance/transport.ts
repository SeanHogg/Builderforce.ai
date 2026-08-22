/**
 * The ONE transport seam for the freelance marketplace client.
 *
 * Every call in this folder goes through `apiClient.apiRequestStream`, which
 * supplies the Authorization header (per `auth` mode), the locale header, the
 * emulation token, the 401→login redirect and the global error report.
 *
 * It used to build its own headers and call `fetch` directly at 72 sites, which
 * meant none of those behaviours applied here: an emulating superadmin saw their
 * own data on the whole talent/freelance surface, and the API never learned the
 * user's language. `apiRequestStream` (rather than `apiRequest`) is the right
 * seam because these modules read their own error envelopes via `jsonOrThrow`.
 *
 * It is a re-export rather than a wrapper on purpose: the modules beside it want
 * the real signatures, and a passthrough that adds nothing is a layer whose only
 * effect is to make a stack trace longer. What it adds is a PLACE — one import
 * line per module, and one file the next person finds when they ask why this
 * client does not call `fetch`.
 */
export { apiRequestStream } from '@/lib/apiClient';
export { jsonOrThrow } from '@/lib/apiEnvelope';
