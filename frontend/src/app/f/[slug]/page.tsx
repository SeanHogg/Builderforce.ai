import { PublicFormResponder } from '@/components/forms/PublicFormResponder';

/**
 * `/f/<slug>` — the address a published form is answered at.
 *
 * Short on purpose: it is typed by hand and read aloud at least as often as it
 * is clicked, and every character is one more chance to get it wrong.
 *
 * Unauthenticated by construction. A form is answered by people who are not in
 * the workspace — that is the entire point of the primitive — so the slug is the
 * credential and the row it resolves to reports which tenant it belongs to.
 *
 * `runtime = 'edge'` because this route is not static; without it `next-on-pages`
 * refuses the build.
 */
export const runtime = 'edge';

export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { slug } = await params;
  // `?t=` carries a named recipient's own credential. Absent for the two open
  // audiences, and REQUIRED for `namedRecipients` — which the server enforces,
  // because a client that decides who may answer is not a control.
  const { t } = await searchParams;
  return <PublicFormResponder slug={slug} {...(t ? { token: t } : {})} />;
}
