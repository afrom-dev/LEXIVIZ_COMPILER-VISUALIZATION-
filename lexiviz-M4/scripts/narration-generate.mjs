// npm run narration:generate [-- --dry-run]
// Pre-generates audio for fixed lesson cues into public/audio/<lang>/<cueId>.mp3 and records a text-hash manifest.
// Keys come only from .env (never from browser code). Without a key the script skips and says so.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, planJobs, providers } from './narration-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry-run');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const env = { ...(existsSync(join(root, '.env')) ? parseEnv(readFileSync(join(root, '.env'), 'utf8')) : {}), ...process.env };

const lessons = read('src/lessons/lessons.json').lessons;
const languages = read('src/audio/languages.json').languages;
const manifestPath = join(root, 'public/audio/manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { version: 1, entries: {} };
const settings = { provider: env.TTS_PROVIDER || '', voice: env.TTS_VOICE || '' };
const { jobs, upToDate } = planJobs(lessons, languages, manifest, settings);

console.log(`Narration: ${jobs.length} cue(s) to generate, ${upToDate} up to date.`);
if (dry) { for (const j of jobs) console.log(`  would generate ${j.key}`); process.exit(0); }
if (!env.TTS_API_KEY || !env.TTS_PROVIDER) {
  console.log('SKIPPED: no TTS_PROVIDER / TTS_API_KEY in .env. Nothing was generated; the app uses browser voices and subtitles. See .env.example.');
  process.exit(0);
}
const provider = providers[env.TTS_PROVIDER];
if (!provider) { console.error(`Unknown TTS_PROVIDER "${env.TTS_PROVIDER}". Known: ${Object.keys(providers).join(', ')}`); process.exit(1); }

let made = 0, failed = 0;
for (const j of jobs) {
  try {
    const mp3 = await provider.synth({ text: j.text, lang: j.lang, voice: settings.voice, model: env.TTS_MODEL, apiKey: env.TTS_API_KEY });
    const file = join(root, 'public/audio', j.lang.code, `${j.cueId}.mp3`);
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, mp3);
    manifest.entries[j.key] = { hash: j.hash, provider: settings.provider, voice: settings.voice };
    made++; console.log(`  generated ${j.key}`);
  } catch (e) { failed++; console.error(`  FAILED ${j.key}: ${e.message}`); }
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(`Done: ${made} generated, ${failed} failed.`);
process.exit(failed ? 1 : 0);
