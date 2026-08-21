import { PollJoin } from '@/components/facilitation/PollJoin';

/**
 * `/p/<slug>` — the address a live poll is answered at.
 *
 * One letter, on purpose, and shorter than `/f/` needed to be: this one is read ALOUD to
 * a room and typed into a phone keyboard while the facilitator waits. Every character is
 * one more person who mistypes it and does not vote.
 *
 * Unauthenticated by construction. A poll is answered by whoever is in the room — that
 * is the entire point of the primitive — so the slug is the credential and the row it
 * resolves to reports which tenant it belongs to.
 *
 * `runtime = 'edge'` because this route is not static; without it `next-on-pages`
 * refuses the build.
 */
export const runtime = 'edge';

export default async function PublicPollPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PollJoin slug={slug} />;
}
