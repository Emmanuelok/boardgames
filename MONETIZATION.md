# Sustainable, learner-first funding

GrandMaster is designed as a learning platform first. Its core games, courses,
puzzles, difficulties, analysis and reviews remain available without payment.
Funding must never distort a learner's progress or turn uncertainty into a
purchase prompt.

## Product rules

- **Tokens are earned, not sold.** They unlock only visible, fixed-price
  cosmetics.
- **No paid randomness.** Quest swaps are free and deterministic. There are no
  mystery items, loot boxes, chance-based purchases or variable rewards bought
  with money.
- **No pay-to-progress.** Supporter and free accounts receive identical XP,
  token rewards, opponent strengths and learning recommendations.
- **No punitive engagement design.** A missed day does not cost money, hide
  content or create a paid recovery offer.
- **No fake checkout.** When a verified billing backend is absent, the
  Collection explicitly says billing is unavailable and renders no purchase
  action.
- **Clear account-holder approval.** Any future purchase screen must disclose
  the exact price and renewal cadence before redirecting to checkout.

## Optional supporter model

The implemented `pro` entitlement is best treated as an optional supporter
status. It may provide:

- the premium cosmetic collection;
- a supporter badge;
- non-essential personalization or hosted convenience features.

It must not gate rules, courses, puzzles, accessibility features, analysis,
review history or the adaptive Strategy Path.

## Current implementation

- `src/progression/progression.ts` owns earned XP, tokens, quests and
  deterministic cosmetic unlocks.
- `/shop` is presented to users as the **Collection**. It links back to learning
  activities instead of selling token packs.
- `src/billing/billing.ts` is the only client payment seam. With no
  `VITE_API_BASE`, checkout is unavailable and no network request is made.
- `/serverless` contains backend templates, but they remain inert until a
  properly authenticated deployment is configured.

## Production billing requirements

Before enabling supporter billing:

1. Add authenticated accounts so entitlements belong to a verified user.
2. Create checkout sessions only on the server from an allow-listed SKU.
3. Verify payment-provider webhooks and make the server the source of truth.
4. Return current entitlement state from `/api/entitlements`, including
   cancellation or expiration.
5. Provide a customer portal for cancellation and receipts.
6. Add purchase, privacy and refund copy appropriate to the deployment region
   and require the account holder's approval.
7. Test failed, duplicated, delayed and replayed webhooks before launch.

Client storage is suitable for earned local progress, but it must never be the
authority for a paid entitlement.
