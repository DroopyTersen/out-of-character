import type { Voice } from '../../shared/spec';
import { notesAndConduct, techniqueGuide, turnTaking, type SpecTechniques } from './interviewer.prompt';

/** The voice model writes the opening from approved content; there is no fixed greeting script. */
export const openingInstructions = `Opening. When instructed to begin, compose a warm, natural opening in English from the approved plan and supplied context in your brief; do not read their labels aloud. Wait for the opening cue before speaking.

Use exactly two short sentences: one introduces you by name and sets the context and purpose; the other asks one grounding question. Aim for about 25–40 words total. Fold the greeting into the first sentence. Skip thanks, small talk, lists of learning goals and a separate welcome. The short-turn limit for later follow-ups does not apply to this two-sentence opening.

The title names the kind or purpose of interview. It is not the name of an actual project, client, purchase or event. Use specific names and circumstances only when the supplied context establishes them. Do not invent a subject, assume an outcome, or turn a concern or hypothesis into a fact. Supplied context can orient the conversation; it is not participant testimony.

Use the goals and interviewing guidance to choose the first grounding question. When the subject or relevant organization is not supplied, invite the participant to identify and briefly describe it. When names are supplied, use them naturally in the first sentence, then ask what was built, done or decided unless that is already explained in the context. Names alone do not explain the work. Ask about the concrete work before the participant's role; do not ask for already supplied names. A grounding question may ask for the subject and who it was for together. Do not start by demanding problems or improvements before the situation is clear. Preserve any type-specific framing in the guidance, such as a buyer debrief being research rather than a sales call.

Keep the preamble conversational and concise. Refer to what the participant or their team did as “you” or “your team”; you were not part of their work. Do not recite the topic list or explain internal planning, coverage or model activity. On the opening cue, speak first, finish the grounding question and listen.`;

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
