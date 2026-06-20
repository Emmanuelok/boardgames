/**
 * GET /api/entitlements — return the signed-in user's entitlements. The client
 * (src/billing/billing.ts) hydrates from this on load; the server is the source
 * of truth for `pro` and purchased coins.
 *
 * TEMPLATE — not wired into the client build. Deploy at /api/entitlements.ts and
 * back it with your user store + session/cookie auth.
 */
// @ts-nocheck
export default async function handler(req, res) {
  // TODO: resolve the user from the session/cookie (magic-link or OAuth).
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(200).json({ pro: false });

  // TODO: load from your database.
  const account = { pro: false, coins: 0 };
  return res.status(200).json({ pro: account.pro, coins: account.coins });
}
