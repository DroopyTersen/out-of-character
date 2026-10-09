import { z } from 'zod';
import { TRANSCRIPT_LIMIT, transcriptCharacters } from './transcript';
import { interviewContextSchema, reportFormatSchema } from './plan';
import type { InterviewSnapshot } from './snapshot';

// Interview commands shared by HTTP and socket transports.

const uuid = z.string().uuid();
const quietDuration = z.number().int().min(0).max(60_000).nullable().optional();
const packets = z.number().int().min(0).max(1_000_000);
const delay = z.number().int().min(0).max(60_000).nullable();
const network = z.object({ ms: z.number().int().min(0).max(600_000), received: packets, lost: packets, concealed: z.number().min(0).max(1).nullable(), jitterMs: delay, sentLost: packets.nullable(), rttMs: delay }).strict();
/** `active`: a click or key press since the last report. `audio`: Sam's playback was audible in the last 1.5 s.
 * inputQuietMs remains accepted for older clients; it no longer controls interview behavior. */
export const activitySchema = z.object({ active: z.boolean(), audio: z.boolean(), outputQuietMs: quietDuration, inputQuietMs: quietDuration, sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  /** The participant has a typed draft open; only sequenced reports may change it. */
  composing: z.boolean().optional(),
  // Diagnostics only: a report this server cannot read is dropped, never a failed poll.
  network: network.optional().catch(undefined) }).strict();
export type Activity = z.infer<typeof activitySchema>;
/** A `ready` may carry the browser's current activity report, applied before the session goes live. */
export const readySchema = activitySchema.optional();
/** One typed participant turn, in characters of text and bytes of JSON around it. */
export const TYPED_TEXT_LIMIT = 2000;
export const SUBMIT_TEXT_BODY_LIMIT = 16 * 1024;
/** `id` is minted once per attempt by the browser and retried unchanged; the text is kept exactly as sent. */
export const submitTextSchema = z.object({ id: uuid, text: z.string().max(TYPED_TEXT_LIMIT).refine(text => text.trim().length > 0, 'Type an answer first.') }).strict();
export type SubmitTextInput = z.infer<typeof submitTextSchema>;
/** The accepted attempt id and the snapshot after the turn's checkpoint was written. */
export type SubmitTextReply = { acceptedId: string; snapshot: InterviewSnapshot };
// The provider does not filter frontend events; deny data channels so the interviewer's context stays private.
export const offerSchema = z.string().min(20).max(60_000).startsWith('v=0').refine(sdp => !/^m=(?!audio )/m.test(sdp), 'Only audio media is allowed.');
/** The spec and voice are checked against the session's spec by the session. */
export const startSchema = z.object({ id: uuid, planId: z.string(), voiceId: z.string(), sdp: offerSchema }).strict();
export type StartInput = z.infer<typeof startSchema>;
export const resumeSchema = z.object({ sdp: offerSchema }).strict();
/** The capability the browser minted for the attempt, on every command. */
export const CAPABILITY = /^Bearer [a-f0-9]{64}$/;
export const PROTOCOL_ACTIONS = ['start', 'poll', 'ready', 'end', 'report', 'pause', 'resume', 'submitText'] as const;
export type ProtocolAction = typeof PROTOCOL_ACTIONS[number];

const passageSchema = z.object({
  id: z.string().min(1).max(100), speaker: z.enum(['participant', 'interviewer']), text: z.string().max(TRANSCRIPT_LIMIT.characters),
  startMs: z.number().min(0), endMs: z.number().min(0),
}).strict();
/** Phase 2 is independent of live sessions, plans, conversation maps and coverage judgments. */
export const narrativeRequestSchema = z.object({
  transcript: z.array(passageSchema).max(TRANSCRIPT_LIMIT.entries)
    .refine(passages => transcriptCharacters(passages) <= TRANSCRIPT_LIMIT.characters, 'The transcript is too long.')
    .refine(passages => new Set(passages.map(passage => passage.id)).size === passages.length, 'Passage IDs must be unique.'),
  format: reportFormatSchema,
  context: interviewContextSchema.optional(),
}).strict();
export type NarrativeRequest = z.infer<typeof narrativeRequestSchema>;

/**
 * The socket transport: one WebSocket per attempt at `/api/interview/sessions/:id/socket`, opt-in for a host.
 * Each message is one command, answered by the same handler as its HTTP route; `id` correlates the reply.
 * The report streams, so it stays on HTTP.
 */
export const SOCKET_ACTIONS = ['start', 'poll', 'ready', 'end', 'pause', 'resume', 'submitText'] as const;
/** The largest command message: a start's SDP offer with room for the JSON around it. */
export const SOCKET_MESSAGE_LIMIT = 128 * 1024;
export const socketRequestSchema = z.object({
  id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  action: z.enum(SOCKET_ACTIONS),
  /** The attempt's capability: the 64 hex digits that follow `Bearer ` on HTTP. */
  capability: z.string().regex(/^[a-f0-9]{64}$/),
  body: z.unknown().optional(),
}).strict();
export type SocketRequest = z.infer<typeof socketRequestSchema>;
/** The HTTP reply's status and JSON body. `id` is null when the message could not be read. */
export type SocketReply = { id: number | null; status: number; body: unknown };
