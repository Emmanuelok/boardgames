/**
 * POST /api/checkout — create a Stripe Checkout Session and return its URL.
 *
 * TEMPLATE — not wired into the client build (lives outside src/). To deploy on
 * Vercel: move to /api/checkout.ts, `npm i stripe`, set the env vars below, and
 * point the client at it with VITE_API_BASE=<deployment origin>.
 *
 * The client (src/billing/billing.ts) POSTs `{ kind, sku }`; we map the SKU to a
 * Stripe Price and return `{ url }` for the client to redirect to.
 */
// @ts-nocheck
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Map the client's SKUs → Stripe Price IDs (create these in the dashboard).
const PRICES = {
  pro_monthly: { price: process.env.STRIPE_PRICE_PRO_MONTHLY, mode: 'subscription' },
  coins_500: { price: process.env.STRIPE_PRICE_COINS_500, mode: 'payment' },
  coins_1500: { price: process.env.STRIPE_PRICE_COINS_1500, mode: 'payment' },
  coins_4000: { price: process.env.STRIPE_PRICE_COINS_4000, mode: 'payment' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const { sku } = req.body ?? {};
  const entry = PRICES[sku];
  if (!entry) return res.status(400).json({ error: 'unknown sku' });

  const origin = req.headers.origin ?? process.env.APP_ORIGIN ?? '';
  try {
    const session = await stripe.checkout.sessions.create({
      mode: entry.mode,
      line_items: [{ price: entry.price, quantity: 1 }],
      // Attach the signed-in user so the webhook can credit the right account.
      client_reference_id: req.headers['x-user-id'],
      success_url: `${origin}/#/shop?status=success`,
      cancel_url: `${origin}/#/shop?status=cancelled`,
    });
    return res.status(200).json({ url: session.url });
  } catch {
    return res.status(500).json({ error: 'checkout failed' });
  }
}
