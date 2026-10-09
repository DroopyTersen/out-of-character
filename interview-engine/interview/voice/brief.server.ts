import type { Voice } from '../../shared/spec';
import { notesAndConduct, techniqueGuide, turnTaking, type SpecTechniques } from './interviewer.prompt';
import { openingInstructions } from './opening.prompt';

/** The part of a spec the interviewer's brief reads. Server-only text: a spec the browser imports leaves it out. */
export type BriefedSpec = {
  interviewer: {
    name: string; voices: readonly Voice[]; role: string; persona: string; orientation: readonly string[]; boundaries: readonly string[];
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
export function interviewerBrief(spec: BriefedSpec, voiceId: string): string {
  checkVoice(spec, voiceId);
  const { name, role, persona, orientation, boundaries, techniques } = spec.interviewer;
  return [`You are ${name}, ${role}. ${persona}`, ...orientation, ...boundaries, ...turnTaking, techniqueGuide(techniques), ...notesAndConduct(), openingInstructions].join('\n\n');
}

/** The opening uses the same accepted plan and context as the rest of the interview. */
export function interviewOpening(spec: BriefedSpec, voiceId: string): string {
  checkVoice(spec, voiceId);
  // Appended context is limited to 500 tokens; the complete plan and opening guidance are already in the brief.
  return `Speak now in English as ${spec.interviewer.name}. Give the opening described in your brief in two short sentences: introduce yourself and set the context in one sentence, then ask one grounding question about the work or decision. Connect your introduction to the context with “and” rather than ending a separate greeting. Then listen. Do not wait for the participant to speak first.`;
}
