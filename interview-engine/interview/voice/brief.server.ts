import type { Voice } from '../../shared/spec';
import { LIVE_NOTE_CHANNEL, type NoteChannel } from './channel';
import { notesAndConduct, techniqueGuide, turnTaking, type SpecTechniques } from './interviewer.prompt';

/** The part of a spec the interviewer's brief reads. Server-only text: a spec the browser imports leaves it out. */
export type BriefedSpec = {
  interviewer: {
    name: string; voices: readonly Voice[]; role: string; persona: string; opening: string; orientation: readonly string[]; boundaries: readonly string[];
    techniques: SpecTechniques;
  };
};

function checkVoice(spec: BriefedSpec, voiceId: string) {
  if (!spec.interviewer.voices.some(voice => voice.id === voiceId)) throw new Error('Unknown interviewer.');
}

/**
 * The voice model's instructions, in five parts: who the interviewer is and the spec's ground rules, turn-taking,
 * how the interview ends, the technique guide, and the private notes. The interviewer never sees the topics.
 */
export function interviewerBrief(spec: BriefedSpec, voiceId: string, channel: NoteChannel = LIVE_NOTE_CHANNEL): string {
  checkVoice(spec, voiceId);
  const { name, role, persona, orientation, boundaries, techniques } = spec.interviewer;
  return [`You are ${name}, ${role}. ${persona}`, ...orientation, ...boundaries, ...turnTaking, techniqueGuide(techniques), ...notesAndConduct(channel)].join('\n\n');
}

/** The instruction that makes the interviewer speak first. */
export function interviewOpening(spec: BriefedSpec, voiceId: string): string {
  checkVoice(spec, voiceId);
  return `Speak now in English: “${spec.interviewer.opening}” Then listen. Do not wait for the participant to speak first.`;
}
