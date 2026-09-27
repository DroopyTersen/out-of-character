import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { clients } from '../ai/simulator/scenarios.server.ts';
import { clientProfiles } from '../app/simulator/client-profiles.ts';
import { liveVoices } from '../core/simulator/voices.ts';
import { LIVE_MODEL } from '../app/server/simulator/live.server.ts';
import { captureLiveClip, encodeLiveClip, hash, trimmedPcm } from './lib/live-voice-clip.mjs';

// Generate public, reusable audition clips with the same model and voices as live practice.
// Usage: bun --env-file=.dev.vars scripts/voice-lab-samples.mjs --paid
//   [--client=morgan,jamie] [--voice=cedar,willow] [--concurrency=4] [--force] [--dry-run]
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const selectedClients = [...new Set(option('client')?.split(',') ?? clients.map(client => client.id))];
const selectedVoices = [...new Set(option('voice')?.split(',') ?? liveVoices.map(voice => voice.id))];
const concurrency = Math.min(8, Math.max(1, Number(option('concurrency') ?? 4)));
for (const id of selectedClients) if (!clients.some(client => client.id === id)) throw new Error(`Unknown client: ${id}`);
for (const id of selectedVoices) if (!liveVoices.some(voice => voice.id === id)) throw new Error(`Unknown voice: ${id}`);
if (!Number.isInteger(concurrency)) throw new Error('Concurrency must be an integer.');

const manifestPath = 'scripts/voice-lab-manifest.json';
const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : { model: LIVE_MODEL, clips: {} };
const instructions = client => `You are ${client.name}, a client speaking in a consultancy meeting. Play this personality with expressive, theatrical commitment while sounding like a real person. ${client.behavior} This is a short prepared voice sample, not an interactive conversation. Speak in English. Do not invent project details or say stage directions aloud.`;
const opening = sample => `Speak now as the client. Say this paragraph once, keeping its meaning and most of its wording. Do not introduce it, explain it, or add anything afterward: ${sample}`;
const tokens = value => value.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
function closeEnough(expected, actual) {
  const target = tokens(expected), heard = tokens(actual);
  const counts = new Map();
  for (const word of heard) counts.set(word, (counts.get(word) ?? 0) + 1);
  let matched = 0;
  for (const word of target) {
    if (!counts.get(word)) continue;
    matched++;
    counts.set(word, counts.get(word) - 1);
  }
  return matched / target.length >= .65 && heard.length / target.length >= .7 && heard.length / target.length <= 1.4
    && heard.slice(-5).includes(target.at(-1));
}

const capture = (client, voice, sample) => captureLiveClip({
  model: LIVE_MODEL, voice, instructions: instructions(client), opening: opening(sample),
});
const encode = (result, path) => encodeLiveClip(result, path);

const pairs = selectedClients.flatMap(id => selectedVoices.map(voice => ({ client: clients.find(client => client.id === id), voice })));
const pending = [];
for (const { client, voice } of pairs) {
  const sample = clientProfiles[client.id]?.sample;
  if (!sample) throw new Error(`Missing sample for ${client.id}`);
  const key = `${client.id}/${voice}`;
  const path = `public/simulator/voice-lab/${key}.mp3`;
  const sourceHash = hash(`${LIVE_MODEL}\n${voice}\n${instructions(client)}\n${opening(sample)}`);
  const current = manifest.clips[key];
  const audioHash = existsSync(path) ? hash(await readFile(path)) : null;
  if (process.argv.includes('--force') || current?.sourceHash !== sourceHash || current?.audioHash !== audioHash) {
    pending.push({ client, voice, sample, key, path, sourceHash });
  }
}
if (process.argv.includes('--dry-run')) {
  console.log(`${pending.length} of ${pairs.length} clips would be recorded: ${pending.map(job => job.key).join(', ') || 'none'}`);
  process.exit(0);
}
if (!process.argv.includes('--paid')) throw new Error('Pass --paid to generate voice samples, or --dry-run to preview.');
if (!process.env.OPENAI_API_KEY) throw new Error('Load OPENAI_API_KEY from the ignored local credentials file.');
for (const tool of ['ffmpeg', 'ffprobe']) {
  const check = Bun.spawn([tool, '-version'], { stdout: 'ignore', stderr: 'ignore' });
  if (await check.exited) throw new Error(`${tool} is required to generate voice samples.`);
}
console.log(`Recording ${pending.length} of ${pairs.length} selected clips.`);
let next = 0, complete = 0, writeQueue = Promise.resolve(), fatal = null;
const failures = [];
async function worker() {
  while (!fatal && next < pending.length) {
    const { client, voice, sample, key, path, sourceHash } = pending[next++];
    let result, error, successfulAttempt;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (fatal) return;
      try {
        result = await capture(client, voice, sample);
        if (!closeEnough(sample, result.transcript)) throw new Error(`Transcript differed too much: ${result.transcript}`);
        const duration = trimmedPcm(result).length / 48_000;
        if (duration < 5 || duration > 35) throw new Error(`Implausible speech duration: ${duration.toFixed(1)}s`);
        successfulAttempt = attempt;
        error = null;
        break;
      } catch (cause) {
        error = cause;
        console.error(`${key} take ${attempt}: ${cause.message}`);
      }
    }
    if (error) { failures.push(`${key}: ${error.message}`); continue; }
    if (fatal) return;
    try {
      const { seconds, audioHash } = await encode(result, path);
      manifest.model = LIVE_MODEL;
      manifest.clips[key] = { sampleHash: hash(sample), sourceHash, audioHash, transcript: result.transcript, seconds: Math.round(seconds * 10) / 10, attempts: successfulAttempt };
      writeQueue = writeQueue.then(() => writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`));
      await writeQueue;
      complete++;
      console.log(`${complete}/${pending.length} ${key} ${seconds.toFixed(1)}s`);
    } catch (cause) {
      fatal = cause;
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
if (fatal) throw fatal;
if (failures.length) throw new Error(`Failed samples:\n${failures.join('\n')}`);
console.log(`Ready: ${complete} new clips, ${pairs.length - pending.length} already current.`);
