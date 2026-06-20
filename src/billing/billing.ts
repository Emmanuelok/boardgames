/**
 * Client-side billing — the single seam where real payments plug in.
 *
 * The app is fully playable with no backend. Set `VITE_API_BASE` to a backend
 * exposing the routes in `/serverless` (Stripe Checkout + webhook + entitlements)
 * to turn on real purchases. While it is unset, every call resolves to a
 * "not configured" result and the Shop shows an honest note rather than faking a
 * charge. Importing this module never touches the network or `window`.
 */
import { useProgression } from '../progression/progression';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

/** True once a backend base URL is configured. */
export function isBillingConfigured(): boolean { return API_BASE.length > 0; }

export interface CheckoutItem { kind: 'pro' | 'coins'; sku: string; }
export type CheckoutResult = { ok: true; url: string } | { ok: false; reason: 'not-configured' | 'error' };

/** Ask the backend for a Stripe Checkout URL for `item`; the caller redirects to it. */
export async function startCheckout(item: CheckoutItem): Promise<CheckoutResult> {
  if (!API_BASE) return { ok: false, reason: 'not-configured' };
  try {
    const res = await fetch(`${API_BASE}/api/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(item),
    });
    if (!res.ok) return { ok: false, reason: 'error' };
    const data = (await res.json()) as { url?: string };
    return data.url ? { ok: true, url: data.url } : { ok: false, reason: 'error' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export interface Entitlements { pro: boolean; coins?: number; }

/**
 * Read the signed-in user's entitlements from the backend (the server is the
 * source of truth for `pro` and purchased coins). Returns null when unconfigured.
 */
export async function fetchEntitlements(): Promise<Entitlements | null> {
  if (!API_BASE) return null;
  try {
    const res = await fetch(`${API_BASE}/api/entitlements`, { credentials: 'include' });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<Entitlements>;
    return { pro: !!data.pro, coins: typeof data.coins === 'number' ? data.coins : undefined };
  } catch {
    return null;
  }
}

/**
 * Best-effort hydrate of the progression store from server entitlements on load.
 * No-op when unconfigured. Only ever *grants* Pro from the server (never revokes
 * a locally-enabled preview) and never overwrites earned coins — purchased-coin
 * reconciliation is a backend decision (see /serverless/README.md).
 */
export async function hydrateEntitlements(): Promise<void> {
  const e = await fetchEntitlements();
  if (e?.pro) {
    try { useProgression.getState().setPro(true); } catch { /* ignore */ }
  }
}
