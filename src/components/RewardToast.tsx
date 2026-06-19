import { useEffect, useRef } from 'react';
import { useProgression, levelTier } from '../progression/progression';
import { playSound } from '../audio/sound';
import './RewardToast.css';

/**
 * Floating "+XP / +coins / Level up!" feedback. Watches the progression store's
 * transient `flash`, animates it in, then clears it after a short beat. Mounted
 * once at the app shell so every earn — anywhere — surfaces the same way.
 */
export default function RewardToast() {
  const flash = useProgression((s) => s.flash);
  const clearFlash = useProgression((s) => s.clearFlash);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!flash) return;
    if (flash.levelUp) playSound('levelup'); // celebrate the big moment
    clearTimeout(timer.current);
    timer.current = setTimeout(() => clearFlash(), flash.levelUp ? 3800 : 2400);
    return () => clearTimeout(timer.current);
  }, [flash, clearFlash]);

  if (!flash) return null;
  const tier = flash.levelUp ? levelTier(flash.levelUp) : null;
  return (
    <div className={`reward-toast ${flash.levelUp ? 'levelup' : ''}`} key={flash.id} role="status" aria-live="polite">
      {tier && (
        <div className="rt-levelup">
          <span className="rt-lu-burst">⬆</span>
          <span>Level {flash.levelUp} — {tier.icon} {tier.name}</span>
        </div>
      )}
      <div className="rt-row">
        <span className="rt-icon">{flash.icon}</span>
        <span className="rt-label">{flash.label}</span>
        <span className="rt-gains">
          {flash.xp > 0 && <span className="rt-xp">+{flash.xp} XP</span>}
          {flash.coins > 0 && <span className="rt-coins">+{flash.coins} 🪙</span>}
        </span>
      </div>
    </div>
  );
}
