/**
 * THE API ORIGIN — the one place `https://api.builderforce.ai` is spelled.
 *
 * `auth.ts` (the session transport), `publicApi.ts` (the uncredentialed server
 * read) and the screens that print the origin for a person to paste into their
 * own code all used to carry their own copy of this expression, and three of them
 * had dropped the environment override and hard-coded production. A deployment
 * pointed at a staging API then showed people a production URL to call.
 *
 * `check-api-transport` fails any other file that spells the literal.
 */
import { BUILDERFORCE_API_ORIGIN, resolvePlatformBaseUrl } from '@builderforce/device-auth';

export const PRODUCTION_API_ORIGIN = BUILDERFORCE_API_ORIGIN;
export const API_ORIGIN = resolvePlatformBaseUrl(process.env.NEXT_PUBLIC_AUTH_API_URL, PRODUCTION_API_ORIGIN);
