import { z } from 'zod';

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const mediaEventSchema = z.object({ sequence: count, epoch: count, atMs: z.number().min(0).finite(), inputActive: z.boolean(), outputActive: z.boolean() }).strict();
export type MediaActivity = z.infer<typeof mediaEventSchema>;
export const mediaBatchSchema = z.object({
  captureId: z.string().uuid(), events: z.array(mediaEventSchema).max(32), dropped: count, observed: count,
  clock: z.object({ epoch: count, atMs: z.number().min(0).finite(), serverAt: z.number().finite(), roundTripMs: z.number().min(0).max(60_000) }).strict().optional(),
}).strict();
export type MediaBatch = z.infer<typeof mediaBatchSchema>;
export type MediaCapture = { captureId: string; dropped: number; observed: number; received: number; clocks: NonNullable<MediaBatch['clock']>[] };
export type MediaDiagnostics = { events: (MediaActivity & { captureId: string; receivedAt: number })[]; captures: MediaCapture[]; discarded: number };
