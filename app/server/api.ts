import { BodyError, boundedJson } from './http';
import { z } from 'zod';
import { CAST_VERSION, characters, characterById } from '../../core/characters';
import { evaluateCharacters, validateReadings, JUDGING_VERSION } from '../../ai/judging';
import { combineReadings } from '../../core/performance';
import { generateScene } from '../../ai/scenes';
import { openSpeech } from './speech';
import { findCharacterHighlights } from '../../ai/highlights';
import { validateHighlightReview } from '../../core/highlights';

const correlationId = z.string().min(1).max(128);
const characterId = z.string().refine(value => !!characterById[value], 'Unknown character');
const judgeSchema = z.object({
  attemptId: correlationId,
  snapshotId: z.number().int().nonnegative(),
  castVersion: z.string().max(100),
  judgingVersion: z.string().max(100),
  transcript: z.string().trim().min(1).max(8000),
  fullTranscript: z.string().trim().min(1).max(80000),
}).strict();
const sceneSchema = z.object({
  attemptId: correlationId,
  requestId: correlationId,
  characterId,
  history: z.array(z.object({ characterId, scene: z.string().min(1).max(1000) }).strict()).max(20),
  currentScene: z.string().max(1000).optional(),
}).strict();
const highlightsSchema = z.object({
  attemptId: correlationId, characterId,
  castVersion: z.string().max(100), judgingVersion: z.string().max(100),
  transcript: z.string().min(1).max(80000).refine(value => !!value.trim()),
}).strict();
const services = { judge: evaluateCharacters, scene: generateScene, speech: openSpeech, highlights: findCharacterHighlights };
export type ApiServices = typeof services;

const jsonError = (status: number, error: string, headers?: HeadersInit) => Response.json({ error }, { status, headers });

/** Returns null for page requests so React Router retains normal routing. */
export async function handleApi(request: Request, env: Env, paid: ApiServices = services): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/')) return null;
  if (path === '/api/health' && request.method === 'GET') return Response.json({
    ok: true, castCount: characters.length, castVersion: CAST_VERSION, judgingVersion: JUDGING_VERSION,
    paidServicesEnabled: String(env.PAID_SERVICES_ENABLED) === 'true',
    configured: { judging: !!env.TYPESAFE_API_KEY, scenes: !!env.OPENROUTER_API_KEY, speech: !!env.AI }, speech: 'cloudflare-flux',
  });
  if (!['/api/judge', '/api/scene', '/api/speech', '/api/highlights'].includes(path)) return jsonError(404, 'Unknown API route.');
  if (path !== '/api/speech' && request.method !== 'POST') return jsonError(405, 'Method not allowed.');
  if (request.headers.get('Origin') !== new URL(request.url).origin) return jsonError(403, 'Same-origin requests are required.');
  if (String(env.PAID_SERVICES_ENABLED) !== 'true') return jsonError(503, 'Paid services are temporarily disabled.');
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const limiter = path === '/api/judge' ? env.RATE_JUDGE : path === '/api/speech' ? env.RATE_SPEECH : env.RATE_SCENE;
  try {
    const result = await limiter.limit({ key: ip });
    if (!result.success) return jsonError(429, 'Too many requests. Please wait a minute.', { 'Retry-After': '60' });
    if (path === '/api/speech') return await paid.speech(request, env);
    const body = await boundedJson(request, path === '/api/scene' ? 32 * 1024 : 512 * 1024);
    if (path === '/api/highlights') {
      const parsed = highlightsSchema.safeParse(body);
      if (!parsed.success) return jsonError(400, 'Invalid highlight request.');
      const { attemptId, characterId, transcript, castVersion, judgingVersion } = parsed.data;
      if (castVersion !== CAST_VERSION || judgingVersion !== JUDGING_VERSION) return jsonError(409, 'The cast or judging version changed. Reload the game.');
      if (!env.TYPESAFE_API_KEY) return jsonError(503, 'Judging is not configured.');
      const review = await paid.highlights({ transcript, characterId, apiKey: env.TYPESAFE_API_KEY, signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]) });
      validateHighlightReview(review, transcript);
      return Response.json({ attemptId, characterId, review });
    }
    if (path === '/api/judge') {
      const parsed = judgeSchema.safeParse(body);
      if (!parsed.success) return jsonError(400, 'Invalid judging request.');
      const { attemptId, snapshotId, castVersion, judgingVersion, transcript, fullTranscript } = parsed.data;
      if (castVersion !== CAST_VERSION || judgingVersion !== JUDGING_VERSION) return jsonError(409, 'The cast or judging version changed. Reload the game.');
      const apiKey = env.TYPESAFE_API_KEY;
      if (!apiKey) return jsonError(503, 'Judging is not configured.');
      const controller = new AbortController();
      const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(2500)]);
      try {
        const judge = (text: string) => paid.judge({ transcript: text, apiKey, mode: 'noul', signal });
        const [recent, full] = await Promise.all([judge(transcript), judge(fullTranscript)]);
        validateReadings(recent.readings);
        validateReadings(full.readings);
        const readings = Object.fromEntries(characters.map(({ id }) => [id, combineReadings(full.readings[id]!, recent.readings[id]!)]));
        return Response.json({ attemptId, snapshotId, castVersion, judgingVersion, readings, recentReadings: recent.readings, fullReadings: full.readings });
      } finally { controller.abort(); }
    }
    const parsed = sceneSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, 'Invalid scene request.');
    if (!env.OPENROUTER_API_KEY) return jsonError(503, 'Scene generation is not configured.');
    const { attemptId, requestId, ...input } = parsed.data;
    const scene = await paid.scene({ ...input, apiKey: env.OPENROUTER_API_KEY, signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]) });
    return Response.json({ attemptId, requestId, scene });
  } catch (error) {
    if (error instanceof BodyError) return jsonError(error.status, error.message);
    return jsonError(502, path === '/api/judge' ? 'Judging failed. Please try again.' : path === '/api/speech' ? 'Speech recognition failed. Please try again.' : path === '/api/highlights' ? 'Transcript highlights are unavailable. Please try again.' : 'Scene generation failed. Please try again.');
  }
}
