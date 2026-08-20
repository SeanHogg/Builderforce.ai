/**
 * DERIVED IMAGE SIZES — the resize this platform never had.
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────────────────
 * Every avatar was served at ORIGINAL SIZE. The upload accepts 5 MB, stores the bytes
 * unmodified, and the serve route streams them back — so a talent-marketplace browse
 * page rendering twenty-four 40-pixel cards could pull 120 MB over the wire to draw
 * about a thousand pixels of image. `<img width>` hides it perfectly: the page looks
 * right, and only the bill and the phone battery know.
 *
 * ── WHY CLOUDFLARE IMAGE RESIZING AND NOT `sharp` ────────────────────────────────
 * `sharp` appears in this repo only as a pnpm override pin. It is a NATIVE module and
 * cannot run in a Worker — there is no libvips in v8 isolates — so it was never a
 * candidate. The Worker-native answer is a subrequest with `cf.image`, which asks
 * Cloudflare's edge to do the transform. That is the only mechanism available at this
 * layer, and it is greenfield here: nothing in the codebase used it before.
 *
 * ── THE CACHING DECISION: R2 WRITE-THROUGH, NOT THE EDGE CACHE ───────────────────
 * A derived size could be left to Cloudflare's own image cache. This writes the bytes
 * back to R2 instead, under a variant key beside the original, and the reasons are:
 *
 *   1. **Cost.** Image Resizing bills per transformation, and the edge cache is
 *      PER-POP: a miss in every point of presence is a fresh billed transform for the
 *      same avatar. An R2 write-through makes it once per (avatar, width), globally,
 *      for the life of the image.
 *   2. **The key is already immutable.** An upload mints
 *      `avatars/<userId>/<uuid>.<ext>` — a fresh UUID every time — so a derived size of
 *      that key can never go stale. There is no invalidation problem to trade against,
 *      which is normally the reason to prefer a TTL'd cache over a stored derivative.
 *   3. **The bucket is already on the path.** Every avatar read already opens R2. A
 *      variant is one more `get` on a binding the route holds, not a new dependency,
 *      a new binding or a new failure mode.
 *
 * ── WHY THE WIDTHS ARE A CLOSED SET ──────────────────────────────────────────────
 * `?w=` taken as an arbitrary integer is a resource-exhaustion vector with a
 * write-amplification multiplier attached: an attacker walking w=1..2000 would bill one
 * transform AND store one R2 object per step, per avatar. A closed set means the
 * keyspace a caller can reach is five objects per image, and an unknown width is a 400
 * rather than a bill.
 */

/** The sizes an avatar is served at. Chosen to cover the real render sites at 1x and
 *  2x: 32/64 for a nav or table row, 128/256 for a talent card, 512 for a profile
 *  header. Add one only with a render site that needs it — every entry is five more
 *  stored objects per avatar across the estate. */
export const AVATAR_WIDTHS = [32, 64, 128, 256, 512] as const;
export type AvatarWidth = (typeof AVATAR_WIDTHS)[number];

/**
 * A requested width, or null when there is none, and `'invalid'` when there is one and
 * it is not on the list.
 *
 * Three outcomes rather than two, because "no width" and "a width I refuse" are
 * different answers: the first serves the original (the pre-existing contract, which
 * every stored `users.avatar_url` still points at) and the second is a 400. Collapsing
 * them would make a typo'd width silently return a full-size image, which is exactly
 * the byte bill this module exists to remove.
 */
export function parseAvatarWidth(raw: string | undefined | null): AvatarWidth | null | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return 'invalid';
  return (AVATAR_WIDTHS as readonly number[]).includes(parsed) ? (parsed as AvatarWidth) : 'invalid';
}

/** The format every derived size is stored and served as. */
const VARIANT_CONTENT_TYPE = 'image/webp';

/**
 * Where a derived size lives: beside the original, under a suffix.
 *
 * Derived FROM the original key rather than from the user id, so the variant inherits
 * the original's immutability — a new upload mints a new UUID and therefore a new
 * variant namespace, and the old variants are orphaned by the same act that orphans the
 * original they came from.
 */
export function avatarVariantKey(originalKey: string, width: AvatarWidth): string {
  return `${originalKey}@w${width}.webp`;
}

/**
 * Source types a derived size is produced for.
 *
 * GIF is deliberately absent. An animated avatar resized to a still frame is a
 * different picture, and silently replacing somebody's image with one frame of it is
 * worse than serving the bytes they uploaded. A GIF falls through to the original.
 */
const RESIZABLE = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function isResizable(contentType: string | undefined | null): boolean {
  return RESIZABLE.has((contentType ?? '').toLowerCase());
}

/** What the serve route got, and where it came from — so the caller can set an honest
 *  cache header and say which it served. */
export interface ImageVariantResult {
  body: ArrayBuffer;
  contentType: string;
  /** `derived` — a real resized image. `original` — the resize was unavailable and the
   *  source bytes are being served instead. */
  origin: 'derived' | 'original';
}

/**
 * A DERIVED SIZE, from the store or freshly transformed.
 *
 * Order: R2 first (free, global, already on the path), then Image Resizing, then — if
 * the transform is unavailable — the ORIGINAL BYTES.
 *
 * That last fallback is the honest degradation this codebase applies to every optional
 * dependency (`isPayoutsConfigured`, `NOTIFY_EMAIL_URL`, `UPLOADS`): Image Resizing is a
 * zone feature that a self-hosted or wrangler-dev deployment simply may not have, and
 * returning a 503 for an avatar would put a broken image on every talent card on a
 * deployment whose only fault is not being on a paid Cloudflare plan. The caller is
 * TOLD which it got (`origin`) so it can shorten the cache header and let a later
 * request try the transform again, rather than caching the fallback for a day.
 *
 * Never throws. An image is furniture; a page must not fail because a face did.
 */
export async function readAvatarVariant(
  bucket: R2Bucket,
  originalKey: string,
  width: AvatarWidth,
  sourceUrl: string,
): Promise<ImageVariantResult | null> {
  const key = avatarVariantKey(originalKey, width);

  const cached = await bucket.get(key);
  if (cached) {
    return {
      body: await cached.arrayBuffer(),
      contentType: cached.httpMetadata?.contentType ?? VARIANT_CONTENT_TYPE,
      origin: 'derived',
    };
  }

  const original = await bucket.get(originalKey);
  if (!original) return null;
  const originalType = original.httpMetadata?.contentType ?? 'image/jpeg';
  if (!isResizable(originalType)) {
    return { body: await original.arrayBuffer(), contentType: originalType, origin: 'original' };
  }

  const derived = await transform(sourceUrl, width);
  if (!derived) {
    // The transform did not happen. Serve what we have rather than nothing.
    return { body: await original.arrayBuffer(), contentType: originalType, origin: 'original' };
  }

  // Write-through. Deliberately NOT awaited-and-failed: a bucket write that is refused
  // (quota, a transient 500) must not turn a successful resize into a broken image —
  // the next request simply transforms again.
  try {
    await bucket.put(key, derived, { httpMetadata: { contentType: VARIANT_CONTENT_TYPE } });
  } catch {
    // Intentionally swallowed AFTER being made harmless: the derived bytes are already
    // in hand and are returned below, so the only consequence of a failed write is one
    // more transform on the next request. There is nothing to report and nothing a
    // caller could do differently.
    void 0;
  }

  return { body: derived, contentType: VARIANT_CONTENT_TYPE, origin: 'derived' };
}

/**
 * Ask Cloudflare's edge for a resized copy.
 *
 * `fit: 'cover'` with a square box, because every consumer of this renders a circular
 * or square avatar: `scale-down` would leave a wide photo wide and the surface would
 * crop it in CSS, which means shipping the pixels that get thrown away — the exact cost
 * this module removes.
 *
 * Returns null on ANY failure, including "this zone does not have Image Resizing", which
 * arrives as a normal non-2xx response rather than an exception. The `content-type`
 * check is what separates a real transform from an error page with a 200.
 */
async function transform(sourceUrl: string, width: AvatarWidth): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(sourceUrl, {
      cf: {
        image: {
          width,
          height: width,
          fit: 'cover',
          format: 'webp',
          quality: 82,
          metadata: 'none',
        },
      },
      // The transform is the whole point of the subrequest; a cached ORIGINAL would be
      // served straight back and stored as a "variant" that is the wrong size.
      headers: { accept: 'image/webp,image/*' },
    } as RequestInit);
    if (!response.ok) return null;
    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    return await response.arrayBuffer();
  } catch {
    // Image Resizing is optional infrastructure and its absence is not an application
    // error — the caller falls back to the original bytes and says so. Reporting this
    // would file a support ticket on every avatar read of every deployment without the
    // feature enabled.
    return null;
  }
}

/**
 * Remove an avatar and every size derived from it.
 *
 * Called when a new avatar replaces an old one. Without it the bucket keeps every image
 * a person has ever uploaded plus up to five derivatives of each, forever — and adding
 * variants would have multiplied that by six. Best-effort: a failed cleanup must never
 * fail the upload the person actually asked for.
 */
export async function deleteAvatarWithVariants(bucket: R2Bucket, originalKey: string): Promise<void> {
  const keys = [originalKey, ...AVATAR_WIDTHS.map((width) => avatarVariantKey(originalKey, width))];
  try {
    await bucket.delete(keys);
  } catch {
    // Swallowed on purpose and harmless: the only consequence is an orphaned object
    // that no URL points at. Failing the upload over it would be strictly worse.
    void 0;
  }
}
