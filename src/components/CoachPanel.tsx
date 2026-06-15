import { useEffect, useRef } from 'react';
import './TutorPanel.css';
import './CoachPanel.css';

export interface CoachMsg { text: string; tone?: 'good' | 'bad' | 'info' }

/**
 * The move-by-move commentary panel for the bespoke games (Backgammon, Dots and
 * Boxes) that don't run through the standard store/TutorPanel. It mirrors the
 * AI Tutor's look: a header, a scrolling feed of what just happened, and a
 * pinned strategy tip for the position.
 */
export default function CoachPanel({
  title = 'AI Coach', subtitle = 'Move-by-move commentary', messages, tip,
}: { title?: string; subtitle?: string; messages: CoachMsg[]; tip?: string }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);
  return (
    <div className="tutor glass coach">
      <div className="tutor-head">
        <div className="row gap-sm" style={{ alignItems: 'center' }}>
          <span className="tutor-orb">🧠</span>
          <div className="col">
            <strong>{title}</strong>
            <span className="faint" style={{ fontSize: 12 }}>{subtitle}</span>
          </div>
        </div>
      </div>
      <div className="tutor-body coach-body">
        {messages.length === 0
          ? <div className="empty">Make a move and I’ll talk you through it.</div>
          : messages.map((m, i) => <div key={i} className={`coach-msg ${m.tone || 'info'}`}>{m.text}</div>)}
        <div ref={endRef} />
      </div>
      {tip && <div className="coach-tip"><span className="ct-ic">💡</span><span>{tip}</span></div>}
    </div>
  );
}
