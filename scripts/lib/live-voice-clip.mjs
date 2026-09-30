import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { foundryConfig, foundryUrl } from '../../ai/foundry.server.ts';

const silence = Buffer.alloc(960).toString('base64'); // 20 ms of mono PCM16 at 24 kHz.
export const hash = value => createHash('sha256').update(value).digest('hex');

export function captureLiveClip({ voice, instructions, opening, timeoutMs = 55_000 }) {
  return new Promise((resolve, reject) => {
    const foundry = foundryConfig(process.env);
    const socket = new WebSocket(foundryUrl(foundry, '/live/sessions').replace('https:', 'wss:'), {
      headers: { 'api-key': foundry.apiKey },
    });
    const chunks = [], eventCounts = {};
    let bytes = 0, firstAudible = null, lastAudible = 0, lastSoundAt = 0, lastTextAt = 0;
    let transcript = '', started = false, startedAt = 0, closing = false, settled = false, failure = null;
    let pacing, closeDeadline;
    const send = event => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event)); };
    const finish = error => {
      if (settled) return;
      settled = true;
      clearInterval(pacing); clearTimeout(deadline); clearTimeout(closeDeadline);
      socket.close();
      if (error) {
        error.partial = { pcm: Buffer.concat(chunks), transcript: transcript.trim(), started, firstAudible, lastAudible, eventCounts };
        reject(error);
      }
      else resolve({ pcm: Buffer.concat(chunks), firstAudible, lastAudible, transcript: transcript.trim() });
    };
    const close = () => {
      if (closing) return;
      closing = true;
      clearInterval(pacing);
      send({ type: 'session.close' });
      closeDeadline = setTimeout(() => finish(failure ?? new Error('Session finalization timed out.')), 10_000);
    };
    const deadline = setTimeout(() => { failure = new Error('Speech generation timed out.'); close(); }, timeoutMs);
    socket.addEventListener('open', () => send({
      type: 'session.start',
      session: {
        model: foundry.liveModel, instructions, delegation: { type: 'client' }, store: false,
        audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice } },
      },
    }));
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      let value;
      try { value = JSON.parse(event.data); } catch { return; }
      eventCounts[value.type] = (eventCounts[value.type] ?? 0) + 1;
      if (value.type === 'session.started') {
        started = true;
        startedAt = lastTextAt = Date.now();
        send({ type: 'session.instructions.append', event_id: 'sample', delegation_id: null, content: opening });
        pacing = setInterval(() => {
          send({ type: 'session.input_audio.append', audio: silence });
          if (firstAudible === null && !transcript && Date.now() - startedAt > 15_000) {
            failure = new Error('No speech began within fifteen seconds.'); close();
          }
          if (lastSoundAt && Date.now() - lastSoundAt > 3000 && Date.now() - lastTextAt > 1800) close();
        }, 20);
      } else if (value.type === 'session.output_audio.delta') {
        const audio = Buffer.from(value.delta, 'base64');
        chunks.push(audio);
        let energy = 0;
        for (let i = 0; i + 1 < audio.length; i += 2) energy += audio.readInt16LE(i) ** 2;
        if (audio.length && Math.sqrt(energy / (audio.length / 2)) > 200) {
          firstAudible ??= bytes;
          lastAudible = bytes + audio.length;
          lastSoundAt = Date.now();
        }
        bytes += audio.length;
      } else if (value.type === 'session.output_transcript.delta') {
        transcript += value.delta;
        lastTextAt = Date.now();
      } else if (value.type === 'session.delegation.created') {
        failure = new Error('The speaker requested an unrelated task.'); close();
      } else if (value.type === 'error') {
        failure = new Error(`Voice service error: ${value.error?.code ?? 'unknown'}`); close();
      } else if (value.type === 'session.closed') {
        finish(failure ?? (!started || firstAudible === null || !transcript ? new Error('No complete spoken sample was captured.') : null));
      }
    });
    socket.addEventListener('error', () => { failure = new Error('Voice transport failed.'); close(); });
    socket.addEventListener('close', () => finish(failure ?? new Error('Voice transport closed before finalization.')));
  });
}

export function trimmedPcm({ pcm, firstAudible, lastAudible }) {
  const start = Math.max(0, firstAudible - 12_000); // Keep 250 ms before speech.
  const end = Math.min(pcm.length, lastAudible + 19_200); // Keep 400 ms after speech.
  return pcm.subarray(start, end);
}

export async function encodeLiveClip(captureResult, path, { tempDir = 'output/voice-lab-temp', minSeconds = 5, maxSeconds = 35 } = {}) {
  const trimmed = trimmedPcm(captureResult);
  await mkdir(dirname(path), { recursive: true });
  await mkdir(tempDir, { recursive: true });
  const temporary = join(tempDir, `${randomUUID()}.mp3`);
  try {
    const ffmpeg = Bun.spawn([
      'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-codec:a', 'libmp3lame', '-b:a', '64k', temporary,
    ], { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' });
    ffmpeg.stdin.write(trimmed); ffmpeg.stdin.end();
    const code = await ffmpeg.exited;
    if (code) throw new Error(`Audio encoding failed: ${await new Response(ffmpeg.stderr).text()}`);
    const probe = Bun.spawn(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', temporary], { stdout: 'pipe', stderr: 'ignore' });
    const seconds = Number((await new Response(probe.stdout).text()).trim());
    if (await probe.exited || !Number.isFinite(seconds) || seconds < minSeconds || seconds > maxSeconds) throw new Error(`Invalid clip duration: ${seconds}`);
    const audioHash = hash(await readFile(temporary));
    await rename(temporary, path);
    return { seconds, audioHash };
  } finally {
    await rm(temporary, { force: true });
  }
}
