import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { useAudio } from '../audio/audioStore';
import { pause, replay, resume, skip } from '../audio/narrator';
import { subtitleLines } from '../audio/narration';

/** Subtitles are always shown for the current cue, in one or two languages, whether or not a voice is playing. */
export function SubtitleBar() {
  const a = useAudio();
  if (!a.current) return null;
  const lines = subtitleLines(a.current.cue, a.current.vars, a.lang, a.lang2);
  const busy = a.speaking !== 'idle';
  return (
    <div className="subtitle-bar panel" role="region" aria-label="Subtitles">
      <div role="status" aria-live="polite">
        {lines.map((l) => (
          <p key={l.lang} className="subtitle" dir={l.dir} lang={l.lang === 'ur-roman' ? 'ur-Latn' : l.lang} style={{ fontFamily: l.font === 'inherit' ? undefined : l.font }}>
            {l.text}
            {l.review === 'ai-translated' && <span className="badge"> AI-translated</span>}
          </p>
        ))}
      </div>
      {a.notice && <p className="muted small">{a.notice}</p>}
      <div className="controls" role="group" aria-label="Narration controls">
        <button type="button" onClick={() => void replay()} aria-label="Replay"><RotateCcw size={16} aria-hidden="true" /></button>
        {a.speaking === 'paused'
          ? <button type="button" onClick={resume} aria-label="Resume"><Play size={16} aria-hidden="true" /></button>
          : <button type="button" onClick={pause} disabled={!busy} aria-label="Pause"><Pause size={16} aria-hidden="true" /></button>}
        <button type="button" onClick={skip} disabled={!busy} aria-label="Skip"><SkipForward size={16} aria-hidden="true" /></button>
      </div>
    </div>
  );
}
