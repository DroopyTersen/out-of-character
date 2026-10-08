import { z } from 'zod';
import { TRANSCRIPT_LIMIT, transcriptCharacters } from './transcript';

// The browser's commands, as the HTTP poll protocol carries them. The field names are the practice simulator's
// (scenarioId is the spec's id, clientId the voice's) until the browser moves to the renamed protocol.

const uuid = z.string().uuid();
const quietDuration = z.number().int().min(0).max(60_000).nullable().optional();
const packets = z.number().int().min(0).max(1_000_000);
const delay = z.number().int().min(0).max(60_000).nullable();
const network = z.object({ ms: z.number().int().min(0).max(600_000), received: packets, lost: packets, concealed: z.number().min(0).max(1).nullable(), jitterMs: delay, sentLost: packets.nullable(), rttMs: delay }).strict();
/** `active`: a click or key press since the last report. `audio`: Sam's playback was audible in the last 1.5 s. */
export const activitySchema = z.object({ active: z.boolean(), audio: z.boolean(), outputQuietMs: quietDuration, sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  // Diagnostics only: a report this server cannot read is dropped, never a failed poll.
  network: network.optional().catch(undefined) }).strict();
export type Activity = z.infer<typeof activitySchema>;
// The provider does not filter frontend events; deny data channels so the interviewer's context stays private.
export const offerSchema = z.string().min(20).max(60_000).startsWith('v=0').refine(sdp => !/^m=(?!audio )/m.test(sdp), 'Only audio media is allowed.');
/** The spec and voice are checked against the session's spec by the session. */
export const startSchema = z.object({ id: uuid, scenarioId: z.string(), clientId: z.string(), sdp: offerSchema }).strict();
export type StartInput = z.infer<typeof startSchema>;
export const resumeSchema = z.object({ sdp: offerSchema }).strict();
/** The capability the browser minted for the attempt, on every command. */
export const CAPABILITY = /^Bearer [a-f0-9]{64}$/;
export const PROTOCOL_ACTIONS = ['start', 'poll', 'ready', 'end', 'report', 'pause', 'resume'] as const;
export type ProtocolAction = typeof PROTOCOL_ACTIONS[number];

const passageSchema = z.object({
  id: z.string().min(1).max(100), speaker: z.enum(['participant', 'interviewer']), text: z.string().max(TRANSCRIPT_LIMIT.characters),
  startMs: z.number().min(0), endMs: z.number().min(0),
}).strict();
/** An imported transcript for the narrative route: the spec whose template writes it, and its passages within the evaluator's bound. */
export const narrativeRequestSchema = z.object({
  specId: z.string().min(1).max(100),
  passages: z.array(passageSchema).max(TRANSCRIPT_LIMIT.entries).refine(passages => transcriptCharacters(passages) <= TRANSCRIPT_LIMIT.characters, 'The transcript is too long.'),
}).strict();
export type NarrativeRequest = z.infer<typeof narrativeRequestSchema>;
