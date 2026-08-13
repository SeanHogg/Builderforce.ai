/**
 * The candidate's booking page — /book/<token>
 *
 * A SERVER shell around one client island. The only interactive region is the slot list
 * (`BookingClient`), so the page itself renders on the server and ships no bundle of its
 * own — the shape the architecture ratchet's client-rooted-page count exists to
 * encourage.
 *
 * Rendered with no shell chrome at all (see `NO_CHROME_PREFIXES` in `shellRouting.ts`):
 * the person opening it is a candidate with no account who did not come to evaluate the
 * product, so neither the operator shell nor the marketing nav is honest here.
 */
import { BookingClient } from './BookingClient';

export default async function BookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <BookingClient token={token} />;
}
