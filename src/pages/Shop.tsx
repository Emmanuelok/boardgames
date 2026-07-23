import { useState } from 'react';
import { useProgression, COSMETICS } from '../progression/progression';
import type { CosmeticSlot } from '../progression/progression';
import { isBillingConfigured, startCheckout as billingCheckout, type CheckoutItem } from '../billing/billing';
import { Link } from 'react-router-dom';
import './Shop.css';

const SLOTS: { slot: CosmeticSlot; title: string; hint: string }[] = [
  { slot: 'wallpaper', title: 'Living Wallpapers', hint: 'animated backdrops for your home hero' },
  { slot: 'title', title: 'Titles', hint: 'flair shown on your profile' },
  { slot: 'frame', title: 'Avatar Frames', hint: 'a ring around your avatar' },
];

const PRO_PERKS = [
  '🎨 Every premium wallpaper, title & frame — unlocked',
  '◇ A supporter badge on your learning profile',
  '💜 Support continued development — with no ads, ever',
];

export default function Shop() {
  const prog = useProgression();
  const [note, setNote] = useState<string | null>(null);
  const billingReady = isBillingConfigured();

  const startCheckout = async (what: string, item: CheckoutItem) => {
    const r = await billingCheckout(item);
    if (r.ok) { window.location.href = r.url; return; }
    setNote(r.reason === 'not-configured'
      ? `${what} is not available in this build.`
      : `Couldn’t start ${what} checkout. Please try again in a moment.`);
  };

  return (
    <div className="shop">
      <header className="sh-top">
        <div className="col">
          <h1>Collection</h1>
          <p className="muted">Earn tokens through learning, then choose the visual style that feels like yours.</p>
        </div>
        <div className="sh-balance">
          <span className="sh-coins">🪙 {prog.coins.toLocaleString()}</span>
          {prog.pro && <span className="sh-pro-tag">PRO</span>}
        </div>
      </header>

      {note && <div className="sh-note" role="status" onClick={() => setNote(null)}>{note} <span className="faint">(tap to dismiss)</span></div>}

      <section className={`sh-pro-panel ${prog.pro ? 'active' : ''}`}>
        <div className="sh-pro-head">
          <h2>{prog.pro ? '✓ GrandMaster Supporter' : billingReady ? 'Supporter collection' : 'Complete learning access'}</h2>
          {billingReady && !prog.pro && <span className="sh-price">$4.99<span>/mo</span></span>}
        </div>
        {billingReady || prog.pro ? (
          <ul className="sh-perks">{PRO_PERKS.map((p) => <li key={p}>{p}</li>)}</ul>
        ) : (
          <p className="sh-access-note">Every game, course, puzzle, difficulty and review tool is available to every learner. Optional supporter billing is not connected in this build.</p>
        )}
        {billingReady && !prog.pro && (
          <>
            <button className="btn primary lg glow" onClick={() => startCheckout('Supporter subscription', { kind: 'pro', sku: 'pro_monthly' })}>Continue to secure checkout</button>
            <p className="sh-purchase-note">Purchases require the account holder’s approval.</p>
          </>
        )}
      </section>

      <section className="sh-section">
        <h2>Earn through mastery</h2>
        <div className="sh-earn-grid">
          <Link className="sh-earn-card glass-soft" to="/path"><span>◎</span><strong>Follow My Path</strong><small>Complete one connected learning mission.</small></Link>
          <Link className="sh-earn-card glass-soft" to="/puzzles"><span>✦</span><strong>Solve positions</strong><small>Build pattern recognition and streaks.</small></Link>
          <Link className="sh-earn-card glass-soft" to="/daily"><span>◇</span><strong>Daily challenge</strong><small>Return for one focused board each day.</small></Link>
        </div>
        <p className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>Tokens are earned—not sold—and every unlock has a visible, fixed cost.</p>
      </section>

      {SLOTS.map(({ slot, title, hint }) => (
        <section className="sh-section" key={slot}>
          <h2>{title} <span className="faint" style={{ fontSize: 14, fontWeight: 400 }}>· {hint}</span></h2>
          <div className="sh-grid">
            {COSMETICS.filter((c) => c.slot === slot).map((c) => {
              const owned = prog.owned.includes(c.id);
              const equipped = prog.equipped[slot] === c.id;
              const locked = !!c.pro && !prog.pro && !owned;
              const affordable = prog.coins >= c.price;
              return (
                <div className={`sh-item glass-soft ${equipped ? 'equipped' : ''} ${locked ? 'locked' : ''}`} key={c.id}>
                  <span className="sh-item-ic" style={slot === 'frame' && c.value ? { boxShadow: `0 0 0 3px ${c.value}` } : undefined}>{c.icon}</span>
                  <strong className="sh-item-name">{c.name}{c.pro && <span className="sh-tag">PRO</span>}</strong>
                  {equipped ? <span className="sh-state equipped">✓ Equipped</span>
                    : owned ? <button className="btn sm" onClick={() => prog.equipCosmetic(slot, c.id)}>Equip</button>
                    : locked ? (
                      billingReady
                        ? <button className="btn sm" onClick={() => startCheckout('Supporter collection', { kind: 'pro', sku: 'pro_monthly' })}>Supporter item</button>
                        : <span className="sh-state">Supporter item</span>
                    )
                    : <button className="btn sm primary" disabled={!affordable} title={affordable ? '' : 'Not enough coins'} onClick={() => prog.buyCosmetic(c.id)}>🪙 {c.price}</button>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
