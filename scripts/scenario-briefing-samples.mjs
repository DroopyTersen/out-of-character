import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { scenarioBriefings } from '../core/simulator/briefings.ts';
import { LIVE_MODEL } from '../app/server/simulator/live.server.ts';
import { captureLiveClip, encodeLiveClip, hash, trimmedPcm } from './lib/live-voice-clip.mjs';

// bun --env-file=.dev.vars scripts/scenario-briefing-samples.mjs --dry-run
// bun --env-file=.dev.vars scripts/scenario-briefing-samples.mjs --paid [--scenario=scope,demo] [--concurrency=3]
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const ids = [...new Set(option('scenario')?.split(',') ?? Object.keys(scenarioBriefings))];
const concurrency = Number(option('concurrency') ?? 3);
for (const id of ids) if (!scenarioBriefings[id]) throw new Error(`Unknown scenario: ${id}`);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Concurrency must be 1–4.');

const voice = 'sage';
const instructions = 'You are a calm, brisk, professional colleague giving a short prerecorded handover to a consultant before a client call. Speak naturally at about 180 to 200 words per minute. This is not a client character or an interactive conversation. Read the supplied script exactly once in English, without an introduction, improvisation, or closing remark. Preserve every warning, negation, and commitment boundary.';
const opening = text => `Start speaking immediately. Read the following handover aloud verbatim, once. Do not wait for a reply. Do not add or omit words:\n\n${text}`;
const manifestPath = 'scripts/scenario-briefings-manifest.json';
const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : { model: LIVE_MODEL, voice, clips: {} };
const words = text => text.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
const jobs = [];
for (const id of ids) {
  const briefing = scenarioBriefings[id];
  const path = `public${briefing.audio}`;
  const sourceHash = hash(`${LIVE_MODEL}\n${voice}\n${instructions}\n${opening(briefing.text)}`);
  const current = manifest.clips[id];
  const audioHash = existsSync(path) ? hash(await readFile(path)) : null;
  if (process.argv.includes('--force') || current?.sourceHash !== sourceHash || current?.audioHash !== audioHash) {
    jobs.push({ id, path, text: briefing.text, sourceHash });
  }
}
if (process.argv.includes('--dry-run')) {
  console.log(`${jobs.length} of ${ids.length} briefings would be recorded: ${jobs.map(job => job.id).join(', ') || 'none'}`);
  process.exit(0);
}
if (!process.argv.includes('--paid')) throw new Error('Pass --paid to record briefings, or --dry-run to preview.');
if (!process.env.OPENAI_API_KEY) throw new Error('Load OPENAI_API_KEY from the ignored local credentials file.');
for (const tool of ['ffmpeg', 'ffprobe']) {
  const check = Bun.spawn([tool, '-version'], { stdout: 'ignore', stderr: 'ignore' });
  if (await check.exited) throw new Error(`${tool} is required to record briefings.`);
}

let next = 0, complete = 0, writeQueue = Promise.resolve();
const failures = [];
async function worker() {
  while (next < jobs.length) {
    const { id, path, text, sourceHash } = jobs[next++];
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await captureLiveClip({ model: LIVE_MODEL, voice, instructions, opening: opening(text), timeoutMs: 75_000 });
        const matchesScript = JSON.stringify(words(text)) === JSON.stringify(words(result.transcript));
        const duration = trimmedPcm(result).length / 48_000;
        if (!matchesScript || duration < 8 || duration > 65) {
          throw Object.assign(new Error(`Script match: ${matchesScript}; ${duration.toFixed(1)}s (take saved privately)`), { partial: result });
        }
        const { seconds, audioHash } = await encodeLiveClip(result, path, { tempDir: 'output/briefing-temp', minSeconds: 8, maxSeconds: 65 });
        manifest.model = LIVE_MODEL;
        manifest.voice = voice;
        manifest.clips[id] = { scriptHash: hash(text), sourceHash, audioHash, transcript: result.transcript, seconds: Math.round(seconds * 10) / 10, attempts: attempt };
        writeQueue = writeQueue.then(() => writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`));
        await writeQueue;
        complete++;
        console.log(`${complete}/${jobs.length} ${id} ${seconds.toFixed(1)}s exact script words`);
        break;
      } catch (error) {
        if (error.partial) {
          const dir = 'output/briefing-failures';
          await mkdir(dir, { recursive: true });
          const base = `${dir}/${id}-take-${attempt}`;
          if (error.partial.pcm.length) await writeFile(`${base}.pcm`, error.partial.pcm);
          await writeFile(`${base}.txt`, error.partial.transcript);
          await writeFile(`${base}.json`, JSON.stringify({ started: error.partial.started, pcmBytes: error.partial.pcm.length, transcriptLength: error.partial.transcript.length, audible: error.partial.firstAudible !== null, eventCounts: error.partial.eventCounts }, null, 2));
        }
        console.error(`${id} take ${attempt}: ${error.message}`);
        if (attempt === 2) failures.push(id);
      }
    }
  }
}
console.log(`Recording ${jobs.length} of ${ids.length} selected briefings.`);
await Promise.all(Array.from({ length: concurrency }, worker));
if (failures.length) throw new Error(`Failed briefings: ${failures.join(', ')}`);
console.log(`Ready: ${complete} new briefings, ${ids.length - jobs.length} already current.`);
