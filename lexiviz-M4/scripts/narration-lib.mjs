// Pure helpers for the narration generator (no network, no file writes), so they can be unit tested.

/** 32-bit FNV-1a. Must match textHash() in src/audio/narration.ts. */
export function textHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Minimal .env parser: KEY=value lines, # comments. Never logs values. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Fixed cues only: a cue with {placeholders} is filled at run time and spoken by the browser instead. */
export function fixedCues(lessons) {
  return lessons.flatMap((l) => l.stages.flatMap((s) => s.cues))
    .filter((c) => !Object.values(c.text).some((t) => /\{\w+\}/.test(t.voiceText ?? t.subtitle)));
}

/** What needs generating: every (language, cue) whose text hash or provider/voice differs from the manifest. */
export function planJobs(lessons, languages, manifest, settings) {
  const jobs = []; let upToDate = 0;
  for (const cue of fixedCues(lessons)) {
    for (const lang of languages) {
      const t = cue.text[lang.code]; if (!t) continue;
      const text = t.voiceText ?? t.subtitle;
      const key = `${lang.code}/${cue.id}`; const hash = textHash(text);
      const e = manifest.entries[key];
      if (e && e.hash === hash && e.provider === settings.provider && e.voice === settings.voice) upToDate++;
      else jobs.push({ key, lang, cueId: cue.id, text, hash });
    }
  }
  return { jobs, upToDate };
}

/** Providers share one interface: synth({ text, lang, voice, model, apiKey }) resolves to an mp3 Buffer. */
export const providers = {
  openai: {
    name: 'openai',
    async synth({ text, voice, model, apiKey }) {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || 'gpt-4o-mini-tts', voice: voice || 'alloy', input: text, response_format: 'mp3' }),
      });
      if (!res.ok) throw new Error(`openai tts failed: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  },
};
