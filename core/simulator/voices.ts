/** Built-in GPT-Live voices. Keep this allowlist in sync with OpenAI's Live API. */
export const liveVoices = [
  { id: 'alloy', label: 'Alloy' },
  { id: 'ash', label: 'Ash' },
  { id: 'ballad', label: 'Ballad' },
  { id: 'coral', label: 'Coral' },
  { id: 'echo', label: 'Echo' },
  { id: 'sage', label: 'Sage' },
  { id: 'shimmer', label: 'Shimmer' },
  { id: 'verse', label: 'Verse' },
  { id: 'marin', label: 'Marin' },
  { id: 'cedar', label: 'Cedar' },
  { id: 'quartz', label: 'Quartz', description: 'Australian English influence · feminine presentation · generated' },
  { id: 'ripple', label: 'Ripple', description: 'Australian English influence · masculine presentation · natural' },
  { id: 'vesper', label: 'Vesper', description: 'British English influence · masculine presentation · natural' },
  { id: 'willow', label: 'Willow', description: 'Irish English influence · feminine presentation · natural' },
  { id: 'stone', label: 'Stone', description: 'Irish English influence · masculine presentation · natural' },
  { id: 'gleam', label: 'Gleam', description: 'North American English influence · feminine presentation · natural' },
  { id: 'meridian', label: 'Meridian', description: 'North American English influence · masculine presentation · natural' },
  { id: 'bossa', label: 'Bossa', description: 'Brazilian Portuguese · feminine presentation · natural' },
  { id: 'tempo', label: 'Tempo', description: 'Brazilian Portuguese · masculine presentation · natural' },
  { id: 'beacon', label: 'Beacon', description: 'Filipino English influence · masculine presentation · generated' },
  { id: 'delta', label: 'Delta', description: 'Southern U.S. English influence · feminine presentation · generated' },
  { id: 'cinder', label: 'Cinder', description: 'Southern U.S. English influence · masculine presentation · generated' },
] as const;

export type LiveVoice = typeof liveVoices[number]['id'];
export const isLiveVoice = (value: string): value is LiveVoice => liveVoices.some(voice => voice.id === value);
