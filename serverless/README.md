# Backend templates (`/serverless`)

These are **ready-to-deploy reference implementations** for the payments backend
the client (`src/billing/billing.ts`) talks to. They are intentionally **outside
`src/`**, so they are not bundled, typechecked, or shipped with the app — the
client stays fully functional and money-free until you deploy a backend and set
`VITE_API_BASE`.

## What's here

| File | Route | Purpose |
| --- | --- | --- |
| `checkout.ts` | `POST /api/checkout` | Create a Stripe Checkout Session, return its `url`. |
| `webhook.ts` | `POST /api/webhook` | The **only** place that grants paid entitlements — on `checkout.session.completed` / subscription changes, mark the account Pro or credit coins. |
| `entitlements.ts` | `GET /api/entitlements` | Return the signed-in user's `{ pro, coins }`. |

## Deploy (Vercel example)

1. Move these files into an `api/` directory at the repo root (`api/checkout.ts`, …).
2. `npm i stripe` and add a `vercel.json` rewrite if needed.
3. Set env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the `STRIPE_PRICE_*`
   IDs (create the products/prices in the Stripe dashboard), and `APP_ORIGIN`.
4. Add the webhook endpoint in Stripe → point it at `/api/webhook`.
5. Point the client at it: set `VITE_API_BASE` to the deployment origin and rebuild.
6. Introduce lightweight **accounts** (email magic-link or OAuth) so entitlements
   and the wallet live server-side — `localStorage` is fine for a single device
   but can't be trusted for paid state.

## Guardrails

- **Never** grant `pro` or credit coins from the client — only from a
  signature-verified webhook (`webhook.ts`).
- The client only ever *reads* entitlements and *redirects* to Checkout.
- Decide how server-credited (purchased) coins reconcile with client-earned coins
  before wiring `coins` into `hydrateEntitlements()`; the default client only
  hydrates the `pro` flag to avoid clobbering earned balances.
