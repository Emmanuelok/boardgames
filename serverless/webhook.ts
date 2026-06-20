/**
 * POST /api/webhook — Stripe webhook. The ONLY place that may grant paid
 * entitlements: on a completed checkout or subscription change, mark the account
 * Pro or credit coins. Never trust the client for paid state.
 *
 * TEMPLATE — not wired into the client build. Deploy at /api/webhook.ts and set
 * STRIPE_WEBHOOK_SECRET. On Vercel, disable body parsing so the raw body is
 * available for signature verification (the `config` export below).
 */
// @ts-nocheck
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = { api: { bodyParser: false } };

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    const raw = await readRaw(req);
    event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).json({ error: 'bad signature' });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      // TODO: look up the user via session.client_reference_id and, based on the
      //       purchased SKU, set pro = true (subscription) or credit coins.
      void session;
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      // TODO: set pro = (subscription is active) for the mapped user.
      break;
    }
  }

  return res.status(200).json({ received: true });
}
