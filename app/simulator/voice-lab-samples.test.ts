import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { expect, test } from 'bun:test';
import { clients } from '../../ai/simulator/scenarios.server';
import { liveVoices } from '../../core/simulator/voices';
import { LIVE_MODEL } from '../server/simulator/live.server';
import { clientProfiles } from './client-profiles';

const root = new URL('../../', import.meta.url);

test('every client and voice combination has an audio clip for the current sample', async () => {
  const manifest = JSON.parse(await readFile(new URL('scripts/voice-lab-manifest.json', root), 'utf8')) as {
    model: string;
    clips: Record<string, { sampleHash: string; audioHash: string; transcript: string; seconds: number }>;
  };
  const expected = clients.flatMap(client => liveVoices.map(voice => `${client.id}/${voice.id}`));
  expect(manifest.model).toBe(LIVE_MODEL);
  expect(Object.keys(manifest.clips).sort()).toEqual(expected.sort());
  const directory = new URL('public/simulator/voice-lab/', root);
  expect((await readdir(directory)).sort()).toEqual(clients.map(client => client.id).sort());
  for (const client of clients) {
    expect((await readdir(new URL(`${client.id}/`, directory))).sort()).toEqual(liveVoices.map(voice => `${voice.id}.mp3`).sort());
  }
  for (const client of clients) for (const voice of liveVoices) {
    const key = `${client.id}/${voice.id}`;
    const clip = manifest.clips[key]!;
    const hash = createHash('sha256').update(clientProfiles[client.id]!.sample).digest('hex');
    expect(clip.sampleHash).toBe(hash);
    expect(clip.transcript.length).toBeGreaterThan(60);
    const finalWord = clientProfiles[client.id]!.sample.toLowerCase().match(/[a-z]+/g)!.at(-1)!;
    expect(clip.transcript.toLowerCase().match(/[a-z]+/g)!.slice(-5)).toContain(finalWord);
    expect(clip.seconds).toBeGreaterThan(5);
    expect(clip.seconds).toBeLessThan(35);
    const audio = await readFile(new URL(`public/simulator/voice-lab/${key}.mp3`, root));
    expect(audio.length).toBeGreaterThan(20_000);
    expect(audio.subarray(0, 3).toString()).toBe('ID3');
    expect(createHash('sha256').update(audio).digest('hex')).toBe(clip.audioHash);
  }
});
