import { AUTH_API_URL } from './auth';

/** Subscribe an address through Builderforce's canonical public newsletter store. */
export async function subscribeToNewsletter(email: string, source: string): Promise<void> {
  const response = await fetch(`${AUTH_API_URL}/api/auth/newsletter/subscribers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email.trim(),
      action: 'subscribe',
      source,
    }),
  });
  if (!response.ok) throw new Error('Newsletter subscription failed');
}

