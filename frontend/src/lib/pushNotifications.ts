/**
 * Web Push client — opt the browser into OS-level "new version deployed"
 * notifications and keep the subscription synced with the API.
 *
 * Flow:
 *   enableDeployNotifications() → request Notification permission → subscribe via
 *   pushManager (using the server's VAPID public key) → POST to /api/push/subscribe.
 *   syncPushSubscription() is the idempotent re-sync run on app load for users who
 *   already granted permission (handles key rotation / a cleared server row).
 *
 * All calls no-op gracefully when push is unsupported, the user isn't logged in,
 * or push isn't configured server-side (public-key endpoint 503s).
 */
import { AUTH_API_URL, getStoredTenantToken } from './auth';

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export function pushPermission(): NotificationPermission | 'unsupported' {
  return isPushSupported() ? Notification.permission : 'unsupported';
}

function authHeaders(): Record<string, string> | null {
  const token = getStoredTenantToken();
  if (!token) return null;
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchPublicKey(): Promise<string | null> {
  try {
    const res = await fetch(`${AUTH_API_URL}/api/push/public-key`);
    if (!res.ok) return null; // 503 = push not configured server-side
    const { publicKey } = (await res.json()) as { publicKey?: string };
    return publicKey ?? null;
  } catch {
    return null;
  }
}

/**
 * Ensure a push subscription exists and is registered with the API. Safe to call
 * on every app load. Returns true if a subscription is active and synced.
 */
export async function syncPushSubscription(): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== 'granted') return false;
  const headers = authHeaders();
  if (!headers) return false; // not logged in — nothing to associate the subscription with

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();

  if (!sub) {
    const publicKey = await fetchPublicKey();
    if (!publicKey) return false;
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    } catch {
      return false;
    }
  }

  try {
    await fetch(`${AUTH_API_URL}/api/push/subscribe`, {
      method: 'POST',
      headers,
      body: JSON.stringify(sub.toJSON()),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Prompt for permission (if not already decided) and subscribe. Wire to a button —
 * browsers require a user gesture to show the permission prompt. Returns the
 * resulting permission so the caller can update UI.
 */
export async function enableDeployNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!isPushSupported()) return 'unsupported';
  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission === 'granted') await syncPushSubscription();
  return permission;
}

/** Unsubscribe this browser and drop the server row. */
export async function disableDeployNotifications(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const headers = authHeaders();
  if (headers) {
    await fetch(`${AUTH_API_URL}/api/push/subscribe`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => { /* best-effort */ });
  }
  await sub.unsubscribe().catch(() => { /* best-effort */ });
}
