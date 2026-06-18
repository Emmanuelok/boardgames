# Monetization strategy

This document captures the recommended monetization approach for GrandMaster and
how the (already-built) in-app economy plugs into a real payment provider.

## Recommendation: free-to-play, monetized by **Pro subscription + cosmetic IAP**

Make the game **free**, and monetize two complementary ways:

1. **GrandMaster Pro** — a recurring subscription ($4.99/mo or ~$34.99/yr). This is
   the revenue engine: predictable, compounding, and it sells the thing players
   actually want from a teaching app — *unlimited depth*. Bundle the "no limits"
   value here (unlimited deep analysis & full review, every difficulty, bonus
   XP/coins, all cosmetics, no ads).
2. **Cosmetic & consumable IAP** — coin packs and premium cosmetics for players who
   won't subscribe but will spend occasionally. These ride on the engagement
   economy and convert the "whale" and "one-time buyer" segments the subscription
   misses.

### Why not subscription-only from day one?

A pure paywall kills the top of the funnel for a game whose growth depends on word
of mouth and daily habit (Daily Challenge, streaks, quests). The free loop **is**
the marketing: the longer players stay free, the more the points chase, streaks and
cosmetic goals warm them up — and the higher Pro converts. Launch free with a
generous loop; introduce Pro as the natural upgrade once the habit exists.

### Why build the cosmetic economy first (which we did)

Cosmetics give the earned currency a **sink**, which is what makes earning feel
meaningful and keeps the points chase alive. That same economy is the surface IAP
sells into. The engagement system and the monetization system are the same system —
so it was built first, money-free, and is fully functional today (earn coins → buy
cosmetics → equip).

## What's already implemented (no payments required)

- **XP, levels & coins** awarded for games, accuracy, puzzles, the Daily, discovery
  of new games, and daily quests (`src/progression/progression.ts`).
- **Daily quests** that rotate each day and pay out on claim.
- **Cosmetic store** (`/shop`) — spend earned coins on wallpapers, titles and avatar
  frames; equip them on your profile / home hero.
- **Pro feature flag** (`pro`) with a paywall surface, an "Enable Pro (preview)"
  toggle for trying Pro features, and a `setPro()` that grants the cosmetic
  catalogue. Pro gating is centralized so features can check `useProgression.getState().pro`.

The **only** thing not wired is taking real money — there is no backend in this
client-only build, and we deliberately do not fake a charge.

## Crossing the payment boundary (integration path)

The single integration point is the `startCheckout()` stub in `src/pages/Shop.tsx`
(and any future Pro gates). Recommended stack:

1. **Stripe** for web (Checkout + Customer Portal + the Billing webhook). For native
   wrappers later, use **RevenueCat** to unify App Store / Play Store receipts.
2. Add a thin backend (a few serverless functions are enough):
   - `POST /api/checkout` → create a Stripe Checkout Session (subscription or a
     one-time coin-pack price), return its URL; `startCheckout()` redirects to it.
   - `POST /api/webhook` → on `checkout.session.completed` /
     `customer.subscription.updated`, mark the account Pro or credit coins.
   - `GET /api/entitlements` → returns `{ pro, coins }` for the signed-in user.
3. Introduce lightweight **accounts** (email magic-link or OAuth) so entitlements and
   the wallet live server-side — client `localStorage` is fine for a single device
   but can't be trusted for paid state.
4. On load, hydrate `useProgression` from `/api/entitlements` (server is the source
   of truth for `pro` and purchased coins; earned coins can stay client-side or be
   mirrored up).

### Guardrails

- Never grant `pro` or credit coins from the client for a real purchase — only from a
  verified server-side webhook.
- Keep the F2P loop genuinely rewarding; Pro should remove *limits*, not gate the
  core teaching experience, or the funnel that feeds conversion dries up.
