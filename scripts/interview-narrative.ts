import { NARRATIVE_VERSION } from '../interview-engine/shared/narrative';
/**
 * Writes an interview narrative for a transcript file, outside any attempt: `writeNarrative` against Foundry.
 *
 *   bun --env-file=.dev.vars scripts/interview-narrative.ts <transcript.json> [--spec <id>] [--out <result.json>]
 *
 * The file can hold { transcript, format, context? } directly, independent of the catalog.
 * For historical inputs it holds the passages as a JSON array, `{ specId, passages }`, an archive row the reference host wrote to
 * INTERVIEW_ARCHIVE_DIR (`{ specId, transcript }`), or a D1 interview row (`{ scenario_id, transcript_json }`).
 * Speakers may be `participant`/`interviewer` or the wire's `trainee`/`client`. `--spec` picks the interview when the
 * file does not name one; the default is the project closeout. The text streams to stdout as it is written; the
 * result (document, failure and usage) goes to `--out`, or to stdout after the stream.
 */
import { z } from 'zod';
import { foundryConfig } from '../ai/foundry.server';
import { archivedTranscriptSchema as passagesSchema } from '../core/interview-transcript';
import { narrativeRequestSchema } from '../interview-engine/shared/protocol';
import type { NarrativeInput } from '../interview-engine/narrative/narrative.server';
import { writeNarrative } from '../interview-engine/narrative/write.server';
import { foundryProviders } from '../interview-engine/providers/providers.server';
import type { Passage } from '../interview-engine/shared/transcript';
import { spec as closeout } from '../interviews/project-closeout/spec';
import { spec as sales } from '../interviews/sales-win-loss/spec';

const usage = 'Usage: bun scripts/interview-narrative.ts <transcript.json> [--spec <id>] [--out <result.json>]';
const specs = [closeout, sales];

export function parseArgs(args: string[]) {
  let file: string | undefined, specId: string | undefined, out: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--spec' || arg === '--out') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(usage);
      if (arg === '--spec') specId = value; else out = value;
    } else if (!arg.startsWith('--') && !file) file = arg;
    else throw new Error(usage);
  }
  if (!file) throw new Error(usage);
  return { file, specId, out };
}

const fileSchema = z.union([
  passagesSchema.transform(passages => ({ passages, specId: undefined as string | undefined })),
  z.object({ specId: z.string().optional(), passages: passagesSchema }).transform(value => ({ passages: value.passages, specId: value.specId })),
  z.object({ specId: z.string(), transcript: passagesSchema }).transform(value => ({ passages: value.transcript, specId: value.specId as string | undefined })),
  z.object({ scenario_id: z.string(), transcript_json: z.string() }).transform((value, context) => {
    try { return { passages: passagesSchema.parse(JSON.parse(value.transcript_json)), specId: value.scenario_id as string | undefined }; }
    catch { context.addIssue({ code: 'custom', message: 'transcript_json is not a transcript.' }); return z.NEVER; }
  }),
]);

/** The transcript and spec a file describes; `--spec` applies when the file names no interview. */
export function readTranscript(value: unknown, specId?: string) {
  const parsed = fileSchema.safeParse(value);
  if (!parsed.success) throw new Error('The file is not a transcript: expected passages, { specId, passages }, an archive row or a D1 interview row.');
  const id = parsed.data.specId ?? specId ?? closeout.id;
  const spec = specs.find(item => item.id === id);
  if (!spec) throw new Error(`Unknown interview "${id}". Known: ${specs.map(item => item.id).join(', ')}.`);
  return { spec, passages: parsed.data.passages };
}

/** New callers supply the independent report input. Historical files can select a shipped default format. */
export function readReport(value: unknown, specId?: string): NarrativeInput {
  if (value && typeof value === 'object' && 'format' in value) return narrativeRequestSchema.parse(value);
  const { spec, passages } = readTranscript(value, specId);
  return narrativeRequestSchema.parse({ transcript: passages, format: spec.plan.report });
}

async function main() {
  const { file, specId, out } = parseArgs(Bun.argv.slice(2));
  const input = readReport(await Bun.file(file).json(), specId);
  const foundry = foundryConfig(process.env);
  // Only the language model is called; the voice and judge providers are built but never used.
  const providers = foundryProviders(foundry);
  const run = writeNarrative(input, providers, AbortSignal.timeout(120_000));
  for await (const chunk of run.stream) process.stdout.write(chunk);
  process.stdout.write('\n');
  const result = { version: NARRATIVE_VERSION, model: foundry.agentModel, ...await run.result };
  const json = JSON.stringify(result, null, 2);
  if (out) await Bun.write(out, json + '\n');
  else process.stdout.write(json + '\n');
  if (result.failure) process.exitCode = 1;
}

if (import.meta.main) await main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
