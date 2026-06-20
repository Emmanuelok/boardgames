import { describe, it, expect } from 'vitest';
import { isBillingConfigured, startCheckout, fetchEntitlements, hydrateEntitlements } from './billing';
import { useProgression } from '../progression/progression';

// VITE_API_BASE is unset in the test env, so billing is "not configured": every
// call must resolve safely without touching the network.
describe('billing — unconfigured (no backend)', () => {
  it('reports not configured', () => {
    expect(isBillingConfigured()).toBe(false);
  });

  it('startCheckout resolves to not-configured', async () => {
    expect(await startCheckout({ kind: 'pro', sku: 'pro_monthly' })).toEqual({ ok: false, reason: 'not-configured' });
  });

  it('fetchEntitlements resolves to null', async () => {
    expect(await fetchEntitlements()).toBeNull();
  });

  it('hydrateEntitlements is a no-op that never throws', async () => {
    localStorage.clear();
    useProgression.getState().reset();
    await hydrateEntitlements();
    expect(useProgression.getState().pro).toBe(false);
  });
});
