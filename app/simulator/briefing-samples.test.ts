import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { expect, test } from 'bun:test';
import { scenarios } from '../../ai/simulator/scenarios.server';
import { scenarioBriefings } from '../../core/simulator/briefings';
import { LIVE_MODEL } from '../server/simulator/live.server';

const root = new URL('../../', import.meta.url);
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const words = (value: string) => value.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z]+(?:'[a-z]+)?/g) ?? [];

test('each playable scenario has an intact recording of its current briefing', async () => {
  const manifest = JSON.parse(await readFile(new URL('scripts/scenario-briefings-manifest.json', root), 'utf8')) as {
    model: string;
    voice: string;
    clips: Record<string, { scriptHash: string; audioHash: string; transcript: string; seconds: number }>;
  };
  const ids = scenarios.map(scenario => scenario.id).sort();
  expect(Object.keys(scenarioBriefings).sort()).toEqual(ids);
  expect(Object.keys(manifest.clips).sort()).toEqual(ids);
  expect((await readdir(new URL('public/simulator/briefings/', root))).filter(name => name.endsWith('.mp3')).sort()).toEqual(ids.map(id => `${id}.mp3`).sort());
  expect(manifest.model).toBe(LIVE_MODEL);
  expect(manifest.voice).toBe('ash');

  for (const id of ids) {
    const briefing = scenarioBriefings[id]!;
    const clip = manifest.clips[id]!;
    expect(briefing.speaker).toBe('Your colleague');
    expect(briefing.audio).toBe(`/simulator/briefings/${id}.mp3`);
    expect(clip.scriptHash).toBe(sha256(briefing.text));
    const scriptWords = words(briefing.text);
    expect(words(clip.transcript)).toEqual(scriptWords);
    const audio = await readFile(new URL(`public${briefing.audio}`, root));
    expect(audio.length).toBeGreaterThan(20_000);
    expect(audio.subarray(0, 3).toString()).toBe('ID3');
    expect(sha256(audio)).toBe(clip.audioHash);
    expect(clip.seconds).toBeGreaterThan(8);
    expect(clip.seconds).toBeLessThan(65);
  }
});
