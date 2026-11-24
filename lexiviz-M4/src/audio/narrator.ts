/**
 * Narration engine. Voice sources, in order:
 *  1. pre-generated audio (public/audio/<lang>/<cueId>.mp3, listed in manifest.json) for fixed cues,
 *  2. the browser's SpeechSynthesis for cues filled with real values (or when no file exists),
 *  3. captions only, with a notice, when the device has no voice for the language.
 * Only one cue is ever active: a new cue replaces the current one.
 */
import type { NarrationCue, Vars } from '../lessons/types';
import { audioStore } from './audioStore';
import { getLanguage } from './languages';
import { captionMs, resolveCue, textHash } from './narration';

interface Manifest { entries: Record<string, { hash: string }> }
let manifest: Promise<Manifest> | null = null;
const loadManifest = (): Promise<Manifest> => (manifest ??= fetch('/audio/manifest.json')
  .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<Manifest>) : { entries: {} }))
  .catch(() => ({ entries: {} })));
export const _resetManifestForTests = () => { manifest = null; };

interface Active { id: number; cancel: () => void; pause: () => void; resume: () => void; setRate: (r: number) => void }
let active: Active | null = null;
let seq = 0;
let last: { cue: NarrationCue; vars: Vars } | null = null;

const synth = (): SpeechSynthesis | null => (typeof speechSynthesis !== 'undefined' ? speechSynthesis : null);

/** A voice whose language matches the locale (exact match preferred, then the same base language). */
export function pickVoice(voices: SpeechSynthesisVoice[], locale: string): SpeechSynthesisVoice | null {
  const l = locale.toLowerCase(); const base = l.split('-')[0] as string;
  return voices.find((v) => v.lang.toLowerCase().replace('_', '-') === l) ?? voices.find((v) => v.lang.toLowerCase().startsWith(base)) ?? null;
}

export function stop(): void { const a = active; active = null; a?.cancel(); synth()?.cancel(); if (audioStore.get().speaking !== 'idle') audioStore.set({ speaking: 'idle' }); }

export async function speak(cue: NarrationCue, vars: Vars = {}): Promise<void> {
  stop();
  const id = ++seq; last = { cue, vars };
  const s = audioStore.get();
  const r = resolveCue(cue, s.lang, vars);
  const info = getLanguage(r.lang);
  const notices: string[] = [];
  if (r.fellBack && s.lang !== 'en') notices.push(`${getLanguage(s.lang).label} text is not available for this cue; showing English.`);
  audioStore.set({ current: { cue, vars }, notice: null });

  return new Promise<void>((resolve) => {
    let done = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => { if (done) return; done = true; if (timer) clearTimeout(timer); if (active?.id === id) { active = null; audioStore.set({ speaking: 'idle' }); } resolve(); };
    const captionsOnly = (why: string | null) => {
      if (why) notices.push(why);
      audioStore.set({ speaking: 'captions', notice: notices.join(' ') || null });
      let remaining = captionMs(r.subtitle, audioStore.get().speed); let startedAt = Date.now();
      const arm = () => { startedAt = Date.now(); timer = setTimeout(finish, remaining); };
      active = { id, cancel: finish, pause: () => { if (timer) clearTimeout(timer); remaining -= Date.now() - startedAt; }, resume: arm, setRate: () => undefined };
      arm();
    };
    const useSpeechSynthesis = () => {
      const ss = synth();
      const voice = ss ? pickVoice(ss.getVoices(), info.ttsLocale) : null;
      if (!ss || !voice || typeof SpeechSynthesisUtterance === 'undefined') { captionsOnly(`No ${info.label} voice is installed on this device, so only captions are shown.`); return; }
      const u = new SpeechSynthesisUtterance(r.voice); u.voice = voice; u.lang = voice.lang; u.rate = audioStore.get().speed;
      u.onend = finish; u.onerror = finish;
      active = { id, cancel: () => { ss.cancel(); finish(); }, pause: () => ss.pause(), resume: () => ss.resume(), setRate: () => undefined };
      audioStore.set({ speaking: 'voice', notice: notices.join(' ') || null });
      ss.speak(u);
    };
    const usePreGenerated = async (): Promise<boolean> => {
      if (/\{\w+\}/.test(cue.text[r.lang]?.voiceText ?? cue.text[r.lang]?.subtitle ?? '')) return false; // filled with real values: cannot be pre-generated
      const m = await loadManifest();
      const entry = m.entries[`${r.lang}/${cue.id}`];
      if (!entry || entry.hash !== textHash(cue.text[r.lang]?.voiceText ?? cue.text[r.lang]?.subtitle ?? '')) return false;
      return new Promise<boolean>((ok) => {
        const a = new Audio(`/audio/${r.lang}/${cue.id}.mp3`); a.playbackRate = audioStore.get().speed;
        let started = false;
        a.onplaying = () => { started = true; ok(true); };
        a.onended = finish;
        a.onerror = () => { if (!started) ok(false); else finish(); };
        active = { id, cancel: () => { a.pause(); finish(); }, pause: () => a.pause(), resume: () => void a.play(), setRate: (x) => { a.playbackRate = x; } };
        audioStore.set({ speaking: 'voice', notice: notices.join(' ') || null });
        a.play().catch(() => ok(false));
      });
    };

    if (!s.narrationOn) { captionsOnly(null); return; }
    void usePreGenerated().then((ok) => { if (id !== seq || done) return; if (!ok) useSpeechSynthesis(); });
  });
}

export function pause(): void { if (!active) return; active.pause(); audioStore.set({ speaking: 'paused' }); }
export function resume(): void { if (!active || audioStore.get().speaking !== 'paused') return; active.resume(); audioStore.set({ speaking: audioStore.get().narrationOn ? 'voice' : 'captions' }); }
export function replay(): Promise<void> { return last ? speak(last.cue, last.vars) : Promise.resolve(); }
/** Skip ends the current cue immediately (a lesson then moves on to the next one). */
export function skip(): void { stop(); }
export function clearSubtitle(): void { stop(); audioStore.set({ current: null, notice: null }); }
