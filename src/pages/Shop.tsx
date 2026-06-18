import { useState } from 'react';
import { useProgression, COSMETICS } from '../progression/progression';
import type { CosmeticSlot } from '../progression/progression';
import './Shop.css';

const SLOTS: { slot: CosmeticSlot; title: string; hint: string }[] = [
  { slot: 'wallpaper', title: 'Living Wallpapers', hint: 'animated backdrops for your home hero' },
  { slot: 'title', title: 'Titles', hint: 'flair shown on your profile' },
  { slot: 'frame', title: 'Avatar Frames', hint: 'a ring around your avatar' },
];

const PRO_PERKS = [
  '🎨 Every premium wallpaper, title & frame — unlocked',
  '🧠 Unlimited deep analysis & full post-game review',
  '♟ All 26 games and every difficulty, no limits',
  '⚡ Bonus coins & XP on everything you play',
  '💜 Support the project — and no ads, ever',
];

const COIN_PACKS = [
  { n: 500, p: '$1.99' },
  { n: 1500, p: '$4.99', best: true },
  { n: 4000, p: '$9.99' },
];

export default function Shop() {
  const prog = useProgression();
  const [note, setNote] = useState<string | null>(null);

  // No payment backend is wired into this client-only build — be honest rather
  // than fake a charge. The integration path is documented in MONETIZATION.md.
  const startCheckout = (what: string) =>
    setNote(`💳 ${what} checkout isn't connected in this build yet — see MONETIZATION.md for the Stripe wiring. Meanwhile, try “Enable Pro (preview)”.`);

  return (
    <div className="shop">
      <header className="sh-top">
        <div className="col">
          <h1>Shop</h1>
          <p className="muted">Earn 🪙 by playing, then spend them on cosmetics — or go Pro to unlock everything.</p>
        </div>
        <div className="sh-balance">
          <span className="sh-coins">🪙 {prog.coins.toLocaleString()}</span>
          {prog.pro && <span className="sh-pro-tag">PRO</span>}
        </div>
      </header>

      {note && <div className="sh-note" role="status" onClick={() => setNote(null)}>{note} <span className="faint">(tap to dismiss)</span></div>}

      <section className={`sh-pro-panel ${prog.pro ? 'active' : ''}`}>
        <div className="sh-pro-head">
          <h2>{prog.pro ? '✓ GrandMaster Pro' : 'Go Pro'}</h2>
          {!prog.pro && <span className="sh-price">$4.99<span>/mo</span></span>}
        </div>
        <ul className="sh-perks">{PRO_PERKS.map((p) => <li key={p}>{p}</li>)}</ul>
        {prog.pro ? (
          <button className="btn" onClick={() => prog.setPro(false)}>Turn off Pro (preview)</button>
        ) : (
          <div className="row gap-sm wrap">
            <button className="btn primary lg glow" onClick={() => startCheckout('Pro subscription')}>Subscribe — $4.99/mo</button>
            <button className="btn lg" onClick={() => prog.setPro(true)} title="Try Pro features without payment">Enable Pro (preview)</button>
          </div>
        )}
      </section>

      <section className="sh-section">
        <h2>Get more coins</h2>
        <div className="sh-coins-grid">
          {COIN_PACKS.map((pack) => (
            <button className={`sh-coin-pack glass-soft ${pack.best ? 'best' : ''}`} key={pack.n} onClick={() => startCheckout(`${pack.n.toLocaleString()} coins`)}>
              {pack.best && <span className="sh-best">Best value</span>}
              <span className="sh-pack-n">🪙 {pack.n.toLocaleString()}</span>
              <span className="btn sm primary">{pack.p}</span>
            </button>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>No spending required — you earn coins from every game, puzzle, daily and quest.</p>
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
                    : locked ? <button className="btn sm" onClick={() => startCheckout('Pro')}>🔒 Go Pro</button>
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
